# Architecture

## Shape

```
┌──────────────────────────── Tauri window (WebView) ─────────────────────────────┐
│ React UI (src/pages, src/components)                                            │
│        │ reads                      │ calls                                     │
│ Zustand stores (src/store)  ◄── actions.ts / timer.ts ──► Driver (src/db)       │
│        ▲ derived by selectors.ts            │ pure rules                        │
│        └──────────── src/domain (no I/O, no React) ◄────────┘                   │
└───────────────────────────────────────┬─────────────────────────────────────────┘
                                        │ invoke: db_select / db_execute / db_batch / backup_*
                              src-tauri/src/lib.rs — one rusqlite connection (WAL, FK on)
                                        │
                                 tempo.db + backups/
```

| Layer | Where | Rule |
| --- | --- | --- |
| Domain | `src/domain` | Pure functions: dates, recurrence, timer state machine, time math, project progress/health, weekly targets, habits, scheduling conflicts, quick-add parsing, filters. No I/O. Fully unit tested. |
| Data | `src/db` | `Driver` interface (`select`, `execute`, `batch`), migrations, SQL helpers. Two drivers: Tauri (rusqlite) and sql.js (browser dev/test). |
| State | `src/store` | `data.ts` holds rows loaded from SQLite; `actions.ts` validates (Zod), writes atomically, then reloads the affected tables; `timer.ts` drives the timer; `selectors.ts` derives totals. |
| UI | `src/pages`, `src/components` | Reads stores, calls actions. No SQL, no business rules. |
| Shell | `src-tauri` | Owns the SQLite connection, backups, and native plugins (notifications, global shortcut, dialogs, fs). |

## Key decisions

**1. Schema and logic live in TypeScript; Rust is a thin SQLite gateway.**
The same migrations and actions run against rusqlite in the app and against sql.js in tests and in the browser.
That is what lets the integration tests exercise real SQL (foreign keys, unique indexes, transactions) in milliseconds,
and lets the whole UI be driven by Playwright without a desktop session.
Cost: SQL is assembled in the webview, so the Tauri commands accept arbitrary SQL. Acceptable for a single-user local app whose only caller is its own bundled frontend (CSP restricts scripts to `self`); the one place external content reaches SQL — JSON import — validates table and column names against the live schema.

**2. Writes are batches.** Every action is one `db_batch` call = one transaction. A session's time entry, its status change and the persisted timer state commit together or not at all.

**3. `time_entries` is the single source of truth for tracked time.**
One row per uninterrupted stretch of work. A timer session creates one entry per running segment (start→pause, resume→stop), so pauses are excluded by construction; manual entries are rows with `source = 'manual'`.
Nothing stores a "minutes spent" counter. Task, project, category, weekly-target, goal and report totals are all derived from the entries, and every total is an interval *union*, so a minute covered by two overlapping entries counts once. Overlaps are flagged where they are created (manual entry dialog) and where they are listed (time log).

**4. The timer is a state machine over timestamps, not a tick counter** (`src/domain/timer.ts`).
State = `accumulatedMs` + `segmentStartedAt` + `plannedMs`. Elapsed time is always `accumulated + (now − segmentStartedAt)`, capped at the plan, so a late or throttled tick can never record more than the planned duration.
The state is persisted in the `settings` table (`active_timer`) inside the same transaction as every change, plus a 15-second heartbeat.
On startup, or when ticks resume after a long silence, `detectGap` compares the heartbeat with the wall clock. Up to 2 minutes of absence is counted silently; beyond that Tempo asks whether the time away was work. "No" closes the segment at the last heartbeat. Closing the app, a crash and system sleep are therefore the same case and none of them corrupt a session.

**5. Context is snapshotted on time entries.** `project_id` and `category_id` are copied onto each entry when it is recorded. Moving a task to another project later does not move its history.

**6. Recurring tasks are materialised rows with a uniqueness guarantee.**
A series (`task_series` + `recurrence_rules`) generates real task rows up to 35 days ahead. The id is `series:date`, inserted with `INSERT OR IGNORE` under a unique `(series_id, occurrence_date)` index, so generation is idempotent however often it runs.
Editing one occurrence marks it `is_detached`; series edits skip detached and completed occurrences. "This and future" splits the series (old rule ends the day before, a new series starts). A deleted occurrence is soft-deleted so its slot stays taken and it is never regenerated.

**7. Dates vs. instants.** Calendar dates (`due_date`, `occurrence_date`, habit days) are local `YYYY-MM-DD` strings. Instants (sessions, entries, events, reminders) are epoch milliseconds. Reports bucket instants into local days at read time, splitting entries at midnight. Week boundaries come from the user's week-start setting. A timezone change therefore re-buckets history consistently instead of corrupting it.

**8. Everything is loaded into memory.** At personal scale (tens of thousands of rows) this keeps the UI synchronous and the code small. Derived maps are cached per array identity. Long lists are capped at 300 rendered rows. If a database ever outgrows this, `selectors.ts` is the seam to move aggregation into SQL.

**9. No opaque scores.** Project health is a status plus the plain-language reasons that produced it. Analytics shows measured quantities only.

## Social layer

Built as a separate layer in `src/social/`; the core never depends on it. One `SocialServer` class holds all the logic and runs either inside a friend's app (LAN hosting, with `src-tauri/src/lan.rs` relaying WebSocket frames) or in the standalone Node server (`server/main.ts`). The app-side client only *observes* the timer and time entries and never writes to them. Full design, protocol, privacy model and limits: [docs/SOCIAL.md](docs/SOCIAL.md).

## Risks and limits

| Risk | Status |
| --- | --- |
| Reminders only fire while Tempo is running | Known. Needs a tray/background mode (Phase 8). Missed reminders under 6 h old fire at next start. |
| Windows build | CI workflow is provided; no Windows build has been produced or tested yet. |
| Mini timer, global shortcut, native notifications, backup *restore* | Implemented against the Tauri APIs; only app start-up, migration and automatic backup were exercised in a real Tauri window (Linux). |
| sql.js driver persists by exporting the whole DB | Fine for development; not a production storage engine. |
