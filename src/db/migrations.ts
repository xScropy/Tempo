/**
 * Schema migrations. Append-only: never edit a shipped migration, add a new one.
 * Dates are local `YYYY-MM-DD` text; instants are epoch-millisecond integers.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial schema",
    sql: `
CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at INTEGER NOT NULL
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('planned','active','on_hold','completed','cancelled')),
  priority INTEGER NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 5),
  color TEXT NOT NULL DEFAULT '#5b7a99',
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  start_date TEXT,
  deadline TEXT,
  estimated_seconds INTEGER,
  weekly_target_seconds INTEGER,
  daily_target_seconds INTEGER,
  progress_mode TEXT NOT NULL DEFAULT 'tasks' CHECK (progress_mode IN ('tasks','weighted','milestones')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX idx_projects_parent ON projects(parent_id);

CREATE TABLE project_tags (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, tag_id)
);

CREATE TABLE milestones (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  due_date TEXT,
  completed_at INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_milestones_project ON milestones(project_id);

CREATE TABLE recurrence_rules (
  id TEXT PRIMARY KEY,
  freq TEXT NOT NULL CHECK (freq IN ('daily','weekly','monthly')),
  interval INTEGER NOT NULL DEFAULT 1 CHECK (interval >= 1),
  weekdays TEXT NOT NULL DEFAULT '[]',
  monthdays TEXT NOT NULL DEFAULT '[]',
  start_date TEXT NOT NULL,
  end_date TEXT,
  count INTEGER,
  created_at INTEGER NOT NULL
);

-- A recurring task: the template every occurrence is generated from.
CREATE TABLE task_series (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES recurrence_rules(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 5,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  estimated_seconds INTEGER,
  scheduled_time TEXT,
  tag_ids TEXT NOT NULL DEFAULT '[]',
  generated_through TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  series_id TEXT REFERENCES task_series(id) ON DELETE SET NULL,
  occurrence_date TEXT,
  -- 1 = this occurrence was edited on its own and no longer follows series edits
  is_detached INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'inbox' CHECK (status IN ('inbox','not_started','planned','in_progress','on_hold','completed','cancelled')),
  priority INTEGER NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 5),
  start_date TEXT,
  due_date TEXT,
  scheduled_at INTEGER,
  scheduled_minutes INTEGER,
  estimated_seconds INTEGER,
  reminder_at INTEGER,
  links TEXT NOT NULL DEFAULT '[]',
  sort_order REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  -- soft delete: keeps the (series, date) slot occupied so a deleted occurrence is never regenerated
  deleted_at INTEGER
);
CREATE UNIQUE INDEX idx_tasks_occurrence ON tasks(series_id, occurrence_date) WHERE series_id IS NOT NULL;
CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_parent ON tasks(parent_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_due ON tasks(due_date);
CREATE INDEX idx_tasks_scheduled ON tasks(scheduled_at);

CREATE TABLE task_tags (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);
CREATE INDEX idx_task_tags_tag ON task_tags(tag_id);

CREATE TABLE task_dependencies (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on_id),
  CHECK (task_id <> depends_on_id)
);

-- Standalone activities with a weekly time target ("English: 5h / week").
CREATE TABLE time_targets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  weekly_seconds INTEGER NOT NULL CHECK (weekly_seconds > 0),
  preferred_days INTEGER,
  min_session_seconds INTEGER,
  max_session_seconds INTEGER,
  created_at INTEGER NOT NULL,
  archived_at INTEGER
);

CREATE TABLE focus_sessions (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('pomodoro','countdown','stopwatch','deep')),
  planned_seconds INTEGER,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','interrupted')),
  -- context is snapshotted at record time and never rewritten when the task changes later
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  target_id TEXT REFERENCES time_targets(id) ON DELETE SET NULL,
  objective TEXT NOT NULL DEFAULT '',
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_started ON focus_sessions(started_at);
CREATE INDEX idx_sessions_task ON focus_sessions(task_id);

-- The single source of truth for tracked time. One row per uninterrupted
-- stretch of work: each running segment of a timer session, or a manual entry.
CREATE TABLE time_entries (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES focus_sessions(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('timer','manual')),
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  target_id TEXT REFERENCES time_targets(id) ON DELETE SET NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (ended_at > started_at)
);
CREATE INDEX idx_entries_started ON time_entries(started_at);
CREATE INDEX idx_entries_ended ON time_entries(ended_at);
CREATE INDEX idx_entries_task ON time_entries(task_id);
CREATE INDEX idx_entries_project ON time_entries(project_id);
CREATE INDEX idx_entries_session ON time_entries(session_id);

CREATE TABLE calendar_events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'event' CHECK (kind IN ('event','meeting','focus_block','personal')),
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  target_id TEXT REFERENCES time_targets(id) ON DELETE SET NULL,
  reminder_minutes INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (end_at > start_at)
);
CREATE INDEX idx_events_start ON calendar_events(start_at);

CREATE TABLE habits (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('boolean','duration','quantity','sessions')),
  target_value REAL NOT NULL DEFAULT 1 CHECK (target_value > 0),
  unit TEXT NOT NULL DEFAULT '',
  weekdays TEXT NOT NULL DEFAULT '[]',
  reminder_time TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_date TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  archived_at INTEGER
);

-- Check-ins are additive: several rows per day sum to the day's value.
CREATE TABLE habit_entries (
  id TEXT PRIMARY KEY,
  habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  value REAL NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_habit_entries ON habit_entries(habit_id, date);

CREATE TABLE goals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  period TEXT NOT NULL CHECK (period IN ('daily','weekly','monthly','yearly','custom')),
  metric TEXT NOT NULL CHECK (metric IN ('focus_time','tasks_completed','sessions','manual')),
  target_value REAL NOT NULL CHECK (target_value > 0),
  manual_value REAL NOT NULL DEFAULT 0,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  start_date TEXT,
  end_date TEXT,
  created_at INTEGER NOT NULL,
  archived_at INTEGER
);

CREATE TABLE journal_entries (
  date TEXT PRIMARY KEY,
  accomplishments TEXT NOT NULL DEFAULT '',
  went_well TEXT NOT NULL DEFAULT '',
  went_wrong TEXT NOT NULL DEFAULT '',
  improve TEXT NOT NULL DEFAULT '',
  tomorrow TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

CREATE TABLE activity_logs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_activity_project ON activity_logs(project_id, created_at);

-- Fired reminders; dedupe_key guarantees each reminder notifies once.
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  fired_at INTEGER NOT NULL
);

CREATE TABLE smart_views (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  filter TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE backup_history (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('auto','manual','export','restore')),
  size INTEGER,
  created_at INTEGER NOT NULL
);
`,
  },
];

/** Tables in dependency order (parents first) — used by export/import. */
export const TABLES = [
  "profiles", "settings", "categories", "tags", "projects", "project_tags", "milestones",
  "recurrence_rules", "task_series", "tasks", "task_tags", "task_dependencies", "time_targets",
  "focus_sessions", "time_entries", "calendar_events", "habits", "habit_entries", "goals",
  "journal_entries", "activity_logs", "notifications", "smart_views", "backup_history",
] as const;
export type TableName = (typeof TABLES)[number];
