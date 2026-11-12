import { addDays, weekdayOf, type DateStr } from "./dates";

export interface HabitDef {
  /** boolean = yes/no, duration = minutes, quantity = arbitrary unit, sessions = number of check-ins */
  kind: "boolean" | "duration" | "quantity" | "sessions";
  target_value: number;
  /** scheduled weekdays, 0 = Sunday; empty = every day */
  weekdays: number[];
  created_date: DateStr;
}

export interface HabitDay {
  value: number;
  /** explicit rest day — neutral for streaks and consistency */
  skipped: boolean;
}

export type DayState = "done" | "partial" | "missed" | "rest" | "off" | "pending";

export const isScheduled = (h: HabitDef, date: DateStr): boolean => h.weekdays.length === 0 || h.weekdays.includes(weekdayOf(date));

export const isDone = (h: HabitDef, day: HabitDay | undefined): boolean => !!day && !day.skipped && day.value >= Math.max(1, h.target_value);

export function dayState(h: HabitDef, date: DateStr, day: HabitDay | undefined, today: DateStr): DayState {
  if (day?.skipped) return "rest";
  if (isDone(h, day)) return "done";
  if (!isScheduled(h, date)) return day && day.value > 0 ? "partial" : "off";
  if (date > today) return "pending";
  if (day && day.value > 0) return "partial";
  return date === today ? "pending" : "missed";
}

/**
 * Current streak: consecutive scheduled days completed, walking back from
 * today. Rest days and unscheduled days are skipped over, and an unfinished
 * today does not break the streak — it simply has not been added yet.
 */
export function currentStreak(h: HabitDef, days: Map<DateStr, HabitDay>, today: DateStr): number {
  let streak = 0;
  for (let d = today, i = 0; d >= h.created_date && i < 3660; d = addDays(d, -1), i++) {
    const day = days.get(d);
    if (isDone(h, day)) {
      streak++;
      continue;
    }
    if (day?.skipped || !isScheduled(h, d)) continue;
    if (d === today) continue;
    break;
  }
  return streak;
}

export function longestStreak(h: HabitDef, days: Map<DateStr, HabitDay>, today: DateStr): number {
  let best = 0;
  let run = 0;
  for (let d = h.created_date, i = 0; d <= today && i < 3660; d = addDays(d, 1), i++) {
    const day = days.get(d);
    if (isDone(h, day)) best = Math.max(best, ++run);
    else if (day?.skipped || !isScheduled(h, d) || d === today) continue;
    else run = 0;
  }
  return best;
}

/** Share of scheduled, non-rest days in [from, to] (not after today) that were completed. Null when no such days. */
export function consistency(h: HabitDef, days: Map<DateStr, HabitDay>, from: DateStr, to: DateStr, today: DateStr): number | null {
  let due = 0;
  let done = 0;
  const start = from < h.created_date ? h.created_date : from;
  const end = to > today ? today : to;
  for (let d = start, i = 0; d <= end && i < 3660; d = addDays(d, 1), i++) {
    const day = days.get(d);
    if (day?.skipped) continue;
    if (isDone(h, day)) {
      done++;
      due++;
    } else if (isScheduled(h, d) && d !== today) due++;
  }
  return due === 0 ? null : done / due;
}
