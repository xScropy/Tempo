import { tn, tr } from "@/i18n";
import { MoreHorizontal, Play, Plus, Target } from "lucide-react";
import { useMemo, useState } from "react";
import { fmtDate, fmtDuration } from "@/domain/dates";
import { weeklyStatus } from "@/domain/targets";
import type { Goal, TimeTarget } from "@/domain/types";
import { attempt } from "@/lib/notify";
import { archiveTarget, deleteGoal, saveGoal, saveTarget, setGoalProgress } from "@/store/actions";
import { useData } from "@/store/data";
import { goalProgress, projectSeconds, targetSeconds, weekRange } from "@/store/selectors";
import { startSession } from "@/store/timer";
import { confirmDialog, navigate, useUi } from "@/store/ui";
import { ProjectOptions } from "@/components/task-bits";
import { Badge, Button, Dialog, DurationInput, Empty, Field, IconButton, Input, Menu, PageHeader, Progress, Section, Select } from "@/components/ui";

function TargetDialog({ target, onClose }: { target?: TimeTarget; onClose: () => void }) {
  const categories = useData((s) => s.categories);
  const [f, setF] = useState({ name: target?.name ?? "", category_id: target?.category_id ?? "", weekly: target?.weekly_seconds ?? null, days: target?.preferred_days ?? null, min: target?.min_session_seconds ?? null, max: target?.max_session_seconds ?? null });
  const save = async () => {
    if (await attempt(() => saveTarget({ id: target?.id, name: f.name, category_id: f.category_id || null, weekly_seconds: f.weekly ?? 0, preferred_days: f.days, min_session_seconds: f.min, max_session_seconds: f.max }))) onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={target ? tr("Edit weekly target") : tr("New weekly time target")}
      footer={
        <>
          <Button onClick={onClose}>{tr("Cancel")}</Button>
          <Button variant="primary" disabled={!f.name.trim() || !f.weekly} onClick={() => void save()}>
            {tr("Save")}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-ink-2">{tr("An activity you want to give a certain amount of time each week, without fixing when. Any focus session or time entry assigned to it counts.")}</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label={tr("Activity")} className="col-span-2">
          <Input autoFocus value={f.name} placeholder={tr("English learning")} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label={tr("Weekly target")}>
          <DurationInput value={f.weekly} onChange={(v) => setF({ ...f, weekly: v })} placeholder="e.g. 5h" />
        </Field>
        <Field label={tr("Preferred sessions per week")}>
          <Input type="number" min={1} max={7} value={f.days ?? ""} placeholder={tr("Flexible")} onChange={(e) => setF({ ...f, days: e.target.value ? Math.min(7, Math.max(1, Number(e.target.value))) : null })} />
        </Field>
        <Field label={tr("Minimum session")}>
          <DurationInput value={f.min} onChange={(v) => setF({ ...f, min: v })} placeholder="e.g. 1h" />
        </Field>
        <Field label={tr("Maximum session")}>
          <DurationInput value={f.max} onChange={(v) => setF({ ...f, max: v })} placeholder="e.g. 3h" />
        </Field>
        <Field label={tr("Category")} className="col-span-2">
          <Select value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}>
            <option value="">{tr("None")}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}

const METRIC_LABEL: Record<Goal["metric"], string> = { focus_time: tr("Focus time (hours)"), tasks_completed: tr("Tasks completed"), sessions: tr("Completed focus sessions"), manual: tr("Updated by hand") };
const PERIOD_LABEL: Record<Goal["period"], string> = { daily: tr("Every day"), weekly: tr("Every week"), monthly: tr("Every month"), yearly: tr("Every year"), custom: tr("Fixed date range") };

function GoalDialog({ goal, onClose }: { goal?: Goal; onClose: () => void }) {
  const projects = useData((s) => s.projects);
  const categories = useData((s) => s.categories);
  const [f, setF] = useState({ title: goal?.title ?? "", period: goal?.period ?? ("weekly" as Goal["period"]), metric: goal?.metric ?? ("focus_time" as Goal["metric"]), target_value: goal?.target_value ?? 10, project_id: goal?.project_id ?? "", category_id: goal?.category_id ?? "", start_date: goal?.start_date ?? "", end_date: goal?.end_date ?? "" });
  const save = async () => {
    if (await attempt(() => saveGoal({ id: goal?.id, ...f, target_value: Number(f.target_value), project_id: f.project_id || null, category_id: f.category_id || null, start_date: f.start_date || null, end_date: f.end_date || null }))) onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={goal ? tr("Edit goal") : tr("New goal")}
      footer={
        <>
          <Button onClick={onClose}>{tr("Cancel")}</Button>
          <Button variant="primary" disabled={!f.title.trim()} onClick={() => void save()}>
            {tr("Save")}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={tr("Goal")} className="col-span-2">
          <Input autoFocus value={f.title} placeholder={tr("Complete 20 hours of legal research this month")} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </Field>
        <Field label={tr("Measured by")}>
          <Select value={f.metric} onChange={(e) => setF({ ...f, metric: e.target.value as Goal["metric"] })}>
            {(Object.keys(METRIC_LABEL) as Goal["metric"][]).map((m) => (
              <option key={m} value={m}>{METRIC_LABEL[m]}</option>
            ))}
          </Select>
        </Field>
        <Field label={tr("Target")}>
          <Input type="number" min={0} step="any" value={f.target_value} onChange={(e) => setF({ ...f, target_value: Number(e.target.value) })} />
        </Field>
        <Field label={tr("Period")} className="col-span-2">
          <Select value={f.period} onChange={(e) => setF({ ...f, period: e.target.value as Goal["period"] })}>
            {(Object.keys(PERIOD_LABEL) as Goal["period"][]).map((p) => (
              <option key={p} value={p}>{PERIOD_LABEL[p]}</option>
            ))}
          </Select>
        </Field>
        {f.period === "custom" && (
          <>
            <Field label={tr("From")}>
              <Input type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} />
            </Field>
            <Field label={tr("Until (deadline)")}>
              <Input type="date" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} />
            </Field>
          </>
        )}
        {f.metric !== "manual" && (
          <>
            <Field label={tr("Only count this project")}>
              <Select value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value })}>
                <option value="">{tr("All work")}</option>
                <ProjectOptions projects={projects} />
              </Select>
            </Field>
            <Field label={tr("Only count this category")}>
              <Select value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}>
                <option value="">{tr("Any")}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </Field>
          </>
        )}
      </div>
    </Dialog>
  );
}

