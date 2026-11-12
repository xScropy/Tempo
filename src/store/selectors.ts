import { addDays, dayStartMs, startOfWeek, todayStr, type DateStr } from "@/domain/dates";
import { projectSubtree } from "@/domain/projects";
import { periodRange } from "@/domain/targets";
import { secondsByGroup, totalSeconds, type Interval } from "@/domain/time";
import type { FocusSession, Goal, HabitEntry, Project, Task, TimeEntry } from "@/domain/types";
import type { HabitDay } from "@/domain/habits";

export type EntryInterval = TimeEntry & Interval;

const intervalCache = new WeakMap<TimeEntry[], EntryInterval[]>();
/** Entries as intervals (cached per entries array, which is replaced on every reload). */
export function intervals(entries: TimeEntry[]): EntryInterval[] {
  let v = intervalCache.get(entries);
  if (!v) {
    v = entries.map((e) => ({ ...e, start: e.started_at, end: e.ended_at }));
    intervalCache.set(entries, v);
  }
  return v;
}

const taskCache = new WeakMap<TimeEntry[], Map<string, number>>();
/** All-time tracked seconds per task id (a subtask's time is under the subtask's own id). */
export function taskSeconds(entries: TimeEntry[]): Map<string, number> {
  let v = taskCache.get(entries);
  if (!v) {
    v = secondsByGroup(intervals(entries).filter((e) => e.task_id), (e) => e.task_id);
    taskCache.set(entries, v);
  }
  return v;
}

/** Tracked seconds of a task including its subtasks, overlap-free. */
export function taskTotalSeconds(task: Task, tasks: Task[], entries: TimeEntry[]): number {
  const ids = new Set([task.id, ...tasks.filter((t) => t.parent_id === task.id).map((t) => t.id)]);
  if (ids.size === 1) return taskSeconds(entries).get(task.id) ?? 0;
  return totalSeconds(intervals(entries).filter((e) => e.task_id && ids.has(e.task_id)));
}

/** Tracked seconds of a project including all subprojects — each minute counted once. */
export function projectSeconds(projectId: string, projects: Project[], entries: TimeEntry[], from = -Infinity, to = Infinity): number {
  const ids = projectSubtree(projectId, projects);
  return totalSeconds(intervals(entries).filter((e) => e.project_id && ids.has(e.project_id)), from, to);
}

export function weekRange(today: DateStr, weekStart: number): { start: DateStr; from: number; to: number } {
  const start = startOfWeek(today, weekStart);
  return { start, from: dayStartMs(start), to: dayStartMs(addDays(start, 7)) };
}

export const dayRange = (date: DateStr) => ({ from: dayStartMs(date), to: dayStartMs(addDays(date, 1)) });

/** Seconds counted toward a standalone weekly target: entries tagged with it directly. */
export function targetSeconds(targetId: string, entries: TimeEntry[], from: number, to: number): number {
  return totalSeconds(intervals(entries).filter((e) => e.target_id === targetId), from, to);
}

export function sessionSeconds(sessionId: string, entries: TimeEntry[]): number {
  let ms = 0;
  for (const e of entries) if (e.session_id === sessionId) ms += e.ended_at - e.started_at;
  return Math.round(ms / 1000);
}

export function habitDays(habitId: string, entries: HabitEntry[]): Map<DateStr, HabitDay> {
  const out = new Map<DateStr, HabitDay>();
  for (const e of entries) {
    if (e.habit_id !== habitId) continue;
    const cur = out.get(e.date) ?? { value: 0, skipped: false };
    out.set(e.date, { value: cur.value + e.value, skipped: cur.skipped || e.skipped === 1 });
  }
  return out;
}

export interface GoalProgress {
  current: number;
  target: number;
  fraction: number;
  start: DateStr;
  end: DateStr;
  /** unit for display: "h", "tasks", "sessions" or "" */
  unit: string;
}

