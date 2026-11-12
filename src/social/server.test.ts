import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PRIVACY, OFFLINE_AFTER_MS, type ServerPush, type SharedInterval, type Snapshot } from "./protocol";
import { SocialServer, emptyState } from "./server";
import { merge, periodStats, secondsPerDay, streakDays, weekStartDay, localDay } from "./stats";

const MIN = 60_000;
const H = 3600_000;
const DAY = 24 * H;
// Monday 2026-03-02 09:00 UTC
const T0 = Date.UTC(2026, 2, 2, 9);
let now = T0;
let server: SocialServer;
let seq = 0;

interface Client {
  id: string;
  token: string;
  pushes: ServerPush[];
  call: <T = unknown>(t: string, d?: unknown) => Promise<T>;
  state: () => Promise<Snapshot>;
  notes: () => string[];
}

async function connect(conn = `c${++seq}`) {
  const pushes: ServerPush[] = [];
  const replies = new Map<number, { ok: boolean; data?: unknown; error?: string }>();
  server.connect(conn, (text) => {
    const m = JSON.parse(text);
    if ("re" in m) replies.set(m.re, m);
    else pushes.push(m);
  });
  let n = 0;
  const call = async <T,>(t: string, d: unknown = {}): Promise<T> => {
    const id = ++n;
    await server.receive(conn, JSON.stringify({ id, t, d }));
    const r = replies.get(id)!;
    if (!r.ok) throw new Error(r.error);
    return r.data as T;
  };
  return { conn, pushes, call };
}

async function join(name: string, extra: object = {}): Promise<Client> {
  const c = await connect();
  const r = await c.call<{ userId: string; token: string }>("register", { username: name, displayName: name[0]!.toUpperCase() + name.slice(1), ...extra });
  return { id: r.userId, token: r.token, pushes: c.pushes, call: c.call, state: () => c.call<Snapshot>("state.get"), notes: () => c.pushes.filter((p) => p.t === "notify").map((p) => (p as { body: string }).body) };
}

async function befriend(a: Client, b: Client, bName: string) {
  await a.call("friend.request", { username: bName });
  const req = (await b.state()).incoming[0]!;
  await b.call("friend.respond", { requestId: req.id, accept: true });
}

const iv = (id: string, start: number, minutes: number, o: Partial<SharedInterval> = {}): SharedInterval => ({ id, start, end: start + minutes * MIN, manual: false, mode: "pomodoro", session: `s-${id}`, completed: true, ...o });
const sync = (c: Client, intervals: SharedInterval[]) => c.call("activity.sync", { windowStart: T0 - 60 * DAY, intervals });

beforeEach(() => {
  now = T0;
  server = new SocialServer(emptyState(), { now: () => now });
});

describe("stats helpers", () => {
  it("merges overlapping spans so a minute counts once", () => {
    expect(merge([{ start: 0, end: 10 }, { start: 5, end: 20 }, { start: 30, end: 40 }])).toEqual([{ start: 0, end: 20 }, { start: 30, end: 40 }]);
  });
  it("buckets by the user's own timezone and week start", () => {
    // 23:30 UTC on Monday is already Tuesday at UTC+2
    const span = [{ start: Date.UTC(2026, 2, 2, 23, 30), end: Date.UTC(2026, 2, 3, 0, 30) }];
    const mon = localDay(T0, 0);
    expect(secondsPerDay(span, mon, 2, 0)).toEqual([1800, 1800]);
    expect(secondsPerDay(span, mon, 2, 120)).toEqual([0, 3600]);
    expect(weekStartDay(mon + 3, 1)).toBe(mon);
    expect(weekStartDay(mon, 0)).toBe(mon - 1);
  });
  it("counts sessions, pomodoros and productive days", () => {
    const mon = localDay(T0, 0);
    const s = periodStats([iv("a", T0, 25), iv("b", T0 + H, 50, { mode: "deep" }), iv("c", T0 + DAY, 10, { completed: false })], mon, 7, 0, 3600);
    expect(s).toMatchObject({ seconds: 85 * 60, sessions: 2, pomodoros: 1, productiveDays: 1, targetSeconds: 3600 });
  });
  it("streaks ignore an empty today", () => {
    const mon = localDay(T0, 0);
    const days = [iv("a", T0, 30), iv("b", T0 + DAY, 30), iv("c", T0 + 3 * DAY, 30)];
    expect(streakDays(days, mon + 2, 0)).toEqual({ current: 2, longest: 2 });
    expect(streakDays(days, mon + 3, 0).current).toBe(1);
  });
});

