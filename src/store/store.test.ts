import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrate, setDriver, sqljsDriver, db } from "@/db/driver";
import { atTime } from "@/domain/dates";
import { projectProgress } from "@/domain/projects";
import { weeklyStatus } from "@/domain/targets";
import { estimationStats } from "@/domain/time";
import { consistency } from "@/domain/habits";
import * as a from "./actions";
import { data, reload, useData, DEFAULT_SETTINGS } from "./data";
import { gameState, habitDays, projectSeconds, sessionSeconds, taskSeconds, targetSeconds, weekRange, goalProgress } from "./selectors";
import { pauseSession, resetTimerStore, resolveGap, restoreTimer, resumeSession, startSession, stopSession, tick, useTimer } from "./timer";

const MIN = 60_000;
const H = 3600;
// Monday 2026-03-02 09:00 local
const T0 = atTime("2026-03-02", "09:00");
const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);
const task = (id: string) => data().tasks.find((t) => t.id === id)!;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  const driver = await sqljsDriver({ persist: false });
  await migrate(driver);
  setDriver(driver);
  useData.setState({ settings: DEFAULT_SETTINGS });
  resetTimerStore();
  await reload();
});

describe("migrations", () => {
  it("are idempotent", async () => {
    expect(await migrate(db())).toEqual([]);
  });
  it("enforce foreign keys", async () => {
    await expect(db().execute("INSERT INTO milestones (id, project_id, title, created_at) VALUES ('m', 'nope', 't', 1)")).rejects.toThrow();
  });
});

describe("projects, tasks and progress (acceptance 1–2)", () => {
  it("assigns tasks and computes progress with subtasks", async () => {
    const p = await a.createProject({ name: "Moot Court" });
    const sub = await a.createProject({ name: "Legal Research", parent_id: p });
    const t1 = await a.createTask({ title: "Research Article 17 ICCPR", project_id: sub });
    const t2 = await a.createTask({ title: "Analyze ECtHR judgments", project_id: sub });
    const s1 = await a.createTask({ title: "Read case A", parent_id: t2 });
    await a.createTask({ title: "Read case B", parent_id: t2 });
    expect(task(s1).project_id).toBe(sub);
    expect(task(t1).status).toBe("not_started");

    await a.updateTask(t1, { status: "completed" });
    await a.updateTask(s1, { status: "completed" });
    const tasks = data().tasks.filter((t) => t.project_id === sub);
    expect(projectProgress("tasks", tasks, [])).toBeCloseTo(0.75);
    expect(task(t1).completed_at).toBe(T0);
    expect(data().logs.some((l) => l.project_id === sub && l.kind === "task_completed")).toBe(true);
  });
  it("rejects invalid input", async () => {
    await expect(a.createTask({ title: "   " })).rejects.toThrow();
    await expect(a.createProject({ name: "" })).rejects.toThrow();
  });
  it("keeps tasks when a project is deleted", async () => {
    const p = await a.createProject({ name: "Temp" });
    const t = await a.createTask({ title: "Survivor", project_id: p });
    await a.deleteProject(p);
    expect(task(t).project_id).toBeNull();
  });
  it("blocks circular dependencies", async () => {
    const x = await a.createTask({ title: "x" });
    const y = await a.createTask({ title: "y" });
    await a.setDependency(x, y, true);
    await expect(a.setDependency(y, x, true)).rejects.toThrow(/circular/);
  });
});

