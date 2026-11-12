import { z } from "zod";
import {
  DEFAULT_PRIVACY, OFFLINE_AFTER_MS, REACTIONS,
  type ChallengeInput, type ChallengeView, type FeedItem, type FriendView, type MeView, type NotifyKind, type PeriodStats, type Presence,
  type PresenceReport, type Privacy, type PublicProfile, type Reply, type RoomView, type ServerPush, type SharedInterval, type Snapshot, type Standing,
} from "./protocol";
import { DAY, clipAll, localDay, merge, monthLength, monthStartDay, periodStats, secondsPerDay, streakDays, totalMs, weekStartDay, type Span } from "./stats";

// ---- persisted state ---------------------------------------------------------

interface User {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  statusText: string;
  color: string;
  tokenHash: string;
  inviteCode: string;
  privacy: Privacy;
  tzOffsetMin: number;
  weekStart: number;
  weeklyTargetSeconds: number | null;
  createdAt: number;
  lastSeen: number;
  blocked: string[];
  flags: Record<string, number>;
  challengesWon: number;
  challengesCompleted: number;
}
interface Challenge extends Omit<ChallengeInput, "invite"> {
  id: string;
  creator: string;
  createdAt: number;
  participants: Array<{ user: string; joinedAt: number; reachedAt: number | null }>;
  invited: string[];
  events: Array<{ at: number; text: string }>;
  started: boolean;
  endingNotified: boolean;
  finished: boolean;
  final: Array<{ user: string; value: number; reachedAt: number | null }> | null;
  lastOrder: string[];
}
interface Room {
  id: string;
  name: string;
  owner: string;
  members: string[];
  invited: string[];
  timer: RoomView["timer"];
  completedSessions: number;
  groupFocusSeconds: number;
  reactions: RoomView["reactions"];
}
interface Feed {
  id: string;
  user: string;
  at: number;
  kind: string;
  text: string;
  reactions: Record<string, string[]>;
}
export interface ServerState {
  users: Record<string, User>;
  friendships: Array<{ a: string; b: string; since: number }>;
  requests: Array<{ id: string; from: string; to: string; at: number }>;
  intervals: Record<string, SharedInterval[]>;
  /** when each user was seen focusing live — the basis of "verified" time */
  focusLog: Record<string, Span[]>;
  challenges: Challenge[];
  rooms: Room[];
  feed: Feed[];
}
export const emptyState = (): ServerState => ({ users: {}, friendships: [], requests: [], intervals: {}, focusLog: {}, challenges: [], rooms: [], feed: [] });

export interface ServerOptions {
  now?: () => number;
  /** called (debounced by the host) whenever state changed */
  onChange?: () => void;
  /** max requests per connection per 10 s */
  rateLimit?: number;
}

interface Conn {
  send: (text: string) => void;
  user: string | null;
  hits: number[];
}
interface Live {
  report: PresenceReport;
  beat: number;
  since: number;
}

// ---- input schemas -----------------------------------------------------------

const idStr = z.string().min(1).max(80);
const username = z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,20}$/, "Usernames are 3–20 characters: letters, numbers or underscore");
const privacy = z.object({ profile: z.boolean(), weekly: z.boolean(), daily: z.boolean(), sessions: z.boolean(), streak: z.boolean(), goal: z.boolean(), activity: z.boolean(), sessionTime: z.boolean(), objective: z.boolean() });
const profileFields = {
  displayName: z.string().trim().min(1, "Enter a display name").max(40),
  bio: z.string().max(200).optional(),
  statusText: z.string().max(80).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  privacy: privacy.optional(),
  tzOffsetMin: z.number().int().min(-900).max(900).optional(),
  weekStart: z.number().int().min(0).max(6).optional(),
  weeklyTargetSeconds: z.number().int().min(0).max(168 * 3600).nullable().optional(),
};
const interval = z.object({ id: idStr, start: z.number().int(), end: z.number().int(), manual: z.boolean(), mode: z.string().max(20).nullable(), session: idStr.nullable(), completed: z.boolean() });
const S = {
  register: z.object({ username, ...profileFields }),
  login: z.object({ userId: idStr, token: z.string().min(16).max(200) }),
  "profile.update": z.object(profileFields).partial(),
  "invite.rotate": z.object({}),
  "friend.search": z.object({ query: z.string().trim().min(1).max(40) }),
  "friend.request": z.object({ username: username.optional(), inviteCode: z.string().trim().max(20).optional() }),
  "friend.respond": z.object({ requestId: idStr, accept: z.boolean() }),
  "friend.cancel": z.object({ requestId: idStr }),
  "friend.remove": z.object({ userId: idStr }),
  "user.block": z.object({ userId: idStr, on: z.boolean() }),
  presence: z.object({ status: z.enum(["online", "focusing", "break", "idle"]), mode: z.string().max(20).nullable().optional(), plannedMs: z.number().int().min(0).max(DAY).nullable().optional(), elapsedMs: z.number().int().min(0).max(DAY).optional(), objective: z.string().max(200).optional() }),
  "activity.sync": z.object({ windowStart: z.number().int(), intervals: z.array(interval).max(6000) }),
  "challenge.create": z.object({
    name: z.string().trim().min(1, "Name the challenge").max(80), description: z.string().max(500), type: z.enum(["focus_hours", "goal", "pomodoro", "consistency", "custom"]),
    metric: z.enum(["focus_seconds", "sessions", "days"]), target: z.number().positive().max(1e7).nullable(), winner: z.enum(["highest", "first"]),
    minDailySeconds: z.number().int().min(60).max(DAY / 1000), eligibility: z.enum(["verified", "tracked", "all"]), start: z.number().int(), end: z.number().int(), invite: z.array(idStr).max(50),
  }),
  "challenge.join": z.object({ id: idStr }),
  "challenge.leave": z.object({ id: idStr }),
  "challenge.invite": z.object({ id: idStr, users: z.array(idStr).max(50) }),
  "challenge.delete": z.object({ id: idStr }),
  "room.create": z.object({ name: z.string().trim().min(1, "Name the room").max(60), invite: z.array(idStr).max(30) }),
  "room.invite": z.object({ id: idStr, users: z.array(idStr).max(30) }),
  "room.join": z.object({ id: idStr }),
  "room.leave": z.object({ id: idStr }),
  "room.timer": z.object({ id: idStr, kind: z.enum(["focus", "break", "stop"]), minutes: z.number().min(1).max(240).optional() }),
  "room.react": z.object({ id: idStr, kind: z.enum(REACTIONS) }),
  "feed.react": z.object({ id: idStr, kind: z.enum(REACTIONS) }),
  cheer: z.object({ userId: idStr, kind: z.enum(REACTIONS) }),
  "state.get": z.object({}),
} as const;
type Op = keyof typeof S;

