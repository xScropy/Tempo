/**
 * Timer engine — a pure state machine.
 *
 * The timer never counts ticks. Elapsed time is always derived from wall-clock
 * timestamps: `accumulatedMs` (closed segments) + `now − segmentStartedAt`
 * (the open segment). Every closed segment becomes one time entry, so pauses
 * are excluded by construction and the state survives the app being closed.
 */
export type TimerMode = "pomodoro" | "countdown" | "stopwatch" | "deep";
export type TimerPhase = "focus" | "short_break" | "long_break";

export interface TimerContext {
  taskId: string | null;
  projectId: string | null;
  categoryId: string | null;
  targetId: string | null;
  objective: string;
}

export interface ActiveTimer extends TimerContext {
  /** focus_sessions.id for focus phases; null during breaks */
  sessionId: string | null;
  mode: TimerMode;
  phase: TimerPhase;
  /** null = open-ended (stopwatch) */
  plannedMs: number | null;
  startedAt: number;
  /** null while paused */
  segmentStartedAt: number | null;
  accumulatedMs: number;
  /** heartbeat — last instant the app was known to be alive and ticking */
  lastSeenAt: number;
  /** focus sessions completed in the current pomodoro cycle */
  cycleCount: number;
}

export interface Segment {
  start: number;
  end: number;
}

export interface PomodoroSettings {
  focusMin: number;
  shortBreakMin: number;
  longBreakMin: number;
  longBreakEvery: number;
}

export const isRunning = (t: ActiveTimer): boolean => t.segmentStartedAt != null;

export function elapsedMs(t: ActiveTimer, now: number): number {
  const open = t.segmentStartedAt != null ? Math.max(0, now - t.segmentStartedAt) : 0;
  const total = t.accumulatedMs + open;
  return t.plannedMs != null ? Math.min(total, t.plannedMs) : total;
}

export function remainingMs(t: ActiveTimer, now: number): number | null {
  return t.plannedMs == null ? null : Math.max(0, t.plannedMs - elapsedMs(t, now));
}

/** Instant at which a running countdown reaches zero; null if paused or open-ended. */
export function dueAt(t: ActiveTimer): number | null {
  if (t.plannedMs == null || t.segmentStartedAt == null) return null;
  return t.segmentStartedAt + (t.plannedMs - t.accumulatedMs);
}

export function isDue(t: ActiveTimer, now: number): boolean {
  const due = dueAt(t);
  return due != null && now >= due;
}

export function startTimer(
  args: { sessionId: string | null; mode: TimerMode; phase: TimerPhase; plannedMs: number | null; cycleCount?: number } & TimerContext,
  now: number,
): ActiveTimer {
  return {
    sessionId: args.sessionId,
    mode: args.mode,
    phase: args.phase,
    plannedMs: args.plannedMs,
    taskId: args.taskId,
    projectId: args.projectId,
    categoryId: args.categoryId,
    targetId: args.targetId,
    objective: args.objective,
    startedAt: now,
    segmentStartedAt: now,
    accumulatedMs: 0,
    lastSeenAt: now,
    cycleCount: args.cycleCount ?? 0,
  };
}

/**
 * Closes the open segment at `at` (capped at the countdown's due instant so a
 * late tick can never record more than the planned duration).
 */
export function closeSegment(t: ActiveTimer, at: number): { timer: ActiveTimer; segment: Segment | null } {
  if (t.segmentStartedAt == null) return { timer: t, segment: null };
  const due = dueAt(t);
  const end = Math.max(t.segmentStartedAt, due != null ? Math.min(at, due) : at);
  const segment = end > t.segmentStartedAt ? { start: t.segmentStartedAt, end } : null;
  return {
    timer: { ...t, segmentStartedAt: null, accumulatedMs: t.accumulatedMs + (end - t.segmentStartedAt), lastSeenAt: at },
    segment,
  };
}

export const pauseTimer = closeSegment;

export function resumeTimer(t: ActiveTimer, now: number): ActiveTimer {
  if (t.segmentStartedAt != null) return t;
  return { ...t, segmentStartedAt: now, lastSeenAt: now };
}

export function extendTimer(t: ActiveTimer, extraMs: number): ActiveTimer {
  return t.plannedMs == null ? t : { ...t, plannedMs: t.plannedMs + extraMs };
}

export const heartbeat = (t: ActiveTimer, now: number): ActiveTimer => ({ ...t, lastSeenAt: now });

export interface Gap {
  /** last instant the app was alive */
  from: number;
  /** when it came back (capped at the countdown's due instant) */
  to: number;
  ms: number;
}

/**
 * Detects time during a running segment in which the app was not alive
 * (closed, crashed, or the machine slept). The caller decides whether that
 * time counts: `keep` = do nothing, `discard` = `discardGap`.
 */
export function detectGap(t: ActiveTimer, now: number, thresholdMs: number): Gap | null {
  if (t.segmentStartedAt == null) return null;
  const due = dueAt(t);
  const to = due != null ? Math.min(now, due) : now;
  const from = Math.max(t.lastSeenAt, t.segmentStartedAt);
  const ms = to - from;
  return ms > thresholdMs ? { from, to, ms } : null;
}

/** Ends the open segment at the last heartbeat and leaves the timer paused. */
export function discardGap(t: ActiveTimer): { timer: ActiveTimer; segment: Segment | null } {
  if (t.segmentStartedAt == null) return { timer: t, segment: null };
  return closeSegment(t, Math.max(t.lastSeenAt, t.segmentStartedAt));
}

export function nextPhase(phase: TimerPhase, cycleCount: number, s: PomodoroSettings): { phase: TimerPhase; plannedMs: number; cycleCount: number } {
  if (phase === "focus") {
    const done = cycleCount + 1;
    const long = done % Math.max(1, s.longBreakEvery) === 0;
    return { phase: long ? "long_break" : "short_break", plannedMs: (long ? s.longBreakMin : s.shortBreakMin) * 60_000, cycleCount: done };
  }
  return { phase: "focus", plannedMs: s.focusMin * 60_000, cycleCount };
}