describe("timer and time attribution (acceptance 3–7, 13–14)", () => {
  it("attributes real elapsed time to tasks, project and weekly target; pauses excluded", async () => {
    const p = await a.createProject({ name: "Research", weekly_target_seconds: 10 * H, estimated_seconds: 100 * H });
    const sub = await a.createProject({ name: "Sub", parent_id: p });
    const t1 = await a.createTask({ title: "Legal research", project_id: p, estimated_seconds: 2 * H });
    const t2 = await a.createTask({ title: "Drafting", project_id: sub, estimated_seconds: H });

    // Pomodoro on t1: 10 min, pause 20 min, resume and run to completion.
    await startSession({ mode: "pomodoro", taskId: t1 });
    expect(task(t1).status).toBe("in_progress");
    advance(10 * MIN);
    await pauseSession();
    advance(20 * MIN);
    await resumeSession();
    advance(15 * MIN + 5000); // tick arrives 5 s late
    await tick();
    const s1 = data().sessions.find((s) => s.task_id === t1)!;
    expect(s1.status).toBe("completed");
    expect(sessionSeconds(s1.id, data().entries)).toBe(25 * 60); // capped at the planned 25 min, not 25:05
    expect(useTimer.getState().timer?.phase).toBe("short_break"); // break started automatically

    // Breaks never produce tracked time.
    advance(5 * MIN + 5000);
    await tick();
    expect(useTimer.getState().timer).toBeNull();
    expect(data().entries.length).toBe(2);

    // Stopwatch on t2 (subproject), stopped after 40 min.
    await startSession({ mode: "stopwatch", taskId: t2 });
    advance(40 * MIN);
    await stopSession();
    // Interrupted countdown on t1: 7 of 25 min.
    await startSession({ mode: "pomodoro", taskId: t1 });
    advance(7 * MIN);
    await stopSession();
    expect(data().sessions.find((s) => s.task_id === t1 && s.status === "interrupted")).toBeTruthy();

    const { entries, projects } = data();
    expect(taskSeconds(entries).get(t1)).toBe(32 * 60);
    expect(taskSeconds(entries).get(t2)).toBe(40 * 60);
    expect(projectSeconds(sub, projects, entries)).toBe(40 * 60);
    expect(projectSeconds(p, projects, entries)).toBe(72 * 60); // parent includes subproject, each minute once

    const week = weekRange("2026-03-02", 1);
    const status = weeklyStatus(10 * H, projectSeconds(p, projects, entries, week.from, week.to), "2026-03-02", 1);
    expect(status.remainingSeconds).toBe(10 * H - 72 * 60);
    expect(status.onTrack).toBe(true);

    // Manual entry (acceptance 6) + estimate vs actual (7)
    await a.addManualEntry({ task_id: t1, started_at: atTime("2026-03-01", "14:00"), ended_at: atTime("2026-03-01", "14:45"), description: "Read a judgment" });
    expect(taskSeconds(data().entries).get(t1)).toBe(77 * 60);
    expect(data().entries.at(0)!.project_id).toBe(p); // context inherited from the task
    // Sunday's entry is outside this (Monday-start) week
    expect(projectSeconds(p, data().projects, data().entries, week.from, week.to)).toBe(72 * 60);
    const stats = estimationStats([{ estimated: 2 * H, actual: 77 * 60 }, { estimated: H, actual: 40 * 60 }]);
    expect(stats.variance).toBe(117 * 60 - 3 * H);
  });

  it("does not double count overlapping manual entries in project totals", async () => {
    const p = await a.createProject({ name: "P" });
    const t1 = await a.createTask({ title: "a", project_id: p });
    const t2 = await a.createTask({ title: "b", project_id: p });
    await a.addManualEntry({ task_id: t1, started_at: T0 - 60 * MIN, ended_at: T0 });
    await a.addManualEntry({ task_id: t2, started_at: T0 - 30 * MIN, ended_at: T0 });
    expect(projectSeconds(p, data().projects, data().entries)).toBe(60 * 60);
  });

  it("rejects impossible manual entries", async () => {
    await expect(a.addManualEntry({ started_at: T0, ended_at: T0 - 1 })).rejects.toThrow();
    await expect(a.addManualEntry({ started_at: T0, ended_at: T0 + 60 * MIN })).rejects.toThrow(/future/);
  });

  it("survives closing and reopening the app mid-session (short absence)", async () => {
    const t = await a.createTask({ title: "Deep" });
    await startSession({ mode: "pomodoro", taskId: t });
    advance(10 * MIN);
    await tick(); // heartbeat persisted
    resetTimerStore(); // "close" the app: in-memory state is gone
    advance(1 * MIN);
    await restoreTimer(); // "reopen"
    const st = useTimer.getState();
    expect(st.gap).toBeNull();
    expect(st.timer!.accumulatedMs + (Date.now() - st.timer!.segmentStartedAt!)).toBe(11 * MIN);
    advance(14 * MIN);
    await tick();
    const s = data().sessions[0]!;
    expect(s.status).toBe("completed");
    expect(sessionSeconds(s.id, data().entries)).toBe(25 * 60);
  });

  it("asks about long absences; discarding ends the session at the last heartbeat", async () => {
    await startSession({ mode: "stopwatch" });
    advance(20 * MIN);
    await tick();
    resetTimerStore();
    advance(8 * 60 * MIN); // laptop slept overnight
    await restoreTimer();
    expect(useTimer.getState().gap?.ms).toBe(8 * 60 * MIN);
    await tick(); // nothing is finalised while the question is open
    expect(data().entries.length).toBe(0);
    await resolveGap(false);
    expect(useTimer.getState().timer!.segmentStartedAt).toBeNull();
    await stopSession();
    const s = data().sessions[0]!;
    expect(sessionSeconds(s.id, data().entries)).toBe(20 * 60);
    expect(s.ended_at).toBe(T0 + 20 * MIN);
  });

  it("keeping an absence counts it, capped at the countdown's end", async () => {
    await startSession({ mode: "countdown", minutes: 50 });
    advance(5 * MIN);
    await tick();
    resetTimerStore();
    advance(3 * 60 * MIN);
    await restoreTimer();
    expect(useTimer.getState().gap?.ms).toBe(45 * MIN);
    await resolveGap(true);
    await tick();
    const s = data().sessions[0]!;
    expect(s.status).toBe("completed");
    expect(sessionSeconds(s.id, data().entries)).toBe(50 * 60);
    expect(s.ended_at).toBe(T0 + 50 * MIN);
  });

  it("history is not rewritten when the task later moves project", async () => {
    const p1 = await a.createProject({ name: "One" });
    const p2 = await a.createProject({ name: "Two" });
    const t = await a.createTask({ title: "Mover", project_id: p1 });
    await startSession({ mode: "stopwatch", taskId: t });
    advance(30 * MIN);
    await stopSession();
    await a.updateTask(t, { project_id: p2 });
    expect(projectSeconds(p1, data().projects, data().entries)).toBe(30 * 60);
    expect(projectSeconds(p2, data().projects, data().entries)).toBe(0);
  });

  it("standalone activity targets and goals track session time", async () => {
    await a.saveTarget({ name: "English", weekly_seconds: 5 * H });
    const target = data().targets[0]!;
    await a.saveGoal({ title: "5h English", period: "weekly", metric: "focus_time", target_value: 5 });
    await startSession({ mode: "stopwatch", targetId: target.id });
    advance(90 * MIN);
    await stopSession();
    const week = weekRange("2026-03-02", 1);
    expect(targetSeconds(target.id, data().entries, week.from, week.to)).toBe(90 * 60);
    const g = goalProgress(data().goals[0]!, { ...data(), weekStart: 1 }, "2026-03-02");
    expect(g.current).toBeCloseTo(1.5);
    expect(g.fraction).toBeCloseTo(0.3);
  });
});

