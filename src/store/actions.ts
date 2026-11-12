import { z } from "zod";
import { db, type Statement } from "@/db/driver";
import { TABLES } from "@/db/migrations";
import { deleteStmt, insertStmt, newId, updateStmt } from "@/db/sql";
import { addDays, atTime, todayStr, type DateStr } from "@/domain/dates";
import { occurrencesBetween, type RecurrenceRule } from "@/domain/recurrence";
import {
  entryInput, eventInput, goalInput, habitInput, projectInput, ruleInput, targetInput, taskInput,
  type EntryInput, type EventInput, type GoalInput, type HabitInput, type ProjectInput, type TargetInput, type Task,
  type TaskFilter, type TaskInput, type JournalEntry, type FocusSession, isOpen,
} from "@/domain/types";
import { data, mutate, reload, type Settings } from "./data";

const now = () => Date.now();
/** How far ahead recurring occurrences are materialised. */
export const RECURRENCE_HORIZON_DAYS = 35;

const logStmt = (project_id: string | null | undefined, kind: string, message: string): Statement[] =>
  project_id ? [insertStmt("activity_logs", { id: newId(), project_id, kind, message, created_at: now() })] : [];

// ---- settings & profile -----------------------------------------------------

export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
  await mutate(
    [{ sql: "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", params: [key, JSON.stringify(value), now()] }],
    ["settings"],
  );
}

export async function saveProfile(display_name: string): Promise<void> {
  const name = z.string().trim().min(1, "Enter a display name").max(60).parse(display_name);
  const p = data().profile;
  await mutate([p ? updateStmt("profiles", p.id, { display_name: name }) : insertStmt("profiles", { id: newId(), display_name: name, created_at: now() })], ["profiles"]);
}

// ---- categories & tags ------------------------------------------------------

export async function saveCategory(input: { id?: string; name: string; color: string }): Promise<string> {
  const name = z.string().trim().min(1, "Name the category").max(60).parse(input.name);
  if (data().categories.some((c) => c.id !== input.id && c.name.toLowerCase() === name.toLowerCase())) throw new Error(`A category named "${name}" already exists`);
  const id = input.id ?? newId();
  await mutate(
    [input.id ? updateStmt("categories", id, { name, color: input.color }) : insertStmt("categories", { id, name, color: input.color, sort_order: data().categories.length, created_at: now() })],
    ["categories"],
  );
  return id;
}

export const deleteCategory = (id: string) => mutate([deleteStmt("categories", id)], ["categories", "tasks", "projects", "habits", "time_targets", "time_entries", "focus_sessions", "goals"]);

