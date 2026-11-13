import { lang, tn } from "@/i18n";
import { addDays, addMonths, daysInMonth, diffDays, startOfMonth, startOfWeek, weekdayOf, type DateStr, weekdayName } from "./dates";

export interface RecurrenceRule {
  freq: "daily" | "weekly" | "monthly";
  /** every N days / weeks / months, N >= 1 */
  interval: number;
  /** weekly only: 0 = Sunday … 6 = Saturday. Empty = weekday of start_date. */
  weekdays: number[];
  /** monthly only: 1–31. Empty = day of start_date. Days past month end clamp to the last day. */
  monthdays: number[];
  start_date: DateStr;
  end_date: DateStr | null;
  /** maximum number of occurrences in the whole series */
  count: number | null;
}

const HARD_LIMIT = 20_000;

/**
 * All occurrence dates of `rule` within [from, to] inclusive.
 * Pure and deterministic: generating twice for overlapping windows yields the
 * same dates, which (with the unique index on series+date) prevents duplicates.
 */
export function occurrencesBetween(rule: RecurrenceRule, from: DateStr, to: DateStr, weekStart = 1): DateStr[] {
  const interval = Math.max(1, Math.floor(rule.interval));
  const last = rule.end_date && rule.end_date < to ? rule.end_date : to;
  const out: DateStr[] = [];
  if (last < rule.start_date) return out;
  let emitted = 0;
  const emit = (d: DateStr): boolean => {
    if (d < rule.start_date || d > last) return true;
    if (rule.count != null && emitted >= rule.count) return false;
    emitted++;
    if (d >= from) out.push(d);
    return true;
  };

  if (rule.freq === "daily") {
    // Without a count limit we can jump straight to the window.
    let d = rule.start_date;
    if (rule.count == null && from > d) {
      const skip = Math.ceil(diffDays(d, from) / interval) * interval;
      d = addDays(d, skip);
    }
    for (let i = 0; d <= last && i < HARD_LIMIT; i++, d = addDays(d, interval)) if (!emit(d)) break;
    return out;
  }

  if (rule.freq === "weekly") {
    const days = (rule.weekdays.length ? rule.weekdays : [weekdayOf(rule.start_date)]).slice().sort((a, b) => a - b);
    const firstWeek = startOfWeek(rule.start_date, weekStart);
    let week = firstWeek;
    if (rule.count == null && from > week) {
      const weeks = Math.floor(diffDays(firstWeek, startOfWeek(from, weekStart)) / 7);
      week = addDays(firstWeek, Math.floor(weeks / interval) * interval * 7);
    }
    for (let i = 0; week <= last && i < HARD_LIMIT; i++, week = addDays(week, interval * 7)) {
      const inWeek = days.map((wd) => addDays(week, (wd - weekStart + 7) % 7)).sort();
      for (const d of inWeek) if (!emit(d)) return out;
    }
    return out;
  }

  const startDay = Number(rule.start_date.slice(8, 10));
  const mdays = (rule.monthdays.length ? rule.monthdays : [startDay]).slice().sort((a, b) => a - b);
  let month = startOfMonth(rule.start_date);
  for (let i = 0; month <= last && i < HARD_LIMIT; i++, month = addMonths(month, interval)) {
    const y = Number(month.slice(0, 4));
    const m = Number(month.slice(5, 7));
    const dim = daysInMonth(y, m);
    const seen = new Set<number>();
    for (const md of mdays) {
      const day = Math.min(md, dim);
      if (seen.has(day)) continue;
      seen.add(day);
      if (!emit(`${month.slice(0, 8)}${String(day).padStart(2, "0")}`)) return out;
    }
  }
  return out;
}

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "كل يومين", "كل 3 أسابيع" — Arabic counts the unit differently for 1, 2, 3–10 and 11+. */
function arEvery(n: number, unit: "day" | "week" | "month"): string {
  const f = { day: ["يوم", "يومين", "أيام", "يوماً"], week: ["أسبوع", "أسبوعين", "أسابيع", "أسبوعاً"], month: ["شهر", "شهرين", "أشهر", "شهراً"] }[unit];
  if (n === 1) return `كل ${f[0]}`;
  if (n === 2) return `كل ${f[1]}`;
  return `كل ${n} ${n <= 10 ? f[2] : f[3]}`;
}

export function describeRule(rule: RecurrenceRule): string {
  const n = rule.interval;
  const ar = lang === "ar";
  let s: string;
  if (rule.freq === "daily") s = ar ? arEvery(n, "day") : n === 1 ? "Every day" : `Every ${n} days`;
  else if (rule.freq === "weekly") {
    const days = rule.weekdays.length ? rule.weekdays : [weekdayOf(rule.start_date)];
    const sorted = days.slice().sort((a, b) => a - b);
    const isWeekdays = sorted.join() === "1,2,3,4,5";
    if (ar) s = `${arEvery(n, "week")} ${isWeekdays ? "من الاثنين إلى الجمعة" : `أيام ${sorted.map((d) => weekdayName(d)).join("، ")}`}`;
    else {
      const names = isWeekdays ? "weekdays" : sorted.map((d) => WD[d]).join(", ");
      s = n === 1 ? (isWeekdays ? "Every weekday" : `Weekly on ${names}`) : `Every ${n} weeks on ${names}`;
    }
  } else {
    const days = rule.monthdays.length ? rule.monthdays : [Number(rule.start_date.slice(8, 10))];
    s = ar ? `${arEvery(n, "month")} يوم ${days.join("، ")}` : `${n === 1 ? "Monthly" : `Every ${n} months`} on day ${days.join(", ")}`;
  }
  if (rule.end_date) s += ar ? ` حتى ${rule.end_date}` : ` until ${rule.end_date}`;
  if (rule.count != null) s += ar ? `، ${tn(rule.count, "time")}` : `, ${rule.count} times`;
  return s;
}
