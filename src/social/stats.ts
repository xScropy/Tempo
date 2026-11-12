import type { PeriodStats, SharedInterval } from "./protocol";

/** Timezone-aware day math on the server, using each user's own UTC offset and week start. */
export const DAY = 86_400_000;
export const localDay = (ms: number, offMin: number) => Math.floor((ms + offMin * 60_000) / DAY);
export const dayStart = (day: number, offMin: number) => day * DAY - offMin * 60_000;
/** 1970-01-01 was a Thursday (4). */
export const weekdayOf = (day: number) => (((day + 4) % 7) + 7) % 7;
export const weekStartDay = (day: number, weekStart: number) => day - ((weekdayOf(day) - weekStart + 7) % 7);
export function monthStartDay(day: number): number {
  const d = new Date(day * DAY);
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / DAY);
}
export function monthLength(day: number): number {
  const d = new Date(day * DAY);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

export interface Span {
  start: number;
  end: number;
}

/** Sorted, non-overlapping union — the reason a minute can never count twice, whatever a client sends. */
export function merge(spans: Span[]): Span[] {
  const sorted = spans.filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ start: s.start, end: s.end });
  }
  return out;
}

export const clipAll = (spans: Span[], from: number, to: number): Span[] =>
  spans.map((s) => ({ start: Math.max(s.start, from), end: Math.min(s.end, to) })).filter((s) => s.end > s.start);

export const totalMs = (merged: Span[]) => merged.reduce((a, s) => a + (s.end - s.start), 0);

/** Seconds per local day for `n` days starting at day number `from`. */
export function secondsPerDay(merged: Span[], from: number, n: number, offMin: number): number[] {
  const out = new Array<number>(n).fill(0);
  for (const s of merged) {
    for (let d = Math.max(from, localDay(s.start, offMin)); d < from + n && dayStart(d, offMin) < s.end; d++) {
      const a = Math.max(s.start, dayStart(d, offMin));
      const b = Math.min(s.end, dayStart(d + 1, offMin));
      if (b > a) out[d - from]! += (b - a) / 1000;
    }
  }
  return out.map(Math.round);
}

/** A day counts as productive from 30 minutes of focus. */
export const PRODUCTIVE_DAY_SECONDS = 30 * 60;

export function periodStats(intervals: SharedInterval[], fromDay: number, nDays: number, offMin: number, targetSeconds: number | null): Required<{ [K in keyof PeriodStats]: NonNullable<PeriodStats[K]> | (K extends "targetSeconds" ? null : never) }> {
  const from = dayStart(fromDay, offMin);
  const to = dayStart(fromDay + nDays, offMin);
  const merged = merge(clipAll(intervals, from, to));
  const days = secondsPerDay(merged, fromDay, nDays, offMin);
  const done = new Map<string, string | null>();
  for (const i of intervals) if (i.session && i.completed && i.end > from && i.end <= to) done.set(i.session, i.mode);
  return {
    seconds: Math.round(totalMs(merged) / 1000),
    sessions: done.size,
    pomodoros: [...done.values()].filter((m) => m === "pomodoro").length,
    days,
    productiveDays: days.filter((s) => s >= PRODUCTIVE_DAY_SECONDS).length,
    targetSeconds,
  };
}

/** Consecutive days with any focus, ending today (an empty today does not break it). */
export function streakDays(intervals: SharedInterval[], today: number, offMin: number): { current: number; longest: number } {
  const days = new Set<number>();
  for (const s of merge(intervals)) for (let d = localDay(s.start, offMin); dayStart(d, offMin) < s.end; d++) days.add(d);
  let current = 0;
  for (let d = today; ; d--) {
    if (days.has(d)) current++;
    else if (d !== today) break;
    if (today - d > 4000) break;
  }
  let longest = 0;
  let run = 0;
  let prev = -Infinity;
  for (const d of [...days].sort((a, b) => a - b)) {
    run = d === prev + 1 ? run + 1 : 1;
    prev = d;
    longest = Math.max(longest, run);
  }
  return { current, longest };
}