describe("accounts and friends", () => {
  it("registers, logs back in with the token, and rejects a wrong one", async () => {
    const a = await join("youssef");
    const c = await connect();
    await expect(c.call("login", { userId: a.id, token: "x".repeat(32) })).rejects.toThrow(/not known/);
    await expect(c.call("state.get")).rejects.toThrow(/Not signed in/);
    const r = await c.call<{ state: Snapshot }>("login", { userId: a.id, token: a.token });
    expect(r.state.me.username).toBe("youssef");
    await expect(join("youssef")).rejects.toThrow(/taken/);
    await expect(join("x")).rejects.toThrow(/3–20/);
    // the token itself is never stored
    expect(JSON.stringify(server.state)).not.toContain(a.token);
  });

  it("requests, accepts, cancels, removes — by username or invitation code", async () => {
    const a = await join("youssef");
    const b = await join("ahmed");
    const c = await join("omar");
    await a.call("friend.request", { username: "ahmed" });
    await expect(a.call("friend.request", { username: "ahmed" })).rejects.toThrow(/already sent/);
    expect((await b.state()).incoming).toHaveLength(1);
    expect(b.notes()).toContain("sent you a friend request");
    await b.call("friend.respond", { requestId: (await b.state()).incoming[0]!.id, accept: true });
    expect((await a.state()).friends.map((f) => f.username)).toEqual(["ahmed"]);
    expect(a.notes()).toContain("accepted your friend request");

    const code = (await c.state()).me.inviteCode;
    await a.call("friend.request", { inviteCode: code.toLowerCase() });
    const out = (await a.state()).outgoing[0]!;
    await a.call("friend.cancel", { requestId: out.id });
    expect((await c.state()).incoming).toHaveLength(0);
    await expect(a.call("friend.request", { inviteCode: "NOPE" })).rejects.toThrow(/not valid/);

    await a.call("friend.remove", { userId: b.id });
    expect((await b.state()).friends).toHaveLength(0);
  });

  it("blocking severs the friendship and hides the blocker", async () => {
    const a = await join("youssef");
    const b = await join("ahmed");
    await befriend(a, b, "ahmed");
    await b.call("user.block", { userId: a.id, on: true });
    expect((await a.state()).friends).toHaveLength(0);
    await expect(a.call("friend.request", { username: "ahmed" })).rejects.toThrow(/No user/);
    expect(await a.call("friend.search", { query: "ahm" })).toEqual([]);
    await b.call("user.block", { userId: a.id, on: false });
    expect(await a.call("friend.search", { query: "ahm" })).toHaveLength(1);
  });

  it("rate limits a flooding connection", async () => {
    server = new SocialServer(emptyState(), { now: () => now, rateLimit: 5 });
    const a = await join("youssef");
    let failed = 0;
    for (let i = 0; i < 10; i++) await a.call("state.get").catch(() => failed++);
    expect(failed).toBeGreaterThan(0);
    now += 11_000;
    await expect(a.call("state.get")).resolves.toBeTruthy();
  });
});