const COLORS = ["#5b7a99", "#1f6f5c", "#8a6d3b", "#9b4d5c", "#6b5b95", "#4a7c59", "#b0653a", "#52677a"];
const rand = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
const code = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[b % 31]).join("");
async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}
const fmtH = (seconds: number) => `${Math.round((seconds / 3600) * 10) / 10}h`;

/**
 * The whole social backend: accounts, friends, presence, shared statistics,
 * challenges, rooms and the feed. It is transport-agnostic — the same class
 * runs inside the desktop app (LAN hosting) and in the standalone Node server.
 *
 * Trust model: clients only ever report *their own* presence and time
 * intervals. Everything a friend sees is computed here, after applying the
 * owner's privacy settings, so a hidden statistic is never sent at all.
 */
export class SocialServer {
  private conns = new Map<string, Conn>();
  private live = new Map<string, Live>();
  private now: () => number;
  private limit: number;

  constructor(public state: ServerState = emptyState(), private opts: ServerOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.limit = opts.rateLimit ?? 80;
  }

  // ---- transport -------------------------------------------------------------

  connect(connId: string, send: (text: string) => void) {
    this.conns.set(connId, { send, user: null, hits: [] });
  }

  disconnect(connId: string) {
    const c = this.conns.get(connId);
    this.conns.delete(connId);
    if (c?.user && ![...this.conns.values()].some((x) => x.user === c.user)) this.goOffline(c.user);
  }

  async receive(connId: string, raw: string): Promise<void> {
    const c = this.conns.get(connId);
    if (!c) return;
    let id = 0;
    const reply = (r: Omit<Reply, "re">) => c.send(JSON.stringify({ re: id, ...r }));
    try {
      if (raw.length > 600_000) throw new Error("Message too large");
      const msg = JSON.parse(raw) as { id?: number; t?: string; d?: unknown };
      id = Number(msg.id) || 0;
      const t = this.now();
      c.hits = c.hits.filter((h) => h > t - 10_000);
      if (c.hits.push(t) > this.limit) throw new Error("Too many requests — slow down");
      const op = msg.t as Op;
      if (!op || !(op in S)) throw new Error("Unknown request");
      const d = S[op].parse(msg.d ?? {});
      if (op !== "register" && op !== "login" && !c.user) throw new Error("Not signed in");
      const data = await this.handle(c, op, d as never);
      reply({ ok: true, data });
    } catch (e) {
      const issues = (e as { issues?: Array<{ message: string }> }).issues;
      reply({ ok: false, error: issues?.[0]?.message ?? (e instanceof Error ? e.message : "Request failed") });
    }
  }

  private push(userId: string, msg: ServerPush) {
    const text = JSON.stringify(msg);
    for (const c of this.conns.values()) if (c.user === userId) c.send(text);
  }
  private changed() {
    this.opts.onChange?.();
  }
  private refresh(...users: Array<string | undefined>) {
    for (const u of new Set(users)) if (u && this.isConnected(u)) this.push(u, { t: "state", state: this.snapshot(u) });
  }
  private isConnected = (u: string) => [...this.conns.values()].some((c) => c.user === u);

  /** Notifications respect blocks; delivery preferences (mute, quiet hours) are applied by the receiving client. */
  private notify(to: string, kind: NotifyKind, from: string | null, title: string, body: string) {
    if (from && this.blockedEither(to, from)) return;
    this.push(to, { t: "notify", kind, from, title, body });
  }

  // ---- lookups ---------------------------------------------------------------

  private user(id: string): User {
    const u = this.state.users[id];
    if (!u) throw new Error("That user no longer exists");
    return u;
  }
  private pub = (id: string): PublicProfile => {
    const u = this.state.users[id];
    return u ? { id: u.id, username: u.username, displayName: u.displayName, color: u.color } : { id, username: "deleted", displayName: "Deleted user", color: "#888888" };
  };
  private friendsOf = (id: string) => this.state.friendships.filter((f) => f.a === id || f.b === id).map((f) => ({ id: f.a === id ? f.b : f.a, since: f.since }));
  private areFriends = (a: string, b: string) => this.state.friendships.some((f) => (f.a === a && f.b === b) || (f.a === b && f.b === a));
  private blockedEither = (a: string, b: string) => !!this.state.users[a]?.blocked.includes(b) || !!this.state.users[b]?.blocked.includes(a);
  /** People who can see something of `id`: friends, plus co-members of their rooms. */
  private audience(id: string): string[] {
    const out = new Set(this.friendsOf(id).map((f) => f.id));
    for (const r of this.state.rooms) if (r.members.includes(id)) for (const m of r.members) out.add(m);
    out.delete(id);
    return [...out];
  }
  private today = (u: User) => localDay(this.now(), u.tzOffsetMin);

