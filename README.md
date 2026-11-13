# Tempo

A local-first desktop app for planning work, doing it, and seeing where the time went:
tasks, projects, a Pomodoro/focus engine, time tracking, calendar, habits, goals and reports — in one place, fully offline.

**Plan → Execute → Track → Review → Improve.**

- All data lives in a SQLite database on your computer. No account, no cloud, no network requests.
- Tracked time is always computed from real timestamps — pauses, closed windows and sleeping laptops are handled explicitly.
- Optional levels, tokens and daily quests reward real work — XP comes only from tracked focus time, finished tasks and habits.
- English and Arabic, with a full right-to-left layout in Arabic.
- Light and dark themes (toggle at the bottom of the sidebar) and nine accent colours.
- Optional social layer: see when friends are focusing, compare weekly progress, run challenges and focus together — start a group and share its code, no server needed ([docs/SOCIAL.md](docs/SOCIAL.md)).
- Nothing in the app is sample data. Every number comes from what you entered or tracked.

Download the Windows installer from the [Releases page](https://github.com/xScropy/Tempo/releases).

Status: **v0.4.0 (pre-release)** — Phases 1–7 of the roadmap are implemented; release polish (Phase 8) is not. See [ROADMAP.md](ROADMAP.md) for exactly what is and is not built.

## Requirements

- Node.js 20+
- Rust (stable) and the [Tauri 2 prerequisites](https://tauri.app/start/prerequisites/) for your OS
  (Windows: WebView2 + MSVC build tools; Linux: `libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev`)

## Run

```bash
npm install
npm run tauri dev        # desktop app with hot reload
npm run tauri build      # installer (NSIS/MSI on Windows, deb/AppImage on Linux, dmg on macOS)
```

Tempo also runs in a plain browser, using SQLite compiled to WebAssembly and persisted in IndexedDB.
This is the development/test driver, not the product:

```bash
npm run dev              # http://localhost:1420
```

## Test

```bash
npm test                 # unit + integration tests (domain logic, and store actions against real SQLite)
npm run typecheck
cd src-tauri && cargo test

# Browser walkthroughs (need Playwright with Chromium available):
npm run build && npm run preview &
npm run e2e
```

## Keyboard

| Keys | Action |
| --- | --- |
| `N` / `Ctrl+N` | New task (quick add understands "tomorrow", "at 9:30", "2h", `!high`, `#tag`) |
| `Ctrl+Shift+P` | New project |
| `Ctrl+K` / `/` | Search tasks, projects, notes, sessions, journal, tags |
| `Alt+T` | Start / pause the timer |
| `Alt+C` | Calendar |
| `Alt+1…9` | Jump to a section |
| `Esc` | Close the task panel / leave focus mode |
| `Ctrl+Shift+Space` | Global quick capture from any app (desktop, configurable) |

## Where is my data?

Settings → Your data shows the folder. It contains `tempo.db` and a `backups/` folder with daily snapshots
(the newest 14 are kept by default). You can export everything to JSON, tasks and time entries to CSV,
and restore from either a JSON export or a database backup.

## Documentation

- [PRD.md](PRD.md) — product requirements
- [ARCHITECTURE.md](ARCHITECTURE.md) — structure, key decisions, risks
- [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) — tables and data rules
- [docs/SOCIAL.md](docs/SOCIAL.md) — friends, presence, challenges: how to connect and how it works
- [ROADMAP.md](ROADMAP.md) — phase status and known gaps
- [CHANGELOG.md](CHANGELOG.md)