describe("presence", () => {
  it("shows focusing with remaining time, then offline when heartbeats stop", async () => {
    const a = await join("youssef");
    const b = await join("ahmed");
    await befriend(a, b, "ahmed");
    await a.call("presence", { status: "focusing", mode: "pomodoro", plannedMs: 25 * MIN, elapsedMs: 0, objective: "Secret thesis chapter" });
    const live = b.pushes.filter((p) => p.t === "presence").at(-1) as Extract<ServerPush, { t: "presence" }>;
    expect(live.presence).toMatchObject({ status: "focusing", mode: "pomodoro", plannedMs: 25 * MIN });
    expect(live.presence.objective).toBeUndefined(); // objective is private unless switched on
    expect(b.notes()).toContain("started a focus session");

    // the socket stays "open" but the device stops answering
    now += OFFLINE_AFTER_MS + 1000;
    server.tick();
    const f = (await b.state()).friends[0]!;
    expect(f.presence.status).toBe("offline");
    expect(f.presence.lastSeen).toBe(T0);
  });

  it("honours activity privacy: hidden activity shows only Online", async () => {
    const a = await join("youssef", { privacy: { ...DEFAULT_PRIVACY, activity: false } });
    const b = await join("ahmed");
    await befriend(a, b, "ahmed");
    await a.call("presence", { status: "focusing", mode: "deep", plannedMs: 90 * MIN, elapsedMs: 0 });
    expect((await b.state()).friends[0]!.presence).toEqual({ status: "online", lastSeen: T0 });
    expect(b.notes()).not.toContain("started a focus session");
    // toggles are merged one key at a time
    await a.call("profile.update", { privacy: { activity: true } });
    await a.call("profile.update", { privacy: { sessionTime: false } });
    await a.call("profile.update", { privacy: { objective: true } });
    await a.call("presence", { status: "focusing", mode: "deep", plannedMs: 90 * MIN, elapsedMs: 0, objective: "Reading" });
    const p = (await b.state()).friends[0]!.presence;
    expect(p).toMatchObject({ status: "focusing", objective: "Reading" });
    expect(p.plannedMs).toBeUndefined();
  });

  it("strangers receive nothing", async () => {
    const a = await join("youssef");
    const c = await join("omar");
    await a.call("presence", { status: "focusing", mode: "pomodoro", plannedMs: 25 * MIN });
    expect(c.pushes.filter((p) => p.t === "presence")).toHaveLength(0);
    expect((await c.state()).friends).toHaveLength(0);
  });
});

describe("shared statistics", () => {
  it("computes weekly stats server-side and hides what is not shared", async () => {
    const a = await join("ahmed", { weeklyTargetSeconds: 15 * 3600, privacy: { ...DEFAULT_PRIVACY, daily: false, goal: false } });
    const b = await join("youssef");
    await befriend(a, b, "youssef");
    now = T0 + 2 * DAY;
    await sync(a, [iv("1", T0, 60), iv("2", T0 + 30 * MIN, 60), iv("3", T0 + DAY, 120, { mode: "deep" }), iv("m", T0 + DAY + 5 * H, 60, { manual: true, session: null, completed: false })]);
    const me = (await a.state()).me;
    expect(me.week.seconds).toBe((90 + 120 + 60) * 60); // overlap of 1 and 2 counted once
    expect(me.week.sessions).toBe(3);
    expect(me.week.pomodoros).toBe(2);
    const f = (await b.state()).friends[0]!;
    expect(f.week.seconds).toBe(me.week.seconds);
    expect(f.week.days).toBeNull();
    expect(f.week.targetSeconds).toBeNull();
    expect(f.streak).toBe(2);
  });

  it("rejects implausible intervals and replaces the synced window idempotently", async () => {
    const a = await join("ahmed");
    now = T0 + DAY;
    const good = iv("ok", T0, 30);
    const r = await a.call<{ accepted: number; rejected: number }>("activity.sync", {
      windowStart: T0 - 60 * DAY,
      intervals: [good, good, iv("future", now + H, 30), iv("negative", T0, -5), iv("huge", T0 - 3 * DAY, 30 * 60)],
    });
    expect(r).toEqual({ accepted: 1, rejected: 4 });
    await sync(a, [good]);
    await sync(a, [good]);
    expect((await a.state()).me.week.seconds).toBe(1800);
    await sync(a, []); // the entry was deleted locally
    expect((await a.state()).me.week.seconds).toBe(0);
  });
});

