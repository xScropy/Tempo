import { addDays, diffDays, type DateStr } from "./dates";

export type ProgressMode = "tasks" | "weighted" | "milestones";

export interface ProgressTask {
  id: string;
  parent_id: string | null;
  status: string;
  estimated_seconds: number | null;
  due_date: DateStr | null;
}

export interface ProgressMilestone {
  completed_at: number | null;
}

const isDone = (t: ProgressTask) => t.status === "completed";
const isLive = (t: ProgressTask) => t.status !== "cancelled";

/**
 * Completion fraction (0–1) of each top-level task: a completed task is 1;
 * otherwise it is the share of its (non-cancelled) subtasks that are done.
 */
export function taskCompletion(task: ProgressTask, subtasks: ProgressTask[]): number {
  if (isDone(task)) return 1;
  const live = subtasks.filter(isLive);
  if (!live.length) return 0;
  return live.filter(isDone).length / live.length;
}

/** Project progress 0–1, or null when there is nothing to measure. */
export function projectProgress(mode: ProgressMode, tasks: ProgressTask[], milestones: ProgressMilestone[]): number | null {
  if (mode === "milestones") {
    if (!milestones.length) return null;
    return milestones.filter((m) => m.completed_at != null).length / milestones.length;
  }
  const byParent = new Map<string, ProgressTask[]>();
  for (const t of tasks) {
    if (t.parent_id) byParent.set(t.parent_id, [...(byParent.get(t.parent_id) ?? []), t]);
  }
  const top = tasks.filter((t) => !t.parent_id && isLive(t));
  if (!top.length) return null;
  if (mode === "tasks") {
    return top.reduce((a, t) => a + taskCompletion(t, byParent.get(t.id) ?? []), 0) / top.length;
  }
  // Weighted by estimate. Tasks without an estimate get the mean estimate so they still count.
  const est = top.map((t) => t.estimated_seconds ?? 0).filter((e) => e > 0);
  const fallback = est.length ? est.reduce((a, b) => a + b, 0) / est.length : 1;
  let done = 0;
  let total = 0;
  for (const t of top) {
    const w = t.estimated_seconds && t.estimated_seconds > 0 ? t.estimated_seconds : fallback;
    total += w;
    done += w * taskCompletion(t, byParent.get(t.id) ?? []);
  }
  return total > 0 ? done / total : null;
}

export type HealthStatus = "done" | "on_track" | "at_risk" | "behind" | "no_data";

export interface HealthInput {
  status: string;
  today: DateStr;
  start_date: DateStr | null;
  deadline: DateStr | null;
  progress: number | null;
  overdueTasks: number;
  estimatedSeconds: number | null;
  actualSeconds: number;
  weeklyTargetSeconds: number | null;
  weekActualSeconds: number;
  /** full days of the current week already elapsed (0–6) */
  weekDaysElapsed: number;
}

export interface Health {
  status: HealthStatus;
  /** Plain-language reasons; health is never an opaque score. */
  reasons: string[];
}

export function projectHealth(i: HealthInput): Health {
  if (i.status === "completed") return { status: "done", reasons: ["Project completed"] };
  const reasons: string[] = [];
  let level = 0; // 0 on track, 1 at risk, 2 behind
  const bump = (l: number, r: string) => {
    level = Math.max(level, l);
    reasons.push(r);
  };
  const progress = i.progress ?? 0;

  if (i.deadline) {
    const left = diffDays(i.today, i.deadline);
    if (left < 0 && progress < 1) bump(2, `Deadline passed ${-left} day${left === -1 ? "" : "s"} ago`);
    else if (i.start_date && i.start_date < i.deadline) {
      const span = diffDays(i.start_date, i.deadline);
      const expected = Math.min(1, Math.max(0, diffDays(i.start_date, i.today) / span));
      const lag = expected - progress;
      if (lag > 0.25) bump(2, `${Math.round(progress * 100)}% done, ${Math.round(expected * 100)}% of the schedule elapsed`);
      else if (lag > 0.1) bump(1, `Slightly behind schedule (${Math.round(progress * 100)}% vs ${Math.round(expected * 100)}%)`);
    } else if (left <= 3 && progress < 0.8) bump(1, `Due in ${left} day${left === 1 ? "" : "s"} at ${Math.round(progress * 100)}%`);
  }
  if (i.overdueTasks > 0) bump(i.overdueTasks >= 3 ? 2 : 1, `${i.overdueTasks} overdue task${i.overdueTasks === 1 ? "" : "s"}`);
  if (i.estimatedSeconds && i.estimatedSeconds > 0 && progress < 1) {
    const used = i.actualSeconds / i.estimatedSeconds;
    if (used > 1) bump(1, `Time budget exceeded (${Math.round(used * 100)}% used)`);
    else if (used - progress > 0.3) bump(1, `${Math.round(used * 100)}% of the time budget used for ${Math.round(progress * 100)}% progress`);
  }
  if (i.weeklyTargetSeconds && i.weeklyTargetSeconds > 0 && i.weekDaysElapsed >= 3) {
    const expected = (i.weeklyTargetSeconds * i.weekDaysElapsed) / 7;
    if (i.weekActualSeconds < expected * 0.5) bump(1, "Well under this week's time target");
  }
  if (level === 0 && i.progress == null && !i.deadline) return { status: "no_data", reasons: ["Add tasks or a deadline to track health"] };
  return { status: level === 2 ? "behind" : level === 1 ? "at_risk" : "on_track", reasons: reasons.length ? reasons : ["No issues detected"] };
}

/** All descendant project ids including `rootId` itself. */
export function projectSubtree(rootId: string, projects: Array<{ id: string; parent_id: string | null }>): Set<string> {
  const out = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of projects) {
      if (p.parent_id && out.has(p.parent_id) && !out.has(p.id)) {
        out.add(p.id);
        grew = true;
      }
    }
  }
  return out;
}

export const isOverdue = (t: { due_date: DateStr | null; status: string }, today: DateStr): boolean =>
  !!t.due_date && t.due_date < today && t.status !== "completed" && t.status !== "cancelled";

export const dueWithin = (t: { due_date: DateStr | null }, today: DateStr, days: number): boolean =>
  !!t.due_date && t.due_date >= today && t.due_date <= addDays(today, days);