export async function ensureTag(name: string): Promise<string> {
  const clean = z.string().trim().min(1).max(40).parse(name.replace(/^#/, ""));
  const existing = data().tags.find((t) => t.name.toLowerCase() === clean.toLowerCase());
  if (existing) return existing.id;
  const id = newId();
  await mutate([insertStmt("tags", { id, name: clean, created_at: now() })], ["tags"]);
  return id;
}

export const deleteTag = (id: string) => mutate([deleteStmt("tags", id)], ["tags", "task_tags"]);

// ---- tasks ------------------------------------------------------------------

export async function createTask(input: TaskInput & { tag_ids?: string[] }): Promise<string> {
  const { tag_ids, ...rest } = input;
  const v = taskInput.parse(rest);
  const parent = v.parent_id ? data().tasks.find((t) => t.id === v.parent_id) : null;
  const project_id = parent ? parent.project_id : (v.project_id ?? null);
  const status = v.status ?? (parent || project_id || v.due_date || v.scheduled_at ? "not_started" : "inbox");
  const id = newId();
  const ts = now();
  await mutate(
    [
      insertStmt("tasks", {
        id, parent_id: v.parent_id ?? null, project_id, category_id: v.category_id ?? parent?.category_id ?? null,
        title: v.title, description: v.description ?? "", notes: v.notes ?? "", status, priority: v.priority ?? 5,
        start_date: v.start_date ?? null, due_date: v.due_date ?? null, scheduled_at: v.scheduled_at ?? null,
        scheduled_minutes: v.scheduled_minutes ?? null, estimated_seconds: v.estimated_seconds ?? null,
        reminder_at: v.reminder_at ?? null, links: v.links ?? [], sort_order: ts, created_at: ts, updated_at: ts,
        completed_at: status === "completed" ? ts : null,
      }),
      ...(tag_ids ?? []).map((tag_id) => insertStmt("task_tags", { task_id: id, tag_id }, true)),
      ...(parent ? [] : logStmt(project_id, "task_added", `Task added: ${v.title}`)),
    ],
    ["tasks", "task_tags", "activity_logs"],
  );
  return id;
}

/** Fields whose change on a recurring occurrence means "this occurrence only". */
const DETACHING = ["title", "description", "priority", "project_id", "category_id", "estimated_seconds", "due_date", "scheduled_at", "scheduled_minutes"];

export async function updateTask(id: string, patch: Partial<TaskInput>): Promise<void> {
  const task = data().tasks.find((t) => t.id === id);
  if (!task) return;
  const v = taskInput.partial().parse(patch) as Partial<Task>;
  const ts = now();
  const next: Partial<Task> = { ...v, updated_at: ts };
  const stmts: Statement[] = [];
  if (v.status && v.status !== task.status) {
    next.completed_at = v.status === "completed" ? ts : null;
    if (v.status === "completed" && !task.parent_id) stmts.push(...logStmt(task.project_id, "task_completed", `Task completed: ${task.title}`));
  }
  if (task.series_id && Object.keys(v).some((k) => DETACHING.includes(k))) next.is_detached = 1;
  if ("project_id" in v && v.project_id !== task.project_id) {
    // Subtasks always live in their parent's project.
    stmts.push({ sql: "UPDATE tasks SET project_id = ? WHERE parent_id = ?", params: [v.project_id ?? null, id] });
  }
  await mutate([updateStmt("tasks", id, next), ...stmts], ["tasks", "activity_logs"]);
}

export const toggleTask = (t: Task) => updateTask(t.id, { status: t.status === "completed" ? (t.project_id || t.due_date ? "not_started" : "inbox") : "completed" });

export async function deleteTask(id: string): Promise<void> {
  const task = data().tasks.find((t) => t.id === id);
  if (!task) return;
  // A deleted occurrence keeps its row so the series does not generate it again.
  const stmt = task.series_id ? updateStmt("tasks", id, { deleted_at: now() }) : deleteStmt("tasks", id);
  await mutate([stmt], ["tasks", "task_tags", "task_dependencies", "time_entries", "focus_sessions"]);
}

export async function setTaskTags(taskId: string, tagIds: string[]): Promise<void> {
  await mutate(
    [{ sql: "DELETE FROM task_tags WHERE task_id = ?", params: [taskId] }, ...tagIds.map((tag_id) => insertStmt("task_tags", { task_id: taskId, tag_id }, true))],
    ["task_tags"],
  );
}

export async function setDependency(taskId: string, dependsOnId: string, on: boolean): Promise<void> {
  if (taskId === dependsOnId) throw new Error("A task cannot depend on itself");
  if (on) {
    // Reject cycles: walk what `dependsOnId` (transitively) depends on.
    const deps = data().deps;
    const seen = new Set<string>();
    const stack = [dependsOnId];
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === taskId) throw new Error("That would create a circular dependency");
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const d of deps) if (d.task_id === cur) stack.push(d.depends_on_id);
    }
  }
  await mutate(
    [on ? insertStmt("task_dependencies", { task_id: taskId, depends_on_id: dependsOnId }, true) : { sql: "DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_id = ?", params: [taskId, dependsOnId] }],
    ["task_dependencies"],
  );
}

// ---- recurring tasks --------------------------------------------------------

export interface SeriesTemplate {
  title: string;
  description?: string;
  priority?: number;
  project_id?: string | null;
  category_id?: string | null;
  estimated_seconds?: number | null;
  scheduled_time?: string | null;
  tag_ids?: string[];
}

const occurrenceId = (seriesId: string, date: DateStr) => `${seriesId}:${date}`;