describe("challenges", () => {
  const week = { start: T0, end: T0 + 7 * DAY };
  const base = { name: "Most focus this week", description: "", type: "focus_hours", metric: "focus_seconds", target: null, winner: "highest", minDailySeconds: 3600, eligibility: "tracked", ...week };

  it("needs an explicit join, ranks by eligible time, and excludes manual entries by default", async () => {
    const a = await join("youssef");
    const b = await join("ahmed");
    const c = await join("omar");
    await befriend(a, b, "ahmed");
    const { id } = await a.call<{ id: string }>("challenge.create", { ...base, invite: [b.id, c.id] });
    expect((await c.state()).challenges).toHaveLength(0); // not a friend → not invited
    let ch = (await b.state()).challenges[0]!;
    expect(ch).toMatchObject({ invited: true, joined: false });
    expect(ch.standings.map((s) => s.user.username)).toEqual(["youssef"]);
    await b.call("challenge.join", { id });
    await expect(c.call("challenge.join", { id })).rejects.toThrow(/not been invited/);

    now = T0 + 2 * DAY;
    await sync(a, [iv("a1", T0 + H, 120), iv("before", T0 - DAY, 600)]); // time before the start never counts
    await sync(b, [iv("b1", T0 + H, 60), iv("b2", T0 + 3 * H, 240, { manual: true, session: null, completed: false })]);
    ch = (await a.state()).challenges[0]!;
    expect(ch.standings.map((s) => [s.user.username, s.value, s.rank])).toEqual([["youssef", 7200, 1], ["ahmed", 3600, 2]]);

    // Ahmed tracks more and overtakes
    now += H;
    await sync(b, [iv("b1", T0 + H, 60), iv("b3", T0 + DAY, 180)]);
    ch = (await a.state()).challenges[0]!;
    expect(ch.standings[0]!.user.username).toBe("ahmed");
    expect(a.notes()).toContain("Ahmed just overtook you");

    // finishing
    now = T0 + 7 * DAY + 1000;
    server.tick();
    ch = (await a.state()).challenges[0]!;
    expect(ch.state).toBe("finished");
    expect(ch.events[0]!.text).toBe("Ahmed won the challenge");
    expect((await b.state()).me.records.challengesWon).toBe(1);
    // results are frozen: later syncs cannot change history
    await sync(a, [iv("late", T0 + H, 600)]);
    expect((await a.state()).challenges[0]!.standings[0]!.user.username).toBe("ahmed");
  });

  it("first-to-target goal challenge records who got there first", async () => {
    const a = await join("youssef");
    const b = await join("ahmed");
    await befriend(a, b, "ahmed");
    const { id } = await a.call<{ id: string }>("challenge.create", { ...base, type: "goal", target: 2 * 3600, winner: "first", invite: [b.id] });
    await b.call("challenge.join", { id });
    now = T0 + DAY;
    await sync(b, [iv("b", T0 + H, 130)]);
    now += H;
    await sync(a, [iv("a", T0 + H, 300)]); // more time, but later
    const ch = (await a.state()).challenges[0]!;
    expect(ch.standings.map((s) => s.user.username)).toEqual(["ahmed", "youssef"]);
    expect(ch.standings[0]!.progress).toBe(1);
    expect(a.notes()).toContain("Ahmed reached the target");
  });

  it("pomodoro and consistency metrics", async () => {
    const a = await join("youssef");
    const p = await a.call<{ id: string }>("challenge.create", { ...base, type: "pomodoro", metric: "sessions", target: 30, invite: [] });
    const c = await a.call<{ id: string }>("challenge.create", { ...base, type: "consistency", metric: "days", target: 7, minDailySeconds: 3600, invite: [] });
    now = T0 + 3 * DAY;
    await sync(a, [iv("1", T0, 25), iv("2", T0 + H, 25), iv("3", T0 + 2 * H, 25, { completed: false }), iv("d2", T0 + DAY, 70), iv("d3", T0 + 2 * DAY, 30)]);
    const list = (await a.state()).challenges;
    expect(list.find((x) => x.id === p.id)!.standings[0]!.value).toBe(4); // completed sessions only
    expect(list.find((x) => x.id === c.id)!.standings[0]!.value).toBe(2); // Mon (75 min) and Tue (70 min); Wed 30 min is short
  });

  it("verified-only challenges count just the time the server saw live", async () => {
    const a = await join("youssef");
    await a.call("challenge.create", { ...base, eligibility: "verified", invite: [] });
    await a.call("presence", { status: "focusing", mode: "pomodoro", plannedMs: 25 * MIN, elapsedMs: 0 });
    for (let i = 0; i < 100; i++) {
      now += 15_000;
      await a.call("presence", { status: "focusing", mode: "pomodoro", plannedMs: 25 * MIN, elapsedMs: (i + 1) * 15_000 });
    }
    await a.call("presence", { status: "online" });
    await sync(a, [iv("seen", T0, 25), iv("claimed", T0 + 5 * H - 4 * H, 200)]); // 25 real minutes, plus an unobserved claim
    expect((await a.state()).challenges[0]!.standings[0]!.value).toBe(25 * 60);
  });

  it("leaving removes the participant; validation rejects nonsense", async () => {
    const a = await join("youssef");
    const b = await join("ahmed");
    await befriend(a, b, "ahmed");
    const { id } = await a.call<{ id: string }>("challenge.create", { ...base, invite: [b.id] });
    await b.call("challenge.join", { id });
    await b.call("challenge.leave", { id });
    expect((await b.state()).challenges).toHaveLength(0);
    expect((await a.state()).challenges[0]!.standings).toHaveLength(1);
    await expect(a.call("challenge.create", { ...base, end: T0 - 1, invite: [] })).rejects.toThrow();
    await expect(a.call("challenge.create", { ...base, winner: "first", invite: [] })).rejects.toThrow(/needs a target/);
    await expect(b.call("challenge.delete", { id })).rejects.toThrow(/Only the creator/);
  });
});

