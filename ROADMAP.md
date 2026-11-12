# Roadmap

Legend: ✅ built and verified · 🟡 built, with stated limits · ⬜ not built

## Phase 1 — Core foundation ✅
Tauri 2 shell, SQLite with migrations, design system (light / dark / system), collapsible sidebar, resizable task panel, settings, local persistence.

## Phase 2 — Task management ✅
Task CRUD, quick add with offline parsing, categories, tags, five priorities, seven statuses, subtasks, dependencies (cycle-safe), links, reminders, notes (Markdown).
Views: List, Kanban, Priority, Eisenhower matrix, Timeline, Today, Upcoming, Overdue, Completed. Filters, sorting and saved Smart Views. Global search. Inbox.

- 🟡 Attachments are reference links only (no file storage).
- ⬜ Custom statuses. ⬜ Per-task Pomodoro configuration. ⬜ Undo for destructive actions (they are confirmed instead).

## Phase 3 — Projects and recurrence ✅
Projects, subprojects (any depth), milestones, notes, activity log, time budget, weekly target, three progress modes, explainable health.
Recurrence: daily, weekdays, selected weekdays, every N days/weeks/months, days of month, end date, count. Edit one occurrence / this and future / whole series. Standalone weekly time targets.

## Phase 4 — Pomodoro and time tracking ✅
Pomodoro (with break cycle), deep work, countdown, stopwatch; pause, resume, stop, extend, restart, skip break; session notes and rating; manual time entries with overlap warnings; editable time log; timer state that survives closing the app, crashes and sleep; focus mode; ambient brown noise.

- 🟡 Always-on-top mini timer: implemented (shrinks the window), not yet exercised on a real desktop.

## Phase 5 — Calendar and scheduling 🟡
Day, week, month, agenda. Drag tasks and weekly targets onto the calendar, move and resize blocks, deadlines and milestones in the all-day row, conflict detection, planned vs. target vs. actual per weekly target, reminders.

- ⬜ Recurring calendar *events* (recurring *tasks* do appear).
- 🟡 Reminders fire only while Tempo is running (no tray/background process yet).

## Phase 6 — Habits, notes, goals 🟡
Habits (yes/no, duration, quantity, multiple check-ins), rest days, streaks, weekly/monthly consistency. Daily journal. Goals by focus time, tasks, sessions or manual count, per period, optionally scoped to a project or category. Analytics: planned vs. tracked, distribution by project/category/task/tag, productive hours, estimate vs. actual with accuracy, habit consistency.

- ⬜ Habit ↔ Pomodoro integration (a focus session does not check in a habit).
- 🟡 PDF reports go through the system print dialog ("Save as PDF").

## Rewards (added after the original brief) ✅
Levels, tokens, daily quests, achievements and a reward shop. XP comes only from tracked focus minutes, completed tasks, completed sessions and habits, by rules shown on the page; tokens (1 per 10 XP) are spent on rewards the user defines. Optional — Settings → Appearance.

- 🟡 Un-completing a task after spending its tokens can leave a negative balance; it is shown as-is rather than hidden.

## Phase 7 — Social 🟡
Friends, live presence, shared statistics, leaderboards, challenges, focus rooms, activity feed, privacy and notification controls — built and verified with two users against the real server (`e2e/social.cjs`). Details, trade-offs and what is not built: [docs/SOCIAL.md](docs/SOCIAL.md).

- 🟡 LAN hosting inside the desktop app is tested at the relay level, not yet on two physical machines.
- 🟡 Friends on other networks connect with a group code through a public relay (end-to-end encrypted). Tested against a local broker; not yet confirmed against the public relays. The group is reachable only while its starter has Tempo open; an always-on group needs the included server.
- ⬜ Profile pictures, standalone groups, chat, automatic LAN discovery, account deletion on the server.

## Phase 8 — Polish and release ⬜
- 🟡 Windows installer: built by CI and attached to GitHub releases; not yet installed and tested on a Windows machine, and not code-signed (Windows SmartScreen will warn).
- ⬜ Templates for projects, tasks, routines and schedules.
- ⬜ System tray / background reminders.
- ⬜ Freely resizable, drag-to-reorder dashboard widgets (today: reorder, hide, half/full width).
- ⬜ Demo mode with clearly marked sample data.
- ⬜ Virtualised lists for very large databases (today: 300-row render cap).

## Acceptance scenarios (PRD §10)

| # | Scenario | Status | Verified by |
| --- | --- | --- | --- |
| 1–2 | Project with tasks; subtasks drive progress | ✅ | `store.test.ts`, `e2e/core-flows` |
| 3–5 | 10 h weekly target; sessions on different tasks; attribution | ✅ | `store.test.ts` |
| 6–7 | Manual entries; estimate vs. actual | ✅ | `store.test.ts`, e2e |
| 8–10 | Daily task; three days a week; edit one occurrence | ✅ | `domain.test.ts`, `store.test.ts`, e2e |
| 11 | Schedule tasks in the calendar | ✅ | `e2e/planning-and-data` (drag and drop) |
| 12 | Native desktop reminders | 🟡 | logic implemented; native delivery not observed on Windows |
| 13–14 | Close and reopen during a Pomodoro; elapsed time correct | ✅ | `store.test.ts`, e2e (reload mid-session) |
| 15 | Habit and weekly consistency | ✅ | `store.test.ts`, e2e |
| 16 | Notes on a task and a session | ✅ | e2e |
| 17 | Export and restore | ✅ | `store.test.ts`, e2e |
| 18 | Fully offline | ✅ | no network code; assets bundled |
| 19 | Two users connected | 🟡 | `e2e/social.cjs` (two browsers, real server); in-app LAN hosting not yet tried on two machines |
| 20 | Private task details never shared | ✅ | `server.test.ts`, `e2e/social.cjs` |
