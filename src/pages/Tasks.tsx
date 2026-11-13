import { hash, tn, tr } from "@/i18n";
import { CalendarRange, Columns3, Filter, Flag, Grid2x2, Inbox as InboxIcon, List, Plus, Save, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { addDays, dateOfMs, diffDays, fmtDate, fromDateStr, weekdayMark } from "@/domain/dates";
import { matchesFilter, quadrant, sortTasks, type FilterContext } from "@/domain/filter";
import { isOverdue, projectSubtree } from "@/domain/projects";
import { PRIORITY_LABEL, STATUS_LABEL, TASK_STATUSES, isOpen, type Task, type TaskFilter, type TaskStatus } from "@/domain/types";
import { attempt } from "@/lib/notify";
import { createTask, deleteSmartView, saveSmartView, updateTask } from "@/store/actions";
import { useData } from "@/store/data";
import { taskSeconds } from "@/store/selectors";
import { confirmDialog, openQuickAdd, openTask, useUi } from "@/store/ui";
import { PriorityFlag, ProjectDot, ProjectOptions, TaskCheck, TaskList, taskMenu } from "@/components/task-bits";
import { Button, ContextMenu, Empty, IconButton, Input, PageHeader, Popover, Segmented, Select, cx } from "@/components/ui";

type Scope = "today" | "upcoming" | "all" | "overdue" | "completed";
type Layout = "list" | "board" | "priority" | "matrix" | "timeline";
const RENDER_CAP = 300;

function useFilterContext(): FilterContext {
  const today = useUi((s) => s.today);
  const taskTags = useData((s) => s.taskTags);
  const entries = useData((s) => s.entries);
  const projects = useData((s) => s.projects);
  return useMemo(() => {
    const cache = new Map<string, Set<string>>();
    return {
      today,
      taskTags,
      actual: taskSeconds(entries),
      subtree: (id: string) => cache.get(id) ?? (cache.set(id, projectSubtree(id, projects)), cache.get(id)!),
    };
  }, [today, taskTags, entries, projects]);
}

function InlineAdd({ defaults, placeholder = tr("Add a task and press Enter") }: { defaults: Parameters<typeof createTask>[0] extends infer T ? Partial<T> : never; placeholder?: string }) {
  const [v, setV] = useState("");
  return (
    <div className="flex items-center gap-2.5 border-b border-line px-3">
      <Plus size={15} className="text-ink-3" />
      <input
        value={v}
        aria-label={tr("Add task")}
        placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && v.trim()) void attempt(() => createTask({ ...defaults, title: v })).then((ok) => ok && setV(""));
        }}
        className="h-9 flex-1 bg-transparent placeholder:text-ink-3"
      />
    </div>
  );
}

function Group({ title, count, tone, children }: { title: string; count: number; tone?: "danger"; children: React.ReactNode }) {
  return (
    <div>
      <div className="sticky top-0 z-10 flex h-7 items-center gap-2 border-b border-line bg-bg px-3 text-xs font-semibold uppercase tracking-wide text-ink-2">
        <span className={tone === "danger" ? "text-danger" : undefined}>{title}</span>
        <span className="tabular font-normal text-ink-3">{count}</span>
      </div>
      {children}
    </div>
  );
}

function Card({ task }: { task: Task }) {
  const project = useData((s) => (task.project_id ? s.projects.find((p) => p.id === task.project_id) : undefined));
  const today = useUi((s) => s.today);
  return (
    <ContextMenu items={() => taskMenu(task)}>
      <div
        role="button"
        tabIndex={0}
        draggable
        onDragStart={(e) => e.dataTransfer.setData("application/x-tempo-task", task.id)}
        onClick={() => openTask(task.id)}
        onKeyDown={(e) => e.key === "Enter" && openTask(task.id)}
        className="rounded border border-line bg-surface px-2.5 py-2 text-sm hover:border-line-strong"
      >
        <div className="flex items-start gap-2">
          <span className="mt-0.5">
            <TaskCheck task={task} size={14} />
          </span>
          <span className={cx("min-w-0 flex-1 leading-[18px]", task.status === "completed" && "text-ink-3 line-through")}>{task.title}</span>
          <PriorityFlag priority={task.priority} className="mt-0.5" />
        </div>
        {(project || task.due_date) && (
          <div className="mt-1.5 flex items-center gap-2 ps-[22px] text-xs text-ink-2">
            {project && (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <ProjectDot project={project} />
                <span className="truncate">{project.name}</span>
              </span>
            )}
            {task.due_date && <span className={cx("ms-auto shrink-0", isOverdue(task, today) && "font-medium text-danger")}>{fmtDate(task.due_date, today)}</span>}
          </div>
        )}
      </div>
    </ContextMenu>
  );
}