  // ---- presence --------------------------------------------------------------

  private rawPresence(id: string): Presence {
    const u = this.state.users[id];
    const l = this.live.get(id);
    const lastSeen = l?.beat ?? u?.lastSeen ?? 0;
    if (!l || this.now() - l.beat > OFFLINE_AFTER_MS) return { status: "offline", lastSeen };
    const r = l.report;
    return { status: r.status, mode: r.mode ?? null, startedAt: l.since, plannedMs: r.plannedMs ?? null, elapsedMs: r.elapsedMs ?? 0, at: l.beat, objective: r.objective, lastSeen };
  }

  /** Presence as a friend may see it, reduced by the owner's privacy settings. */
  private presenceFor(id: string): Presence {
    const p = this.rawPresence(id);
    const pr = this.state.users[id]?.privacy ?? DEFAULT_PRIVACY;
    if (p.status === "offline") return p;
    if (!pr.activity) return { status: "online", lastSeen: p.lastSeen };
    if (p.status !== "focusing" && p.status !== "break") return { status: p.status, lastSeen: p.lastSeen };
    const out: Presence = { status: p.status, mode: p.mode, lastSeen: p.lastSeen };
    if (pr.sessionTime) Object.assign(out, { startedAt: p.startedAt, plannedMs: p.plannedMs, elapsedMs: p.elapsedMs, at: p.at });
    if (pr.objective && p.objective) out.objective = p.objective;
    return out;
  }

  private broadcastPresence(id: string) {
    const presence = this.presenceFor(id);
    for (const f of this.audience(id)) if (!this.blockedEither(id, f)) this.push(f, { t: "presence", userId: id, presence, serverNow: this.now() });
  }

  private closeFocusLog(id: string, at: number) {
    const l = this.live.get(id);
    if (l?.report.status !== "focusing") return;
    const log = (this.state.focusLog[id] ??= []);
    log.push({ start: l.since, end: at });
    this.state.focusLog[id] = merge(log).filter((s) => s.end > at - 70 * DAY);
  }

  private goOffline(id: string) {
    const l = this.live.get(id);
    if (!l) return;
    this.closeFocusLog(id, Math.min(this.now(), l.beat + OFFLINE_AFTER_MS));
    this.live.delete(id);
    const u = this.state.users[id];
    if (u) u.lastSeen = l.beat;
    this.broadcastPresence(id);
    this.changed();
  }

  private setPresence(id: string, report: PresenceReport) {
    const t = this.now();
    const prev = this.live.get(id);
    const was = prev?.report.status;
    const sameRun = prev && was === report.status && prev.report.mode === report.mode;
    if (prev && !sameRun) this.closeFocusLog(id, t);
    // A focus run that started before we connected is credited from when the client says it began.
    const since = sameRun ? prev.since : report.status === "focusing" || report.status === "break" ? t - Math.min(report.elapsedMs ?? 0, 5 * 60_000) : t;
    this.live.set(id, { report, beat: t, since });
    this.user(id).lastSeen = t;
    if (!sameRun) {
      this.broadcastPresence(id);
      const u = this.user(id);
      if (u.privacy.activity && (report.status === "focusing" || was === "focusing")) {
        const started = report.status === "focusing";
        for (const f of this.friendsOf(id)) this.notify(f.id, started ? "friend_focus_start" : "friend_focus_end", id, u.displayName, started ? "started a focus session" : "finished a focus session");
      }
    } else if (report.status === "focusing" || report.status === "break") {
      // keep viewers' countdowns honest without a full refresh
      if (Math.abs((prev.report.elapsedMs ?? 0) + (t - prev.beat) - (report.elapsedMs ?? 0)) > 4000) this.broadcastPresence(id);
    }
  }

  /** Housekeeping; call every few seconds. */
  tick() {
    const t = this.now();
    for (const [id, l] of this.live) if (t - l.beat > OFFLINE_AFTER_MS) this.goOffline(id);
    for (const r of this.state.rooms) {
      if (r.timer && t >= r.timer.startedAt + r.timer.plannedMs) {
        if (r.timer.kind === "focus") {
          const focusing = r.members.filter((m) => this.rawPresence(m).status === "focusing").length;
          r.completedSessions++;
          r.groupFocusSeconds += Math.round((r.timer.plannedMs / 1000) * Math.max(1, focusing));
        }
        r.timer = null;
        for (const m of r.members) this.push(m, { t: "room_timer", roomId: r.id, timer: null, serverNow: t });
        this.refresh(...r.members);
        this.changed();
      }
    }
    for (const c of this.state.challenges) this.advanceChallenge(c);
  }

  // ---- statistics ------------------------------------------------------------