function occurrenceStmts(seriesId: string, tpl: SeriesTemplate, dates: DateStr[]): Statement[] {
  const ts = now();
  return dates.flatMap((date, i) => {
    const id = occurrenceId(seriesId, date);
    return [
      // OR IGNORE + the unique (series_id, occurrence_date) index make generation idempotent.
      insertStmt("tasks", {
        id, series_id: seriesId, occurrence_date: date, project_id: tpl.project_id ?? null, category_id: tpl.category_id ?? null,
        title: tpl.title, description: tpl.description ?? "", status: "planned", priority: tpl.priority ?? 5, due_date: date,
        scheduled_at: tpl.scheduled_time ? atTime(date, tpl.scheduled_time) : null,
        scheduled_minutes: tpl.scheduled_time ? Math.max(15, Math.round((tpl.estimated_seconds ?? 1800) / 60)) : null,
        estimated_seconds: tpl.estimated_seconds ?? null, sort_order: ts + i, created_at: ts, updated_at: ts,
      }, true),
      ...(tpl.tag_ids ?? []).map((tag_id) => ({
        sql: "INSERT OR IGNORE INTO task_tags (task_id, tag_id) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM tasks WHERE id = ? AND created_at = ?)",
        params: [id, tag_id, id, ts],
      })),
    ];
  });
}

/** Materialises occurrences of every series up to the horizon. Safe to call repeatedly. */
export async function generateOccurrences(today: DateStr = todayStr()): Promise<void> {
  const { series, rules, settings } = data();
  const through = addDays(today, RECURRENCE_HORIZON_DAYS);
  const stmts: Statement[] = [];
  for (const s of series) {
    const rule = rules.find((r) => r.id === s.rule_id);
    if (!rule) continue;
    if (s.generated_through && s.generated_through >= through) continue;
    const from = s.generated_through ? addDays(s.generated_through, 1) : rule.start_date;
    stmts.push(...occurrenceStmts(s.id, s, occurrencesBetween(rule, from, through, settings.weekStart)));
    stmts.push(updateStmt("task_series", s.id, { generated_through: through }));
  }
  if (stmts.length) await mutate(stmts, ["tasks", "task_tags", "task_series"]);
}

export async function createSeries(tpl: SeriesTemplate, rule: RecurrenceRule, replaceTaskId?: string): Promise<string> {
  const r = ruleInput.parse(rule);
  const title = z.string().trim().min(1, "A task needs a title").max(500).parse(tpl.title);
  const ruleId = newId();
  const seriesId = newId();
  const ts = now();
  await mutate(
    [
      insertStmt("recurrence_rules", { id: ruleId, ...r, created_at: ts }),
      insertStmt("task_series", {
        id: seriesId, rule_id: ruleId, title, description: tpl.description ?? "", priority: tpl.priority ?? 5,
        project_id: tpl.project_id ?? null, category_id: tpl.category_id ?? null, estimated_seconds: tpl.estimated_seconds ?? null,
        scheduled_time: tpl.scheduled_time ?? null, tag_ids: tpl.tag_ids ?? [], generated_through: null, created_at: ts, updated_at: ts,
      }),
      // Turning an existing one-off task into a series replaces it with the generated occurrences.
      ...(replaceTaskId ? [deleteStmt("tasks", replaceTaskId)] : []),
    ],
    ["recurrence_rules", "task_series", "tasks"],
  );
  await generateOccurrences();
  return seriesId;
}

/**
 * Edits a recurring task.
 *  - scope "all": the whole series. Completed and individually edited occurrences are left untouched.
 *  - scope "future": occurrences from `fromDate` on move to a new series; the old one ends the day before.
 * (Editing a single occurrence is a plain `updateTask`, which detaches it.)
 */