function DropColumn({ title, count, onDropTask, children, className }: { title: React.ReactNode; count: number; onDropTask: (id: string) => void; children: React.ReactNode; className?: string }) {
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("application/x-tempo-task")) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const id = e.dataTransfer.getData("application/x-tempo-task");
        if (id) onDropTask(id);
      }}
      className={cx("flex min-h-0 flex-col rounded-md border bg-raised", over ? "border-accent" : "border-line", className)}
    >
      <div className="flex h-8 shrink-0 items-center gap-2 px-2.5 text-xs font-semibold uppercase tracking-wide text-ink-2">
        {title}
        <span className="tabular font-normal text-ink-3">{count}</span>
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-1.5 pb-1.5">{children}</div>
    </div>
  );
}

function Board({ tasks }: { tasks: Task[] }) {
  const cols: TaskStatus[] = ["inbox", "not_started", "planned", "in_progress", "on_hold", "completed"];
  return (
    <div className="flex h-full gap-2.5 overflow-x-auto p-3">
      {cols.map((status) => {
        const list = tasks.filter((t) => t.status === status);
        return (
          <DropColumn key={status} title={STATUS_LABEL[status]} count={list.length} className="w-[250px] shrink-0" onDropTask={(id) => void attempt(() => updateTask(id, { status }))}>
            {list.slice(0, 80).map((t) => (
              <Card key={t.id} task={t} />
            ))}
            {list.length > 80 && <div className="px-1 text-xs text-ink-3">+{list.length - 80}{" "}{tr("more — use filters to narrow down")}</div>}
          </DropColumn>
        );
      })}
    </div>
  );
}

function Matrix({ tasks }: { tasks: Task[] }) {
  const today = useUi((s) => s.today);
  const quads = [
    { title: tr("Urgent and important"), hint: tr("Do first") },
    { title: tr("Important, not urgent"), hint: tr("Schedule") },
    { title: tr("Urgent, not important"), hint: tr("Delegate or keep short") },
    { title: tr("Neither"), hint: tr("Reconsider") },
  ];
  // Dropping into a quadrant adjusts the two inputs the matrix is derived from.
  const move = (id: string, q: number) => {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    const important = q === 0 || q === 1;
    const urgent = q === 0 || q === 2;
    const patch: { priority?: number; due_date?: string | null } = {};
    if (important && t.priority > 2) patch.priority = 2;
    if (!important && t.priority <= 2) patch.priority = 3;
    const isUrgent = !!t.due_date && t.due_date <= addDays(today, 2);
    if (urgent && !isUrgent) patch.due_date = today;
    if (!urgent && isUrgent) patch.due_date = addDays(today, 7);
    if (Object.keys(patch).length) void attempt(() => updateTask(id, patch));
  };
  return (
    <div className="grid h-full grid-cols-2 grid-rows-2 gap-2.5 p-3">
      {quads.map((q, i) => {
        const list = tasks.filter((t) => quadrant(t, today) === i);
        return (
          <DropColumn key={i} count={list.length} onDropTask={(id) => move(id, i)} title={<span>{q.title} <span className="font-normal normal-case tracking-normal text-ink-3">· {q.hint}</span></span>}>
            {list.slice(0, 60).map((t) => (
              <Card key={t.id} task={t} />
            ))}
          </DropColumn>
        );
      })}
    </div>
  );
}

