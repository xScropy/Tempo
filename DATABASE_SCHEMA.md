# Database schema

SQLite, `foreign_keys = ON`, WAL journal. The schema is defined in [`src/db/migrations.ts`](src/db/migrations.ts) (append-only migrations tracked in `schema_migrations`).

Conventions: ids are UUID text; calendar dates are local `YYYY-MM-DD` text; instants are epoch-millisecond integers; durations are integer seconds.

| Table | Purpose | Notes |
| --- | --- | --- |
| `profiles` | Local profile (display name) | one row |
| `settings` | Key → JSON value | also holds `active_timer`, the persisted timer state |
| `categories`, `tags` | Classification | names unique, case-insensitive |
| `projects` | Projects **and subprojects** (`parent_id`) | budget: `estimated_seconds`, `weekly_target_seconds`, `daily_target_seconds`; `progress_mode` = tasks / weighted / milestones |
| `project_tags` | Project ↔ tag | |
| `milestones` | Project checkpoints | |
| `recurrence_rules` | freq, interval, weekdays, monthdays, start, end, count | |
| `task_series` | Template of a recurring task | `generated_through` = horizon already materialised |
| `tasks` | Tasks **and subtasks** (`parent_id`) | `series_id` + `occurrence_date` for occurrences; `is_detached`; `deleted_at` (soft delete for occurrences) |
| `task_tags`, `task_dependencies` | Task ↔ tag, task → task | self-dependency rejected by CHECK; cycles rejected in code |
| `time_targets` | Standalone activities with a weekly time target | |
| `focus_sessions` | One row per timer session | mode, planned seconds, status (active / completed / interrupted), rating, notes |
| `time_entries` | **Source of truth for tracked time** | `source` timer/manual; `CHECK (ended_at > started_at)`; context snapshot (`task_id`, `project_id`, `category_id`, `target_id`) |
| `calendar_events` | Events, meetings, focus blocks | |
| `habits`, `habit_entries` | Habits and additive check-ins | several entries per day sum to the day's value; `skipped` = rest day |
| `goals` | Daily/weekly/monthly/yearly/custom goals | metric: focus_time / tasks_completed / sessions / manual |
| `journal_entries` | One row per day, five sections | |
| `activity_logs` | Chronological project log | written by the actions that change a project |
| `notifications` | Fired reminders | `dedupe_key` UNIQUE → each reminder fires once |
| `smart_views` | Saved task filters | |
| `backup_history` | Restore/import audit | |
| `rewards`, `reward_redemptions` | User-defined rewards and what was spent on them (migration 2) | XP, levels and the token balance are **not stored** — they are derived from entries, tasks, sessions and habits; only spending is recorded |

Mapping to the PRD's entity list: *Subtasks* and *Subprojects* are self-references rather than separate tables; *TaskNotes* is `tasks.notes`; *SessionNotes* is `focus_sessions.notes`. *Friends, Groups, Challenges, ChallengeParticipants* arrive with the Phase 7 migration.

## Data rules enforced

| Rule | Enforced by |
| --- | --- |
| No duplicate recurring occurrences | `UNIQUE (series_id, occurrence_date)` + deterministic id + `INSERT OR IGNORE` |
| Deleted occurrence is not regenerated | soft delete keeps the unique slot |
| Completed / individually edited occurrences survive series edits | `updateSeries` only touches open, non-detached rows |
| A tracked minute is never counted twice | all totals are interval unions (`src/domain/time.ts`) |
| History is not rewritten when a task changes | context snapshot on `time_entries` / `focus_sessions` |
| Deleting a project keeps its tasks and time | `ON DELETE SET NULL` on `tasks.project_id`, `time_entries.project_id` |
| Deleting a task keeps its time | `ON DELETE SET NULL` on `time_entries.task_id` |
| Subtasks stay in their parent's project | `createTask` / `updateTask` |
| Multi-step changes are atomic | every action is a single `batch` transaction |
| Import cannot inject SQL | file is Zod-validated; column names checked against `PRAGMA table_info` |

Indexes cover the hot paths: tasks by project / parent / status / due / scheduled; entries by start, end, task, project, session; sessions by start; events by start; habit entries by (habit, date).
