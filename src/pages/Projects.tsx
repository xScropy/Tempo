import { LOCALE, tn, tr } from "@/i18n";
import { ArrowLeft, Check, ChevronRight, Folder, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { dateOfMs, diffDays, fmtDate, fmtDuration, fmtHours, startOfWeek, type DateStr } from "@/domain/dates";
import { isOverdue, projectHealth, projectProgress, projectSubtree, type Health } from "@/domain/projects";
import { weeklyStatus } from "@/domain/targets";
import { PRIORITY_LABEL, PROJECT_STATUSES, PROJECT_STATUS_LABEL, isOpen, type Project, type ProjectStatus } from "@/domain/types";
import { attempt } from "@/lib/notify";
import { addMilestone, createTask, deleteMilestone, deleteProject, toggleMilestone, updateProject } from "@/store/actions";
import { useData, type DataState } from "@/store/data";
import { projectSeconds, weekRange } from "@/store/selectors";
import { confirmDialog, navigate, openQuickAdd, useUi } from "@/store/ui";
import { ProjectOptions, TaskList } from "@/components/task-bits";
import { Badge, Button, CommitInput, DurationInput, Empty, Field, IconButton, Input, Markdown, Menu, PageHeader, Progress, Segmented, Select, Stat, cx } from "@/components/ui";

export interface ProjectStats {
  progress: number | null;
  actual: number;
  weekActual: number;
  openTasks: number;
  overdue: number;
  health: Health;
}

/** Everything shown about a project derives from tasks and time entries — nothing is stored redundantly. */
export function projectStats(p: Project, s: Pick<DataState, "projects" | "tasks" | "milestones" | "entries" | "settings">, today: DateStr): ProjectStats {
  const ids = projectSubtree(p.id, s.projects);
  const tasks = s.tasks.filter((t) => t.project_id && ids.has(t.project_id));
  const milestones = s.milestones.filter((m) => ids.has(m.project_id));
  const progress = projectProgress(p.progress_mode, tasks, milestones);
  const week = weekRange(today, s.settings.weekStart);
  const actual = projectSeconds(p.id, s.projects, s.entries);
  const weekActual = projectSeconds(p.id, s.projects, s.entries, week.from, week.to);
  const overdue = tasks.filter((t) => !t.parent_id && isOverdue(t, today)).length;
  const health = projectHealth({
    status: p.status, today, start_date: p.start_date, deadline: p.deadline, progress, overdueTasks: overdue,
    estimatedSeconds: p.estimated_seconds, actualSeconds: actual, weeklyTargetSeconds: p.weekly_target_seconds, weekActualSeconds: weekActual,
    // A project created mid-week is only judged on the days since it existed.
    weekDaysElapsed: diffDays([startOfWeek(today, s.settings.weekStart), dateOfMs(p.created_at)].sort()[1]!, today),
  });
  return { progress, actual, weekActual, openTasks: tasks.filter((t) => !t.parent_id && isOpen(t)).length, overdue, health };
}

const HEALTH: Record<Health["status"], { label: string; tone: "ok" | "warn" | "danger" | "neutral" }> = {
  on_track: { label: tr("On track"), tone: "ok" },
  at_risk: { label: tr("At risk"), tone: "warn" },
  behind: { label: tr("Behind"), tone: "danger" },
  done: { label: tr("Done"), tone: "neutral" },
  no_data: { label: tr("No data"), tone: "neutral" },
};

export function HealthBadge({ health }: { health: Health }) {
  const h = HEALTH[health.status];
  return (
    <span title={health.reasons.join("\n")}>
      <Badge tone={h.tone}>{h.label}</Badge>
    </span>
  );
}

function useStats(p: Project) {
  const today = useUi((s) => s.today);
  const projects = useData((s) => s.projects);
  const tasks = useData((s) => s.tasks);
  const milestones = useData((s) => s.milestones);
  const entries = useData((s) => s.entries);
  const settings = useData((s) => s.settings);
  return useMemo(() => projectStats(p, { projects, tasks, milestones, entries, settings }, today), [p, projects, tasks, milestones, entries, settings, today]);
}

function ProjectRow({ project, depth }: { project: Project; depth: number }) {
  const st = useStats(project);
  const today = useUi((s) => s.today);
  return (
    <button type="button" onClick={() => navigate("projects", project.id)} className="grid w-full grid-cols-[minmax(0,2.2fr)_150px_90px_120px_120px_100px_20px] items-center gap-3 border-b border-line px-4 py-2 text-start text-sm hover:bg-hover/60">
      <span className="flex min-w-0 items-center gap-2" style={{ paddingLeft: depth * 18 }}>
        <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: project.color }} />
        <span className={cx("truncate text-base", depth === 0 && "font-medium", project.status === "completed" && "text-ink-3")}>{project.name}</span>
        {project.status !== "active" && <Badge>{PROJECT_STATUS_LABEL[project.status]}</Badge>}
      </span>
      <span className="flex items-center gap-2">
        <Progress value={st.progress ?? 0} className="flex-1" />
        <span className="tabular w-8 text-end text-xs text-ink-2">{st.progress == null ? "—" : `${Math.round(st.progress * 100)}%`}</span>
      </span>
      <HealthBadge health={st.health} />
      <span className="tabular text-ink-2" title={tr("Tracked / estimated")}>
        {fmtHours(st.actual)}
        {project.estimated_seconds ? <span className="text-ink-3"> / {fmtHours(project.estimated_seconds)}</span> : null}
      </span>
      <span className="tabular text-ink-2" title={tr("This week / weekly target")}>
        {project.weekly_target_seconds ? (
          <>
            {fmtHours(st.weekActual)}
            <span className="text-ink-3"> / {fmtHours(project.weekly_target_seconds)}{" "}{tr("wk")}</span>
          </>
        ) : (
          <span className="text-ink-3">—</span>
        )}
      </span>
      <span className={cx("tabular", project.deadline && project.deadline < today && project.status !== "completed" ? "font-medium text-danger" : "text-ink-2")}>{project.deadline ? fmtDate(project.deadline, today) : "—"}</span>
      <ChevronRight size={14} className="rtl:rotate-180 text-ink-3" />
    </button>
  );
}

