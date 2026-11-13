import { describe, expect, it } from "vitest";
import { addDays, addMonths, atTime, diffDays, parseDuration, startOfWeek, fmtDuration } from "./dates";
import { describeRule, occurrencesBetween, type RecurrenceRule } from "./recurrence";
import { estimationStats, findOverlaps, secondsByDay, secondsByGroup, totalSeconds, unionSeconds } from "./time";
import { closeSegment, detectGap, discardGap, dueAt, elapsedMs, extendTimer, isDue, nextPhase, pauseTimer, remainingMs, resumeTimer, startTimer } from "./timer";
import { projectHealth, projectProgress, projectSubtree, type ProgressTask } from "./projects";
import { periodRange, weeklyStatus } from "./targets";
import { consistency, currentStreak, dayState, longestStreak, type HabitDay, type HabitDef } from "./habits";
import { parseQuickAdd } from "./quickadd";
import { conflictingIds, conflictsFor, layoutColumns } from "./schedule";

const MIN = 60_000;
const rule = (p: Partial<RecurrenceRule>): RecurrenceRule => ({ freq: "daily", interval: 1, weekdays: [], monthdays: [], start_date: "2026-03-02", end_date: null, count: null, ...p });

describe("dates", () => {
  it("handles week starts", () => {
    // 2026-03-04 is a Wednesday
    expect(startOfWeek("2026-03-04", 1)).toBe("2026-03-02");
    expect(startOfWeek("2026-03-04", 0)).toBe("2026-03-01");
    expect(startOfWeek("2026-03-04", 6)).toBe("2026-02-28");
    expect(startOfWeek("2026-03-02", 1)).toBe("2026-03-02");
  });
  it("adds days and months across boundaries", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(diffDays("2026-03-01", "2026-04-01")).toBe(31);
  });
  it("parses and formats durations", () => {
    expect(parseDuration("1h 30m")).toBe(5400);
    expect(parseDuration("1.5h")).toBe(5400);
    expect(parseDuration("45")).toBe(2700);
    expect(parseDuration("2:15")).toBe(8100);
    expect(parseDuration("soon")).toBeNull();
    expect(fmtDuration(5400)).toBe("1h 30m");
    expect(fmtDuration(2700)).toBe("45m");
  });
});

