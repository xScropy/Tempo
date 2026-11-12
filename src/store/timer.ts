import { create } from "zustand";
import { db, type Statement } from "@/db/driver";
import { deleteStmt, insertStmt, newId, updateStmt } from "@/db/sql";
import {
  closeSegment, detectGap, discardGap, elapsedMs, extendTimer, heartbeat, isDue, nextPhase, resumeTimer, startTimer,
  type ActiveTimer, type Gap, type Segment, type TimerContext, type TimerMode,
} from "@/domain/timer";
import { notify } from "@/lib/notify";
import { data, reload } from "./data";

/** A running segment with no sign of life for longer than this is treated as closed app / sleep / crash. */
export const GAP_THRESHOLD_MS = 2 * 60_000;
const HEARTBEAT_MS = 15_000;
const KEY = "active_timer";

interface TimerState {
  timer: ActiveTimer | null;
  now: number;
  /** unresolved away-time the user must keep or discard */
  gap: Gap | null;
  /** session that just ended and may still receive notes / a rating */
  review: string | null;
}

export const useTimer = create<TimerState>(() => ({ timer: null, now: Date.now(), gap: null, review: null }));

const persistStmt = (t: ActiveTimer | null): Statement =>
  t
    ? { sql: "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", params: [KEY, JSON.stringify(t), Date.now()] }
    : { sql: "DELETE FROM settings WHERE key = ?", params: [KEY] };

function entryStmt(t: ActiveTimer, seg: Segment | null): Statement[] {
  if (!seg || !t.sessionId || t.phase !== "focus" || seg.end - seg.start < 1000) return [];
  const ts = Date.now();
  return [
    insertStmt("time_entries", {
      id: newId(), session_id: t.sessionId, source: "timer", task_id: t.taskId, project_id: t.projectId, category_id: t.categoryId,
      target_id: t.targetId, started_at: seg.start, ended_at: seg.end, description: "", created_at: ts, updated_at: ts,
    }),
  ];
}

async function commit(timer: ActiveTimer | null, stmts: Statement[], extra: Partial<TimerState> = {}) {
  await db().batch([...stmts, persistStmt(timer)]);
  useTimer.setState({ timer, now: Date.now(), ...extra });
  if (stmts.length) await reload(["time_entries", "focus_sessions", "tasks", "activity_logs"]);
}

export interface StartConfig extends Partial<TimerContext> {
  mode: TimerMode;
  /** minutes; ignored for stopwatch */
  minutes?: number;
}

/** Fills in project and category from the task, so tracked time is attributed without extra input. */
function resolveContext(c: Partial<TimerContext>): TimerContext {
  const st = data();
  const task = c.taskId ? st.tasks.find((t) => t.id === c.taskId) : null;
  const projectId = c.projectId ?? task?.project_id ?? null;
  const project = projectId ? st.projects.find((p) => p.id === projectId) : null;
  const target = c.targetId ? st.targets.find((t) => t.id === c.targetId) : null;
  return {
    taskId: task?.id ?? null,
    projectId,
    categoryId: c.categoryId ?? task?.category_id ?? project?.category_id ?? target?.category_id ?? null,
    targetId: c.targetId ?? null,
    objective: c.objective ?? "",
  };
}

async function beginFocus(mode: TimerMode, plannedMs: number | null, ctx: TimerContext, cycleCount: number) {
  const at = Date.now();
  const sessionId = newId();
  const timer = startTimer({ sessionId, mode, phase: "focus", plannedMs, cycleCount, ...ctx }, at);
  const task = ctx.taskId ? data().tasks.find((t) => t.id === ctx.taskId) : null;
  const stmts: Statement[] = [
    insertStmt("focus_sessions", {
      id: sessionId, mode, planned_seconds: plannedMs == null ? null : Math.round(plannedMs / 1000), started_at: at, status: "active",
      task_id: ctx.taskId, project_id: ctx.projectId, category_id: ctx.categoryId, target_id: ctx.targetId, objective: ctx.objective, created_at: at, updated_at: at,
    }),
  ];
  if (task && ["inbox", "not_started", "planned"].includes(task.status)) stmts.push(updateStmt("tasks", task.id, { status: "in_progress", updated_at: at }));
  await commit(timer, stmts, { gap: null });
}

export async function startSession(config: StartConfig): Promise<void> {
  if (useTimer.getState().timer) await stopSession();
  const s = data().settings;
  const minutes = config.mode === "stopwatch" ? null : (config.minutes ?? (config.mode === "deep" ? s.deepWorkMin : s.focusMin));
  if (minutes != null && !(minutes >= 1 && minutes <= 720)) throw new Error("Session length must be between 1 and 720 minutes");
  await beginFocus(config.mode, minutes == null ? null : minutes * 60_000, resolveContext(config), 0);
}

export async function pauseSession(): Promise<void> {
  const { timer } = useTimer.getState();
  if (!timer || timer.segmentStartedAt == null) return;
  const { timer: next, segment } = closeSegment(timer, Date.now());
  await commit(next, entryStmt(timer, segment));
}

export async function resumeSession(): Promise<void> {
  const { timer } = useTimer.getState();
  if (!timer || timer.segmentStartedAt != null) return;
  await commit(resumeTimer(timer, Date.now()), [], { gap: null });
}

export async function extendSession(minutes: number): Promise<void> {
  const { timer } = useTimer.getState();
  if (timer) await commit(extendTimer(timer, minutes * 60_000), []);
}