function ProjectList() {
  const projects = useData((s) => s.projects);
  const [show, setShow] = useState<"active" | "all">("active");
  const rows = useMemo(() => {
    const out: Array<{ p: Project; depth: number }> = [];
    const walk = (parent: string | null, depth: number) => {
      for (const p of projects) {
        if (p.parent_id !== parent) continue;
        if (show === "active" && depth === 0 && (p.status === "completed" || p.status === "cancelled")) continue;
        out.push({ p, depth });
        walk(p.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [projects, show]);
  return (
    <div className="flex h-full flex-col">
      <PageHeader title={tr("Projects")} subtitle={tr("{0} projects", projects.filter((p) => !p.parent_id).length)}>
        <Segmented value={show} onChange={setShow} options={[{ value: "active", label: tr("Active") }, { value: "all", label: tr("All") }]} />
        <Button variant="primary" icon={<Plus size={14} />} onClick={() => useUi.setState({ projectDialog: { parentId: null } })}>
          {tr("New project")}
        </Button>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <Empty
            icon={<Folder size={28} />}
            title={projects.length ? tr("No active projects") : tr("No projects yet")}
            body={tr("A project groups tasks toward a larger objective, with its own time budget, weekly target, milestones and health.")}
            action={<Button variant="primary" onClick={() => useUi.setState({ projectDialog: { parentId: null } })}>{tr("Create a project")}</Button>}
          />
        ) : (
          <>
            <div className="grid grid-cols-[minmax(0,2.2fr)_150px_90px_120px_120px_100px_20px] gap-3 border-b border-line px-4 py-1.5 text-xs font-medium text-ink-3">
              <span>{tr("Project")}</span>
              <span>{tr("Progress")}</span>
              <span>{tr("Health")}</span>
              <span>{tr("Time")}</span>
              <span>{tr("This week")}</span>
              <span>{tr("Deadline")}</span>
              <span />
            </div>
            {rows.map(({ p, depth }) => (
              <ProjectRow key={p.id} project={p} depth={depth} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function ProjectDetail({ project }: { project: Project }) {
  const today = useUi((s) => s.today);
  const projects = useData((s) => s.projects);
  const allTasks = useData((s) => s.tasks);
  const allMilestones = useData((s) => s.milestones);
  const milestones = useMemo(() => allMilestones.filter((m) => m.project_id === project.id), [allMilestones, project.id]);
  const logs = useData((s) => s.logs);
  const categories = useData((s) => s.categories);
  const weekStart = useData((s) => s.settings.weekStart);
  const st = useStats(project);
  const [tab, setTab] = useState<"tasks" | "milestones" | "notes" | "activity" | "details">("tasks");
  const [showDone, setShowDone] = useState(false);
  const [newTask, setNewTask] = useState("");
  const [ms, setMs] = useState({ title: "", due: "" });
  const [editNotes, setEditNotes] = useState(false);

  const save = (patch: Parameters<typeof updateProject>[1]) => void attempt(() => updateProject(project.id, patch));
  const parent = projects.find((p) => p.id === project.parent_id);
  const subs = projects.filter((p) => p.parent_id === project.id);
  const tasks = allTasks.filter((t) => t.project_id === project.id && !t.parent_id);
  const open = tasks.filter(isOpen);
  const done = tasks.filter((t) => !isOpen(t)).sort((a, b) => (b.completed_at ?? 0) - (a.completed_at ?? 0));
  const myLogs = logs.filter((l) => l.project_id === project.id);
  const week = project.weekly_target_seconds ? weeklyStatus(project.weekly_target_seconds, st.weekActual, today, weekStart) : null;
  const remaining = project.estimated_seconds ? project.estimated_seconds - st.actual : null;
  const subtree = projectSubtree(project.id, projects);

  const remove = async () => {
    const ok = await confirmDialog({
      title: tr("Delete \"{0}\"?", project.name),
      body: (subs.length ? tr("Its {0} will be deleted too.", tn(subs.length, "subproject")) + " " : "") + tr("Tasks and tracked time are kept, but will no longer belong to a project. This cannot be undone."),
      confirmLabel: tr("Delete project"),
      danger: true,
    });
    if (ok && (await attempt(() => deleteProject(project.id)))) navigate("projects", parent?.id);
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <IconButton label={tr("Back")} onClick={() => navigate("projects", parent?.id)}>
              <ArrowLeft className="rtl:rotate-180" size={15} />
            </IconButton>
            <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: project.color }} />
            <span className="truncate">{project.name}</span>
          </span>
        }
        subtitle={parent ? tr("Subproject of {0}", parent.name) : undefined}
      >
        <Select className="!w-32" aria-label={tr("Project status")} value={project.status} onChange={(e) => save({ status: e.target.value as ProjectStatus })}>
          {PROJECT_STATUSES.map((s) => (
            <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>
          ))}
        </Select>
        <Button icon={<Plus size={14} />} onClick={() => openQuickAdd({ project_id: project.id })}>
          {tr("Task")}
        </Button>
        <Menu
          align="end"
          trigger={
            <IconButton label={tr("More")}>
              <MoreHorizontal size={15} />
            </IconButton>
          }
          items={[
            { label: tr("Add subproject"), icon: <Plus size={13} />, onSelect: () => useUi.setState({ projectDialog: { parentId: project.id } }) },
            "sep",
            { label: tr("Delete project"), icon: <Trash2 size={13} />, danger: true, onSelect: () => void remove() },
          ]}
        />
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 border-b border-line px-5 py-4 lg:grid-cols-4">
          <div>
            <Stat label={tr("Progress")} value={st.progress == null ? "—" : `${Math.round(st.progress * 100)}%`} sub={tn(st.openTasks, "open task") + (st.overdue ? ` · ${tr("{0} overdue", st.overdue)}` : "")} />
            <Progress value={st.progress ?? 0} className="mt-2" />
          </div>
          <div>
            <Stat
              label={tr("Time budget")}
              value={<>{fmtDuration(st.actual)}{project.estimated_seconds ? <span className="text-base font-normal text-ink-2">{" "}{tr("of")}{" "}{fmtDuration(project.estimated_seconds)}</span> : null}</>}
              sub={remaining == null ? tr("No estimate set") : remaining >= 0 ? tr("{0} of the estimate remaining", fmtDuration(remaining)) : tr("{0} over the estimate", fmtDuration(-remaining))}
            />
            {project.estimated_seconds ? <Progress value={st.actual / project.estimated_seconds} tone={st.actual > project.estimated_seconds ? "warn" : "accent"} className="mt-2" /> : null}
          </div>
          <div>
            <Stat
              label={tr("This week")}
              value={<>{fmtDuration(st.weekActual)}{week ? <span className="text-base font-normal text-ink-2">{" "}{tr("of")}{" "}{fmtDuration(week.targetSeconds)}</span> : null}</>}
              sub={!week ? tr("No weekly target set") : week.met ? tr("Weekly target reached") : tr("{0} left · {1}", fmtDuration(week.remainingSeconds), week.onTrack ? "on pace" : `needs ${fmtDuration(week.neededPerDaySeconds)}/day`)}
            />
            {week && <Progress value={week.progress} tone={week.met ? "ok" : week.onTrack ? "accent" : "warn"} className="mt-2" />}
          </div>
          <div>
            <div className="text-xs text-ink-2">{tr("Health")}</div>
            <div className="mt-1">
              <HealthBadge health={st.health} />
            </div>
            <ul className="mt-1.5 space-y-0.5 text-xs text-ink-2">
              {st.health.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
              {project.deadline && <li>{tr("Deadline")}{" "}{fmtDate(project.deadline, today).toLowerCase()}</li>}
            </ul>
          </div>
        </div>

        {subs.length > 0 && (
          <div className="border-b border-line">
            <div className="px-5 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-ink-2">{tr("Subprojects")}</div>
            {subs.map((p) => (
              <ProjectRow key={p.id} project={p} depth={0} />
            ))}
          </div>
        )}

        <div className="flex items-center gap-3 px-5 pt-3">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: "tasks", label: tr("Tasks {0}", open.length) },
              { value: "milestones", label: tr("Milestones {0}", milestones.length) },
              { value: "notes", label: tr("Notes") },
              { value: "activity", label: tr("Activity") },
              { value: "details", label: tr("Details") },
            ]}
          />
        </div>

        <div className="px-5 py-3">
          {tab === "tasks" && (
            <div className="rounded-md border border-line bg-surface">
              <div className="flex items-center gap-2.5 border-b border-line px-3">
                <Plus size={15} className="text-ink-3" />
                <input
                  value={newTask}
                  placeholder={tr("Add a task to this project")}
                  aria-label={tr("Add task to project")}
                  onChange={(e) => setNewTask(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && newTask.trim() && void attempt(() => createTask({ title: newTask, project_id: project.id })).then((ok) => ok && setNewTask(""))}
                  className="h-9 flex-1 bg-transparent placeholder:text-ink-3"
                />
              </div>
              {open.length === 0 && done.length === 0 && <Empty title={tr("No tasks yet")} body={tr("Break the project down into tasks. Their completion and tracked time roll up into the project.")} />}
              <TaskList tasks={open} showProject={false} />
              {done.length > 0 && (
                <>
                  <button type="button" className="flex h-8 w-full items-center gap-1.5 px-3 text-xs text-ink-2 hover:bg-hover/60" onClick={() => setShowDone(!showDone)}>
                    <ChevronRight size={12} className={cx("rtl:rotate-180 transition-transform", showDone && "rotate-90")} />
                    {done.length}{" "}{tr("completed or cancelled")}
                  </button>
                  {showDone && <TaskList tasks={done.slice(0, 200)} showProject={false} />}
                </>
              )}
            </div>
          )}

          {tab === "milestones" && (
            <div className="rounded-md border border-line bg-surface">
              {milestones.length === 0 && <div className="px-3 py-4 text-sm text-ink-2">{tr("Milestones mark the checkpoints of a project. Switch progress to \"Milestones\" under Details to measure progress by them.")}</div>}
              {milestones.map((m) => (
                <div key={m.id} className="group flex items-center gap-2.5 border-b border-line px-3 py-2">
                  <button type="button" role="checkbox" aria-checked={!!m.completed_at} aria-label={tr("Toggle milestone {0}", m.title)} onClick={() => void attempt(() => toggleMilestone(m.id))} className={cx("flex h-4 w-4 items-center justify-center rounded-sm border-[1.5px]", m.completed_at ? "border-accent bg-accent text-accent-ink" : "border-ink-3 hover:border-ink")}>
                    {m.completed_at && <Check size={11} strokeWidth={3} />}
                  </button>
                  <span className={cx("flex-1", m.completed_at && "text-ink-3 line-through")}>{m.title}</span>
                  {m.due_date && <span className={cx("tabular text-xs", !m.completed_at && m.due_date < today ? "font-medium text-danger" : "text-ink-2")}>{fmtDate(m.due_date, today)}</span>}
                  <IconButton label={tr("Delete milestone")} className="opacity-0 focus:opacity-100 group-hover:opacity-100" onClick={() => void attempt(() => deleteMilestone(m.id))}>
                    <Trash2 size={13} />
                  </IconButton>
                </div>
              ))}
              <form
                className="flex items-center gap-2 px-3 py-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void attempt(() => addMilestone(project.id, ms.title, ms.due || null)).then((ok) => ok && setMs({ title: "", due: "" }));
                }}
              >
                <Input placeholder={tr("New milestone")} aria-label={tr("Milestone title")} value={ms.title} onChange={(e) => setMs({ ...ms, title: e.target.value })} />
                <Input type="date" aria-label={tr("Milestone due date")} className="!w-40" value={ms.due} onChange={(e) => setMs({ ...ms, due: e.target.value })} />
                <Button type="submit" disabled={!ms.title.trim()}>{tr("Add")}</Button>
              </form>
            </div>
          )}

          {tab === "notes" &&
            (editNotes || !project.notes ? (
              <CommitInput multiline rows={14} value={project.notes} placeholder={tr("Project notes — Markdown supported.")} className="font-mono text-sm" onCommit={(v) => (save({ notes: v }), setEditNotes(false))} />
            ) : (
              <div className="rounded-md border border-line bg-surface px-4 py-3">
                <Markdown source={project.notes} />
                <Button size="sm" className="mt-3" onClick={() => setEditNotes(true)}>{tr("Edit notes")}</Button>
              </div>
            ))}

          {tab === "activity" && (
            <div className="rounded-md border border-line bg-surface">
              {myLogs.length === 0 && <div className="px-3 py-4 text-sm text-ink-2">{tr("No activity recorded yet.")}</div>}
              {myLogs.slice(0, 200).map((l) => (
                <div key={l.id} className="flex gap-3 border-b border-line px-3 py-1.5 text-sm last:border-0">
                  <span className="tabular w-32 shrink-0 text-ink-3">{new Date(l.created_at).toLocaleString(LOCALE, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  <span>{l.message}</span>
                </div>
              ))}
            </div>
          )}

          {tab === "details" && (
            <div className="grid max-w-2xl grid-cols-2 gap-3">
              <Field label={tr("Name")} className="col-span-2">
                <CommitInput value={project.name} onCommit={(v) => v.trim() && save({ name: v })} />
              </Field>
              <Field label={tr("Description")} className="col-span-2">
                <CommitInput multiline value={project.description} onCommit={(v) => save({ description: v })} />
              </Field>
              <Field label={tr("Parent project")}>
                <Select value={project.parent_id ?? ""} onChange={(e) => save({ parent_id: e.target.value || null })}>
                  <option value="">{tr("None (top level)")}</option>
                  <ProjectOptions projects={projects} exclude={subtree} />
                </Select>
              </Field>
              <Field label={tr("Category")}>
                <Select value={project.category_id ?? ""} onChange={(e) => save({ category_id: e.target.value || null })}>
                  <option value="">{tr("None")}</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label={tr("Priority")}>
                <Select value={project.priority} onChange={(e) => save({ priority: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5].map((p) => (
                    <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
                  ))}
                </Select>
              </Field>
              <Field label={tr("Progress measured by")}>
                <Select value={project.progress_mode} onChange={(e) => save({ progress_mode: e.target.value as Project["progress_mode"] })}>
                  <option value="tasks">{tr("Completed tasks")}</option>
                  <option value="weighted">{tr("Tasks weighted by estimate")}</option>
                  <option value="milestones">{tr("Milestones")}</option>
                </Select>
              </Field>
              <Field label={tr("Start date")}>
                <Input type="date" value={project.start_date ?? ""} onChange={(e) => save({ start_date: e.target.value || null })} />
              </Field>
              <Field label={tr("Deadline")}>
                <Input type="date" value={project.deadline ?? ""} onChange={(e) => save({ deadline: e.target.value || null })} />
              </Field>
              <Field label={tr("Estimated total time")}>
                <DurationInput value={project.estimated_seconds} onChange={(v) => save({ estimated_seconds: v })} placeholder="e.g. 100h" />
              </Field>
              <Field label={tr("Weekly time target")}>
                <DurationInput value={project.weekly_target_seconds} onChange={(v) => save({ weekly_target_seconds: v })} placeholder="e.g. 12h" />
              </Field>
              <Field label={tr("Preferred daily time")}>
                <DurationInput value={project.daily_target_seconds} onChange={(v) => save({ daily_target_seconds: v })} placeholder="e.g. 2h" />
              </Field>
              <Field label={tr("Color")}>
                <Input type="color" value={project.color} onChange={(e) => save({ color: e.target.value })} className="!w-16 !p-1" />
              </Field>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ProjectsPage() {
  const routeId = useUi((s) => s.routeId);
  const project = useData((s) => (routeId ? s.projects.find((p) => p.id === routeId) : undefined));
  return project ? <ProjectDetail key={project.id} project={project} /> : <ProjectList />;
}
