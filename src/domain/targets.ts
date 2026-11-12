import { addDays, addMonths, diffDays, startOfMonth, startOfWeek, startOfYear, type DateStr } from "./dates";

export interface WeeklyStatus {
  targetSeconds: number;
  actualSeconds: number;
  remainingSeconds: number;
  /** 0–1, capped */
  progress: number;
  /** what an even pace would have reached by the end of yesterday */
  expectedSeconds: number;
  onTrack: boolean;
  met: boolean;
  /** mean per day over the days of the week so far (today included) */
  averagePerDaySeconds: number;
  /** needed per remaining day (today included) to still hit the target */
  neededPerDaySeconds: number;
  daysLeft: number;
}

/**
 * Weekly time-target status. "On track" compares actual time with an even
 * pace over the *fully elapsed* days, so the first day of a week is never
 * "behind" and today's unfinished work is never held against the user.
 */
export function weeklyStatus(targetSeconds: number, actualSeconds: number, today: DateStr, weekStart: number): WeeklyStatus {
  const start = startOfWeek(today, weekStart);
  const elapsedFull = diffDays(start, today); // 0–6
  const daysLeft = 7 - elapsedFull;
  const expected = (targetSeconds * elapsedFull) / 7;
  const remaining = Math.max(0, targetSeconds - actualSeconds);
  return {
    targetSeconds,
    actualSeconds,
    remainingSeconds: remaining,
    progress: targetSeconds > 0 ? Math.min(1, actualSeconds / targetSeconds) : 0,
    expectedSeconds: expected,
    onTrack: actualSeconds >= expected || remaining === 0,
    met: targetSeconds > 0 && actualSeconds >= targetSeconds,
    averagePerDaySeconds: actualSeconds / (elapsedFull + 1),
    neededPerDaySeconds: remaining / daysLeft,
    daysLeft,
  };
}

export type GoalPeriod = "daily" | "weekly" | "monthly" | "yearly" | "custom";

/** Inclusive date range of the period containing `today`. */
export function periodRange(period: GoalPeriod, today: DateStr, weekStart: number, custom?: { start: DateStr | null; end: DateStr | null }): { start: DateStr; end: DateStr } {
  switch (period) {
    case "daily":
      return { start: today, end: today };
    case "weekly": {
      const start = startOfWeek(today, weekStart);
      return { start, end: addDays(start, 6) };
    }
    case "monthly": {
      const start = startOfMonth(today);
      return { start, end: addDays(addMonths(start, 1), -1) };
    }
    case "yearly": {
      const start = startOfYear(today);
      return { start, end: `${today.slice(0, 4)}-12-31` };
    }
    case "custom":
      return { start: custom?.start ?? today, end: custom?.end ?? today };
  }
}