describe("recurring tasks (acceptance 8–10)", () => {
  const daily = { freq: "daily" as const, interval: 1, weekdays: [], monthdays: [], start_date: "2026-03-02", end_date: null, count: null };
  const occ = (sid: string) => data().tasks.filter((t) => t.series_id === sid).sort((x, y) => x.occurrence_date!.localeCompare(y.occurrence_date!));

  it("generates daily occurrences once, however often generation runs", async () => {
    const sid = await a.createSeries({ title: "Morning reading" }, daily);
    const n = occ(sid).length;
    expect(n).toBe(a.RECURRENCE_HORIZON_DAYS + 1);
    await a.generateOccurrences();
    await a.generateOccurrences("2026-03-02");
    expect(occ(sid).length).toBe(n);
    // A later day extends the horizon without duplicating
    await a.generateOccurrences("2026-03-05");
    expect(occ(sid).length).toBe(n + 3);
    expect(new Set(occ(sid).map((t) => t.occurrence_date)).size).toBe(n + 3);
  });

  it("three days per week", async () => {
    const sid = await a.createSeries({ title: "Study" }, { ...daily, freq: "weekly", weekdays: [1, 3, 5] });
    expect(occ(sid).slice(0, 4).map((t) => t.occurrence_date)).toEqual(["2026-03-02", "2026-03-04", "2026-03-06", "2026-03-09"]);
  });

  it("editing one occurrence leaves the rest of the series alone, and series edits skip it", async () => {
    const sid = await a.createSeries({ title: "Exercise", priority: 3 }, daily);
    const [first, second, third] = occ(sid);
    await a.updateTask(second!.id, { title: "Exercise (physio instead)" });
    expect(task(second!.id).is_detached).toBe(1);
    expect(task(third!.id).title).toBe("Exercise");

    await a.updateTask(first!.id, { status: "completed" });
    await a.updateSeries(sid, { title: "Workout", priority: 2 }, daily, "all", "2026-03-02");
    expect(task(first!.id).title).toBe("Exercise"); // completed history preserved
    expect(task(second!.id).title).toBe("Exercise (physio instead)"); // single edit preserved
    expect(task(third!.id).title).toBe("Workout");
    expect(task(third!.id).priority).toBe(2);
    expect(new Set(occ(sid).map((t) => t.occurrence_date)).size).toBe(occ(sid).length);
  });

  it("editing this-and-future splits the series without duplicates", async () => {
    const sid = await a.createSeries({ title: "Review" }, daily);
    const before = occ(sid);
    await a.updateTask(before[3]!.id, { status: "completed" }); // 03-05 done ahead of time
    await a.updateSeries(sid, { title: "Review v2" }, { ...daily, freq: "weekly", weekdays: [1, 4] }, "future", "2026-03-04");
    const old = occ(sid);
    expect(old.map((t) => t.occurrence_date)).toEqual(["2026-03-02", "2026-03-03", "2026-03-05"]);
    const newSeries = data().series.find((s) => s.id !== sid)!;
    const next = occ(newSeries.id);
    expect(next[0]!.title).toBe("Review v2");
    // Thursdays and Mondays from 03-04, but 03-05 is already held by the completed occurrence
    expect(next.slice(0, 3).map((t) => t.occurrence_date)).toEqual(["2026-03-09", "2026-03-12", "2026-03-16"]);
    expect(data().rules.find((r) => r.id === data().series.find((s) => s.id === sid)!.rule_id)!.end_date).toBe("2026-03-03");
  });

  it("a deleted occurrence is not regenerated", async () => {
    const sid = await a.createSeries({ title: "Call" }, daily);
    const victim = occ(sid)[1]!;
    await a.deleteTask(victim.id);
    await a.updateSeries(sid, { title: "Call" }, daily, "all", "2026-03-02");
    await a.generateOccurrences("2026-03-03");
    expect(occ(sid).some((t) => t.occurrence_date === victim.occurrence_date)).toBe(false);
  });

  it("ending a series keeps history", async () => {
    const sid = await a.createSeries({ title: "Prayers" }, daily);
    await a.updateTask(occ(sid)[0]!.id, { status: "completed" });
    await a.endSeries(sid);
    expect(occ(sid).map((t) => t.occurrence_date)).toEqual(["2026-03-02"]);
    await a.generateOccurrences("2026-03-20");
    expect(occ(sid).length).toBe(1);
  });
});