export function goalProgress(
  g: Goal,
  ctx: { tasks: Task[]; entries: TimeEntry[]; sessions: FocusSession[]; projects: Project[]; weekStart: number },
  today: DateStr = todayStr(),
): GoalProgress {
  const { start, end } = periodRange(g.period, today, ctx.weekStart, { start: g.start_date, end: g.end_date });
  const from = dayStartMs(start);
  const to = dayStartMs(addDays(end, 1));
  const projectIds = g.project_id ? projectSubtree(g.project_id, ctx.projects) : null;
  const inScope = (x: { project_id: string | null; category_id: string | null }) =>
    (!projectIds || (x.project_id != null && projectIds.has(x.project_id))) && (!g.category_id || x.category_id === g.category_id);
  let current = 0;
  let unit = "";
  if (g.metric === "focus_time") {
    current = totalSeconds(intervals(ctx.entries).filter(inScope), from, to) / 3600;
    unit = "h";
  } else if (g.metric === "tasks_completed") {
    current = ctx.tasks.filter((t) => t.status === "completed" && t.completed_at != null && t.completed_at >= from && t.completed_at < to && inScope(t)).length;
    unit = "tasks";
  } else if (g.metric === "sessions") {
    current = ctx.sessions.filter((s) => s.status === "completed" && s.started_at >= from && s.started_at < to && inScope(s)).length;
    unit = "sessions";
  } else current = g.manual_value;
  return { current, target: g.target_value, fraction: Math.min(1, current / g.target_value), start, end, unit };
}

const childCache = new WeakMap<Task[], Map<string, Task[]>>();
/** Subtasks grouped by parent id (cached per tasks array). */
export function subtasksByParent(tasks: Task[]): Map<string, Task[]> {
  let v = childCache.get(tasks);
  if (!v) {
    v = new Map();
    for (const t of tasks) if (t.parent_id) v.set(t.parent_id, [...(v.get(t.parent_id) ?? []), t]);
    childCache.set(tasks, v);
  }
  return v;
}

const byIdCache = new WeakMap<object[], Map<string, unknown>>();
/** id → row lookup, cached per array. */
export function byId<T extends { id: string }>(list: T[]): Map<string, T> {
  let v = byIdCache.get(list) as Map<string, T> | undefined;
  if (!v) {
    v = new Map(list.map((x) => [x.id, x]));
    byIdCache.set(list, v);
  }
  return v;
}

const NO_TASKS: Task[] = [];
export const subtasksOf = (tasks: Task[], id: string): Task[] => subtasksByParent(tasks).get(id) ?? NO_TASKS;

/** True when the task waits on a dependency that is still open. */
export function isBlocked(taskId: string, deps: Array<{ task_id: string; depends_on_id: string }>, tasks: Task[]): boolean {
  if (!deps.length) return false;
  const map = byId(tasks);
  return deps.some((d) => {
    if (d.task_id !== taskId) return false;
    const dep = map.get(d.depends_on_id);
    return !!dep && dep.status !== "completed" && dep.status !== "cancelled";
  });
}

/** Consecutive days with tracked focus time, ending today (an empty today does not break it). */
export function focusStreak(entries: TimeEntry[], today: DateStr): number {
  const days = new Set<DateStr>();
  for (const e of entries) {
    for (let d = dayStartMs(todayStr(new Date(e.started_at))); d < e.ended_at; d += 86_400_000) days.add(todayStr(new Date(d)));
  }
  let streak = 0;
  for (let d = today, i = 0; i < 3660; d = addDays(d, -1), i++) {
    if (days.has(d)) streak++;
    else if (d !== today) break;
  }
  return streak;
}

/**
 * Collapses recurring tasks to the next open occurrence of each series, so a
 * daily task shows up once in planning lists instead of once per future day.
 */
export function nextOccurrenceOnly(tasks: Task[]): Task[] {
  const earliest = new Map<string, Task>();
  for (const t of tasks) {
    if (!t.series_id || !t.occurrence_date) continue;
    const cur = earliest.get(t.series_id);
    if (!cur || t.occurrence_date < cur.occurrence_date!) earliest.set(t.series_id, t);
  }
  return tasks.filter((t) => !t.series_id || earliest.get(t.series_id) === t);
}
