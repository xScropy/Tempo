# Changelog

## 0.1.1 — 2026-11-12

Fixed
- **Timer could get permanently stuck with "FOREIGN KEY constraint failed"** when pausing, stopping or starting a session. This happened once the running timer pointed at something that no longer existed — its task, project, category or activity had been deleted while it ran, or its session had been removed (from the time log, or by restoring data). Every later pause/stop then failed the same way, and a finished countdown retried every second.
  - Time is now recorded even if the task or project is gone (the entry is kept, unassigned), and a missing session record is recreated.
  - The running session can no longer be deleted from the time log.
  - Restoring data clears any running timer.
  - As a last resort, a session that cannot be saved resets the timer instead of leaving it unstoppable.

Added
- Reward feedback: "+XP" pops as you earn, confetti and a chime for finished quests, a level-up card, celebration when redeeming a reward. Sounds can be turned off; motion respects the system "reduce motion" setting.
- Rewards page: level ring, current focus streak, and the next reward to work toward with how many minutes of focus it is away.
- "Today's quests" dashboard widget, a greeting using your profile name, and a Tempo mark in the sidebar.

## 0.1.0 — 2026-11-12

First release (pre-release): roadmap phases 1–6.

- Desktop shell (Tauri 2) with a local SQLite database, migrations and daily automatic backups.
- Tasks: quick add, subtasks, tags, priorities, statuses, dependencies, reminders, notes, links; list, board, priority, matrix and timeline views; filters and smart views; inbox; global search.
- Projects and subprojects with milestones, time budget, weekly target, configurable progress and explainable health.
- Recurring tasks with per-occurrence, this-and-future and whole-series edits.
- Focus engine: Pomodoro, deep work, countdown and stopwatch; timestamp-based timing that survives closing the app and sleep; session notes; manual time entries; time log.
- Calendar: day, week, month and agenda; drag-and-drop scheduling; conflict warnings; weekly planning against time targets.
- Habits, goals, weekly time targets, daily journal.
- Analytics: planned vs. tracked time, distribution by project/category/task/tag, productive hours, estimation accuracy; print to PDF.
- Export to JSON and CSV; restore from JSON or from a database backup.
- Rewards: levels, tokens, daily quests, achievements and a user-defined reward shop, all derived from real tracked work by fixed, visible rules. Can be switched off.
- One-click light/dark toggle in the sidebar (in addition to Settings → Appearance, which also offers "follow system").
- 80 automated tests for time calculation, recurrence, project progress, weekly targets, habits and the data layer; three browser walkthrough scripts.

Not included: friends and networking, templates, tray/background reminders, a tested Windows installer. See ROADMAP.md.