export function WeeklyBar({ name, target, actual, sub, action }: { name: string; target: number; actual: number; sub?: string; action?: React.ReactNode }) {
  const today = useUi((s) => s.today);
  const weekStart = useData((s) => s.settings.weekStart);
  const st = weeklyStatus(target, actual, today, weekStart);
  return (
    <div className="flex items-center gap-4 border-b border-line px-3 py-2.5 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{name}</span>
          {st.met ? <Badge tone="ok">{tr("Reached")}</Badge> : st.onTrack ? <Badge tone="accent">{tr("On track")}</Badge> : <Badge tone="warn">{tr("Behind pace")}</Badge>}
        </div>
        <Progress value={st.progress} tone={st.met ? "ok" : st.onTrack ? "accent" : "warn"} className="mt-1.5" />
        <div className="tabular mt-1 text-xs text-ink-2">
          {fmtDuration(actual)}{" "}{tr("of")}{" "}{fmtDuration(target)}
          {!st.met && ` · ${tr("{0} left · {1}/day over {2}", fmtDuration(st.remainingSeconds), fmtDuration(st.neededPerDaySeconds), tn(st.daysLeft, "day"))}`}
          {tr(" · avg {0}/day", fmtDuration(st.averagePerDaySeconds))}
          {sub ? ` · ${sub}` : ""}
        </div>
      </div>
      {action}
    </div>
  );
}