  private stats(u: User) {
    const iv = this.state.intervals[u.id] ?? [];
    const today = this.today(u);
    const wk = weekStartDay(today, u.weekStart);
    const mo = monthStartDay(today);
    return {
      week: periodStats(iv, wk, 7, u.tzOffsetMin, u.weeklyTargetSeconds),
      lastWeek: periodStats(iv, wk - 7, 7, u.tzOffsetMin, u.weeklyTargetSeconds),
      month: periodStats(iv, mo, monthLength(mo), u.tzOffsetMin, null),
      streak: streakDays(iv, today, u.tzOffsetMin),
      totalPomodoros: new Set(iv.filter((i) => i.session && i.completed && i.mode === "pomodoro").map((i) => i.session)).size,
    };
  }

  private badges(u: User, s: ReturnType<SocialServer["stats"]>): string[] {
    const iv = this.state.intervals[u.id] ?? [];
    const out: string[] = [];
    if (s.totalPomodoros >= 10) out.push("First 10 Pomodoros");
    if (s.week.seconds >= 10 * 3600 || s.lastWeek.seconds >= 10 * 3600 || u.flags.week10) out.push("10-Hour Focus Week");
    if (s.month.seconds >= 50 * 3600 || u.flags.month50) out.push("50-Hour Focus Month");
    if (s.streak.longest >= 7) out.push("7-Day Consistency");
    if (u.flags.goalReached) out.push("Weekly Goal Achiever");
    if (u.challengesWon > 0) out.push("Challenge Winner");
    void iv;
    return out;
  }

  private hide(p: ReturnType<typeof periodStats>, pr: Privacy): PeriodStats {
    return {
      seconds: pr.weekly ? p.seconds : null,
      sessions: pr.sessions ? p.sessions : null,
      pomodoros: pr.sessions ? p.pomodoros : null,
      days: pr.daily ? p.days : null,
      productiveDays: pr.daily ? p.productiveDays : null,
      targetSeconds: pr.goal ? p.targetSeconds : null,
    };
  }

  private friendView(id: string, since: number): FriendView {
    const u = this.user(id);
    const s = this.stats(u);
    const pr = u.privacy;
    return {
      ...this.pub(id), bio: pr.profile ? u.bio : null, statusText: pr.profile ? u.statusText : null, presence: this.presenceFor(id),
      week: this.hide(s.week, pr), lastWeek: this.hide(s.lastWeek, pr), month: this.hide(s.month, pr),
      streak: pr.streak ? s.streak.current : null, totalPomodoros: pr.sessions ? s.totalPomodoros : null, badges: pr.profile ? this.badges(u, s) : [], since,
    };
  }

  private meView(u: User): MeView {
    const s = this.stats(u);
    const iv = this.state.intervals[u.id] ?? [];
    const today = this.today(u);
    const days = secondsPerDay(merge(iv), today - 400, 401, u.tzOffsetMin);
    let bestWeek = 0;
    for (let i = 0; i + 7 <= days.length; i++) bestWeek = Math.max(bestWeek, days.slice(i, i + 7).reduce((a, b) => a + b, 0));
    return {
      ...this.pub(u.id), bio: u.bio, statusText: u.statusText, privacy: u.privacy, inviteCode: u.inviteCode, weeklyTargetSeconds: u.weeklyTargetSeconds,
      week: s.week, lastWeek: s.lastWeek, month: s.month, streak: s.streak.current, totalPomodoros: s.totalPomodoros, badges: this.badges(u, s),
      records: { bestDaySeconds: Math.max(0, ...days), bestWeekSeconds: bestWeek, longestStreak: s.streak.longest, challengesWon: u.challengesWon, challengesCompleted: u.challengesCompleted },
    };
  }

  // ---- challenges ------------------------------------------------------------

  private eligible(c: Challenge, userId: string, until: number): SharedInterval[] {
    let iv = (this.state.intervals[userId] ?? []).filter((i) => c.eligibility === "all" || !i.manual);
    if (c.eligibility === "verified") {
      // Only time the server itself watched happen: at least half the interval overlaps live "focusing" presence.
      const log = this.state.focusLog[userId] ?? [];
      iv = iv.filter((i) => totalMs(merge(clipAll(log, i.start, i.end))) >= (i.end - i.start) * 0.5);
    }
    return iv.filter((i) => i.end > c.start && i.start < until);
  }

  private valueOf(c: Challenge, userId: string, until: number): number {
    const u = this.state.users[userId];
    if (!u) return 0;
    const iv = this.eligible(c, userId, until);
    const merged = merge(clipAll(iv, c.start, until));
    if (c.metric === "focus_seconds") return Math.round(totalMs(merged) / 1000);
    if (c.metric === "sessions") return new Set(iv.filter((i) => i.session && i.completed && i.end >= c.start && i.end <= until).map((i) => i.session)).size;
    const from = localDay(c.start, u.tzOffsetMin);
    const n = localDay(until - 1, u.tzOffsetMin) - from + 1;
    return secondsPerDay(merged, from, Math.max(1, n), u.tzOffsetMin).filter((s) => s >= c.minDailySeconds).length;
  }

  private rank(c: Challenge): Array<{ user: string; value: number; reachedAt: number | null }> {
    const rows = c.final ?? c.participants.map((p) => ({ user: p.user, value: this.valueOf(c, p.user, Math.min(this.now(), c.end)), reachedAt: p.reachedAt }));
    return rows.slice().sort((a, b) => (c.winner === "first" ? (a.reachedAt ?? Infinity) - (b.reachedAt ?? Infinity) : 0) || b.value - a.value || a.user.localeCompare(b.user));
  }

