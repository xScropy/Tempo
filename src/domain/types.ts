import { z } from "zod";
import type { DateStr } from "./dates";
import type { RecurrenceRule } from "./recurrence";

export const TASK_STATUSES = ["inbox", "not_started", "planned", "in_progress", "on_hold", "completed", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const STATUS_LABEL: Record<TaskStatus, string> = {
  inbox: "Inbox",
  not_started: "Not started",
  planned: "Planned",
  in_progress: "In progress",
  on_hold: "On hold",
  completed: "Completed",
  cancelled: "Cancelled",
};
export const PRIORITY_LABEL: Record<number, string> = { 1: "Critical", 2: "High", 3: "Medium", 4: "Low", 5: "No priority" };
export const PROJECT_STATUSES = ["planned", "active", "on_hold", "completed", "cancelled"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = { planned: "Planned", active: "Active", on_hold: "On hold", completed: "Completed", cancelled: "Cancelled" };

export const isOpen = (t: { status: string }) => t.status !== "completed" && t.status !== "cancelled";

export interface Category {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  created_at: number;
}
export interface Tag {
  id: string;
  name: string;
  created_at: number;
}
export interface Link {
  url: string;
  label: string;
}
export interface Task {
  id: string;
  parent_id: string | null;
  project_id: string | null;
  category_id: string | null;
  series_id: string | null;
  occurrence_date: DateStr | null;
  is_detached: number;
  title: string;
  description: string;
  notes: string;
  status: TaskStatus;
  priority: number;
  start_date: DateStr | null;
  due_date: DateStr | null;
  scheduled_at: number | null;
  scheduled_minutes: number | null;
  estimated_seconds: number | null;
  reminder_at: number | null;
  links: Link[];
  sort_order: number;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  deleted_at: number | null;
}
export interface Project {
  id: string;
  parent_id: string | null;
  name: string;
  description: string;
  notes: string;
  status: ProjectStatus;
  priority: number;
  color: string;
  category_id: string | null;
  start_date: DateStr | null;
  deadline: DateStr | null;
  estimated_seconds: number | null;
  weekly_target_seconds: number | null;
  daily_target_seconds: number | null;
  progress_mode: "tasks" | "weighted" | "milestones";
  sort_order: number;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}
export interface Milestone {
  id: string;
  project_id: string;
  title: string;
  due_date: DateStr | null;
  completed_at: number | null;
  sort_order: number;
  created_at: number;
}
export interface RuleRow extends RecurrenceRule {
  id: string;
  created_at: number;
}
export interface TaskSeries {
  id: string;
  rule_id: string;
  title: string;
  description: string;
  priority: number;
  project_id: string | null;
  category_id: string | null;
  estimated_seconds: number | null;
  scheduled_time: string | null;
  tag_ids: string[];
  generated_through: DateStr | null;
  created_at: number;
  updated_at: number;
}
export interface TimeTarget {
  id: string;
  name: string;
  category_id: string | null;
  weekly_seconds: number;
  preferred_days: number | null;
  min_session_seconds: number | null;
  max_session_seconds: number | null;
  created_at: number;
  archived_at: number | null;
}
export interface FocusSession {
  id: string;
  mode: "pomodoro" | "countdown" | "stopwatch" | "deep";
  planned_seconds: number | null;
  started_at: number;
  ended_at: number | null;
  status: "active" | "completed" | "interrupted";
  task_id: string | null;
  project_id: string | null;
  category_id: string | null;
  target_id: string | null;
  objective: string;
  rating: number | null;
  notes: string;
  created_at: number;
  updated_at: number;
}
export interface TimeEntry {
  id: string;
  session_id: string | null;
  source: "timer" | "manual";
  task_id: string | null;
  project_id: string | null;
  category_id: string | null;
  target_id: string | null;
  started_at: number;
  ended_at: number;
  description: string;
  created_at: number;
  updated_at: number;
}
export interface CalendarEvent {
  id: string;
  title: string;
  description: string;
  kind: "event" | "meeting" | "focus_block" | "personal";
  start_at: number;
  end_at: number;
  project_id: string | null;
  target_id: string | null;
  reminder_minutes: number | null;
  created_at: number;
  updated_at: number;
}
export interface Habit {
  id: string;
  name: string;
  description: string;
  category_id: string | null;
  kind: "boolean" | "duration" | "quantity" | "sessions";
  target_value: number;
  unit: string;
  weekdays: number[];
  reminder_time: string | null;
  sort_order: number;
  created_date: DateStr;
  created_at: number;
  archived_at: number | null;
}
export interface HabitEntry {
  id: string;
  habit_id: string;
  date: DateStr;
  value: number;
  skipped: number;
  created_at: number;
}
export interface Goal {
  id: string;
  title: string;
  period: "daily" | "weekly" | "monthly" | "yearly" | "custom";
  metric: "focus_time" | "tasks_completed" | "sessions" | "manual";
  target_value: number;
  manual_value: number;
  project_id: string | null;
  category_id: string | null;
  start_date: DateStr | null;
  end_date: DateStr | null;
  created_at: number;
  archived_at: number | null;
}
export interface JournalEntry {
  date: DateStr;
  accomplishments: string;
  went_well: string;
  went_wrong: string;
  improve: string;
  tomorrow: string;
  updated_at: number;
}
export interface ActivityLog {
  id: string;
  project_id: string;
  kind: string;
  message: string;
  created_at: number;
}
export interface TaskFilter {
  text?: string;
  project_id?: string | "none";
  category_id?: string;
  tag_id?: string;
  priority?: number;
  status?: TaskStatus | "open";
  due?: "overdue" | "today" | "week" | "none";
  recurring?: boolean;
  sort?: "manual" | "due" | "priority" | "created" | "estimate" | "actual" | "title";
}
export interface SmartView {
  id: string;
  name: string;
  filter: TaskFilter;
  created_at: number;
}
export interface Reward {
  id: string;
  title: string;
  cost: number;
  created_at: number;
  archived_at: number | null;
}
export interface Redemption {
  id: string;
  reward_id: string | null;
  title: string;
  cost: number;
  redeemed_at: number;
}
export interface Profile {
  id: string;
  display_name: string;
  created_at: number;
}

// ---- input validation -------------------------------------------------------

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optDate = dateStr.nullable().optional();
const seconds = z.number().int().min(0).max(100_000 * 3600).nullable().optional();
const id = z.string().min(1).nullable().optional();

export const taskInput = z.object({
  title: z.string().trim().min(1, "A task needs a title").max(500),
  description: z.string().max(20_000).optional(),
  notes: z.string().max(200_000).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.number().int().min(1).max(5).optional(),
  parent_id: id,
  project_id: id,
  category_id: id,
  start_date: optDate,
  due_date: optDate,
  scheduled_at: z.number().int().nullable().optional(),
  scheduled_minutes: z.number().int().min(5).max(24 * 60).nullable().optional(),
  estimated_seconds: seconds,
  reminder_at: z.number().int().nullable().optional(),
  links: z.array(z.object({ url: z.string().min(1).max(2000), label: z.string().max(200) })).optional(),
});
export type TaskInput = z.infer<typeof taskInput>;

export const projectInput = z.object({
  name: z.string().trim().min(1, "A project needs a name").max(200),
  parent_id: id,
  description: z.string().max(20_000).optional(),
  notes: z.string().max(200_000).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  priority: z.number().int().min(1).max(5).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  category_id: id,
  start_date: optDate,
  deadline: optDate,
  estimated_seconds: seconds,
  weekly_target_seconds: seconds,
  daily_target_seconds: seconds,
  progress_mode: z.enum(["tasks", "weighted", "milestones"]).optional(),
});
export type ProjectInput = z.infer<typeof projectInput>;

export const ruleInput = z
  .object({
    freq: z.enum(["daily", "weekly", "monthly"]),
    interval: z.number().int().min(1).max(365),
    weekdays: z.array(z.number().int().min(0).max(6)),
    monthdays: z.array(z.number().int().min(1).max(31)),
    start_date: dateStr,
    end_date: dateStr.nullable(),
    count: z.number().int().min(1).max(10_000).nullable(),
  })
  .refine((r) => !r.end_date || r.end_date >= r.start_date, "The end date is before the start date");

export const targetInput = z.object({
  name: z.string().trim().min(1, "Name the activity").max(200),
  category_id: id,
  weekly_seconds: z.number().int().min(60, "Set a weekly target").max(168 * 3600),
  preferred_days: z.number().int().min(1).max(7).nullable().optional(),
  min_session_seconds: seconds,
  max_session_seconds: seconds,
});
export type TargetInput = z.infer<typeof targetInput>;

export const entryInput = z
  .object({
    started_at: z.number().int(),
    ended_at: z.number().int(),
    task_id: id,
    project_id: id,
    category_id: id,
    target_id: id,
    description: z.string().max(5000).optional(),
  })
  .refine((e) => e.ended_at > e.started_at, "The end must be after the start")
  .refine((e) => e.ended_at - e.started_at <= 24 * 3600_000, "A single entry cannot be longer than 24 hours");
export type EntryInput = z.infer<typeof entryInput>;

export const eventInput = z
  .object({
    title: z.string().trim().min(1, "An event needs a title").max(300),
    description: z.string().max(5000).optional(),
    kind: z.enum(["event", "meeting", "focus_block", "personal"]).optional(),
    start_at: z.number().int(),
    end_at: z.number().int(),
    project_id: id,
    target_id: id,
    reminder_minutes: z.number().int().min(0).max(7 * 24 * 60).nullable().optional(),
  })
  .refine((e) => e.end_at > e.start_at, "The end must be after the start");
export type EventInput = z.infer<typeof eventInput>;

export const habitInput = z.object({
  name: z.string().trim().min(1, "A habit needs a name").max(200),
  description: z.string().max(5000).optional(),
  category_id: id,
  kind: z.enum(["boolean", "duration", "quantity", "sessions"]),
  target_value: z.number().positive().max(100_000),
  unit: z.string().max(30).optional(),
  weekdays: z.array(z.number().int().min(0).max(6)),
  reminder_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
});
export type HabitInput = z.infer<typeof habitInput>;

export const goalInput = z.object({
  title: z.string().trim().min(1, "A goal needs a title").max(300),
  period: z.enum(["daily", "weekly", "monthly", "yearly", "custom"]),
  metric: z.enum(["focus_time", "tasks_completed", "sessions", "manual"]),
  target_value: z.number().positive(),
  project_id: id,
  category_id: id,
  start_date: optDate,
  end_date: optDate,
});
export type GoalInput = z.infer<typeof goalInput>;

/** First human-readable message of a zod error. */
export const zodMessage = (e: unknown): string => (e instanceof z.ZodError ? (e.issues[0]?.message ?? "Invalid input") : e instanceof Error ? e.message : String(e));
