# Changelog

## 0.4.0 — 2026-11-13

Added
- **Arabic.** Settings → Appearance → Language. The whole interface switches to Arabic and to a right-to-left layout: sidebar on the right, panels and calendar mirrored, directional arrows flipped, charts read right to left. Text is set in IBM Plex Sans Arabic (bundled, works offline) at a slightly larger size and leading.
  - Written as Arabic rather than translated word for word, with correct counted forms (مهمة واحدة، مهمتان، 3 مهام، 11 مهمة), Arabic day and month names, and durations as «1 س 30 د».
  - Arabic input is understood: quick add reads «مذاكرة القانون لمدة ساعتين بكرة الساعة 9 !عالية #دراسة», and duration fields accept «ساعة ونص», «45 دقيقة», «ساعتين».
  - On first run Tempo follows the system language; changing it restarts the window.
- **Colour themes.** Settings → Appearance → Colour: teal, green, blue, purple, pink, deep pink, orange, brown, graphite. Each is tuned separately for light and dark and checked for readable contrast.

Fixed
- Calendar day headers now always line up with the grid columns.
- Time log and time-by-category columns no longer wrap long durations.

## 0.3.0 — 2026-11-13

Added
- **Connect with friends on other networks without running a server.** Social → *Start a group* gives a code; friends choose *Join with a code*. The starter's app hosts the group and traffic goes through a public relay, end-to-end encrypted with the code. The group is reachable while the starter's Tempo is open. Server address and same-Wi-Fi hosting remain under *Other ways to connect*.

Fixed
- The desktop window no longer slows its timers when minimised or behind other windows, which could delay "session complete" notifications and would have made a minimised Tempo look offline to friends.
- A hosted group's state is now saved immediately on change instead of after a delay.
- Browser (development) build: database changes are written through promptly; previously the last fraction of a second could be lost when the tab closed.

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
