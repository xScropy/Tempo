# Social: friends, live activity, challenges

Optional. Tempo works exactly as before without it, and nothing leaves the device until a profile is created under **Social**.

## Getting connected

| Situation | What to do |
| --- | --- |
| Friends on the **same Wi-Fi / network** | One person opens Social → *Host on this computer*. Tempo shows an address such as `ws://192.168.1.20:47800` under Profile → Connection. Everyone else chooses *Join a server* and enters it. It works while the host's Tempo is open; the firewall may ask for permission once. |
| Friends on **other networks** | Someone runs the small server where everyone can reach it, and all join with its address. Options: `node tempo-social-server.cjs` (attached to each release, needs Node 20+), `docker build -f server/Dockerfile -t tempo-social . && docker run -p 47800:47800 -v tempo-social:/data tempo-social`, or a one-click deploy with the included `render.yaml`. Put it behind TLS and use a `wss://` address. |

Two home networks cannot reach each other directly; that is a property of the internet, not of Tempo. Remote friends therefore need a server somewhere. It is small, self-hosted, and stores only what users chose to share.

Then: pick a username, review what friends may see, and add friends by username or invitation code.

## 1. Analysis of the existing application

- **Local-first.** One SQLite file; `time_entries` is the single source of truth for tracked time, one row per uninterrupted stretch of work, with timer sessions in `focus_sessions`.
- **Timer** is a timestamp state machine (`src/domain/timer.ts`) persisted in the `settings` table; elapsed and remaining time are always derived, never counted.
- **State** lives in Zustand stores loaded from SQLite; every write is one transaction through `actions.ts`.
- **Rust shell** is a thin gateway: SQLite commands, backups, native plugins.

Integration points chosen:

| Need | Hook | Why |
| --- | --- | --- |
| Presence (focusing / break / idle) | subscribe to the timer store | The timer already knows mode, planned and elapsed time; nothing new is tracked. |
| Shared statistics, challenges | read `time_entries` + `focus_sessions` | The same rows every local report uses, so shared numbers match local ones. |
| Identity, preferences | two keys in `settings` | No schema change needed; excluded from export because the login token is a secret. |
| LAN hosting | three Tauri commands relaying WebSocket frames | Keeps all logic in one tested TypeScript class. |

## 2. Integration plan (as built)

```
 Tempo app A                         social server                        Tempo app B
 timer store ──presence──┐      ┌──────────────────────────┐      ┌──presence── timer store
 time_entries ─intervals─┼─ws──▶│ SocialServer (TypeScript) │◀──ws─┼─intervals─ time_entries
 Social UI ◀──snapshot───┘      │ accounts · friends · presence      └──snapshot──▶ Social UI
                                │ stats · challenges · rooms · feed │
                                └──────────────────────────┘
        runs either inside one friend's app (LAN hosting, Rust relays frames)
        or as the standalone Node server (remote)
```

- The social layer is **read-only toward local data**. It never writes to tasks, sessions or time entries, so it cannot corrupt or duplicate them. Removing it leaves the database untouched.
- The client uploads **anonymous intervals** — `{id, start, end, manual, mode, session, completed}`. There is no field for a task, project, category, note or calendar event, so they cannot be sent by accident.
- **Everything a friend sees is computed on the server** after applying the owner's privacy settings. A hidden statistic is not sent at all, rather than sent and hidden in the UI.
- The client re-sends the last 62 days as one idempotent window on every change, so edits and deletions propagate and nothing is double counted; the server additionally merges overlapping intervals before summing.

## 3. Database migrations

**None for the local database.** Two `settings` keys are added: `social` (server address, user id, login token) and `socialPrefs` (notification categories, muted friends, quiet hours, idle timeout). When hosting, the server's state is kept under the `social_host_state` key. All three are excluded from JSON export.

Server-side state (one JSON document, written atomically) holds the entities of the brief:

| Brief | Server state |
| --- | --- |
| SocialProfiles, UserPrivacySettings | `users` (profile, privacy, timezone offset, week start, weekly target, blocked list) |
| Friendships, FriendRequests | `friendships`, `requests` |
| PresenceStates, PresenceHeartbeats | in memory (`live`), plus `focusLog` — when each user was seen focusing |
| SharedActivity | `intervals` |
| Challenges, ChallengeParticipants, ChallengeEvents | `challenges` |
| FocusRooms, FocusRoomParticipants, SocialReactions | `rooms`, reactions on `feed` |
| SocialNotifications | pushed live; delivery preferences are applied on the receiving device |

## 4. Networking

- **Transport:** JSON over WebSocket. Requests get one reply; the server pushes `state`, `presence`, `notify` and `room_timer`. Clients reconnect with backoff (2 s → 30 s).
- **Presence:** heartbeat every 15 s; a user with no heartbeat for 45 s is offline **even if the socket still looks open**, which is what catches a sleeping or disconnected device. Idle = no keyboard or mouse input for a configurable time (default 5 min). Friends' countdowns are extrapolated from server timestamps, corrected for clock difference.
- **Authentication:** registering returns a random 256-bit token, stored only on the device; the server keeps its SHA-256 hash.
- **Encryption:** use `wss://` (TLS) for a remote server. **LAN hosting is plain `ws://`** — fine on a home network you trust, not on public Wi-Fi.
- **Abuse limits:** 80 requests per 10 s per connection, 600 KB per message, 64 connections on a LAN host.
- **Validating results:** intervals must be finished, positive, at most 24 h, not in the future, and unique; totals are computed on the server from merged intervals inside the challenge dates only. Challenges choose what counts: *verified* (at least half of the interval overlaps time the server itself saw the user focusing live), *tracked* (timer sessions, no manual entries — the default) or *all*.
  A modified client can still invent timer sessions under *tracked*; only *verified* resists that, and it cannot count work done while offline. This is a friends tool, not an anti-cheat system.

## 5. Phases

| Phase | Status |
| --- | --- |
| 1 Foundation — profiles, usernames, invitation codes, requests, friends list, blocking, privacy | ✅ |
| 2 Presence — online / focusing / break / idle / offline, last seen, live countdowns | ✅ |
| 3 Statistics — weekly hours, daily chart, targets, this week / last week / month | ✅ |
| 4 Challenges — five types, invitations, explicit join, live standings, history, eligibility policy | ✅ |
| 5 Focus Together — private rooms, shared timer, statuses, reactions, group totals | ✅ |
| 6 Activity & polish — feed, reactions, badges, records, notification categories, mute, quiet hours | ✅ |

Not built: profile pictures (avatars are coloured initials), standalone named groups (a leaderboard can be limited to a challenge's participants instead), chat, automatic discovery of a LAN host (the address is typed in), deleting an account from the server, and moving a profile to another server. Daylight-saving changes use the user's current UTC offset for past days.

## Verification

- `src/social/server.test.ts` — 20 tests: accounts and tokens, friend requests, blocking, rate limiting, presence and heartbeat timeout, privacy filtering, statistics in the user's timezone, all challenge metrics and eligibility policies, frozen results, rooms, feed.
- `src-tauri/src/lan.rs` — the LAN relay with two real WebSocket clients.
- `e2e/social.cjs` — two users in two browsers against the real server, covering every acceptance criterion: profiles, adding and accepting, online and focusing status with remaining time, switching sharing off, weekly hours, leaderboard, challenge create / join / live standings / leave, a focus room with a shared timer, a check that no task title reached the server, and the tracker continuing to work with the server stopped.

LAN hosting inside the desktop app has been exercised at the relay level only, not end to end on two physical machines.