  private event(c: Challenge, text: string) {
    c.events.unshift({ at: this.now(), text });
    c.events.length = Math.min(c.events.length, 30);
  }

  /** Recomputes a challenge: start, targets reached, overtakes, ending soon, completion. */
  private advanceChallenge(c: Challenge, announce = true) {
    if (c.finished) return;
    const t = this.now();
    const people = c.participants.map((p) => p.user);
    let dirty = false;
    if (!c.started && t >= c.start) {
      c.started = true;
      dirty = true;
      this.event(c, "The challenge has started");
      for (const p of people) this.notify(p, "challenge_event", null, c.name, "The challenge has started. Good luck!");
    }
    if (c.started) {
      const ranked = this.rank(c);
      for (const r of ranked) {
        const p = c.participants.find((x) => x.user === r.user)!;
        if (c.target != null && r.value >= c.target && p.reachedAt == null) {
          p.reachedAt = t;
          dirty = true;
          const name = this.pub(r.user).displayName;
          this.event(c, `${name} reached the target`);
          this.addFeed(r.user, "challenge", `reached the target in “${c.name}”`);
          for (const o of people) if (o !== r.user) this.notify(o, "challenge_event", r.user, c.name, `${name} reached the target`);
        }
      }
      const order = this.rank(c).map((r) => r.user);
      if (announce && c.lastOrder.length && order.length > 1) {
        order.forEach((u, i) => {
          const before = c.lastOrder.indexOf(u);
          const passed = c.lastOrder[i];
          if (before > i && passed && passed !== u && order.indexOf(passed) > i) {
            this.event(c, `${this.pub(u).displayName} overtook ${this.pub(passed).displayName}`);
            this.notify(passed, "challenge_event", u, c.name, `${this.pub(u).displayName} just overtook you`);
            dirty = true;
          }
        });
      }
      if (order.join() !== c.lastOrder.join()) dirty = true;
      c.lastOrder = order;
    }
    if (!c.endingNotified && c.started && c.end - t < DAY && c.end - c.start > DAY) {
      c.endingNotified = true;
      dirty = true;
      for (const p of people) this.notify(p, "challenge_event", null, c.name, "Less than a day left");
    }
    if (t >= c.end) {
      c.final = this.rank(c);
      c.finished = true;
      dirty = true;
      const winner = c.final[0];
      const won = winner && winner.value > 0 && (c.winner === "highest" || winner.reachedAt != null);
      this.event(c, won ? `${this.pub(winner.user).displayName} won the challenge` : "The challenge ended with no winner");
      for (const r of c.final) {
        const u = this.state.users[r.user];
        if (!u) continue;
        if (won && r.user === winner.user) u.challengesWon++;
        if (c.target == null ? r.value > 0 : r.value >= c.target) u.challengesCompleted++;
        this.notify(r.user, "challenge_done", null, c.name, won ? `${this.pub(winner.user).displayName} won. See the final ranking.` : "The challenge has ended.");
      }
      if (won) this.addFeed(winner.user, "challenge", `won the challenge “${c.name}”`);
    }
    if (dirty) {
      this.changed();
      this.refresh(...people, ...c.invited);
    }
  }

  private challengeView(c: Challenge, viewer: string): ChallengeView {
    const t = this.now();
    let rank = 0;
    const standings: Standing[] = this.rank(c).map((r, i, all) => {
      const prev = all[i - 1];
      if (!prev || prev.value !== r.value || (c.winner === "first" && prev.reachedAt !== r.reachedAt)) rank = i + 1;
      return { user: this.pub(r.user), value: r.value, progress: c.target ? Math.min(1, r.value / c.target) : null, reachedAt: r.reachedAt, rank };
    });
    const { participants, invited, started, endingNotified, finished, final, lastOrder, createdAt, creator, ...rest } = c;
    void started, endingNotified, final, lastOrder, createdAt;
    return {
      ...rest, creator: this.pub(creator), joined: participants.some((p) => p.user === viewer), invited: invited.includes(viewer),
      state: finished ? "finished" : t < c.start ? "upcoming" : "active", standings, invitedUsers: invited.map(this.pub),
    };
  }

  // ---- feed ------------------------------------------------------------------

  private addFeed(user: string, kind: string, text: string) {
    this.state.feed.unshift({ id: rand(8), user, at: this.now(), kind, text, reactions: {} });
    this.state.feed.length = Math.min(this.state.feed.length, 600);
  }

  // ---- snapshot --------------------------------------------------------------

  snapshot(userId: string): Snapshot {
    const u = this.user(userId);
    const friends = this.friendsOf(userId).filter((f) => this.state.users[f.id]);
    const visible = new Set([userId, ...friends.map((f) => f.id)]);
    const room = (r: Room): RoomView => ({
      id: r.id, name: r.name, owner: r.owner, joined: r.members.includes(userId), invited: r.invited.includes(userId),
      members: r.members.map((m) => ({ ...this.pub(m), presence: m === userId ? this.rawPresence(m) : this.presenceFor(m) })), invitedUsers: r.invited.map(this.pub),
      timer: r.timer, completedSessions: r.completedSessions, groupFocusSeconds: r.groupFocusSeconds, reactions: r.reactions,
    });
    return {
      serverNow: this.now(),
      me: this.meView(u),
      friends: friends.map((f) => this.friendView(f.id, f.since)),
      incoming: this.state.requests.filter((r) => r.to === userId).map((r) => ({ id: r.id, from: this.pub(r.from), at: r.at })),
      outgoing: this.state.requests.filter((r) => r.from === userId).map((r) => ({ id: r.id, to: this.pub(r.to), at: r.at })),
      blocked: u.blocked.map(this.pub),
      challenges: this.state.challenges.filter((c) => c.participants.some((p) => p.user === userId) || c.invited.includes(userId)).map((c) => this.challengeView(c, userId)),
      rooms: this.state.rooms.filter((r) => r.members.includes(userId) || r.invited.includes(userId)).map(room),
      feed: this.state.feed.filter((f) => visible.has(f.user)).slice(0, 60).map((f): FeedItem => ({ id: f.id, user: this.pub(f.user), at: f.at, text: f.text, kind: f.kind, reactions: f.reactions })),
    };
  }

