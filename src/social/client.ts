import { create } from "zustand";
import { db, isTauri } from "@/db/driver";
import { elapsedMs, isRunning } from "@/domain/timer";
import { notify, toast } from "@/lib/notify";
import { setSetting } from "@/store/actions";
import { data, useData, type Settings } from "@/store/data";
import { startSession, useTimer } from "@/store/timer";
import { HEARTBEAT_MS, type NotifyKind, type Presence, type PresenceReport, type Privacy, type RoomView, type ServerPush, type SharedInterval, type Snapshot } from "./protocol";

/**
 * The app's side of the social layer.
 *
 * It is strictly an observer of local data: it reads the timer and the time
 * entries and reports them, and never writes to them. If the server is
 * unreachable nothing else in Tempo is affected.
 */
interface SocialState {
  conn: "off" | "connecting" | "online" | "offline";
  error: string | null;
  snap: Snapshot | null;
  /** serverNow − local clock, to draw friends' countdowns correctly */
  offsetMs: number;
  /** ticks once a second while connected so live timers re-render */
  now: number;
}

export const useSocial = create<SocialState>(() => ({ conn: "off", error: null, snap: null, offsetMs: 0, now: Date.now() }));

const SYNC_WINDOW_DAYS = 62;
let ws: WebSocket | null = null;
let seq = 0;
let wanted = false;
let retry = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let beatTimer: ReturnType<typeof setInterval> | null = null;
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let lastInput = Date.now();
let lastPresenceKey = "";
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

if (typeof window !== "undefined") {
  for (const ev of ["mousemove", "keydown", "pointerdown", "wheel"]) window.addEventListener(ev, () => (lastInput = Date.now()), { passive: true });
}

function rawCall<T>(t: string, d: unknown = {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return reject(new Error("Not connected to the social server"));
    const id = ++seq;
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    ws.send(JSON.stringify({ id, t, d }));
    setTimeout(() => pending.delete(id) && reject(new Error("The server did not answer in time")), 12_000);
  });
}

/** Sends a request to the social server. */
export const social = rawCall;

function applySnapshot(snap: Snapshot) {
  useSocial.setState({ snap, offsetMs: snap.serverNow - Date.now() });
}

/** What this device is doing right now, from the real timer state. */
export function presenceReport(): PresenceReport {
  const { timer, gap } = useTimer.getState();
  const idleMs = data().settings.socialPrefs.idleMinutes * 60_000;
  if (timer && isRunning(timer) && !gap) {
    const elapsed = elapsedMs(timer, Date.now());
    if (timer.phase === "focus") return { status: "focusing", mode: timer.mode, plannedMs: timer.plannedMs, elapsedMs: elapsed, objective: timer.objective || undefined };
    return { status: "break", mode: timer.phase, plannedMs: timer.plannedMs, elapsedMs: elapsed };
  }
  return { status: Date.now() - lastInput > idleMs ? "idle" : "online" };
}

function sendPresence(force = false) {
  if (useSocial.getState().conn !== "online") return;
  const r = presenceReport();
  const key = `${r.status}|${r.mode}|${r.plannedMs}`;
  if (!force && key === lastPresenceKey) return;
  lastPresenceKey = key;
  void rawCall("presence", r).catch(() => undefined);
}

/** Tracked time as anonymous intervals — when and what kind, never what on. */
export function sharedIntervals(now = Date.now()): { windowStart: number; intervals: SharedInterval[] } {
  const s = data();
  const windowStart = now - SYNC_WINDOW_DAYS * 86_400_000;
  const sessions = new Map(s.sessions.map((x) => [x.id, x]));
  const intervals = s.entries
    .filter((e) => e.started_at >= windowStart)
    .map((e): SharedInterval => {
      const session = e.session_id ? sessions.get(e.session_id) : undefined;
      return { id: e.id, start: e.started_at, end: e.ended_at, manual: e.source === "manual", mode: session?.mode ?? null, session: e.session_id, completed: session?.status === "completed" };
    });
  return { windowStart, intervals };
}

function scheduleSync(delay = 1500) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    if (useSocial.getState().conn !== "online") return;
    void rawCall("activity.sync", sharedIntervals()).catch(() => undefined);
  }, delay);
}

const localProfile = () => {
  const s = data().settings;
  return { tzOffsetMin: -new Date().getTimezoneOffset(), weekStart: s.weekStart, weeklyTargetSeconds: s.weeklyFocusTargetHours > 0 ? Math.round(s.weeklyFocusTargetHours * 3600) : null };
};

const CATEGORY: Record<NotifyKind, keyof Settings["socialPrefs"]["notify"]> = {
  friend_request: "requests", friend_accepted: "requests", friend_focus_start: "friendActivity", friend_focus_end: "friendActivity",
  challenge_invite: "challenges", challenge_event: "challenges", challenge_done: "challenges", room: "rooms", cheer: "cheers",
};