export async function updateSeries(seriesId: string, tpl: SeriesTemplate, rule: RecurrenceRule, scope: "all" | "future", fromDate: DateStr): Promise<void> {
  const st = data();
  const series = st.series.find((s) => s.id === seriesId);
  const oldRule = st.rules.find((r) => r.id === series?.rule_id);
  if (!series || !oldRule) return;
  const r = ruleInput.parse(rule);
  const title = z.string().trim().min(1, "A task needs a title").max(500).parse(tpl.title);
  const ts = now();
  const today = todayStr();
  const through = addDays(today, RECURRENCE_HORIZON_DAYS);
  const stmts: Statement[] = [];
  const fields = {
    title, description: tpl.description ?? "", priority: tpl.priority ?? 5, project_id: tpl.project_id ?? null,
    category_id: tpl.category_id ?? null, estimated_seconds: tpl.estimated_seconds ?? null, scheduled_time: tpl.scheduled_time ?? null, tag_ids: tpl.tag_ids ?? [],
  };
  let targetSeries = seriesId;
  let cutoff: DateStr;

  if (scope === "all") {
    cutoff = today;
    stmts.push(updateStmt("recurrence_rules", oldRule.id, r), updateStmt("task_series", seriesId, { ...fields, generated_through: through, updated_at: ts }));
  } else {
    cutoff = fromDate;
    targetSeries = newId();
    const ruleId = newId();
    r.start_date = r.start_date < fromDate ? fromDate : r.start_date;
    stmts.push(
      updateStmt("recurrence_rules", oldRule.id, { end_date: addDays(fromDate, -1) }),
      insertStmt("recurrence_rules", { id: ruleId, ...r, created_at: ts }),
      insertStmt("task_series", { id: targetSeries, rule_id: ruleId, ...fields, generated_through: through, created_at: ts, updated_at: ts }),
    );
  }

  const wanted = new Set(occurrencesBetween(r, cutoff, through, st.settings.weekStart));
  // Dates already held by history (completed, individually edited or deleted occurrences) are never regenerated.
  const held = await db().select<{ id: string; occurrence_date: string }>("SELECT id, occurrence_date FROM tasks WHERE series_id = ? AND occurrence_date >= ?", [seriesId, cutoff]);
  // Open, un-detached occurrences from the cutoff on follow the edit; everything else is history.
  const live = st.tasks.filter((t) => t.series_id === seriesId && t.occurrence_date && t.occurrence_date >= cutoff && isOpen(t) && !t.is_detached);
  for (const t of live) {
    const date = t.occurrence_date!;
    if (!wanted.has(date)) {
      stmts.push(deleteStmt("tasks", t.id));
      continue;
    }
    wanted.delete(date);
    stmts.push(
      updateStmt("tasks", t.id, {
        series_id: targetSeries, title, description: fields.description, priority: fields.priority, project_id: fields.project_id,
        category_id: fields.category_id, estimated_seconds: fields.estimated_seconds, due_date: date,
        scheduled_at: fields.scheduled_time ? atTime(date, fields.scheduled_time) : null,
        scheduled_minutes: fields.scheduled_time ? Math.max(15, Math.round((fields.estimated_seconds ?? 1800) / 60)) : null, updated_at: ts,
      }),
      { sql: "DELETE FROM task_tags WHERE task_id = ?", params: [t.id] },
      ...fields.tag_ids.map((tag_id) => insertStmt("task_tags", { task_id: t.id, tag_id }, true)),
    );
  }
  const liveIds = new Set(live.map((t) => t.id));
  for (const h of held) if (!liveIds.has(h.id)) wanted.delete(h.occurrence_date);
  stmts.push(...occurrenceStmts(targetSeries, fields, [...wanted].sort()));
  await mutate(stmts, ["recurrence_rules", "task_series", "tasks", "task_tags"]);
}

/** Stops a series: history stays, open future occurrences are removed. */
export async function endSeries(seriesId: string): Promise<void> {
  const st = data();
  const series = st.series.find((s) => s.id === seriesId);
  if (!series) return;
  const today = todayStr();
  await mutate(
    [
      updateStmt("recurrence_rules", series.rule_id, { end_date: today }),
      ...st.tasks.filter((t) => t.series_id === seriesId && t.occurrence_date! > today && isOpen(t) && !t.is_detached).map((t) => deleteStmt("tasks", t.id)),
    ],
    ["recurrence_rules", "tasks", "task_tags"],
  );
}

// ---- projects ---------------------------------------------------------------

export async function createProject(input: ProjectInput): Promise<string> {
  const v = projectInput.parse(input);
  const id = newId();
  const ts = now();
  const parent = v.parent_id ? data().projects.find((p) => p.id === v.parent_id) : null;
  await mutate(
    [
      insertStmt("projects", {
        id, parent_id: v.parent_id ?? null, name: v.name, description: v.description ?? "", notes: v.notes ?? "", status: v.status ?? "active",
        priority: v.priority ?? 5, color: v.color ?? parent?.color ?? "#5b7a99", category_id: v.category_id ?? parent?.category_id ?? null,
        start_date: v.start_date ?? null, deadline: v.deadline ?? null, estimated_seconds: v.estimated_seconds ?? null,
        weekly_target_seconds: v.weekly_target_seconds ?? null, daily_target_seconds: v.daily_target_seconds ?? null,
        progress_mode: v.progress_mode ?? "tasks", sort_order: ts, created_at: ts, updated_at: ts,
      }),
      ...logStmt(id, "created", parent ? `Subproject created under ${parent.name}` : "Project created"),
      ...logStmt(parent?.id, "subproject_added", `Subproject added: ${v.name}`),
    ],
    ["projects", "activity_logs"],
  );
  return id;
}