describe("recurrence", () => {
  it("daily", () => {
    expect(occurrencesBetween(rule({}), "2026-03-01", "2026-03-04")).toEqual(["2026-03-02", "2026-03-03", "2026-03-04"]);
  });
  it("every X days stays in phase regardless of the window", () => {
    const r = rule({ interval: 3 });
    expect(occurrencesBetween(r, "2026-03-02", "2026-03-12")).toEqual(["2026-03-02", "2026-03-05", "2026-03-08", "2026-03-11"]);
    expect(occurrencesBetween(r, "2026-03-06", "2026-03-12")).toEqual(["2026-03-08", "2026-03-11"]);
  });
  it("three days per week", () => {
    const r = rule({ freq: "weekly", weekdays: [1, 3, 5] });
    expect(occurrencesBetween(r, "2026-03-02", "2026-03-15")).toEqual(["2026-03-02", "2026-03-04", "2026-03-06", "2026-03-09", "2026-03-11", "2026-03-13"]);
  });
  it("weekly never emits before the start date", () => {
    const r = rule({ freq: "weekly", weekdays: [1, 3, 5], start_date: "2026-03-04" });
    expect(occurrencesBetween(r, "2026-03-01", "2026-03-08")).toEqual(["2026-03-04", "2026-03-06"]);
  });
  it("every 2 weeks", () => {
    const r = rule({ freq: "weekly", interval: 2, weekdays: [2] });
    expect(occurrencesBetween(r, "2026-03-01", "2026-04-05")).toEqual(["2026-03-03", "2026-03-17", "2026-03-31"]);
    expect(occurrencesBetween(r, "2026-03-10", "2026-04-05")).toEqual(["2026-03-17", "2026-03-31"]);
  });
  it("weekly with Sunday in a Monday-start week", () => {
    const r = rule({ freq: "weekly", weekdays: [0, 1] });
    expect(occurrencesBetween(r, "2026-03-02", "2026-03-09")).toEqual(["2026-03-02", "2026-03-08", "2026-03-09"]);
  });
  it("monthly clamps to month end and honours interval", () => {
    const r = rule({ freq: "monthly", monthdays: [31], start_date: "2026-01-31" });
    expect(occurrencesBetween(r, "2026-01-01", "2026-04-30")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    const q = rule({ freq: "monthly", interval: 3, monthdays: [1, 15], start_date: "2026-01-01" });
    expect(occurrencesBetween(q, "2026-01-01", "2026-07-31")).toEqual(["2026-01-01", "2026-01-15", "2026-04-01", "2026-04-15", "2026-07-01", "2026-07-15"]);
  });
  it("respects end date and count", () => {
    expect(occurrencesBetween(rule({ end_date: "2026-03-03" }), "2026-03-01", "2026-03-31")).toEqual(["2026-03-02", "2026-03-03"]);
    const counted = rule({ count: 3 });
    expect(occurrencesBetween(counted, "2026-03-01", "2026-03-31")).toHaveLength(3);
    // The count applies to the series, not the window.
    expect(occurrencesBetween(counted, "2026-03-04", "2026-03-31")).toEqual(["2026-03-04"]);
    expect(occurrencesBetween(counted, "2026-03-05", "2026-03-31")).toEqual([]);
  });
  it("is idempotent across overlapping windows", () => {
    const r = rule({ freq: "weekly", weekdays: [1, 4] });
    const a = occurrencesBetween(r, "2026-03-01", "2026-03-20");
    const b = occurrencesBetween(r, "2026-03-10", "2026-03-31");
    const merged = new Set([...a, ...b]);
    expect([...merged].sort()).toEqual(occurrencesBetween(r, "2026-03-01", "2026-03-31"));
  });
  it("describes rules", () => {
    expect(describeRule(rule({ freq: "weekly", weekdays: [1, 2, 3, 4, 5] }))).toBe("Every weekday");
    expect(describeRule(rule({ interval: 2 }))).toBe("Every 2 days");
  });
});

describe("time", () => {
  const t = (h: number, m = 0) => atTime("2026-03-02", `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  it("counts overlapping minutes once", () => {
    expect(unionSeconds([{ start: t(9), end: t(10) }, { start: t(9, 30), end: t(10, 30) }])).toBe(5400);
    expect(unionSeconds([{ start: t(9), end: t(10) }, { start: t(11), end: t(12) }])).toBe(7200);
    expect(unionSeconds([{ start: t(9), end: t(12) }, { start: t(10), end: t(11) }])).toBe(10800);
    expect(unionSeconds([])).toBe(0);
  });
  it("splits entries across midnight", () => {
    const e = { start: atTime("2026-03-02", "23:30"), end: atTime("2026-03-03", "00:45") };
    const days = secondsByDay([e], atTime("2026-03-02", "00:00"), atTime("2026-03-04", "00:00"));
    expect(days.get("2026-03-02")).toBe(1800);
    expect(days.get("2026-03-03")).toBe(2700);
  });
  it("clips entries to the reporting range (week boundary)", () => {
    const e = { start: atTime("2026-03-08", "23:00"), end: atTime("2026-03-09", "01:00") };
    expect(totalSeconds([e], atTime("2026-03-09", "00:00"), atTime("2026-03-16", "00:00"))).toBe(3600);
  });
  it("groups without double counting inside a group", () => {
    const entries = [
      { start: t(9), end: t(10), p: "a" },
      { start: t(9, 30), end: t(10, 30), p: "a" },
      { start: t(11), end: t(12), p: "b" },
      { start: t(13), end: t(14), p: null },
    ];
    const g = secondsByGroup(entries, (e) => e.p);
    expect(g.get("a")).toBe(5400);
    expect(g.get("b")).toBe(3600);
    expect(g.get("")).toBe(3600);
  });
  it("finds overlaps", () => {
    const a = { start: t(9), end: t(10), id: 1 };
    const b = { start: t(9, 59), end: t(11), id: 2 };
    const c = { start: t(11), end: t(12), id: 3 };
    expect(findOverlaps([c, b, a]).map(([x, y]) => [x.id, y.id])).toEqual([[1, 2]]);
  });
  it("computes estimation accuracy", () => {
    const s = estimationStats([
      { estimated: 7200, actual: 10800 },
      { estimated: 3600, actual: 2700 },
      { estimated: 14400, actual: 18000 },
      { estimated: 0, actual: 500 },
    ]);
    expect(s.samples).toBe(3);
    expect(s.variance).toBe(6300);
    expect(s.ratio).toBeCloseTo(1.25);
    expect(s.accuracy).toBeCloseTo((0.5 + 0.75 + 0.75) / 3);
  });
});

describe("timer", () => {
  const ctx = { taskId: "t", projectId: null, categoryId: null, targetId: null, objective: "" };
  const start = (plannedMin: number | null, now = 0) => startTimer({ sessionId: "s", mode: plannedMin ? "pomodoro" : "stopwatch", phase: "focus", plannedMs: plannedMin ? plannedMin * MIN : null, ...ctx }, now);

  it("derives elapsed time from timestamps and excludes pauses", () => {
    let t = start(25);
    expect(elapsedMs(t, 10 * MIN)).toBe(10 * MIN);
    const p = pauseTimer(t, 10 * MIN);
    expect(p.segment).toEqual({ start: 0, end: 10 * MIN });
    t = p.timer;
    expect(elapsedMs(t, 30 * MIN)).toBe(10 * MIN); // paused: time does not advance
    t = resumeTimer(t, 30 * MIN);
    expect(elapsedMs(t, 35 * MIN)).toBe(15 * MIN);
    expect(remainingMs(t, 35 * MIN)).toBe(10 * MIN);
    expect(dueAt(t)).toBe(45 * MIN);
  });
  it("caps a countdown at its planned duration when the tick is late", () => {
    const t = start(25);
    expect(isDue(t, 24 * MIN)).toBe(false);
    expect(isDue(t, 90 * MIN)).toBe(true);
    const done = closeSegment(t, 90 * MIN);
    expect(done.segment).toEqual({ start: 0, end: 25 * MIN });
    expect(done.timer.accumulatedMs).toBe(25 * MIN);
  });
  it("survives close and reopen: elapsed is computed from the wall clock", () => {
    const t = start(25);
    const persisted = JSON.parse(JSON.stringify(t));
    expect(elapsedMs(persisted, 12 * MIN)).toBe(12 * MIN);
    expect(remainingMs(persisted, 12 * MIN)).toBe(13 * MIN);
  });
  it("stopwatch is open-ended", () => {
    const t = start(null);
    expect(remainingMs(t, 3 * 60 * MIN)).toBeNull();
    expect(elapsedMs(t, 3 * 60 * MIN)).toBe(180 * MIN);
    expect(closeSegment(t, 180 * MIN).segment).toEqual({ start: 0, end: 180 * MIN });
  });
  it("detects a sleep/crash gap and can discard it", () => {
    let t = start(null);
    t = { ...t, lastSeenAt: 20 * MIN };
    expect(detectGap(t, 21 * MIN, 2 * MIN)).toBeNull();
    const gap = detectGap(t, 8 * 60 * MIN, 2 * MIN);
    expect(gap).toEqual({ from: 20 * MIN, to: 480 * MIN, ms: 460 * MIN });
    const d = discardGap(t);
    expect(d.segment).toEqual({ start: 0, end: 20 * MIN });
    expect(d.timer.segmentStartedAt).toBeNull();
    expect(elapsedMs(d.timer, 999 * MIN)).toBe(20 * MIN);
  });
  it("caps a gap at the countdown's due time", () => {
    const t = { ...start(25), lastSeenAt: 5 * MIN };
    expect(detectGap(t, 300 * MIN, 2 * MIN)).toEqual({ from: 5 * MIN, to: 25 * MIN, ms: 20 * MIN });
  });
  it("no gap while paused", () => {
    const t = pauseTimer(start(25), 5 * MIN).timer;
    expect(detectGap(t, 500 * MIN, 2 * MIN)).toBeNull();
  });
  it("extends", () => {
    const t = extendTimer(start(25), 5 * MIN);
    expect(remainingMs(t, 25 * MIN)).toBe(5 * MIN);
    expect(extendTimer(start(null), 5 * MIN).plannedMs).toBeNull();
  });
  it("cycles pomodoro phases with a long break every 4", () => {
    const s = { focusMin: 25, shortBreakMin: 5, longBreakMin: 15, longBreakEvery: 4 };
    expect(nextPhase("focus", 0, s)).toEqual({ phase: "short_break", plannedMs: 5 * MIN, cycleCount: 1 });
    expect(nextPhase("focus", 3, s)).toEqual({ phase: "long_break", plannedMs: 15 * MIN, cycleCount: 4 });
    expect(nextPhase("short_break", 1, s)).toEqual({ phase: "focus", plannedMs: 25 * MIN, cycleCount: 1 });
  });
});

describe("project progress", () => {
  const task = (id: string, status: string, est: number | null = null, parent: string | null = null): ProgressTask => ({ id, parent_id: parent, status, estimated_seconds: est, due_date: null });
  it("by task count, ignoring cancelled", () => {
    const tasks = [task("a", "completed"), task("b", "in_progress"), task("c", "cancelled"), task("d", "planned")];
    expect(projectProgress("tasks", tasks, [])).toBeCloseTo(1 / 3);
  });
  it("subtasks contribute fractionally", () => {
    const tasks = [task("a", "in_progress"), task("a1", "completed", null, "a"), task("a2", "planned", null, "a"), task("b", "completed")];
    expect(projectProgress("tasks", tasks, [])).toBeCloseTo(0.75);
  });
  it("weighted by estimate", () => {
    const tasks = [task("a", "completed", 3600), task("b", "planned", 3 * 3600)];
    expect(projectProgress("weighted", tasks, [])).toBeCloseTo(0.25);
    // unestimated tasks take the mean estimate
    expect(projectProgress("weighted", [...tasks, task("c", "completed")], [])).toBeCloseTo((3600 + 7200) / (3600 + 10800 + 7200));
  });
  it("by milestones", () => {
    expect(projectProgress("milestones", [], [{ completed_at: 1 }, { completed_at: null }])).toBe(0.5);
    expect(projectProgress("milestones", [], [])).toBeNull();
  });
  it("returns null with no tasks", () => {
    expect(projectProgress("tasks", [], [])).toBeNull();
  });
  it("collects subtree", () => {
    const ps = [{ id: "a", parent_id: null }, { id: "b", parent_id: "a" }, { id: "c", parent_id: "b" }, { id: "d", parent_id: null }];
    expect([...projectSubtree("a", ps)].sort()).toEqual(["a", "b", "c"]);
  });
});

describe("project health", () => {
  const base = { status: "active", today: "2026-03-10", start_date: "2026-03-01", deadline: "2026-03-21", progress: 0.5, overdueTasks: 0, estimatedSeconds: null, actualSeconds: 0, weeklyTargetSeconds: null, weekActualSeconds: 0, weekDaysElapsed: 1 };
  it("on track", () => expect(projectHealth(base).status).toBe("on_track"));
  it("behind when far below the schedule", () => expect(projectHealth({ ...base, progress: 0.1 }).status).toBe("behind"));
  it("behind after the deadline", () => expect(projectHealth({ ...base, today: "2026-03-25" }).status).toBe("behind"));
  it("at risk with overdue tasks or blown budget", () => {
    expect(projectHealth({ ...base, overdueTasks: 1 }).status).toBe("at_risk");
    expect(projectHealth({ ...base, estimatedSeconds: 3600, actualSeconds: 4000 }).status).toBe("at_risk");
  });
  it("done", () => expect(projectHealth({ ...base, status: "completed" }).status).toBe("done"));
});

describe("weekly targets", () => {
  const H = 3600;
  it("computes remaining, pace and on-track", () => {
    // Thursday 2026-03-05, Monday start: 3 full days elapsed
    const s = weeklyStatus(10 * H, 4 * H, "2026-03-05", 1);
    expect(s.remainingSeconds).toBe(6 * H);
    expect(s.progress).toBeCloseTo(0.4);
    expect(s.expectedSeconds).toBeCloseTo((10 * H * 3) / 7);
    expect(s.onTrack).toBe(false);
    expect(s.daysLeft).toBe(4);
    expect(s.neededPerDaySeconds).toBe(1.5 * H);
    expect(s.averagePerDaySeconds).toBe(H);
    expect(weeklyStatus(10 * H, 5 * H, "2026-03-05", 1).onTrack).toBe(true);
  });
  it("first day of the week is never behind; week start is configurable", () => {
    expect(weeklyStatus(10 * H, 0, "2026-03-02", 1).onTrack).toBe(true);
    // Same Monday with a Sunday week start: one full day elapsed
    expect(weeklyStatus(10 * H, 0, "2026-03-02", 0).onTrack).toBe(false);
  });
  it("met target", () => {
    const s = weeklyStatus(5 * H, 6 * H, "2026-03-03", 1);
    expect(s.met).toBe(true);
    expect(s.remainingSeconds).toBe(0);
    expect(s.progress).toBe(1);
  });
  it("period ranges", () => {
    expect(periodRange("weekly", "2026-03-05", 1)).toEqual({ start: "2026-03-02", end: "2026-03-08" });
    expect(periodRange("weekly", "2026-03-01", 1)).toEqual({ start: "2026-02-23", end: "2026-03-01" });
    expect(periodRange("monthly", "2026-02-10", 1)).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(periodRange("yearly", "2026-02-10", 1)).toEqual({ start: "2026-01-01", end: "2026-12-31" });
  });
});

describe("habits", () => {
  const h: HabitDef = { kind: "boolean", target_value: 1, weekdays: [], created_date: "2026-03-01" };
  const days = (o: Record<string, Partial<HabitDay>>) => new Map(Object.entries(o).map(([k, v]) => [k, { value: 0, skipped: false, ...v }]));
  it("streak ignores an unfinished today and rest days", () => {
    const d = days({ "2026-03-05": { value: 1 }, "2026-03-06": { value: 1 }, "2026-03-07": { skipped: true }, "2026-03-08": { value: 1 } });
    expect(currentStreak(h, d, "2026-03-09")).toBe(3);
    expect(currentStreak(h, d, "2026-03-10")).toBe(0);
    expect(longestStreak(h, d, "2026-03-10")).toBe(3);
  });
  it("unscheduled weekdays do not break streaks", () => {
    const mwf = { ...h, weekdays: [1, 3, 5] };
    const d = days({ "2026-03-02": { value: 1 }, "2026-03-04": { value: 1 }, "2026-03-06": { value: 1 } });
    expect(currentStreak(mwf, d, "2026-03-08")).toBe(3);
  });
  it("multi check-in habits need the full target", () => {
    const prayers: HabitDef = { ...h, kind: "sessions", target_value: 5 };
    expect(dayState(prayers, "2026-03-02", { value: 3, skipped: false }, "2026-03-03")).toBe("partial");
    expect(dayState(prayers, "2026-03-02", { value: 5, skipped: false }, "2026-03-03")).toBe("done");
    expect(dayState(prayers, "2026-03-02", undefined, "2026-03-03")).toBe("missed");
    expect(dayState(prayers, "2026-03-03", undefined, "2026-03-03")).toBe("pending");
  });
  it("consistency excludes rest days and today-in-progress", () => {
    const d = days({ "2026-03-02": { value: 1 }, "2026-03-03": { skipped: true }, "2026-03-04": { value: 1 } });
    // Mar 2–8, today Mar 6: due = 2,4,5 (3 rest, 6 today pending) → 2/3
    expect(consistency(h, d, "2026-03-02", "2026-03-08", "2026-03-06")).toBeCloseTo(2 / 3);
    expect(consistency(h, new Map(), "2026-03-06", "2026-03-08", "2026-03-06")).toBeNull();
  });
});

describe("quick add", () => {
  it("parses the PRD example", () => {
    const q = parseQuickAdd("Study International Humanitarian Law for 2 hours tomorrow", "2026-03-04");
    expect(q).toMatchObject({ title: "Study International Humanitarian Law", estimated_seconds: 7200, due_date: "2026-03-05" });
  });
  it("parses time, priority, tags and weekdays", () => {
    const q = parseQuickAdd("Project meeting friday at 1pm 45m !high #work", "2026-03-04");
    expect(q).toMatchObject({ title: "Project meeting", due_date: "2026-03-06", time: "13:00", estimated_seconds: 2700, priority: 2, tags: ["work"] });
  });
  it("leaves plain text alone", () => {
    expect(parseQuickAdd("Buy milk", "2026-03-04")).toMatchObject({ title: "Buy milk", due_date: null, estimated_seconds: null });
    expect(parseQuickAdd("Read chapter 4", "2026-03-04").title).toBe("Read chapter 4");
  });
});

describe("schedule", () => {
  const b = (id: string, s: number, e: number) => ({ id, title: id, start: s, end: e });
  it("detects conflicts", () => {
    const blocks = [b("a", 0, 60), b("b", 30, 90), b("c", 90, 120)];
    expect([...conflictingIds(blocks)].sort()).toEqual(["a", "b"]);
    expect(conflictsFor(b("x", 100, 110), blocks).map((c) => c.id)).toEqual(["c"]);
    expect(conflictsFor(b("a", 0, 60), blocks).map((c) => c.id)).toEqual(["b"]);
  });
  it("lays out overlapping blocks in columns", () => {
    const out = layoutColumns([b("a", 0, 60), b("b", 30, 90), b("c", 100, 120)]);
    const get = (id: string) => out.find((o) => o.id === id)!;
    expect([get("a").col, get("a").cols]).toEqual([0, 2]);
    expect([get("b").col, get("b").cols]).toEqual([1, 2]);
    expect([get("c").col, get("c").cols]).toEqual([0, 1]);
  });
});

import { achievementsFor, dayXp, levelFor, questsFor, tokensEarned, totalsOf, xpForLevel, EMPTY_DAY } from "./game";

describe("levels, tokens and quests", () => {
  it("awards XP by fixed rules, with quest bonuses", () => {
    expect(dayXp(EMPTY_DAY)).toBe(0);
    // 30 min focus + 1 task + 1 session, no quest finished
    expect(dayXp({ ...EMPTY_DAY, focusSeconds: 1800, tasksCompleted: 1, sessionsCompleted: 1 })).toBe(30 + 10 + 5);
    // 60 min + 3 tasks: both quests done
    expect(dayXp({ ...EMPTY_DAY, focusSeconds: 3600, tasksCompleted: 3 })).toBe(60 + 30 + 30);
  });
  it("only offers the habit quest when habits are due", () => {
    expect(questsFor(EMPTY_DAY).map((q) => q.id)).toEqual(["focus", "tasks"]);
    const q = questsFor({ ...EMPTY_DAY, habitsDue: 2, habitsDone: 2 });
    expect(q[2]).toMatchObject({ id: "habits", done: true });
  });
  it("maps XP to levels on a rising curve", () => {
    expect([1, 2, 3, 4].map(xpForLevel)).toEqual([0, 100, 300, 600]);
    expect(levelFor(0)).toMatchObject({ level: 1, into: 0, needed: 100 });
    expect(levelFor(99).level).toBe(1);
    expect(levelFor(100).level).toBe(2);
    expect(levelFor(450)).toMatchObject({ level: 3, into: 150, needed: 300, fraction: 0.5 });
    expect(tokensEarned(459)).toBe(45);
  });
  it("totals days and finds the best focus streak", () => {
    const d = (m: number) => ({ ...EMPTY_DAY, focusSeconds: m * 60 });
    const t = totalsOf(new Map([["2026-03-01", d(30)], ["2026-03-02", d(30)], ["2026-03-04", d(60)], ["2026-02-28", d(10)]]));
    expect(t.bestFocusStreak).toBe(3); // Feb 28, Mar 1, Mar 2
    expect(t.xp).toBe(10 + 30 + 30 + 60 + 15);
    expect(achievementsFor(t).find((a) => a.id === "focus-10")!.unlocked).toBe(false);
  });
});

describe("Arabic input", () => {
  it("quick add understands everyday Arabic", () => {
    const q = parseQuickAdd("مذاكرة القانون الدولي الإنساني لمدة ساعتين بكرة", "2026-03-04");
    expect(q).toMatchObject({ title: "مذاكرة القانون الدولي الإنساني", estimated_seconds: 7200, due_date: "2026-03-05" });
    const m = parseQuickAdd("اجتماع المشروع يوم الجمعة الساعة 1 م 45 دقيقة !عالية #شغل", "2026-03-04");
    expect(m).toMatchObject({ title: "اجتماع المشروع", due_date: "2026-03-06", time: "13:00", estimated_seconds: 2700, priority: 2, tags: ["شغل"] });
    expect(parseQuickAdd("شراء لبن", "2026-03-04")).toMatchObject({ title: "شراء لبن", due_date: null, estimated_seconds: null });
  });
  it("durations can be typed in Arabic", () => {
    expect(parseDuration("ساعتين")).toBe(7200);
    expect(parseDuration("ساعة ونص")).toBe(5400);
    expect(parseDuration("45 دقيقة")).toBe(2700);
    expect(parseDuration("1 س 30 د")).toBe(5400);
    expect(parseDuration("نص ساعة")).toBe(1800);
    expect(parseDuration("كلام")).toBeNull();
  });
});