function Timeline({ tasks }: { tasks: Task[] }) {
  const today = useUi((s) => s.today);
  const projects = useData((s) => s.projects);
  const start = addDays(today, -3);
  const days = Array.from({ length: 35 }, (_, i) => addDays(start, i));
  const dated = tasks.filter((t) => t.due_date || t.start_date).slice(0, 200);
  const W = 30;
  if (!dated.length) return <Empty icon={<CalendarRange size={28} />} title={tr("Nothing to place on a timeline")} body={tr("Tasks appear here once they have a start or due date.")} />;
  return (
    <div className="h-full overflow-auto">
      <div style={{ width: 240 + days.length * W }}>
        <div className="sticky top-0 z-10 flex h-9 border-b border-line bg-bg">
          <div className="sticky start-0 z-10 w-[240px] shrink-0 border-e border-line bg-bg" />
          {days.map((d) => {
            const dt = fromDateStr(d);
            return (
              <div key={d} style={{ width: W }} className={cx("shrink-0 border-e border-line text-center text-2xs leading-4", d === today ? "bg-accent/10 font-semibold text-accent" : [0, 6].includes(dt.getDay()) ? "text-ink-3" : "text-ink-2")}>
                <div>{weekdayMark(dt.getDay())}</div>
                <div className="tabular">{dt.getDate()}</div>
              </div>
            );
          })}
        </div>
        {dated.map((t) => {
          const from = t.start_date ?? t.due_date!;
          const to = t.due_date ?? t.start_date!;
          const a = Math.max(0, diffDays(start, from < to ? from : to));
          const b = Math.min(days.length - 1, diffDays(start, to > from ? to : from));
          const visible = b >= 0 && a <= days.length - 1;
          const color = projects.find((p) => p.id === t.project_id)?.color ?? "rgb(var(--ink-3))";
          return (
            <div key={t.id} className="flex h-8 border-b border-line hover:bg-hover/50">
              <button type="button" onClick={() => openTask(t.id)} className="sticky start-0 z-[5] flex w-[240px] shrink-0 items-center gap-2 truncate border-e border-line bg-bg px-3 text-start text-sm">
                <span className="truncate">{t.title}</span>
              </button>
              <div className="relative flex-1">
                <div className="absolute inset-y-0 w-px bg-accent/50" style={{ insetInlineStart: diffDays(start, today) * W + W / 2 }} />
                {visible && (
                  <button type="button" aria-label={tr("{0}: {1} to {2}", t.title, from, to)} onClick={() => openTask(t.id)} className={cx("absolute top-1.5 h-5 rounded-sm", isOverdue(t, today) && "ring-1 ring-danger")} style={{ insetInlineStart: a * W + 2, width: Math.max(W - 4, (b - a + 1) * W - 4), background: color, opacity: t.status === "completed" ? 0.35 : 0.85 }} />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FilterBar({ filter, setFilter, onSave }: { filter: TaskFilter; setFilter: (f: TaskFilter) => void; onSave: (name: string) => void }) {
  const projects = useData((s) => s.projects);
  const categories = useData((s) => s.categories);
  const tags = useData((s) => s.tags);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<TaskFilter>) => {
    const next = { ...filter, ...patch };
    for (const k of Object.keys(next) as Array<keyof TaskFilter>) if (next[k] === "" || next[k] == null) delete next[k];
    setFilter(next);
  };
  const active = Object.keys(filter).filter((k) => k !== "sort").length;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line bg-raised px-3 py-2">
      <Input className="!w-44" placeholder={tr("Filter by text")} aria-label={tr("Filter by text")} value={filter.text ?? ""} onChange={(e) => set({ text: e.target.value })} />
      <Select className="!w-40" aria-label={tr("Project")} value={filter.project_id ?? ""} onChange={(e) => set({ project_id: e.target.value })}>
        <option value="">{tr("Any project")}</option>
        <option value="none">{tr("No project")}</option>
        <ProjectOptions projects={projects} />
      </Select>
      {categories.length > 0 && (
        <Select className="!w-36" aria-label={tr("Category")} value={filter.category_id ?? ""} onChange={(e) => set({ category_id: e.target.value })}>
          <option value="">{tr("Any category")}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
      )}
      {tags.length > 0 && (
        <Select className="!w-32" aria-label={tr("Tag")} value={filter.tag_id ?? ""} onChange={(e) => set({ tag_id: e.target.value })}>
          <option value="">{tr("Any tag")}</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>{hash(t.name)}</option>
          ))}
        </Select>
      )}
      <Select className="!w-36" aria-label={tr("Priority")} value={filter.priority ?? ""} onChange={(e) => set({ priority: e.target.value ? Number(e.target.value) : undefined })}>
        <option value="">{tr("Any priority")}</option>
        {[1, 2, 3, 4, 5].map((p) => (
          <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
        ))}
      </Select>
      <Select className="!w-36" aria-label={tr("Status")} value={filter.status ?? ""} onChange={(e) => set({ status: e.target.value as TaskFilter["status"] })}>
        <option value="">{tr("Any status")}</option>
        <option value="open">{tr("All open")}</option>
        {TASK_STATUSES.map((s) => (
          <option key={s} value={s}>{STATUS_LABEL[s]}</option>
        ))}
      </Select>
      <Select className="!w-36" aria-label={tr("Due")} value={filter.due ?? ""} onChange={(e) => set({ due: e.target.value as TaskFilter["due"] })}>
        <option value="">{tr("Any due date")}</option>
        <option value="overdue">{tr("Overdue")}</option>
        <option value="today">{tr("Due today")}</option>
        <option value="week">{tr("Next 7 days")}</option>
        <option value="none">{tr("No due date")}</option>
      </Select>
      <Select className="!w-36" aria-label={tr("Recurrence")} value={filter.recurring == null ? "" : String(filter.recurring)} onChange={(e) => set({ recurring: e.target.value === "" ? undefined : e.target.value === "true" })}>
        <option value="">{tr("Recurring or not")}</option>
        <option value="true">{tr("Recurring only")}</option>
        <option value="false">{tr("One-off only")}</option>
      </Select>
      <Select className="!w-40" aria-label={tr("Sort")} value={filter.sort ?? ""} onChange={(e) => set({ sort: e.target.value as TaskFilter["sort"] })}>
        <option value="">{tr("Default order")}</option>
        <option value="due">{tr("Sort: due date")}</option>
        <option value="priority">{tr("Sort: priority")}</option>
        <option value="created">{tr("Sort: newest")}</option>
        <option value="estimate">{tr("Sort: estimate")}</option>
        <option value="actual">{tr("Sort: time tracked")}</option>
        <option value="title">{tr("Sort: title")}</option>
      </Select>
      {active > 0 && (
        <>
          <Button size="sm" variant="ghost" icon={<X size={12} />} onClick={() => setFilter({})}>
            {tr("Clear")}
          </Button>
          <Popover
            open={saving}
            onOpenChange={setSaving}
            trigger={
              <Button size="sm" variant="ghost" icon={<Save size={12} />}>
                {tr("Save as view")}
              </Button>
            }
          >
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) (onSave(name), setName(""), setSaving(false));
              }}
            >
              <Input autoFocus placeholder={tr("View name")} value={name} onChange={(e) => setName(e.target.value)} className="!w-44" />
              <Button variant="primary" type="submit">{tr("Save")}</Button>
            </form>
          </Popover>
        </>
      )}
    </div>
  );
}