function inQuietHours(p: Settings["socialPrefs"], d = new Date()): boolean {
  if (!p.quietFrom || !p.quietTo) return false;
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return p.quietFrom <= p.quietTo ? hm >= p.quietFrom && hm < p.quietTo : hm >= p.quietFrom || hm < p.quietTo;
}

/** Whether a pushed notification should be shown, per the user's preferences. Exported for tests. */
export function shouldNotify(kind: NotifyKind, from: string | null, p: Settings["socialPrefs"], focusing: boolean, at = new Date()): boolean {
  if (!p.notify[CATEGORY[kind]]) return false;
  if (from && p.muted.includes(from)) return false;
  if (p.dndWhileFocusing && focusing) return false;
  return !inQuietHours(p, at);
}

function onRoomTimer(timer: RoomView["timer"], serverNow: number) {
  const prefs = data().settings.socialPrefs;
  if (!timer || timer.kind !== "focus" || !prefs.followRoomTimer || useTimer.getState().timer) return;
  const minutes = Math.round((timer.startedAt + timer.plannedMs - serverNow) / 60_000);
  if (minutes >= 1) void startSession({ mode: "countdown", minutes, objective: "Focus Together" }).catch(() => undefined);
}

function onPush(msg: ServerPush) {
  if (msg.t === "state") return applySnapshot(msg.state);
  if (msg.t === "presence") {
    const snap = useSocial.getState().snap;
    if (!snap) return;
    const set = <T extends { id: string; presence: Presence }>(list: T[]) => list.map((f) => (f.id === msg.userId ? { ...f, presence: msg.presence } : f));
    useSocial.setState({ offsetMs: msg.serverNow - Date.now(), snap: { ...snap, friends: set(snap.friends), rooms: snap.rooms.map((r) => ({ ...r, members: set(r.members) })) } });
    return;
  }
  if (msg.t === "room_timer") return onRoomTimer(msg.timer, msg.serverNow);
  const prefs = data().settings.socialPrefs;
  const t = useTimer.getState().timer;
  if (!shouldNotify(msg.kind, msg.from, prefs, !!t && t.phase === "focus" && isRunning(t))) return;
  // Friend activity is frequent: in-app only. Everything else may use a desktop notification.
  void notify(msg.title, msg.body, data().settings.notifications && CATEGORY[msg.kind] !== "friendActivity");
}

function open(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let sock: WebSocket;
    try {
      sock = new WebSocket(url);
    } catch {
      return reject(new Error("That server address is not valid. It should look like ws://192.168.1.20:47800 or wss://example.com"));
    }
    ws = sock;
    sock.onopen = () => ((settled = true), resolve());
    sock.onerror = () => !settled && ((settled = true), reject(new Error("Could not reach the social server at that address")));
    sock.onmessage = (ev) => {
      try {
        const m = JSON.parse(String(ev.data));
        if ("re" in m) {
          const p = pending.get(m.re);
          pending.delete(m.re);
          if (p) m.ok ? p.resolve(m.data) : p.reject(new Error(m.error ?? "Request failed"));
        } else onPush(m as ServerPush);
      } catch {
        /* ignore malformed frames */
      }
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      for (const p of pending.values()) p.reject(new Error("Connection lost"));
      pending.clear();
      if (!wanted) return;
      useSocial.setState({ conn: "offline" });
      retryTimer = setTimeout(() => void connectSocial().catch(() => undefined), Math.min(30_000, 2000 * 2 ** retry++));
    };
  });
}

function goOnline(snap: Snapshot) {
  retry = 0;
  applySnapshot(snap);
  useSocial.setState({ conn: "online", error: null });
  lastPresenceKey = "";
  void rawCall("profile.update", localProfile()).catch(() => undefined);
  sendPresence(true);
  scheduleSync(200);
  if (beatTimer) clearInterval(beatTimer);
  let n = 0;
  beatTimer = setInterval(() => {
    useSocial.setState({ now: Date.now() });
    // Every heartbeat re-sends presence; without it the server marks us offline.
    if (++n % Math.round(HEARTBEAT_MS / 1000) === 0) sendPresence(true);
    else sendPresence();
  }, 1000);
}

/** Connects with the saved identity. Safe to call repeatedly. */
export async function connectSocial(): Promise<void> {
  const id = data().settings.social;
  if (!id) return;
  wanted = true;
  if (ws && ws.readyState <= WebSocket.OPEN) return;
  useSocial.setState({ conn: "connecting" });
  try {
    if (id.host) await startHost(id.port);
    await open(id.url);
    const r = await rawCall<{ state: Snapshot }>("login", { userId: id.userId, token: id.token });
    goOnline(r.state);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    useSocial.setState({ conn: "offline", error });
    if (ws) ws.close();
    else if (wanted) retryTimer = setTimeout(() => void connectSocial().catch(() => undefined), Math.min(30_000, 2000 * 2 ** retry++));
  }
}