export async function updateProject(id: string, patch: Partial<ProjectInput>): Promise<void> {
  const p = data().projects.find((x) => x.id === id);
  if (!p) return;
  const v = projectInput.partial().parse(patch);
  const ts = now();
  const logs: Statement[] = [];
  if ("deadline" in v && v.deadline !== p.deadline) logs.push(...logStmt(id, "deadline_changed", v.deadline ? `Deadline changed to ${v.deadline}` : "Deadline removed"));
  if (v.status && v.status !== p.status) logs.push(...logStmt(id, "status_changed", `Status changed to ${v.status.replace("_", " ")}`));
  const completed_at = v.status ? (v.status === "completed" ? ts : null) : p.completed_at;
  await mutate([updateStmt("projects", id, { ...v, completed_at, updated_at: ts }), ...logs], ["projects", "activity_logs"]);
}

/** Deletes a project and its subprojects. Tasks and tracked time are kept and become project-less. */
export const deleteProject = (id: string) =>
  mutate([deleteStmt("projects", id)], ["projects", "milestones", "tasks", "task_series", "time_entries", "focus_sessions", "calendar_events", "goals", "activity_logs"]);

export async function addMilestone(project_id: string, title: string, due_date: DateStr | null): Promise<void> {
  const t = z.string().trim().min(1, "Name the milestone").max(300).parse(title);
  await mutate(
    [insertStmt("milestones", { id: newId(), project_id, title: t, due_date, sort_order: now(), created_at: now() }), ...logStmt(project_id, "milestone_added", `Milestone added: ${t}`)],
    ["milestones", "activity_logs"],
  );
}

export async function toggleMilestone(id: string): Promise<void> {
  const m = data().milestones.find((x) => x.id === id);
  if (!m) return;
  const done = m.completed_at == null;
  await mutate(
    [updateStmt("milestones", id, { completed_at: done ? now() : null }), ...(done ? logStmt(m.project_id, "milestone_achieved", `Milestone achieved: ${m.title}`) : [])],
    ["milestones", "activity_logs"],
  );
}

export const deleteMilestone = (id: string) => mutate([deleteStmt("milestones", id)], ["milestones"]);

// ---- weekly time targets ----------------------------------------------------

export async function saveTarget(input: TargetInput & { id?: string }): Promise<void> {
  const { id, ...rest } = input;
  const v = targetInput.parse(rest);
  const row = { name: v.name, category_id: v.category_id ?? null, weekly_seconds: v.weekly_seconds, preferred_days: v.preferred_days ?? null, min_session_seconds: v.min_session_seconds ?? null, max_session_seconds: v.max_session_seconds ?? null };
  await mutate([id ? updateStmt("time_targets", id, row) : insertStmt("time_targets", { id: newId(), ...row, created_at: now() })], ["time_targets"]);
}

export const archiveTarget = (id: string) => mutate([updateStmt("time_targets", id, { archived_at: now() })], ["time_targets"]);

// ---- time entries & sessions ------------------------------------------------

function entryContext(v: EntryInput) {
  const task = v.task_id ? data().tasks.find((t) => t.id === v.task_id) : null;
  return {
    task_id: v.task_id ?? null,
    project_id: v.project_id ?? task?.project_id ?? null,
    category_id: v.category_id ?? task?.category_id ?? null,
    target_id: v.target_id ?? null,
  };
}

export async function addManualEntry(input: EntryInput): Promise<void> {
  const v = entryInput.parse(input);
  if (v.ended_at > now() + 60_000) throw new Error("Time entries cannot end in the future");
  const ts = now();
  await mutate(
    [insertStmt("time_entries", { id: newId(), session_id: null, source: "manual", ...entryContext(v), started_at: v.started_at, ended_at: v.ended_at, description: v.description ?? "", created_at: ts, updated_at: ts })],
    ["time_entries"],
  );
}