export function TasksPage() {
  const routeId = useUi((s) => s.routeId);
  const today = useUi((s) => s.today);
  const all = useData((s) => s.tasks);
  const smartViews = useData((s) => s.smartViews);
  const [scope, setScope] = useState<Scope>("today");
  const [layout, setLayout] = useState<Layout>("list");
  const [filter, setFilter] = useState<TaskFilter>({});
  const [showFilter, setShowFilter] = useState(false);
  const [view, setView] = useState<string | null>(null);
  const ctx = useFilterContext();

  // Deep links from search: #/tasks/tag:<id> or #/tasks/category:<id>
  useEffect(() => {
    if (!routeId) return;
    const [kind, id] = routeId.split(":");
    if (kind === "tag" && id) (setFilter({ tag_id: id }), setScope("all"), setShowFilter(true));
    if (kind === "category" && id) (setFilter({ category_id: id }), setScope("all"), setShowFilter(true));
  }, [routeId]);

  const top = useMemo(() => all.filter((t) => !t.parent_id), [all]);
  const scoped = useMemo(() => {
    const filtered = top.filter((t) => matchesFilter(t, filter, ctx));
    // An explicit status filter overrides the scope's notion of open vs. completed.
    const open = filter.status ? filtered : filtered.filter(isOpen);
    switch (scope) {
      case "today":
        return open.filter((t) => t.due_date === today || isOverdue(t, today) || (t.scheduled_at != null && dateOfMs(t.scheduled_at) === today));
      case "upcoming":
        return open.filter((t) => t.due_date && t.due_date > today);
      case "overdue":
        return open.filter((t) => isOverdue(t, today));
      case "completed":
        return filtered.filter((t) => t.status === "completed").sort((a, b) => (b.completed_at ?? 0) - (a.completed_at ?? 0));
      default:
        return open;
    }
  }, [top, filter, ctx, scope, today]);

  const sorted = useMemo(() => (scope === "completed" && !filter.sort ? scoped : sortTasks(scoped, filter.sort ?? (scope === "all" ? "manual" : "due"), ctx)), [scoped, filter.sort, scope, ctx]);
  const boardTasks = useMemo(() => (layout === "board" ? top.filter((t) => matchesFilter(t, filter, ctx) && t.status !== "cancelled" && (t.status !== "completed" || (t.completed_at ?? 0) > Date.now() - 7 * 86_400_000)) : []), [layout, top, filter, ctx]);

  const defaults = scope === "today" ? { due_date: today } : scope === "upcoming" ? { due_date: addDays(today, 1) } : {};

  const list = () => {
    if (!sorted.length) {
      return scope === "today" ? (
        <Empty title={tr("Nothing due today")} body={tr("Add a task above, or pull something in from Upcoming or your Inbox.")} />
      ) : (
        <Empty title={tr("No tasks here")} body={Object.keys(filter).length ? tr("No tasks match the current filters.") : tr("Tasks you add will show up in this view.")} />
      );
    }
    const shown = sorted.slice(0, RENDER_CAP);
    const more = sorted.length > RENDER_CAP && <div className="px-3 py-2 text-xs text-ink-3">{tr("Showing the first")}{" "}{RENDER_CAP}{" "}{tr("of")}{" "}{sorted.length}{" "}{tr("tasks. Use filters to narrow the list.")}</div>;
    if (scope === "today") {
      const overdue = shown.filter((t) => isOverdue(t, today));
      const rest = shown.filter((t) => !isOverdue(t, today));
      return (
        <>
          {overdue.length > 0 && <Group title={tr("Overdue")} tone="danger" count={overdue.length}><TaskList tasks={overdue} draggable /></Group>}
          {rest.length > 0 && <Group title={tr("Today")} count={rest.length}><TaskList tasks={rest} draggable /></Group>}
        </>
      );
    }
    if (scope === "upcoming") {
      const byDate = new Map<string, Task[]>();
      for (const t of shown) byDate.set(t.due_date!, [...(byDate.get(t.due_date!) ?? []), t]);
      return (
        <>
          {[...byDate.entries()].map(([d, ts]) => (
            <Group key={d} title={fmtDate(d, today)} count={ts.length}>
              <TaskList tasks={ts} draggable />
            </Group>
          ))}
          {more}
        </>
      );
    }
    return (
      <>
        <TaskList tasks={shown} draggable />
        {more}
      </>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={tr("My Tasks")} subtitle={tn(sorted.length, "task")}>
        <Segmented
          value={scope}
          onChange={(s) => (setScope(s), setView(null))}
          options={[
            { value: "today", label: tr("Today") },
            { value: "upcoming", label: tr("Upcoming") },
            { value: "all", label: tr("All") },
            { value: "overdue", label: tr("Overdue") },
            { value: "completed", label: tr("Completed") },
          ]}
        />
        <Segmented
          value={layout}
          onChange={setLayout}
          options={[
            { value: "list", label: <List size={14} />, title: tr("List") },
            { value: "board", label: <Columns3 size={14} />, title: tr("Kanban board") },
            { value: "priority", label: <Flag size={14} />, title: tr("By priority") },
            { value: "matrix", label: <Grid2x2 size={14} />, title: tr("Eisenhower matrix") },
            { value: "timeline", label: <CalendarRange size={14} />, title: tr("Timeline") },
          ]}
        />
        <IconButton label={tr("Filters")} active={showFilter} onClick={() => setShowFilter(!showFilter)}>
          <Filter size={14} />
        </IconButton>
        <Button variant="primary" icon={<Plus size={14} />} onClick={() => openQuickAdd(defaults)}>
          {tr("New task")}
        </Button>
      </PageHeader>
      {smartViews.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-1.5">
          <span className="text-xs text-ink-3">{tr("Smart views")}</span>
          {smartViews.map((v) => (
            <ContextMenu key={v.id} items={() => [{ label: tr("Delete view"), danger: true, onSelect: () => void confirmDialog({ title: tr("Delete the view \"{0}\"?", v.name), confirmLabel: tr("Delete"), danger: true }).then((ok) => ok && attempt(() => deleteSmartView(v.id))) }]}>
              <button
                type="button"
                onClick={() => {
                  const on = view === v.id;
                  setView(on ? null : v.id);
                  setFilter(on ? {} : v.filter);
                  if (!on) setScope(v.filter.status === "completed" ? "completed" : "all");
                }}
                className={cx("h-6 rounded border px-2 text-xs", view === v.id ? "border-accent bg-accent/10 text-accent" : "border-line-strong text-ink-2 hover:bg-hover")}
              >
                {v.name}
              </button>
            </ContextMenu>
          ))}
        </div>
      )}
      {showFilter && <FilterBar filter={filter} setFilter={(f) => (setFilter(f), setView(null))} onSave={(name) => void attempt(() => saveSmartView(name, filter))} />}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {layout === "list" && (
          <>
            {scope !== "completed" && scope !== "overdue" && <InlineAdd defaults={defaults} />}
            {list()}
          </>
        )}
        {layout === "board" && <Board tasks={boardTasks} />}
        {layout === "matrix" && <Matrix tasks={sorted} />}
        {layout === "timeline" && <Timeline tasks={sorted} />}
        {layout === "priority" &&
          (sorted.length ? (
            [1, 2, 3, 4, 5].map((p) => {
              const ts = sorted.filter((t) => t.priority === p);
              return ts.length ? (
                <Group key={p} title={PRIORITY_LABEL[p]!} count={ts.length}>
                  <TaskList tasks={ts.slice(0, RENDER_CAP)} />
                </Group>
              ) : null;
            })
          ) : (
            <Empty title={tr("No tasks here")} />
          ))}
      </div>
    </div>
  );
}

export function InboxPage() {
  const tasks = useData((s) => s.tasks);
  const inbox = useMemo(() => tasks.filter((t) => t.status === "inbox" && !t.parent_id).sort((a, b) => b.created_at - a.created_at), [tasks]);
  return (
    <div className="flex h-full flex-col">
      <PageHeader title={tr("Inbox")} subtitle={tr("Capture now, organise later. Give an item a project or a date and it leaves the inbox.")} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <InlineAdd defaults={{ status: "inbox" }} placeholder={tr("Capture a task, idea or reminder and press Enter")} />
        {inbox.length ? <TaskList tasks={inbox} /> : <Empty icon={<InboxIcon size={28} />} title={tr("Inbox zero")} body={tr("Anything you capture without a project or date lands here. Press N anywhere to capture.")} />}
      </div>
    </div>
  );
}
