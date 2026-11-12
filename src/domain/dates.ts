/**
 * Date helpers. Calendar dates are local `YYYY-MM-DD` strings (DateStr);
 * instants are epoch milliseconds. Keeping the two apart is what makes
 * week boundaries and timezone changes behave predictably.
 */
export type DateStr = string;

const pad = (n: number) => String(n).padStart(2, "0");

export function toDateStr(d: Date): DateStr {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromDateStr(s: DateStr): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

export const todayStr = (now: Date = new Date()): DateStr => toDateStr(now);

export function addDays(s: DateStr, n: number): DateStr {
  const d = fromDateStr(s);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

/** Whole days from a to b (b - a). DST-safe: computed on calendar components. */
export function diffDays(a: DateStr, b: DateStr): number {
  const utc = (s: DateStr) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y!, m! - 1, d!);
  };
  return Math.round((utc(b) - utc(a)) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday */
export const weekdayOf = (s: DateStr): number => fromDateStr(s).getDay();

export function startOfWeek(s: DateStr, weekStart: number): DateStr {
  const back = (weekdayOf(s) - weekStart + 7) % 7;
  return addDays(s, -back);
}

export const weekDates = (start: DateStr): DateStr[] => Array.from({ length: 7 }, (_, i) => addDays(start, i));

export const dayStartMs = (s: DateStr): number => fromDateStr(s).getTime();
export const dayEndMs = (s: DateStr): number => dayStartMs(addDays(s, 1));

export const startOfMonth = (s: DateStr): DateStr => s.slice(0, 8) + "01";

export function daysInMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

export function addMonths(s: DateStr, n: number): DateStr {
  const d = fromDateStr(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, daysInMonth(d.getFullYear(), d.getMonth() + 1)));
  return toDateStr(d);
}

export const startOfYear = (s: DateStr): DateStr => s.slice(0, 4) + "-01-01";

/** Local date + "HH:MM" → epoch ms */
export function atTime(date: DateStr, hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  const d = fromDateStr(date);
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d.getTime();
}

export function timeOf(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const dateOfMs = (ms: number): DateStr => toDateStr(new Date(ms));

/** "1h 30m", "45m", "0m" */
export function fmtDuration(seconds: number): string {
  const mins = Math.round(Math.max(0, seconds) / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** "1.5h" style for dense tables and charts */
export const fmtHours = (seconds: number): string => `${(Math.round((seconds / 3600) * 10) / 10).toString()}h`;

/** "25:00" or "1:05:00" */
export function fmtClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const weekdayName = (i: number) => WEEKDAYS[((i % 7) + 7) % 7]!;
export const monthName = (m0: number) => MONTHS[m0]!;

/** "Today", "Tomorrow", "Mon 3 Mar" (year added when it differs). */
export function fmtDate(s: DateStr, today: DateStr = todayStr()): string {
  const diff = diffDays(today, s);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  const d = fromDateStr(s);
  const base = `${weekdayName(d.getDay())} ${d.getDate()} ${monthName(d.getMonth())}`;
  return s.slice(0, 4) === today.slice(0, 4) ? base : `${base} ${d.getFullYear()}`;
}

/** Parses "1h 30m", "90m", "1.5h", "2:30", "45" (minutes) → seconds, or null. */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  const colon = /^(\d+):(\d{1,2})$/.exec(s);
  if (colon) return Number(colon[1]) * 3600 + Number(colon[2]) * 60;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * 60);
  const re = /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\b/g;
  let total = 0;
  let matched = false;
  let rest = s;
  for (const m of s.matchAll(re)) {
    matched = true;
    total += Number(m[1]) * (m[2]!.startsWith("h") ? 3600 : 60);
    rest = rest.replace(m[0], "");
  }
  if (!matched || rest.trim() !== "") return null;
  return Math.round(total);
}