describe("habits (acceptance 15)", () => {
  it("tracks multi check-in habits and weekly consistency", async () => {
    await a.saveHabit({ name: "Daily prayers", kind: "sessions", target_value: 5, weekdays: [] });
    const h = data().habits[0]!;
    for (let i = 0; i < 5; i++) await a.checkInHabit(h.id, "2026-03-02", 1);
    await a.checkInHabit(h.id, "2026-03-03", 3);
    await a.restHabitDay(h.id, "2026-03-04");
    const days = habitDays(h.id, data().habitEntries);
    expect(days.get("2026-03-02")).toEqual({ value: 5, skipped: false });
    expect(days.get("2026-03-04")?.skipped).toBe(true);
    // Mon done, Tue partial (missed), Wed rest → 1 of 2 due days by Thursday
    expect(consistency({ ...h, created_date: "2026-03-02" }, days, "2026-03-02", "2026-03-08", "2026-03-05")).toBeCloseTo(1 / 2);
  });
});

describe("export and restore (acceptance 17)", () => {
  it("round-trips all data", async () => {
    const p = await a.createProject({ name: "Thesis", deadline: "2026-12-01" });
    const t = await a.createTask({ title: "Outline", project_id: p, notes: "## Plan\n- intro" });
    const tag = await a.ensureTag("writing");
    await a.setTaskTags(t, [tag]);
    await a.createTask({ title: "Sub", parent_id: t });
    await a.setSetting("weekStart", 0);
    await a.saveJournal("2026-03-02", { went_well: "Focus" });
    await startSession({ mode: "stopwatch", taskId: t });
    advance(30 * MIN);
    await stopSession();

    const file = JSON.parse(JSON.stringify(await a.exportAll()));
    const snapshot = { tasks: data().tasks, entries: data().entries, projects: data().projects, taskTags: data().taskTags };

    await a.deleteProject(p);
    await a.deleteTask(t);
    expect(data().tasks.length).toBe(0);

    await a.importAll(file);
    expect(data().tasks).toEqual(snapshot.tasks);
    expect(data().entries).toEqual(snapshot.entries);
    expect(data().projects).toEqual(snapshot.projects);
    expect(data().taskTags).toEqual(snapshot.taskTags);
    expect(data().settings.weekStart).toBe(0);
    expect(data().journal["2026-03-02"]!.went_well).toBe("Focus");
  });

  it("rejects malformed files and leaves data intact", async () => {
    await a.createTask({ title: "Keep me" });
    await expect(a.importAll({ app: "other" })).rejects.toThrow();
    await expect(a.importAll({ app: "tempo", schema_version: 1, exported_at: 1, tables: { tasks: [{ id: "x" }] } })).rejects.toThrow();
    expect(data().tasks.map((t) => t.title)).toEqual(["Keep me"]);
  });
});