  // ---- request handlers ------------------------------------------------------

  private async handle<K extends Op>(c: Conn, op: K, d: z.infer<(typeof S)[K]>): Promise<unknown> {
    const st = this.state;
    const t = this.now();
    const me = c.user!;
    const fn: { [P in Op]: (d: z.infer<(typeof S)[P]>) => unknown } = {
      register: async (d) => {
        if (Object.values(st.users).some((u) => u.username === d.username)) throw new Error("That username is taken");
        const id = rand(12);
        const token = rand(32);
        st.users[id] = {
          id, username: d.username, displayName: d.displayName, bio: d.bio ?? "", statusText: d.statusText ?? "", color: d.color ?? COLORS[Object.keys(st.users).length % COLORS.length]!,
          tokenHash: await sha256(token), inviteCode: code(), privacy: d.privacy ?? { ...DEFAULT_PRIVACY }, tzOffsetMin: d.tzOffsetMin ?? 0, weekStart: d.weekStart ?? 1,
          weeklyTargetSeconds: d.weeklyTargetSeconds ?? null, createdAt: t, lastSeen: t, blocked: [], flags: {}, challengesWon: 0, challengesCompleted: 0,
        };
        c.user = id;
        this.changed();
        return { userId: id, token, state: this.snapshot(id) };
      },
      login: async (d) => {
        const u = st.users[d.userId];
        if (!u || u.tokenHash !== (await sha256(d.token))) throw new Error("This profile is not known to the server");
        c.user = u.id;
        return { state: this.snapshot(u.id) };
      },
      "profile.update": (d) => {
        const u = this.user(me);
        const before = JSON.stringify(u.privacy);
        Object.assign(u, Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined)));
        this.changed();
        if (before !== JSON.stringify(u.privacy)) this.broadcastPresence(me);
        this.refresh(me, ...this.audience(me));
      },
      "invite.rotate": () => {
        this.user(me).inviteCode = code();
        this.changed();
        this.refresh(me);
      },
      "friend.search": (d) => {
        const q = d.query.toLowerCase().replace(/^@/, "");
        return Object.values(st.users).filter((u) => u.id !== me && !this.blockedEither(me, u.id) && u.username.startsWith(q)).slice(0, 8).map((u) => this.pub(u.id));
      },
      "friend.request": (d) => {
        const target = Object.values(st.users).find((u) => (d.username ? u.username === d.username : !!d.inviteCode && u.inviteCode === d.inviteCode.toUpperCase()));
        // Same answer whether the user does not exist or has blocked the sender, so blocks cannot be probed.
        if (!target || target.blocked.includes(me)) throw new Error(d.username ? "No user with that username" : "That invitation code is not valid");
        if (target.id === me) throw new Error("That is you");
        if (this.user(me).blocked.includes(target.id)) throw new Error("You have blocked this user. Unblock them first.");
        if (this.areFriends(me, target.id)) throw new Error("You are already friends");
        if (st.requests.some((r) => r.from === me && r.to === target.id)) throw new Error("You have already sent this person a request");
        const reverse = st.requests.find((r) => r.from === target.id && r.to === me);
        if (reverse) return fn["friend.respond"]({ requestId: reverse.id, accept: true });
        if (st.requests.filter((r) => r.from === me).length >= 50) throw new Error("You have too many pending requests");
        st.requests.push({ id: rand(8), from: me, to: target.id, at: t });
        this.changed();
        this.notify(target.id, "friend_request", me, this.pub(me).displayName, "sent you a friend request");
        this.refresh(me, target.id);
      },
      "friend.respond": (d) => {
        const r = st.requests.find((x) => x.id === d.requestId && x.to === me);
        if (!r) throw new Error("That request is no longer pending");
        st.requests = st.requests.filter((x) => x !== r);
        if (d.accept && !this.areFriends(r.from, r.to)) {
          st.friendships.push({ a: r.from, b: r.to, since: t });
          this.notify(r.from, "friend_accepted", me, this.pub(me).displayName, "accepted your friend request");
        }
        this.changed();
        this.refresh(r.from, r.to);
      },
      "friend.cancel": (d) => {
        const r = st.requests.find((x) => x.id === d.requestId && x.from === me);
        if (!r) throw new Error("That request is no longer pending");
        st.requests = st.requests.filter((x) => x !== r);
        this.changed();
        this.refresh(r.from, r.to);
      },
      "friend.remove": (d) => {
        st.friendships = st.friendships.filter((f) => !((f.a === me && f.b === d.userId) || (f.a === d.userId && f.b === me)));
        this.changed();
        this.refresh(me, d.userId);
      },
      "user.block": (d) => {
        const u = this.user(me);
        if (d.userId === me) throw new Error("You cannot block yourself");
        u.blocked = u.blocked.filter((x) => x !== d.userId);
        if (d.on) {
          u.blocked.push(d.userId);
          // Blocking severs everything between the two people.
          st.friendships = st.friendships.filter((f) => !((f.a === me && f.b === d.userId) || (f.a === d.userId && f.b === me)));
          st.requests = st.requests.filter((r) => !((r.from === me && r.to === d.userId) || (r.from === d.userId && r.to === me)));
        }
        this.changed();
        this.refresh(me, d.userId);
      },
      presence: (d) => this.setPresence(me, d),
      "activity.sync": (d) => {
        const u = this.user(me);
        const before = this.stats(u);
        const seen = new Set<string>();
        const clean = d.intervals.filter((i) => {
          // Plausibility: a real, finished, sanely sized stretch of time, reported once.
          const ok = i.end > i.start && i.end - i.start <= DAY && i.end <= t + 120_000 && i.start >= d.windowStart && !seen.has(i.id);
          seen.add(i.id);
          return ok;
        });
        const known = new Set((st.intervals[me] ?? []).map((i) => i.id));
        // The client owns the window it sends: everything in it is replaced, older history is kept.
        st.intervals[me] = [...(st.intervals[me] ?? []).filter((i) => i.end <= d.windowStart && i.end > t - 420 * DAY), ...clean];
        const after = this.stats(u);
        if (u.privacy.sessions || u.privacy.weekly) {
          const fresh = clean.filter((i) => !known.has(i.id) && i.completed && !i.manual && i.end > t - 15 * 60_000 && i.end - i.start >= 10 * 60_000);
          for (const i of fresh.slice(0, 2)) this.addFeed(me, "session", `completed a ${Math.round((i.end - i.start) / 60_000)}-minute ${i.mode === "pomodoro" ? "Pomodoro" : "focus session"}`);
        }
        const today = this.today(u);
        const dayIdx = today - weekStartDay(today, u.weekStart);
        const todayNow = after.week.days[dayIdx] ?? 0;
        if (u.privacy.daily && (before.week.days[dayIdx] ?? 0) < 5 * 3600 && todayNow >= 5 * 3600 && u.flags.fiveHourDay !== today) {
          u.flags.fiveHourDay = today;
          this.addFeed(me, "milestone", "completed 5 hours of focus today");
        }
        const target = u.weeklyTargetSeconds;
        const week = weekStartDay(today, u.weekStart);
        if (target && after.week.seconds >= target && u.flags.goalWeek !== week) {
          u.flags.goalWeek = week;
          u.flags.goalReached = 1;
          if (u.privacy.goal) {
            this.addFeed(me, "goal", `reached their weekly focus target of ${fmtH(target)}`);
            for (const f of this.friendsOf(me)) this.notify(f.id, "challenge_event", me, u.displayName, "reached their weekly focus target");
          }
        }
        if (after.week.seconds >= 10 * 3600) u.flags.week10 = 1;
        if (after.month.seconds >= 50 * 3600) u.flags.month50 = 1;
        this.changed();
        for (const ch of st.challenges) if (ch.participants.some((p) => p.user === me)) this.advanceChallenge(ch);
        this.refresh(me, ...this.audience(me));
        return { accepted: clean.length, rejected: d.intervals.length - clean.length };
      },
      "challenge.create": (d) => {
        if (d.end <= d.start) throw new Error("The challenge must end after it starts");
        if (d.end - d.start > 366 * DAY) throw new Error("A challenge can last at most a year");
        if (d.end < t) throw new Error("The challenge would already be over");
        if (d.winner === "first" && d.target == null) throw new Error("A “first to reach” challenge needs a target");
        const { invite, ...rest } = d;
        const ch: Challenge = {
          ...rest, id: rand(8), creator: me, createdAt: t, participants: [{ user: me, joinedAt: t, reachedAt: null }],
          invited: invite.filter((u) => u !== me && this.areFriends(me, u)), events: [], started: false, endingNotified: false, finished: false, final: null, lastOrder: [],
        };
        st.challenges.push(ch);
        this.addFeed(me, "challenge", `created the challenge “${ch.name}”`);
        for (const u of ch.invited) this.notify(u, "challenge_invite", me, this.pub(me).displayName, `invited you to “${ch.name}”`);
        this.advanceChallenge(ch, false);
        this.changed();
        this.refresh(me, ...ch.invited);
        return { id: ch.id };
      },
      "challenge.join": (d) => {
        const ch = st.challenges.find((x) => x.id === d.id);
        if (!ch || !ch.invited.includes(me)) throw new Error("You have not been invited to this challenge");
        if (ch.finished) throw new Error("This challenge has already ended");
        ch.invited = ch.invited.filter((u) => u !== me);
        ch.participants.push({ user: me, joinedAt: t, reachedAt: null });
        this.event(ch, `${this.pub(me).displayName} joined`);
        this.addFeed(me, "challenge", `joined the challenge “${ch.name}”`);
        for (const p of ch.participants) if (p.user !== me) this.notify(p.user, "challenge_event", me, ch.name, `${this.pub(me).displayName} joined`);
        ch.lastOrder = [];
        this.advanceChallenge(ch, false);
        this.changed();
        this.refresh(...ch.participants.map((p) => p.user), ...ch.invited);
      },
      "challenge.leave": (d) => {
        const ch = st.challenges.find((x) => x.id === d.id);
        if (!ch) return;
        const people = [...ch.participants.map((p) => p.user), ...ch.invited];
        ch.invited = ch.invited.filter((u) => u !== me);
        if (!ch.finished) {
          if (ch.participants.some((p) => p.user === me)) this.event(ch, `${this.pub(me).displayName} left`);
          ch.participants = ch.participants.filter((p) => p.user !== me);
          ch.lastOrder = [];
          if (!ch.participants.length) st.challenges = st.challenges.filter((x) => x !== ch);
        }
        this.changed();
        this.refresh(...people);
      },
      "challenge.invite": (d) => {
        const ch = st.challenges.find((x) => x.id === d.id);
        if (!ch || ch.creator !== me) throw new Error("Only the creator can invite people");
        if (ch.finished) throw new Error("This challenge has already ended");
        for (const u of d.users) {
          if (!this.areFriends(me, u) || ch.invited.includes(u) || ch.participants.some((p) => p.user === u)) continue;
          ch.invited.push(u);
          this.notify(u, "challenge_invite", me, this.pub(me).displayName, `invited you to “${ch.name}”`);
        }
        this.changed();
        this.refresh(...ch.participants.map((p) => p.user), ...ch.invited);
      },
      "challenge.delete": (d) => {
        const ch = st.challenges.find((x) => x.id === d.id);
        if (!ch || ch.creator !== me) throw new Error("Only the creator can delete a challenge");
        st.challenges = st.challenges.filter((x) => x !== ch);
        this.changed();
        this.refresh(...ch.participants.map((p) => p.user), ...ch.invited);
      },
      "room.create": (d) => {
        const r: Room = { id: rand(8), name: d.name, owner: me, members: [me], invited: d.invite.filter((u) => u !== me && this.areFriends(me, u)), timer: null, completedSessions: 0, groupFocusSeconds: 0, reactions: [] };
        st.rooms.push(r);
        for (const u of r.invited) this.notify(u, "room", me, this.pub(me).displayName, `invited you to focus together in “${r.name}”`);
        this.changed();
        this.refresh(me, ...r.invited);
        return { id: r.id };
      },
      "room.invite": (d) => {
        const r = st.rooms.find((x) => x.id === d.id);
        if (!r || !r.members.includes(me)) throw new Error("You are not in this room");
        for (const u of d.users) {
          if (!this.areFriends(me, u) || r.invited.includes(u) || r.members.includes(u)) continue;
          r.invited.push(u);
          this.notify(u, "room", me, this.pub(me).displayName, `invited you to focus together in “${r.name}”`);
        }
        this.changed();
        this.refresh(...r.members, ...r.invited);
      },
      "room.join": (d) => {
        const r = st.rooms.find((x) => x.id === d.id);
        if (!r || !r.invited.includes(me)) throw new Error("You have not been invited to this room");
        r.invited = r.invited.filter((u) => u !== me);
        r.members.push(me);
        for (const m of r.members) if (m !== me) this.notify(m, "room", me, r.name, `${this.pub(me).displayName} joined the room`);
        this.changed();
        this.refresh(...r.members, ...r.invited);
      },
      "room.leave": (d) => {
        const r = st.rooms.find((x) => x.id === d.id);
        if (!r) return;
        const people = [...r.members, ...r.invited];
        r.members = r.members.filter((u) => u !== me);
        r.invited = r.invited.filter((u) => u !== me);
        if (!r.members.length) st.rooms = st.rooms.filter((x) => x !== r);
        else if (r.owner === me) r.owner = r.members[0]!;
        this.changed();
        this.refresh(...people);
      },
      "room.timer": (d) => {
        const r = st.rooms.find((x) => x.id === d.id);
        if (!r || !r.members.includes(me)) throw new Error("You are not in this room");
        r.timer = d.kind === "stop" ? null : { kind: d.kind, startedAt: t, plannedMs: Math.round((d.minutes ?? (d.kind === "focus" ? 25 : 5)) * 60_000), by: me };
        this.changed();
        for (const m of r.members) this.push(m, { t: "room_timer", roomId: r.id, timer: r.timer, serverNow: t });
        this.refresh(...r.members);
      },
      "room.react": (d) => {
        const r = st.rooms.find((x) => x.id === d.id);
        if (!r || !r.members.includes(me)) throw new Error("You are not in this room");
        r.reactions = [{ at: t, user: me, kind: d.kind }, ...r.reactions].slice(0, 20);
        this.changed();
        this.refresh(...r.members);
      },
      "feed.react": (d) => {
        const f = st.feed.find((x) => x.id === d.id);
        if (!f || !(f.user === me || this.areFriends(me, f.user))) throw new Error("That post is not available");
        const list = (f.reactions[d.kind] ??= []);
        const had = list.includes(me);
        f.reactions[d.kind] = had ? list.filter((u) => u !== me) : [...list, me];
        if (!had && f.user !== me) this.notify(f.user, "cheer", me, this.pub(me).displayName, "reacted to your activity");
        this.changed();
        this.refresh(f.user, ...this.friendsOf(f.user).map((x) => x.id));
      },
      cheer: (d) => {
        if (!this.areFriends(me, d.userId)) throw new Error("You can only encourage friends");
        const label = { clap: "says: good job!", fire: "says: you are on fire!", strong: "says: keep going!", focus: "says: let's focus!" }[d.kind];
        this.notify(d.userId, "cheer", me, this.pub(me).displayName, label);
      },
      "state.get": () => this.snapshot(me),
    };
    return fn[op](d);
  }
}
