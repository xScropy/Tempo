import { tr } from "@/i18n";
/**
 * Levels, tokens and daily quests. Everything is derived from real activity
 * with fixed, visible rules — there is no hidden score and nothing to "game"
 * except by actually doing the work.
 */
export interface DayActivity {
  focusSeconds: number;
  tasksCompleted: number;
  sessionsCompleted: number;
  habitsDone: number;
  /** habits scheduled that day (not counting rest days) */
  habitsDue: number;
}

export const EMPTY_DAY: DayActivity = { focusSeconds: 0, tasksCompleted: 0, sessionsCompleted: 0, habitsDone: 0, habitsDue: 0 };

export const XP_RULES = { perFocusMinute: 1, perTask: 10, perSession: 5, perHabit: 5, perQuest: 15 } as const;
/** XP needed to earn one token. */
export const XP_PER_TOKEN = 10;

export interface Quest {
  id: string;
  label: string;
  current: number;
  goal: number;
  done: boolean;
}

export function questsFor(day: DayActivity): Quest[] {
  const q = (id: string, label: string, current: number, goal: number): Quest => ({ id, label, current: Math.min(current, goal), goal, done: current >= goal });
  const out = [q("focus", tr("Focus for 60 minutes"), Math.floor(day.focusSeconds / 60), 60), q("tasks", tr("Complete 3 tasks"), day.tasksCompleted, 3)];
  // The habit quest only exists on days that have habits to do.
  if (day.habitsDue > 0) out.push(q("habits", tr("Do every habit scheduled today"), day.habitsDone, day.habitsDue));
  return out;
}

export function dayXp(day: DayActivity): number {
  return (
    Math.floor(day.focusSeconds / 60) * XP_RULES.perFocusMinute +
    day.tasksCompleted * XP_RULES.perTask +
    day.sessionsCompleted * XP_RULES.perSession +
    day.habitsDone * XP_RULES.perHabit +
    questsFor(day).filter((x) => x.done).length * XP_RULES.perQuest
  );
}

/** Total XP at which `level` begins: 0, 100, 300, 600, 1000 … (each level needs 100 more than the last). */
export const xpForLevel = (level: number): number => 50 * (level - 1) * level;

export function levelFor(xp: number): { level: number; into: number; needed: number; fraction: number } {
  const level = Math.max(1, Math.floor((1 + Math.sqrt(1 + (4 * Math.max(0, xp)) / 50)) / 2));
  const base = xpForLevel(level);
  const needed = xpForLevel(level + 1) - base;
  return { level, into: xp - base, needed, fraction: (xp - base) / needed };
}

const TITLES = [tr("Beginner"), tr("Apprentice"), tr("Steady"), tr("Focused"), tr("Dedicated"), tr("Disciplined"), tr("Expert"), tr("Master"), tr("Grandmaster"), tr("Legend")];
export const levelTitle = (level: number): string => TITLES[Math.min(TITLES.length - 1, Math.floor((level - 1) / 3))]!;

export interface GameTotals {
  xp: number;
  focusSeconds: number;
  tasksCompleted: number;
  sessionsCompleted: number;
  habitsDone: number;
  questsDone: number;
  /** longest run of consecutive days with any focus time */
  bestFocusStreak: number;
  activeDays: number;
}

export function totalsOf(days: Map<string, DayActivity>): GameTotals {
  const t: GameTotals = { xp: 0, focusSeconds: 0, tasksCompleted: 0, sessionsCompleted: 0, habitsDone: 0, questsDone: 0, bestFocusStreak: 0, activeDays: 0 };
  let run = 0;
  let prev: number | null = null;
  for (const date of [...days.keys()].sort()) {
    const d = days.get(date)!;
    const xp = dayXp(d);
    t.xp += xp;
    t.focusSeconds += d.focusSeconds;
    t.tasksCompleted += d.tasksCompleted;
    t.sessionsCompleted += d.sessionsCompleted;
    t.habitsDone += d.habitsDone;
    t.questsDone += questsFor(d).filter((q) => q.done).length;
    if (xp > 0) t.activeDays++;
    const [y, m, dd] = date.split("-").map(Number);
    const n = Date.UTC(y!, m! - 1, dd!) / 86_400_000;
    if (d.focusSeconds > 0) {
      run = prev != null && n === prev + 1 ? run + 1 : 1;
      prev = n;
      t.bestFocusStreak = Math.max(t.bestFocusStreak, run);
    }
  }
  return t;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  current: number;
  goal: number;
  unlocked: boolean;
}

export function achievementsFor(t: GameTotals): Achievement[] {
  const a = (id: string, title: string, description: string, current: number, goal: number): Achievement => ({ id, title, description, current: Math.min(current, goal), goal, unlocked: current >= goal });
  const hours = Math.floor(t.focusSeconds / 3600);
  return [
    a("first-session", tr("First step"), tr("Complete your first focus session"), t.sessionsCompleted, 1),
    a("focus-10", tr("Ten hours in"), tr("Track 10 hours of focus"), hours, 10),
    a("focus-50", tr("Deep diver"), tr("Track 50 hours of focus"), hours, 50),
    a("focus-200", tr("Two hundred hours"), tr("Track 200 hours of focus"), hours, 200),
    a("tasks-25", tr("Getting things done"), tr("Complete 25 tasks"), t.tasksCompleted, 25),
    a("tasks-250", tr("Finisher"), tr("Complete 250 tasks"), t.tasksCompleted, 250),
    a("streak-7", tr("One full week"), tr("Focus 7 days in a row"), t.bestFocusStreak, 7),
    a("streak-30", tr("Unbroken month"), tr("Focus 30 days in a row"), t.bestFocusStreak, 30),
    a("habits-50", tr("Creature of habit"), tr("Complete habits 50 times"), t.habitsDone, 50),
    a("quests-20", tr("Quest hunter"), tr("Finish 20 daily quests"), t.questsDone, 20),
  ];
}

export const tokensEarned = (xp: number): number => Math.floor(xp / XP_PER_TOKEN);
