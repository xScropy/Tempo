# Tempo — Product Requirements

*Condensed from the original product brief. Section numbers follow the brief. Implementation status is tracked in [ROADMAP.md](ROADMAP.md).*

## 1. Vision

Tempo is a native-feeling desktop productivity system combining task management, Pomodoro and focus sessions, project management, time tracking and analytics, planning, calendar, recurring tasks and habits, notes and logs, goals, and optional social competition.

It should tell the user what they planned, how long they meant to spend, how long they actually spent, how productive sessions were, where time goes, and whether they are on course for weekly and monthly goals.

**Plan → Execute → Track → Review → Improve.** A carefully designed professional tool, not a generic AI productivity app.

## 2. Platform

- Windows first; architecture that also supports macOS and Linux.
- React + TypeScript, Tauri, Tailwind, shadcn-style components, Zustand, SQLite, Recharts, a calendar component, native notifications, Zod. Stable libraries, few dependencies.
- **Local-first:** all data local, fully offline, no mandatory account, subscription or AI API. Automatic backups, import/export, migrations, recovery. Fast start, lightweight.
- **Optional social connectivity:** friends, invitations, private groups, compared statistics, weekly challenges, leaderboards. Local-network mode and optional remote mode (peer-to-peer or encrypted relay). Never requires exposing the local database. Optional and privacy-conscious.

## 3. Modules

1. **Dashboard** — today (date, tasks done/remaining/scheduled, planned vs. actual focus, completed sessions, streak); week (target, hours worked, remaining, projects in progress, approaching deadlines, completion %); quick actions (task, project, Pomodoro, stopwatch, habit, calendar, quick focus); customisable widgets (schedule, priority tasks, active projects, focus statistics, weekly goals, deadlines, habits, recent activity, time by category) that can be rearranged, hidden and resized.
2. **Tasks** — title, description, notes, category, tags, priority (Critical/High/Medium/Low/None), status (Inbox, Not Started, Planned, In Progress, On Hold, Completed, Cancelled), start/due dates, scheduled time, estimated and actual duration, project, subtasks, recurrence, links, reminders, dependencies, Pomodoro configuration. Views: list, Kanban, calendar, timeline, priority, today, upcoming, overdue, completed. Filtering/sorting by project, category, tag, priority, status, due date, durations, recurrence; saved Smart Views. Quick creation without filling every field; optional natural-language parsing that works without AI.
3. **Recurrence and weekly time targets** — daily, weekdays, chosen weekdays, every X days/weeks/months, dates of the month, start/end, limits. Weekly time targets for an activity without a fixed schedule (target, preferred sessions, min/max session), computing hours done, remaining, daily average, progress and on-track. Scheduled, planned, target and actual time are distinct.
4. **Projects** — name, description, dates, category, tags, priority, status, colour, estimated total, weekly target, actual time, progress, tasks, subprojects, notes, milestones. Hierarchy Project → Subprojects → Tasks → Subtasks, rolling up progress and time. Time budget (total, weekly, daily, actual, remaining). Health from deadline proximity, completion, actual vs. estimate, weekly progress and overdue tasks.
5. **Pomodoro and focus** — 25/5/15 with a long break after 4, all configurable. Modes: Pomodoro, custom, stopwatch, countdown, deep work. Choose task, project, category, tags, duration, mode, objective; quick focus without a task. Start, pause, resume, stop, skip break, restart, extend, complete. On finish: record actual duration and update task, project, weekly target, category and statistics. Session history (timestamps, actual and planned duration, context, type, status, rating, notes), editable. Distraction-free focus screen, optional ambient sound, optional always-on-top mini timer. Statistics; breaks never count as work.
6. **Time tracking** — automatic from sessions at task, subtask, project, subproject, category and tag level; manual entries (start/end or duration, editable, described, associated). Daily, weekly and monthly reports. Estimated vs. actual with variance and historical accuracy. Distribution charts by project, category, task, tag, day, week.
7. **Calendar** — day, week, month, agenda, timeline; tasks, milestones, meetings, recurring activities, commitments, focus blocks, habits, deadlines. Assign date and time, warn about overlaps. Distribute weekly-target hours across days. Drag, reschedule, resize, move incomplete tasks. Native reminders for tasks, meetings, deadlines, habits, recurring activities and finished sessions.
8. **Habits** — name, description, category, frequency, preferred time, reminder, target duration, weekly target, optional Pomodoro integration, streaks. Completion types: yes/no, duration, quantity, number of sessions. Analytics: current and longest streak, completion rate, weekly and monthly consistency. No punishment for missed days; rest days and flexible goals.
9. **Notes, journal, logs** — task notes; a prompt after each session; daily journal (accomplishments, went well, went wrong, to improve, tomorrow); chronological project log. Markdown and search.
10. **Goals and analytics** — daily, weekly, monthly, yearly and project goals with target, progress, deadline, associations, time- or completion-based measurement. Analytics for productivity, focus trends, completion rates, goal achievement, estimation accuracy and habit consistency. Meaningful insight, no arbitrary scores.
11. **Friends and competition (optional)** — local profile, friends, invitations, groups; weekly challenges; leaderboards; shared focus rooms. Share aggregates by default; never automatically expose task titles, notes, project details, calendar events or logs. LAN first, then optional P2P, then optional encrypted relay, with the trade-offs explained.