describe("levels and tokens", () => {
  it("earns XP from real work and spends tokens on rewards without overdrawing", async () => {
    const t = await a.createTask({ title: "Write" });
    await startSession({ mode: "countdown", minutes: 60, taskId: t });
    advance(60 * MIN);
    await tick();
    await a.updateTask(t, { status: "completed" });
    const g = gameState(data(), "2026-03-02");
    // 60 focus minutes + 1 task (10) + 1 session (5) + focus quest (15)
    expect(g.totals.xp).toBe(90);
    expect(g.tokens).toBe(9);

    await a.saveReward({ title: "Coffee break", cost: 5 });
    await a.saveReward({ title: "Movie night", cost: 50 });
    const [coffee, movie] = data().rewards;
    await a.redeemReward(coffee!.id);
    expect(gameState(data(), "2026-03-02").tokens).toBe(4);
    await expect(a.redeemReward(movie!.id)).rejects.toThrow(/46 more tokens/);
    await expect(a.redeemReward(coffee!.id)).rejects.toThrow(/1 more token/);
    await expect(a.saveReward({ title: "Free", cost: 0 })).rejects.toThrow();
    // Redemption history survives archiving the reward
    await a.archiveReward(coffee!.id);
    expect(data().redemptions).toHaveLength(1);
  });
});