export async function updateEntry(id: string, input: EntryInput): Promise<void> {
  const v = entryInput.parse(input);
  await mutate([updateStmt("time_entries", id, { ...entryContext(v), started_at: v.started_at, ended_at: v.ended_at, description: v.description ?? "", updated_at: now() })], ["time_entries"]);
}

export const deleteEntry = (id: string) => mutate([deleteStmt("time_entries", id)], ["time_entries"]);

export async function updateSession(id: string, patch: Partial<Pick<FocusSession, "rating" | "notes" | "objective">>): Promise<void> {
  const v = z.object({ rating: z.number().int().min(1).max(5).nullable(), notes: z.string().max(20_000), objective: z.string().max(500) }).partial().parse(patch);
  await mutate([updateStmt("focus_sessions", id, { ...v, updated_at: now() })], ["focus_sessions"]);
}

export const deleteSession = (id: string) => mutate([deleteStmt("focus_sessions", id)], ["focus_sessions", "time_entries"]);

// ---- calendar ---------------------------------------------------------------

export async function saveEvent(input: EventInput & { id?: string }): Promise<void> {
  const { id, ...rest } = input;
  const v = eventInput.parse(rest);
  const ts = now();
  const row = { title: v.title, description: v.description ?? "", kind: v.kind ?? "event", start_at: v.start_at, end_at: v.end_at, project_id: v.project_id ?? null, target_id: v.target_id ?? null, reminder_minutes: v.reminder_minutes ?? null, updated_at: ts };
  await mutate([id ? updateStmt("calendar_events", id, row) : insertStmt("calendar_events", { id: newId(), ...row, created_at: ts })], ["calendar_events"]);
}

export const moveEvent = (id: string, start_at: number, end_at: number) => mutate([updateStmt("calendar_events", id, { start_at, end_at, updated_at: now() })], ["calendar_events"]);
export const deleteEvent = (id: string) => mutate([deleteStmt("calendar_events", id)], ["calendar_events"]);

// ---- habits -----------------------------------------------------------------

export async function saveHabit(input: HabitInput & { id?: string }): Promise<void> {
  const { id, ...rest } = input;
  const v = habitInput.parse(rest);
  const row = { name: v.name, description: v.description ?? "", category_id: v.category_id ?? null, kind: v.kind, target_value: v.kind === "boolean" ? 1 : v.target_value, unit: v.unit ?? "", weekdays: v.weekdays, reminder_time: v.reminder_time ?? null };
  await mutate([id ? updateStmt("habits", id, row) : insertStmt("habits", { id: newId(), ...row, sort_order: now(), created_date: todayStr(), created_at: now() })], ["habits"]);
}

export const archiveHabit = (id: string) => mutate([updateStmt("habits", id, { archived_at: now() })], ["habits"]);
export const deleteHabit = (id: string) => mutate([deleteStmt("habits", id)], ["habits", "habit_entries"]);

/** Adds a check-in (additive). Clears a rest-day mark for that date. */
export async function checkInHabit(habit_id: string, date: DateStr, value: number): Promise<void> {
  if (!(value > 0)) return;
  await mutate(
    [{ sql: "DELETE FROM habit_entries WHERE habit_id = ? AND date = ? AND skipped = 1", params: [habit_id, date] }, insertStmt("habit_entries", { id: newId(), habit_id, date, value, skipped: 0, created_at: now() })],
    ["habit_entries"],
  );
}

/** Clears the day (all check-ins and any rest mark). */
export const resetHabitDay = (habit_id: string, date: DateStr) => mutate([{ sql: "DELETE FROM habit_entries WHERE habit_id = ? AND date = ?", params: [habit_id, date] }], ["habit_entries"]);

export async function restHabitDay(habit_id: string, date: DateStr): Promise<void> {
  await mutate(
    [{ sql: "DELETE FROM habit_entries WHERE habit_id = ? AND date = ?", params: [habit_id, date] }, insertStmt("habit_entries", { id: newId(), habit_id, date, value: 0, skipped: 1, created_at: now() })],
    ["habit_entries"],
  );
}