export interface JoinInput {
  url: string;
  host: boolean;
  port: number;
  username: string;
  displayName: string;
  privacy: Privacy;
}

/** Creates a profile on a server (or on this computer when hosting) and stays connected. */
export async function joinSocial(input: JoinInput): Promise<void> {
  disconnectSocial();
  wanted = true;
  useSocial.setState({ conn: "connecting", error: null });
  try {
    let url = input.url.trim();
    if (input.host) {
      await startHost(input.port);
      url = `ws://127.0.0.1:${input.port}`;
    } else if (!/^wss?:\/\//.test(url)) url = `ws://${url}`;
    await open(url);
    const r = await rawCall<{ userId: string; token: string; state: Snapshot }>("register", { username: input.username, displayName: input.displayName, privacy: input.privacy, ...localProfile() });
    await setSetting("social", { url, userId: r.userId, token: r.token, host: input.host, port: input.port });
    goOnline(r.state);
  } catch (e) {
    disconnectSocial();
    throw e;
  }
}

export function disconnectSocial() {
  wanted = false;
  if (retryTimer) clearTimeout(retryTimer);
  if (beatTimer) clearInterval(beatTimer);
  const sock = ws;
  ws = null;
  sock?.close();
  useSocial.setState({ conn: "off", snap: null, error: null });
}

/** Forgets the profile on this device and stops hosting. Local productivity data is untouched. */
export async function leaveSocial(): Promise<void> {
  disconnectSocial();
  await stopHost();
  await setSetting("social", null);
}

/** Wires the social layer to the timer and the data store. Call once at startup. */
export function initSocial() {
  useTimer.subscribe((s, prev) => {
    if (s.timer !== prev.timer || s.gap !== prev.gap) sendPresence();
  });
  useData.subscribe((s, prev) => {
    if (s.entries !== prev.entries || s.sessions !== prev.sessions) scheduleSync();
    if (s.settings.weekStart !== prev.settings.weekStart || s.settings.weeklyFocusTargetHours !== prev.settings.weeklyFocusTargetHours) {
      if (useSocial.getState().conn === "online") void rawCall("profile.update", localProfile()).catch(() => undefined);
    }
  });
  if (data().settings.social) void connectSocial();
}

// ---- LAN hosting (desktop app only) ------------------------------------------

export const useHost = create<{ running: boolean; addresses: string[] }>(() => ({ running: false, addresses: [] }));
const HOST_KEY = "social_host_state";
let unlisten: (() => void) | null = null;
let hostTick: ReturnType<typeof setInterval> | null = null;

/**
 * Hosts the social server inside this app for friends on the same network.
 * The Rust side only relays WebSocket frames; the server logic is the same
 * `SocialServer` class the standalone server runs, with its state kept in
 * this computer's database.
 */
export async function startHost(port: number): Promise<void> {
  if (!isTauri()) throw new Error("Hosting is available in the desktop app. In a browser, connect to a server address instead.");
  if (useHost.getState().running) return;
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const { SocialServer, emptyState } = await import("./server");
  const row = (await db().select<{ value: string }>("SELECT value FROM settings WHERE key = ?", [HOST_KEY]))[0];
  let state = emptyState();
  try {
    if (row) state = { ...state, ...JSON.parse(row.value) };
  } catch {
    toast("Hosted data could not be read", "Starting with an empty friends server.", "error");
  }
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const save = () => void db().execute("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", [HOST_KEY, JSON.stringify(server.state), Date.now()]);
  const server = new SocialServer(state, {
    onChange: () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(save, 800);
    },
  });
  unlisten = await listen<{ kind: string; conn: number; text: string }>("lan-host", (e) => {
    const id = String(e.payload.conn);
    if (e.payload.kind === "open") server.connect(id, (text) => void invoke("lan_host_send", { conn: e.payload.conn, text }));
    else if (e.payload.kind === "close") server.disconnect(id);
    else void server.receive(id, e.payload.text);
  });
  const info = await invoke<{ port: number; addresses: string[] }>("lan_host_start", { port });
  hostTick = setInterval(() => server.tick(), 5000);
  useHost.setState({ running: true, addresses: info.addresses });
}

export async function stopHost(): Promise<void> {
  if (!useHost.getState().running) return;
  unlisten?.();
  unlisten = null;
  if (hostTick) clearInterval(hostTick);
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("lan_host_stop").catch(() => undefined);
  useHost.setState({ running: false, addresses: [] });
}