/** Ends the current focus session (or break). `reached` = the countdown ran to zero. */
async function finish(reached: boolean): Promise<void> {
  const { timer } = useTimer.getState();
  if (!timer) return;
  const at = Date.now();
  const { timer: closed, segment } = closeSegment(timer, at);
  const s = data().settings;

  if (timer.phase !== "focus") {
    // Break over (or skipped): offer the next focus session of the cycle.
    if (timer.mode === "pomodoro" && reached && s.autoStartFocus) {
      useTimer.setState({ timer: null });
      await beginFocus("pomodoro", s.focusMin * 60_000, timer, timer.cycleCount);
    } else await commit(null, []);
    if (reached) void notify("Break finished", "Ready for the next focus session?", s.notifications);
    return;
  }

  const stmts = entryStmt(timer, segment);
  const worked = closed.accumulatedMs;
  const sessionId = timer.sessionId!;
  if (worked < 1000) {
    stmts.push(deleteStmt("focus_sessions", sessionId)); // started and stopped at once: nothing to record
  } else {
    const completed = timer.plannedMs == null || reached || worked >= timer.plannedMs - 500;
    const endedAt = segment?.end ?? closed.lastSeenAt;
    stmts.push(updateStmt("focus_sessions", sessionId, { ended_at: endedAt, status: completed ? "completed" : "interrupted", updated_at: at }));
    if (timer.projectId) {
      stmts.push(insertStmt("activity_logs", { id: newId(), project_id: timer.projectId, kind: "focus_session", message: `Focus session ${completed ? "completed" : "stopped"} (${Math.round(worked / 60_000)} min)`, created_at: at }));
    }
  }
  const review = worked >= 1000 && s.askSessionNotes ? sessionId : null;

  if (timer.mode === "pomodoro" && reached) {
    const next = nextPhase("focus", timer.cycleCount, s);
    const brk = s.autoStartBreaks ? startTimer({ ...timer, sessionId: null, phase: next.phase, plannedMs: next.plannedMs, cycleCount: next.cycleCount }, at) : null;
    await commit(brk, stmts, { review, gap: null });
    void notify("Focus session complete", brk ? `Time for a ${next.phase === "long_break" ? "long" : "short"} break.` : "Nice work.", s.notifications);
  } else {
    await commit(null, stmts, { review, gap: null });
    if (reached) void notify("Session complete", `${Math.round(worked / 60_000)} minutes recorded.`, s.notifications);
  }
}

export const stopSession = () => finish(false);
export const skipBreak = () => finish(false);

/** Discards the running session entirely and starts the same configuration again. */
export async function restartSession(): Promise<void> {
  const { timer } = useTimer.getState();
  if (!timer || timer.phase !== "focus" || !timer.sessionId) return;
  await db().batch([deleteStmt("focus_sessions", timer.sessionId), persistStmt(null)]);
  useTimer.setState({ timer: null });
  await beginFocus(timer.mode, timer.plannedMs, timer, timer.cycleCount);
}

export async function resolveGap(keep: boolean): Promise<void> {
  const { timer, gap } = useTimer.getState();
  if (!timer || !gap) return useTimer.setState({ gap: null });
  if (keep) {
    await commit(heartbeat(timer, Date.now()), [], { gap: null });
    return;
  }
  const { timer: paused, segment } = discardGap(timer);
  await commit(paused, entryStmt(timer, segment), { gap: null });
}

/** Loads a persisted timer at startup and checks for time spent with the app closed. */
export async function restoreTimer(): Promise<void> {
  const row = (await db().select<{ value: string }>("SELECT value FROM settings WHERE key = ?", [KEY]))[0];
  if (!row) return;
  try {
    const timer = JSON.parse(row.value) as ActiveTimer;
    const now = Date.now();
    useTimer.setState({ timer, now, gap: detectGap(timer, now, GAP_THRESHOLD_MS) });
  } catch {
    await db().execute("DELETE FROM settings WHERE key = ?", [KEY]);
  }
}

let lastTick = 0;
let lastBeat = 0;
let busy = false;

/** Called about once a second while the app is open. All timing derives from timestamps, never from tick counts. */
export async function tick(): Promise<void> {
  const now = Date.now();
  const { timer, gap } = useTimer.getState();
  if (!timer) {
    lastTick = now;
    return;
  }
  // A long silence between ticks means the machine slept (or the process was frozen).
  if (!gap && lastTick && now - lastTick > GAP_THRESHOLD_MS) {
    const g = detectGap({ ...timer, lastSeenAt: Math.max(timer.lastSeenAt, lastTick) }, now, GAP_THRESHOLD_MS);
    if (g) {
      lastTick = now;
      useTimer.setState({ gap: g, now, timer: { ...timer, lastSeenAt: g.from } });
      return;
    }
  }
  lastTick = now;
  useTimer.setState({ now });
  if (busy || useTimer.getState().gap) return;
  busy = true;
  try {
    if (isDue(timer, now)) await finish(true);
    else if (timer.segmentStartedAt != null && now - lastBeat > HEARTBEAT_MS) {
      lastBeat = now;
      const beat = heartbeat(timer, now);
      await db().execute(persistStmt(beat).sql, persistStmt(beat).params);
      if (useTimer.getState().timer === timer) useTimer.setState({ timer: beat });
    }
  } finally {
    busy = false;
  }
}

export const timerElapsed = (s: TimerState) => (s.timer ? elapsedMs(s.timer, s.gap ? s.gap.from : s.now) : 0);

/** Test hook */
export function resetTimerStore() {
  lastTick = 0;
  lastBeat = 0;
  busy = false;
  useTimer.setState({ timer: null, now: Date.now(), gap: null, review: null });
}
