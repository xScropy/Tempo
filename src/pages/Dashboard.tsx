import { td, tn, tr } from "@/i18n";
import { ArrowDown, ArrowUp, CalendarDays, Check, Eye, EyeOff, FolderPlus, Play, Plus, Repeat2, Settings2, Timer, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { addDays, dayStartMs, diffDays, fmtDate, fmtDuration, fromDateStr, monthName, timeOf, weekdayName, weekdayLong } from "@/domain/dates";
import { dayState, isScheduled } from "@/domain/habits";
import { isOverdue } from "@/domain/projects";
import { weeklyStatus } from "@/domain/targets";
import { secondsByGroup, totalSeconds } from "@/domain/time";
import { isOpen } from "@/domain/types";
import { attempt } from "@/lib/notify";
import { checkInHabit, setSetting } from "@/store/actions";
import { useData, WIDGETS, type WidgetConfig } from "@/store/data";
import { byId, nextOccurrenceOnly, focusStreak, habitDays, intervals, projectSeconds, targetSeconds, weekRange } from "@/store/selectors";
import { startSession } from "@/store/timer";
import { navigate, openQuickAdd, openTask, useUi } from "@/store/ui";
import { TaskList } from "@/components/task-bits";
import { Button, IconButton, PageHeader, Progress, Section, Stat, cx } from "@/components/ui";
import { EMPTY_DAY, XP_RULES, questsFor } from "@/domain/game";
import { HealthBadge, projectStats } from "./Projects";
import { useGame } from "./Rewards";

const None = ({ children }: { children: React.ReactNode }) => <div className="px-3 py-5 text-center text-sm text-ink-2">{children}</div>;

function useWeek() {
  const today = useUi((s) => s.today);
  const weekStart = useData((s) => s.settings.weekStart);
  return useMemo(() => ({ today, weekStart, ...weekRange(today, weekStart) }), [today, weekStart]);
}

function Schedule() {
  const { today } = useWeek();
  const tasks = useData((s) => s.tasks);
  const events = useData((s) => s.events);
  const from = dayStartMs(today);
  const items = useMemo(
    () =>
      [
        ...tasks.filter((t) => t.scheduled_at != null && t.scheduled_at >= from && t.scheduled_at < from + 86_400_000 && t.status !== "cancelled").map((t) => ({ key: t.id, at: t.scheduled_at!, end: t.scheduled_at! + (t.scheduled_minutes ?? 30) * 60_000, title: t.title, done: t.status === "completed", open: () => openTask(t.id) })),
        ...events.filter((e) => e.start_at < from + 86_400_000 && e.end_at > from).map((e) => ({ key: e.id, at: e.start_at, end: e.end_at, title: e.title, done: false, open: () => navigate("calendar") })),
      ].sort((a, b) => a.at - b.at),
    [tasks, events, from],
  );
  if (!items.length) return <None>{tr("Nothing scheduled today. Drag tasks onto the calendar to plan your day.")}</None>;
  const now = Date.now();
  return (
    <div>
      {items.map((i) => (
        <button key={i.key} type="button" onClick={i.open} className="flex w-full items-center gap-3 border-b border-line px-3 py-1.5 text-start last:border-0 hover:bg-hover/50">
          <span className={cx("tabular w-24 shrink-0 text-sm", i.at <= now && i.end > now ? "font-medium text-accent" : "text-ink-2")}>{timeOf(i.at)} – {timeOf(i.end)}</span>
          <span className={cx("min-w-0 flex-1 truncate", i.done && "text-ink-3 line-through")}>{i.title}</span>
        </button>
      ))}
    </div>
  );
}

function PriorityTasks() {
  const { today } = useWeek();
  const tasks = useData((s) => s.tasks);
  const list = useMemo(
    () =>
      tasks
        .filter((t) => !t.parent_id && isOpen(t) && t.status !== "inbox" && (t.priority <= 2 || t.due_date === today || isOverdue(t, today)))
        .sort((a, b) => a.priority - b.priority || (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"))
        .slice(0, 7),
    [tasks, today],
  );
  return list.length ? <TaskList tasks={list} withSubtasks={false} /> : <None>{tr("No urgent or high-priority tasks. A calm day.")}</None>;
}

function ActiveProjects() {
  const { today } = useWeek();
  const projects = useData((s) => s.projects);
  const tasks = useData((s) => s.tasks);
  const milestones = useData((s) => s.milestones);
  const entries = useData((s) => s.entries);
  const settings = useData((s) => s.settings);
  const rows = useMemo(() => projects.filter((p) => !p.parent_id && p.status === "active").slice(0, 6).map((p) => ({ p, st: projectStats(p, { projects, tasks, milestones, entries, settings }, today) })), [projects, tasks, milestones, entries, settings, today]);
  if (!rows.length) return <None>{tr("No active projects yet.")}</None>;
  return (
    <div>
      {rows.map(({ p, st }) => (
        <button key={p.id} type="button" onClick={() => navigate("projects", p.id)} className="flex w-full items-center gap-3 border-b border-line px-3 py-2 text-start last:border-0 hover:bg-hover/50">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: p.color }} />
          <span className="min-w-0 flex-1 truncate">{p.name}</span>
          <Progress value={st.progress ?? 0} className="w-20" />
          <span className="tabular w-9 text-end text-xs text-ink-2">{st.progress == null ? "—" : `${Math.round(st.progress * 100)}%`}</span>
          <HealthBadge health={st.health} />
        </button>
      ))}
    </div>
  );
}

function FocusWeek() {
  const { start, today, from, to } = useWeek();
  const entries = useData((s) => s.entries);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = addDays(start, i);
    const a = dayStartMs(d);
    return { d, seconds: totalSeconds(intervals(entries), a, a + 86_400_000) };
  }), [entries, start]);
  const max = Math.max(3600, ...days.map((d) => d.seconds));
  const total = totalSeconds(intervals(entries), from, to);
  return (
    <div className="px-3 py-3">
      <div className="flex h-28 items-end gap-2" role="img" aria-label={tr("Focus time per day this week, {0} in total", fmtDuration(total))}>
        {days.map(({ d, seconds }) => (
          <div key={d} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${fmtDate(d, today)}: ${fmtDuration(seconds)}`}>
            <span className="tabular text-2xs text-ink-2">{seconds > 0 ? fmtDuration(seconds) : ""}</span>
            <div className={cx("w-full max-w-[34px] rounded-t-[3px]", d > today && "opacity-40")} style={{ height: `${Math.max(seconds > 0 ? 3 : 1, (seconds / max) * 78)}%`, background: seconds > 0 ? "var(--chart-1)" : "rgb(var(--line-strong))" }} />
            <span className={cx("text-2xs", d === today ? "font-semibold text-accent" : "text-ink-3")}>{weekdayName(fromDateStr(d).getDay())}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Targets() {
  const { today, weekStart, from, to } = useWeek();
  const projects = useData((s) => s.projects);
  const targets = useData((s) => s.targets);
  const entries = useData((s) => s.entries);
  const rows = useMemo(
    () => [
      ...targets.filter((t) => !t.archived_at).map((t) => ({ key: t.id, name: t.name, target: t.weekly_seconds, actual: targetSeconds(t.id, entries, from, to), go: () => navigate("goals") })),
      ...projects.filter((p) => p.weekly_target_seconds && p.status === "active").map((p) => ({ key: p.id, name: p.name, target: p.weekly_target_seconds!, actual: projectSeconds(p.id, projects, entries, from, to), go: () => navigate("projects", p.id) })),
    ],
    [targets, projects, entries, from, to],
  );
  if (!rows.length) return <None>{tr("No weekly time targets. Add one under Goals or on a project.")}</None>;
  return (
    <div>
      {rows.map((r) => {
        const st = weeklyStatus(r.target, r.actual, today, weekStart);
        return (
          <button key={r.key} type="button" onClick={r.go} className="block w-full border-b border-line px-3 py-2 text-start last:border-0 hover:bg-hover/50">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate">{r.name}</span>
              <span className="tabular shrink-0 text-xs text-ink-2">{fmtDuration(r.actual)} / {fmtDuration(r.target)}</span>
            </div>
            <Progress value={st.progress} tone={st.met ? "ok" : st.onTrack ? "accent" : "warn"} className="mt-1.5" />
            <div className="mt-1 text-xs text-ink-3">{st.met ? tr("Reached") : tr("{0} left · {1}", fmtDuration(st.remainingSeconds), st.onTrack ? "on track" : "behind pace")}</div>
          </button>
        );
      })}
    </div>
  );
}

function Deadlines() {
  const { today } = useWeek();
  const tasks = useData((s) => s.tasks);
  const projects = useData((s) => s.projects);
  const milestones = useData((s) => s.milestones);
  const items = useMemo(() => {
    const until = addDays(today, 14);
    const pm = byId(projects);
    return [
      ...nextOccurrenceOnly(tasks.filter((t) => !t.parent_id && isOpen(t) && t.due_date && t.due_date <= until)).map((t) => ({ key: t.id, date: t.due_date!, label: t.title, kind: tr("Task"), go: () => openTask(t.id) })),
      ...projects.filter((p) => p.deadline && p.deadline <= until && p.status !== "completed" && p.status !== "cancelled").map((p) => ({ key: p.id, date: p.deadline!, label: p.name, kind: tr("Project"), go: () => navigate("projects", p.id) })),
      ...milestones.filter((m) => m.due_date && m.due_date <= until && !m.completed_at).map((m) => ({ key: m.id, date: m.due_date!, label: `${m.title} · ${pm.get(m.project_id)?.name ?? ""}`, kind: tr("Milestone"), go: () => navigate("projects", m.project_id) })),
    ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);
  }, [tasks, projects, milestones, today]);
  if (!items.length) return <None>{tr("No deadlines in the next two weeks.")}</None>;
  return (
    <div>
      {items.map((i) => {
        const left = diffDays(today, i.date);
        return (
          <button key={i.key} type="button" onClick={i.go} className="flex w-full items-center gap-3 border-b border-line px-3 py-1.5 text-start last:border-0 hover:bg-hover/50">
            <span className={cx("tabular w-20 shrink-0 text-sm", left < 0 ? "font-medium text-danger" : left <= 1 ? "font-medium text-warn" : "text-ink-2")}>{fmtDate(i.date, today)}</span>
            <span className="min-w-0 flex-1 truncate">{i.label}</span>
            <span className="text-xs text-ink-3">{i.kind}</span>
          </button>
        );
      })}
    </div>
  );
}

function HabitsToday() {
  const { today } = useWeek();
  const habits = useData((s) => s.habits);
  const entries = useData((s) => s.habitEntries);
  const list = habits.filter((h) => !h.archived_at && isScheduled(h, today));
  if (!list.length) return <None>{tr("No habits scheduled for today.")}</None>;
  return (
    <div>
      {list.map((h) => {
        const day = habitDays(h.id, entries).get(today);
        const state = dayState(h, today, day, today);
        const done = state === "done";
        return (
          <div key={h.id} className="flex items-center gap-3 border-b border-line px-3 py-1.5 last:border-0">
            <button
              type="button"
              role="checkbox"
              aria-checked={done}
              aria-label={tr("Check in {0}", h.name)}
              disabled={done || (h.kind !== "boolean" && h.kind !== "sessions")}
              onClick={() => void attempt(() => checkInHabit(h.id, today, 1))}
              className={cx("flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border-[1.5px]", done ? "border-accent bg-accent text-accent-ink" : "border-ink-3 enabled:hover:border-ink")}
            >
              {done && <Check size={11} strokeWidth={3} />}
            </button>
            <button type="button" className={cx("min-w-0 flex-1 truncate text-start", done && "text-ink-3")} onClick={() => navigate("habits")}>
              {h.name}
            </button>
            {h.kind !== "boolean" && <span className="tabular text-xs text-ink-2">{day?.value ?? 0}/{h.target_value}</span>}
            {state === "rest" && <span className="text-xs text-ink-3">{tr("Rest day")}</span>}
          </div>
        );
      })}
    </div>
  );
}

function Categories() {
  const { from, to } = useWeek();
  const entries = useData((s) => s.entries);
  const categories = useData((s) => s.categories);
  const rows = useMemo(() => {
    const cm = byId(categories);
    return [...secondsByGroup(intervals(entries).filter((e) => e.end > from && e.start < to), (e) => e.category_id, from, to).entries()].map(([k, seconds]) => ({ k, name: k ? (cm.get(k)?.name ?? tr("(deleted)")) : tr("Uncategorised"), color: k ? cm.get(k)?.color : undefined, seconds })).sort((a, b) => b.seconds - a.seconds);
  }, [entries, categories, from, to]);
  if (!rows.length) return <None>{tr("No time tracked this week yet.")}</None>;
  const max = rows[0]!.seconds;
  return (
    <div className="px-3 py-2">
      {rows.slice(0, 6).map((r) => (
        <div key={r.k} className="flex items-center gap-3 py-1 text-sm">
          <span className={cx("w-28 shrink-0 truncate", !r.k && "text-ink-2")}>{r.name}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-sm bg-hover">
            <div className="h-full rounded-sm" style={{ width: `${(r.seconds / max) * 100}%`, background: r.color ?? "rgb(var(--ink-3))" }} />
          </div>
          <span className="tabular w-20 shrink-0 whitespace-nowrap text-end text-ink-2">{fmtDuration(r.seconds)}</span>
        </div>
      ))}
    </div>
  );
}

function Activity() {
  const logs = useData((s) => s.logs);
  const projects = useData((s) => s.projects);
  if (!logs.length) return <None>{tr("Project activity will appear here.")}</None>;
  const pm = byId(projects);
  return (
    <div>
      {logs.slice(0, 7).map((l) => (
        <button key={l.id} type="button" onClick={() => navigate("projects", l.project_id)} className="flex w-full gap-3 border-b border-line px-3 py-1.5 text-start text-sm last:border-0 hover:bg-hover/50">
          <span className="min-w-0 flex-1 truncate">{td(l.message)}</span>
          <span className="max-w-[110px] shrink-0 truncate text-xs text-ink-3">{pm.get(l.project_id)?.name}</span>
        </button>
      ))}
    </div>
  );
}

function Quests() {
  const { today } = useWeek();
  const g = useGame();
  const on = useData((s) => s.settings.gamification);
  if (!on) return <None>{tr("Levels and quests are switched off in Settings.")}</None>;
  const quests = questsFor(g.days.get(today) ?? EMPTY_DAY);
  return (
    <button type="button" className="block w-full text-start" onClick={() => navigate("rewards")}>
      {quests.map((q) => (
        <div key={q.id} className="border-b border-line px-3 py-2 last:border-0">
          <div className="flex items-center gap-2">
            <span className={cx("flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-[1.5px]", q.done ? "border-accent bg-accent text-accent-ink" : "border-ink-3")}>{q.done && <Check size={10} strokeWidth={3} />}</span>
            <span className={cx("flex-1", q.done && "text-ink-2 line-through")}>{q.label}</span>
            <span className="tabular text-xs text-ink-2">{q.done ? tr("+{0} XP", XP_RULES.perQuest) : `${q.current}/${q.goal}`}</span>
          </div>
          <Progress value={q.current / q.goal} tone={q.done ? "ok" : "accent"} className="ms-6 mt-1.5" />
        </div>
      ))}
      <div className="tabular px-3 py-2 text-xs text-ink-2">{tr("Level")}{" "}{g.level.level} · {g.level.needed - g.level.into}{" "}{tr("XP to the next level ·")}{" "}{g.tokens}{" "}{tr("tokens")}</div>
    </button>
  );
}

const BODY: Record<string, () => React.ReactNode> = {
  quests: () => <Quests />,
  schedule: () => <Schedule />, priority: () => <PriorityTasks />, projects: () => <ActiveProjects />, focus: () => <FocusWeek />, targets: () => <Targets />,
  deadlines: () => <Deadlines />, habits: () => <HabitsToday />, categories: () => <Categories />, activity: () => <Activity />,
};

export function DashboardPage() {
  const { today, weekStart, from, to } = useWeek();
  const settings = useData((s) => s.settings);
  const tasks = useData((s) => s.tasks);
  const entries = useData((s) => s.entries);
  const sessions = useData((s) => s.sessions);
  const events = useData((s) => s.events);
  const projects = useData((s) => s.projects);
  const [editing, setEditing] = useState(false);
  const layout = settings.dashboard;
  const name = useData((s) => s.profile?.display_name);
  const hour = new Date().getHours();
  const greeting = `${hour < 5 ? tr("Still up") : hour < 12 ? tr("Good morning") : hour < 18 ? tr("Good afternoon") : tr("Good evening")}${name ? `${tr(",")} ${name.split(" ")[0]}` : ""}`;

  const m = useMemo(() => {
    const dayFrom = dayStartMs(today);
    const dayTo = dayFrom + 86_400_000;
    const top = tasks.filter((t) => !t.parent_id);
    const dueToday = top.filter((t) => t.status !== "cancelled" && (t.due_date === today || (t.status === "completed" ? t.completed_at != null && t.completed_at >= dayFrom : isOverdue(t, today))));
    const doneToday = top.filter((t) => t.status === "completed" && t.completed_at != null && t.completed_at >= dayFrom && t.completed_at < dayTo).length;
    const remaining = dueToday.filter(isOpen).length;
    const scheduled = tasks.filter((t) => t.scheduled_at != null && t.scheduled_at >= dayFrom && t.scheduled_at < dayTo && t.status !== "cancelled");
    const planned = scheduled.reduce((a, t) => a + (t.scheduled_minutes ?? 30) * 60, 0) + events.filter((e) => e.kind === "focus_block" && e.start_at >= dayFrom && e.start_at < dayTo).reduce((a, e) => a + (e.end_at - e.start_at) / 1000, 0);
    const all = intervals(entries);
    const weekTop = top.filter((t) => t.due_date && t.due_date >= dayStrOf(from) && t.due_date < dayStrOf(to) && t.status !== "cancelled");
    return {
      doneToday, remaining, scheduled: scheduled.length, planned,
      focusToday: totalSeconds(all, dayFrom, dayTo),
      pomodoros: sessions.filter((s) => s.status === "completed" && s.started_at >= dayFrom && s.started_at < dayTo).length,
      streak: focusStreak(entries, today),
      week: totalSeconds(all, from, to),
      weekDue: weekTop.length,
      weekDone: weekTop.filter((t) => t.status === "completed").length,
      activeProjects: projects.filter((p) => p.status === "active" && !p.parent_id).length,
      dueSoon: top.filter((t) => isOpen(t) && t.due_date && t.due_date >= today && t.due_date <= addDays(today, 3)).length,
    };
  }, [tasks, entries, sessions, events, projects, today, from, to]);

  const weekTarget = settings.weeklyFocusTargetHours * 3600;
  const wk = weekTarget > 0 ? weeklyStatus(weekTarget, m.week, today, weekStart) : null;
  const dt = fromDateStr(today);
  const update = (next: WidgetConfig[]) => void attempt(() => setSetting("dashboard", next));
  const move = (i: number, dir: number) => {
    const next = layout.slice();
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    update(next);
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={greeting} subtitle={`${weekdayLong(dt.getDay())} ${dt.getDate()} ${monthName(dt.getMonth())} · ` + (m.remaining ? tr("{0} left for today", tn(m.remaining, "task")) : m.doneToday ? tr("Everything for today is done") : tr("Nothing due today"))}>
        <Button icon={<Plus size={14} />} onClick={() => openQuickAdd({ due_date: today })}>{tr("Task")}</Button>
        <Button icon={<FolderPlus size={14} />} onClick={() => useUi.setState({ projectDialog: { parentId: null } })}>{tr("Project")}</Button>
        <Button icon={<Repeat2 size={14} />} onClick={() => navigate("habits")}>{tr("Habit")}</Button>
        <Button icon={<CalendarDays size={14} />} onClick={() => navigate("calendar")}>{tr("Calendar")}</Button>
        <Button icon={<Timer size={14} />} onClick={() => void attempt(() => startSession({ mode: "stopwatch" })).then((ok) => ok && navigate("focus"))}>{tr("Stopwatch")}</Button>
        <Button icon={<Play size={14} />} onClick={() => navigate("focus")}>{tr("Pomodoro")}</Button>
        <Button variant="primary" icon={<Zap size={14} />} title={tr("Start a Pomodoro right now, without picking a task")} onClick={() => void attempt(() => startSession({ mode: "pomodoro" })).then((ok) => ok && navigate("focus"))}>{tr("Quick focus")}</Button>
        <IconButton label={editing ? tr("Finish customising") : tr("Customise dashboard")} active={editing} onClick={() => setEditing(!editing)}>
          <Settings2 size={15} />
        </IconButton>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-md border border-line bg-surface px-4 py-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-2">{tr("Today")}</div>
            <div className="grid grid-cols-3 gap-x-4 gap-y-3">
              <Stat label={tr("Tasks done")} value={m.doneToday} sub={tr("{0} remaining", m.remaining)} />
              <Stat label={tr("Focus time")} value={fmtDuration(m.focusToday)} sub={m.planned ? tr("{0} planned", fmtDuration(m.planned)) : tr("nothing planned")} />
              <Stat label={tr("Sessions")} value={m.pomodoros} sub={tr("completed")} />
              <Stat label={tr("Scheduled")} value={m.scheduled} sub={tr("tasks on the calendar")} />
              <Stat label={tr("Focus streak")} value={tn(m.streak, "day")} sub={tr("days with tracked focus")} />
            </div>
          </div>
          <div className="rounded-md border border-line bg-surface px-4 py-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-2">{tr("This week")}</div>
            <div className="grid grid-cols-3 gap-x-4 gap-y-3">
              <Stat label={tr("Hours worked")} value={fmtDuration(m.week)} sub={wk ? tr("of {0} target", fmtDuration(weekTarget)) : tr("no weekly target set")} />
              <Stat label={tr("Remaining")} value={wk ? fmtDuration(wk.remainingSeconds) : "—"} sub={wk ? (wk.met ? tr("target reached") : wk.onTrack ? tr("on track") : tr("behind pace")) : <button type="button" className="underline" onClick={() => navigate("settings")}>{tr("set a target")}</button>} />
              <Stat label={tr("Week's tasks")} value={m.weekDue ? `${Math.round((m.weekDone / m.weekDue) * 100)}%` : "—"} sub={tr("{0} of {1} due this week", m.weekDone, m.weekDue)} />
              <Stat label={tr("Active projects")} value={m.activeProjects} />
              <Stat label={tr("Due within 3 days")} value={m.dueSoon} sub={tr("open tasks")} />
            </div>
            {wk && <Progress value={wk.progress} tone={wk.met ? "ok" : wk.onTrack ? "accent" : "warn"} className="mt-3" />}
          </div>
        </div>

        {editing && <div className="mt-4 rounded border border-accent/40 bg-accent/5 px-3 py-2 text-sm text-ink-2">{tr("Customising: reorder, resize or hide widgets. Changes are saved as you make them.")}</div>}
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          {layout.map((w, i) => {
            const def = WIDGETS.find((x) => x.id === w.id);
            if (!def || (!w.visible && !editing)) return null;
            return (
              <Section
                key={w.id}
                title={def.title}
                className={cx(w.wide && "xl:col-span-2", !w.visible && "opacity-50")}
                action={
                  editing ? (
                    <span className="flex">
                      <IconButton label={tr("Move earlier")} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={13} /></IconButton>
                      <IconButton label={tr("Move later")} disabled={i === layout.length - 1} onClick={() => move(i, 1)}><ArrowDown size={13} /></IconButton>
                      <Button size="sm" variant="ghost" onClick={() => update(layout.map((x) => (x.id === w.id ? { ...x, wide: !x.wide } : x)))}>{w.wide ? tr("Half width") : tr("Full width")}</Button>
                      <IconButton label={w.visible ? tr("Hide widget") : tr("Show widget")} onClick={() => update(layout.map((x) => (x.id === w.id ? { ...x, visible: !x.visible } : x)))}>{w.visible ? <Eye size={13} /> : <EyeOff size={13} />}</IconButton>
                    </span>
                  ) : undefined
                }
              >
                {w.visible ? BODY[w.id]?.() : <None>{tr("Hidden")}</None>}
              </Section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const dayStrOf = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