## 4. Additional features

Inbox · Eisenhower matrix · focus mode · global quick capture shortcut · global search · templates · keyboard shortcuts · backup and export (automatic and manual backups, CSV, JSON, PDF reports, restore).

## 5. UI/UX

Premium, professional, minimalist, typography-driven, consistent spacing, subtle borders, one careful accent colour. Avoid heavy gradients, glows, needless animation, many colours, giant rounded cards, decorative graphics, emojis, needless charts and overloaded dashboards. Inspired by — not copied from — Linear, Things 3, TickTick, Todoist, Sunsama, Raycast, Notion Calendar. Light, dark and system themes. Left sidebar, main workspace, optional context panel; collapsible sidebar, resizable panels. Subtle transitions, drag and drop, context menus, quick editing, keyboard-first navigation, confirmation of destructive actions, useful empty states, no needless loading screens.

## 6. Data

Normalised SQLite with stable ids, timestamps, foreign keys, transactions and indexes. Rules: a task may belong to a project and have many tags; projects have subprojects; tasks have subtasks; a session belongs to a task or a standalone activity; time entries are manual or automatic; recurring tasks keep historical completions; a recurring edit can target one occurrence, future occurrences or the series; completed sessions are never silently altered by later metadata changes.

## 7. Critical business logic

- **Time** from real timestamps and entries — never "one Pomodoro = 25 minutes". Handle pauses, interruptions, shutdown, sleep, crashes, timezone changes and manual corrections. Persist timer state.
- **Recurrence** without duplicates, preserving history.
- **Weekly goals** follow the configured week start and timezone.
- **Project progress** configurable: task count, weighted, milestones.
- **Attribution:** no minute counted twice; overlapping entries resolved or flagged.

## 8. Non-functional

Offline, fast, light, reliable persistence, large databases, responsive layouts, keyboard navigation, accessible contrast, no needless network requests, protected local data, automated tests for critical calculations, safe under unexpected shutdown. No fake analytics or hardcoded sample statistics; sample data only in a clearly marked demo mode.

## 9. Phases

1 Foundation · 2 Tasks · 3 Projects and recurrence · 4 Pomodoro and time tracking · 5 Calendar · 6 Habits, notes, goals · 7 Social · 8 Polish and release.

## 10. Acceptance scenarios

1. Create a project and assign tasks. 2. Subtasks and project progress. 3. Weekly target of 10 hours. 4. Several Pomodoros against different tasks. 5. Time attributed correctly to tasks and project. 6. Manual time entries. 7. Estimated vs. actual. 8. Daily recurring task. 9. Three days per week. 10. Edit one occurrence only. 11. Schedule tasks in the calendar. 12. Native reminders. 13. Close and reopen during a Pomodoro. 14. Elapsed time correct. 15. Habit and weekly consistency. 16. Notes on a task and a session. 17. Export and restore. 18. Entirely offline. 19. Two users on one local network. 20. Private task details never shared without permission.

Unit tests for time calculations, recurrence rules, project progress and weekly targets.

## 11. Development rules

No static mockups, dead buttons or fake data. The timer must not depend on the window staying open. Database integrity over convenience. No needless abstraction; do not overcomplicate the MVP. Strict TypeScript, validated input, tests for business logic, documented decisions. Build in phases; at the end of each: run, test, fix, verify persistence, review UI consistency, update the docs.