// ---- goals, journal, smart views -------------------------------------------

export async function saveGoal(input: GoalInput & { id?: string }): Promise<void> {
  const { id, ...rest } = input;
  const v = goalInput.parse(rest);
  if (v.period === "custom" && (!v.start_date || !v.end_date || v.end_date < v.start_date)) throw new Error("A custom goal needs a valid start and end date");
  const row = { title: v.title, period: v.period, metric: v.metric, target_value: v.target_value, project_id: v.project_id ?? null, category_id: v.category_id ?? null, start_date: v.start_date ?? null, end_date: v.end_date ?? null };
  await mutate([id ? updateStmt("goals", id, row) : insertStmt("goals", { id: newId(), ...row, created_at: now() })], ["goals"]);
}

export const setGoalProgress = (id: string, manual_value: number) => mutate([updateStmt("goals", id, { manual_value: Math.max(0, manual_value) })], ["goals"]);
export const deleteGoal = (id: string) => mutate([deleteStmt("goals", id)], ["goals"]);

export async function saveJournal(date: DateStr, patch: Partial<Omit<JournalEntry, "date" | "updated_at">>): Promise<void> {
  const cur = data().journal[date];
  const base = cur ?? { accomplishments: "", went_well: "", went_wrong: "", improve: "", tomorrow: "" };
  const row = { ...base, ...patch, date, updated_at: now() };
  const cols = Object.keys(row);
  await mutate(
    [{ sql: `INSERT OR REPLACE INTO journal_entries (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, params: cols.map((c) => (row as Record<string, string | number>)[c]!) }],
    ["journal_entries"],
  );
}

export async function saveSmartView(name: string, filter: TaskFilter): Promise<void> {
  const n = z.string().trim().min(1, "Name the view").max(60).parse(name);
  await mutate([insertStmt("smart_views", { id: newId(), name: n, filter, created_at: now() })], ["smart_views"]);
}
export const deleteSmartView = (id: string) => mutate([deleteStmt("smart_views", id)], ["smart_views"]);

// ---- export / import --------------------------------------------------------

const exportSchema = z.object({
  app: z.literal("tempo"),
  schema_version: z.number().int().min(1),
  exported_at: z.number(),
  tables: z.record(z.string(), z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()])))),
});
export type ExportFile = z.infer<typeof exportSchema>;

const schemaVersion = async () => (await db().select<{ v: number }>("SELECT MAX(version) AS v FROM schema_migrations"))[0]?.v ?? 0;

export async function exportAll(): Promise<ExportFile> {
  const tables: ExportFile["tables"] = {};
  for (const t of TABLES) {
    // Live timer state is device-local and is not part of an export.
    tables[t] = await db().select(t === "settings" ? "SELECT * FROM settings WHERE key <> 'active_timer'" : `SELECT * FROM ${t}`);
  }
  return { app: "tempo", schema_version: await schemaVersion(), exported_at: now(), tables };
}

/** Replaces all data with the contents of an export file, atomically. */
export async function importAll(raw: unknown): Promise<void> {
  const file = exportSchema.parse(raw);
  const current = await schemaVersion();
  if (file.schema_version > current) throw new Error("This file was exported by a newer version of Tempo");
  const stmts: Statement[] = [{ sql: "PRAGMA defer_foreign_keys = ON" }];
  for (const t of [...TABLES].reverse()) stmts.push({ sql: `DELETE FROM ${t}` });
  for (const t of TABLES) {
    const list = file.tables[t];
    if (!list?.length) continue;
    // Only real columns of the table are accepted — file contents never reach SQL as identifiers.
    const cols = new Set((await db().select<{ name: string }>(`PRAGMA table_info(${t})`)).map((c) => c.name));
    for (const row of list) {
      const keys = Object.keys(row).filter((k) => cols.has(k));
      if (!keys.length) continue;
      stmts.push({ sql: `INSERT INTO ${t} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, params: keys.map((k) => row[k] ?? null) });
    }
  }
  stmts.push(insertStmt("backup_history", { id: newId(), name: "import", kind: "restore", size: null, created_at: now() }));
  await db().batch(stmts);
  await reload();
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (header: string[], lines: unknown[][]) => [header, ...lines].map((l) => l.map(csvCell).join(",")).join("\r\n");
