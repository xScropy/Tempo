# Changelog

## 0.2.0 — 2026-11-12

Added — **Social** (optional; see docs/SOCIAL.md)
- Friends: usernames, invitation codes, requests (send, accept, decline, cancel), remove, block.
- Live presence: Online, Focusing, On break, Idle, Offline with last seen; session type, elapsed and remaining time, updating without a refresh. Offline is detected from missed heartbeats, not from the window being open.
- Shared statistics per friend: weekly focus, sessions, productive days, weekly goal progress, daily chart; this week / last week / this month.
- Leaderboard by focus hours, completed sessions, weekly goal completion, streak or consistency, with change in rank since last week.
- Challenges: focus hours, weekly goal, Pomodoro, consistency and custom; invitation and explicit join; live standings; history; a per-challenge rule for which time counts.
- Focus Together: private, invitation-only rooms with a shared timer that can start your own timer, live statuses, reactions, group totals.
- Activity feed with reactions; badges and personal records on your profile.
- Privacy controls for every shared statistic; notification categories, per-friend mute, quiet hours, and holding notifications while focusing.
- Two ways to connect: host on this computer for friends on the same network, or join a self-hosted server (`tempo-social-server.cjs`, Dockerfile and `render.yaml` included).

Task titles, projects, notes, calendar events and journal entries are never sent; the protocol has no field for them.

Fixed
- Groups of buttons inside a form label (weekday pickers, colour pickers, friend chips) were each announced with the label's name to assistive technology.

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