describe("focus rooms and feed", () => {
  it("invitation-only rooms with a shared timer, statuses and group totals", async () => {
    const a = await join("youssef");
    const b = await join("ahmed");
    const c = await join("omar");
    await befriend(a, b, "ahmed");
    const { id } = await a.call<{ id: string }>("room.create", { name: "Evening study", invite: [b.id, c.id] });
    await expect(c.call("room.join", { id })).rejects.toThrow(/not been invited/);
    await b.call("room.join", { id });
    await a.call("room.timer", { id, kind: "focus", minutes: 25 });
    const pushed = b.pushes.filter((p) => p.t === "room_timer").at(-1) as Extract<ServerPush, { t: "room_timer" }>;
    expect(pushed.timer).toMatchObject({ kind: "focus", plannedMs: 25 * MIN, startedAt: T0 });
    await a.call("presence", { status: "focusing", mode: "countdown", plannedMs: 25 * MIN });
    await b.call("presence", { status: "focusing", mode: "countdown", plannedMs: 25 * MIN });
    await b.call("room.react", { id, kind: "focus" });
    for (let i = 0; i < 101; i++) {
      now += 15_000;
      await a.call("presence", { status: "focusing", mode: "countdown", plannedMs: 25 * MIN });
      await b.call("presence", { status: "focusing", mode: "countdown", plannedMs: 25 * MIN });
    }
    server.tick();
    const room = (await a.state()).rooms[0]!;
    expect(room.timer).toBeNull();
    expect(room.completedSessions).toBe(1);
    expect(room.groupFocusSeconds).toBe(2 * 25 * 60);
    expect(room.members.map((m) => m.presence.status)).toEqual(["focusing", "focusing"]);
    expect(room.reactions[0]).toMatchObject({ user: b.id, kind: "focus" });
    await a.call("room.leave", { id });
    expect((await b.state()).rooms[0]!.owner).toBe(b.id);
  });

  it("feed shows friends' achievements only, with reactions", async () => {
    const a = await join("youssef", { weeklyTargetSeconds: 3600 });
    const b = await join("ahmed");
    const c = await join("omar");
    await befriend(a, b, "ahmed");
    now = T0 + 2 * H;
    await sync(a, [iv("s", now - 70 * MIN, 65)]);
    const feed = (await b.state()).feed;
    expect(feed.map((f) => f.text)).toEqual(expect.arrayContaining(["completed a 65-minute Pomodoro", "reached their weekly focus target of 1h"]));
    expect((await c.state()).feed).toHaveLength(0);
    await b.call("feed.react", { id: feed[0]!.id, kind: "clap" });
    expect((await a.state()).feed.find((f) => f.id === feed[0]!.id)!.reactions.clap).toEqual([b.id]);
    await expect(c.call("feed.react", { id: feed[0]!.id, kind: "clap" })).rejects.toThrow();
    // nothing in the server's entire state mentions a task, project or note
    expect(Object.keys(server.state.intervals[a.id]![0]!).sort()).toEqual(["completed", "end", "id", "manual", "mode", "session", "start"]);
  });
});
