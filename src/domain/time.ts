import { dateOfMs, dayEndMs, type DateStr } from "./dates";

export interface Interval {
  start: number;
  end: number;
}

/** Seconds covered by at least one interval — overlapping minutes count once. */
export function unionSeconds(intervals: Interval[]): number {
  const sorted = intervals.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  let total = 0;
  let curStart = 0;
  let curEnd = -Infinity;
  for (const i of sorted) {
    if (i.start > curEnd) {
      if (curEnd > curStart) total += curEnd - curStart;
      curStart = i.start;
      curEnd = i.end;
    } else if (i.end > curEnd) curEnd = i.end;
  }
  if (curEnd > curStart) total += curEnd - curStart;
  return Math.round(total / 1000);
}

export function clip<T extends Interval>(i: T, from: number, to: number): T | null {
  const start = Math.max(i.start, from);
  const end = Math.min(i.end, to);
  return end > start ? { ...i, start, end } : null;
}

/** Splits an interval at local midnights so each piece belongs to one calendar day. */
export function splitByDay<T extends Interval>(i: T): Array<T & { date: DateStr }> {
  const out: Array<T & { date: DateStr }> = [];
  let start = i.start;
  let guard = 0;
  while (start < i.end && guard++ < 4000) {
    const date = dateOfMs(start);
    const end = Math.min(i.end, dayEndMs(date));
    out.push({ ...i, start, end, date });
    start = end;
  }
  return out;
}

/** Tracked seconds per local day within [from, to), overlap-free. */
export function secondsByDay(entries: Interval[], from: number, to: number): Map<DateStr, number> {
  const perDay = new Map<DateStr, Interval[]>();
  for (const e of entries) {
    const c = clip(e, from, to);
    if (!c) continue;
    for (const piece of splitByDay(c)) {
      const list = perDay.get(piece.date) ?? [];
      list.push(piece);
      perDay.set(piece.date, list);
    }
  }
  const out = new Map<DateStr, number>();
  for (const [date, list] of perDay) out.set(date, unionSeconds(list));
  return out;
}

/** Overlap-free seconds per group key within [from, to). Entries with a null key are grouped under "". */
export function secondsByGroup<T extends Interval>(
  entries: T[],
  key: (e: T) => string | null | undefined | Array<string>,
  from = -Infinity,
  to = Infinity,
): Map<string, number> {
  const groups = new Map<string, Interval[]>();
  for (const e of entries) {
    const c = clip(e, from, to);
    if (!c) continue;
    const k = key(e);
    const keys = Array.isArray(k) ? (k.length ? k : [""]) : [k ?? ""];
    for (const g of keys) {
      const list = groups.get(g) ?? [];
      list.push(c);
      groups.set(g, list);
    }
  }
  const out = new Map<string, number>();
  for (const [k, list] of groups) out.set(k, unionSeconds(list));
  return out;
}

export function totalSeconds(entries: Interval[], from = -Infinity, to = Infinity): number {
  const clipped: Interval[] = [];
  for (const e of entries) {
    const c = clip(e, from, to);
    if (c) clipped.push(c);
  }
  return unionSeconds(clipped);
}

/** Pairs of entries whose time ranges intersect. */
export function findOverlaps<T extends Interval>(entries: T[]): Array<[T, T]> {
  const sorted = entries.slice().sort((a, b) => a.start - b.start);
  const out: Array<[T, T]> = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length && sorted[j]!.start < sorted[i]!.end; j++) {
      out.push([sorted[i]!, sorted[j]!]);
    }
  }
  return out;
}

export const overlaps = (a: Interval, b: Interval): boolean => a.start < b.end && b.start < a.end;

/** Seconds per local hour of day (0–23), overlap-free. */
export function secondsByHour(entries: Interval[]): number[] {
  const hours: Interval[][] = Array.from({ length: 24 }, () => []);
  for (const e of entries) {
    let start = e.start;
    let guard = 0;
    while (start < e.end && guard++ < 10_000) {
      const d = new Date(start);
      const hour = d.getHours();
      d.setMinutes(60, 0, 0);
      const end = Math.min(e.end, d.getTime());
      hours[hour]!.push({ start, end });
      start = end;
    }
  }
  return hours.map(unionSeconds);
}

export interface EstimateSample {
  estimated: number;
  actual: number;
}

export interface EstimationStats {
  samples: number;
  totalEstimated: number;
  totalActual: number;
  /** actual − estimated, seconds (positive = took longer) */
  variance: number;
  /** totalActual / totalEstimated; 1 = perfect, >1 = underestimating */
  ratio: number | null;
  /** mean of per-task (1 − |actual − est| / est), floored at 0, as 0–1 */
  accuracy: number | null;
}

export function estimationStats(samples: EstimateSample[]): EstimationStats {
  const valid = samples.filter((s) => s.estimated > 0 && s.actual > 0);
  const totalEstimated = valid.reduce((a, s) => a + s.estimated, 0);
  const totalActual = valid.reduce((a, s) => a + s.actual, 0);
  const accuracy = valid.length
    ? valid.reduce((a, s) => a + Math.max(0, 1 - Math.abs(s.actual - s.estimated) / s.estimated), 0) / valid.length
    : null;
  return {
    samples: valid.length,
    totalEstimated,
    totalActual,
    variance: totalActual - totalEstimated,
    ratio: totalEstimated > 0 ? totalActual / totalEstimated : null,
    accuracy,
  };
}