export function GoalsPage() {
  const today = useUi((s) => s.today);
  const targets = useData((s) => s.targets);
  const goals = useData((s) => s.goals);
  const projects = useData((s) => s.projects);
  const entries = useData((s) => s.entries);
  const tasks = useData((s) => s.tasks);
  const sessions = useData((s) => s.sessions);
  const weekStart = useData((s) => s.settings.weekStart);
  const [targetDlg, setTargetDlg] = useState<TimeTarget | "new" | null>(null);
  const [goalDlg, setGoalDlg] = useState<Goal | "new" | null>(null);
  const week = useMemo(() => weekRange(today, weekStart), [today, weekStart]);
  const active = targets.filter((t) => !t.archived_at);
  const projectTargets = projects.filter((p) => p.weekly_target_seconds && p.status !== "completed" && p.status !== "cancelled");
  const ctx = { tasks, entries, sessions, projects, weekStart };

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={tr("Goals")} subtitle={tr("Weekly time targets and goals, measured from what you actually tracked.")}>
        <Button icon={<Plus size={14} />} onClick={() => setTargetDlg("new")}>
          {tr("Weekly target")}
        </Button>
        <Button variant="primary" icon={<Plus size={14} />} onClick={() => setGoalDlg("new")}>
          {tr("Goal")}
        </Button>
      </PageHeader>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <Section title={tr("Weekly time targets · week of {0}", fmtDate(week.start, ""))}>
          {active.length === 0 && projectTargets.length === 0 && (
            <Empty icon={<Target size={26} />} title={tr("No weekly targets")} body={tr("Set a number of hours per week for an activity (\"International Law: 10h\") without fixing a schedule. Projects can have a weekly target too.")} action={<Button onClick={() => setTargetDlg("new")}>{tr("Add a weekly target")}</Button>} />
          )}
          {active.map((t) => (
            <WeeklyBar
              key={t.id}
              name={t.name}
              target={t.weekly_seconds}
              actual={targetSeconds(t.id, entries, week.from, week.to)}
              sub={[t.preferred_days ? `${t.preferred_days} sessions/week` : null, t.min_session_seconds || t.max_session_seconds ? `sessions ${t.min_session_seconds ? fmtDuration(t.min_session_seconds) : "any"}–${t.max_session_seconds ? fmtDuration(t.max_session_seconds) : "any"}` : null].filter(Boolean).join(" · ")}
              action={
                <div className="flex items-center gap-1">
                  <Button size="sm" icon={<Play size={12} />} onClick={() => void attempt(() => startSession({ mode: "stopwatch", targetId: t.id })).then((ok) => ok && navigate("focus"))}>
                    {tr("Start")}
                  </Button>
                  <Menu
                    align="end"
                    trigger={
                      <IconButton label={tr("Options for {0}", t.name)}>
                        <MoreHorizontal size={15} />
                      </IconButton>
                    }
                    items={[
                      { label: tr("Edit"), onSelect: () => setTargetDlg(t) },
                      { label: tr("Archive"), danger: true, onSelect: () => void confirmDialog({ title: tr("Archive \"{0}\"?", t.name), body: tr("Time already tracked stays in your reports."), confirmLabel: tr("Archive") }).then((ok) => ok && attempt(() => archiveTarget(t.id))) },
                    ]}
                  />
                </div>
              }
            />
          ))}
          {projectTargets.map((p) => (
            <WeeklyBar key={p.id} name={p.name} target={p.weekly_target_seconds!} actual={projectSeconds(p.id, projects, entries, week.from, week.to)} sub={tr("project")} action={<Button size="sm" variant="ghost" onClick={() => navigate("projects", p.id)}>{tr("Open")}</Button>} />
          ))}
        </Section>

        <Section title={tr("Goals")}>
          {goals.length === 0 && <Empty title={tr("No goals yet")} body={tr("Goals can count focus hours, completed tasks or completed sessions over a day, week, month, year or a fixed range — optionally limited to one project.")} action={<Button onClick={() => setGoalDlg("new")}>{tr("Add a goal")}</Button>} />}
          {goals.map((g) => {
            const p = goalProgress(g, ctx, today);
            const fmt = (n: number) => (p.unit === "h" ? `${Math.round(n * 10) / 10}h` : `${Math.round(n * 100) / 100}${p.unit ? ` ${p.unit}` : ""}`);
            return (
              <div key={g.id} className="flex items-center gap-4 border-b border-line px-3 py-2.5 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{g.title}</span>
                    {p.fraction >= 1 && <Badge tone="ok">{tr("Achieved")}</Badge>}
                  </div>
                  <Progress value={p.fraction} tone={p.fraction >= 1 ? "ok" : "accent"} className="mt-1.5" />
                  <div className="tabular mt-1 text-xs text-ink-2">
                    {fmt(p.current)}{" "}{tr("of")}{" "}{fmt(p.target)} · {PERIOD_LABEL[g.period].toLowerCase()} ({fmtDate(p.start, today)} – {fmtDate(p.end, today)})
                    {g.project_id ? ` · ${projects.find((x) => x.id === g.project_id)?.name ?? ""}` : ""}
                  </div>
                </div>
                {g.metric === "manual" && (
                  <div className="flex items-center gap-1">
                    <Button size="sm" onClick={() => void attempt(() => setGoalProgress(g.id, g.manual_value - 1))}>−</Button>
                    <Button size="sm" onClick={() => void attempt(() => setGoalProgress(g.id, g.manual_value + 1))}>+1</Button>
                  </div>
                )}
                <Menu
                  align="end"
                  trigger={
                    <IconButton label={tr("Options for {0}", g.title)}>
                      <MoreHorizontal size={15} />
                    </IconButton>
                  }
                  items={[
                    { label: tr("Edit"), onSelect: () => setGoalDlg(g) },
                    { label: tr("Delete"), danger: true, onSelect: () => void confirmDialog({ title: tr("Delete the goal \"{0}\"?", g.title), confirmLabel: tr("Delete"), danger: true }).then((ok) => ok && attempt(() => deleteGoal(g.id))) },
                  ]}
                />
              </div>
            );
          })}
        </Section>
      </div>
      {targetDlg && <TargetDialog target={targetDlg === "new" ? undefined : targetDlg} onClose={() => setTargetDlg(null)} />}
      {goalDlg && <GoalDialog goal={goalDlg === "new" ? undefined : goalDlg} onClose={() => setGoalDlg(null)} />}
    </div>
  );
}
