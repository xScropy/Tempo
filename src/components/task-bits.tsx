import { tr } from "@/i18n";
import { CalendarDays, Clock, CornerDownRight, Flag, Play, Repeat, Trash2 } from "lucide-react";
import { memo } from "react";
import { addDays, fmtDate, fmtDuration, todayStr } from "@/domain/dates";
import { isOverdue } from "@/domain/projects";
import { PRIORITY_LABEL, STATUS_LABEL, TASK_STATUSES, type Project, type Task } from "@/domain/types";
import { attempt } from "@/lib/notify";
import { deleteTask, toggleTask, updateTask } from "@/store/actions";
import { useData } from "@/store/data";
import { byId, isBlocked, subtasksByParent, subtasksOf, taskSeconds } from "@/store/selectors";
import { startSession } from "@/store/timer";
import { confirmDialog, navigate, openTask, useUi } from "@/store/ui";
import { ContextMenu, cx, type MenuItem } from "./ui";

const PRIORITY_TONE: Record<number, string> = { 1: "text-danger", 2: "text-warn", 3: "text-ink-2", 4: "text-ink-3", 5: "text-transparent" };

export function PriorityFlag({ priority, className }: { priority: number; className?: string }) {
  if (priority === 5) return null;
  return (
    <span title={tr("{0} priority", PRIORITY_LABEL[priority])} className={cx("inline-flex", PRIORITY_TONE[priority], className)}>
      <Flag size={12} fill={priority <= 2 ? "currentColor" : "none"} />
    </span>
  );
}

export function TaskCheck({ task, size = 16 }: { task: Task; size?: number }) {
  const done = task.status === "completed";
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={done ? tr("Mark as not done") : tr("Mark as done")}
      onClick={(e) => {
        e.stopPropagation();
        void attempt(() => toggleTask(task));
      }}
      style={{ width: size, height: size }}
      className={cx(
        "flex shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors",
        done ? "border-accent bg-accent text-accent-ink" : task.priority === 1 ? "border-danger hover:bg-danger/10" : task.priority === 2 ? "border-warn hover:bg-warn/10" : "border-ink-3 hover:border-ink hover:bg-hover",
      )}
    >
      {done && (
        <svg className="check-pop" viewBox="0 0 12 12" width={size - 6} height={size - 6} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2.5 6.2l2.4 2.4 4.6-5" />
        </svg>
      )}
    </button>
  );
}

export function ProjectDot({ project, className }: { project: Project | undefined; className?: string }) {
  if (!project) return null;
  return <span className={cx("inline-block h-2 w-2 shrink-0 rounded-sm", className)} style={{ background: project.color }} />;
}

export async function removeTask(task: Task) {
  const ok = await confirmDialog({
    title: tr("Delete \"{0}\"?", task.title),
    body: task.series_id ? tr("Only this occurrence is deleted. The rest of the series is unaffected.") : tr("Its subtasks are deleted too. Tracked time is kept in your reports."),
    confirmLabel: tr("Delete"),
    danger: true,
  });
  if (!ok) return;
  if (useUi.getState().taskId === task.id) openTask(null);
  await attempt(() => deleteTask(task.id));
}

export function taskMenu(task: Task): MenuItem[] {
  const today = todayStr();
  return [
    { label: tr("Start focus session"), icon: <Play size={13} />, onSelect: () => void attempt(() => startSession({ mode: "pomodoro", taskId: task.id })).then((ok) => ok && navigate("focus")) },
    { label: tr("Start stopwatch"), icon: <Clock size={13} />, onSelect: () => void attempt(() => startSession({ mode: "stopwatch", taskId: task.id })).then((ok) => ok && navigate("focus")) },
    "sep",
    {
      label: tr("Status"),
      children: TASK_STATUSES.map((s) => ({ label: STATUS_LABEL[s], checked: task.status === s, onSelect: () => void attempt(() => updateTask(task.id, { status: s })) })),
    },
    {
      label: tr("Priority"),
      icon: <Flag size={13} />,
      children: [1, 2, 3, 4, 5].map((p) => ({ label: PRIORITY_LABEL[p]!, checked: task.priority === p, onSelect: () => void attempt(() => updateTask(task.id, { priority: p })) })),
    },
    {
      label: tr("Due"),
      icon: <CalendarDays size={13} />,
      children: [
        { label: tr("Today"), onSelect: () => void attempt(() => updateTask(task.id, { due_date: today })) },
        { label: tr("Tomorrow"), onSelect: () => void attempt(() => updateTask(task.id, { due_date: addDays(today, 1) })) },
        { label: tr("Next week"), onSelect: () => void attempt(() => updateTask(task.id, { due_date: addDays(today, 7) })) },
        { label: tr("No date"), onSelect: () => void attempt(() => updateTask(task.id, { due_date: null })) },
      ],
    },
    "sep",
    { label: tr("Delete"), icon: <Trash2 size={13} />, danger: true, onSelect: () => void removeTask(task) },
  ];
}

interface RowProps {
  task: Task;
  showProject?: boolean;
  indent?: boolean;
  draggable?: boolean;
}

export const TaskRow = memo(function TaskRow({ task, showProject = true, indent, draggable }: RowProps) {
  const project = useData((s) => (task.project_id ? byId(s.projects).get(task.project_id) : undefined));
  const subs = useData((s) => subtasksOf(s.tasks, task.id));
  const subCount = subs.length;
  const subDone = subs.filter((t) => t.status === "completed").length;
  const actual = useData((s) => taskSeconds(s.entries).get(task.id) ?? 0);
  const blocked = useData((s) => isBlocked(task.id, s.deps, s.tasks));
  const selected = useUi((s) => s.taskId === task.id);
  const today = todayStr();
  const done = task.status === "completed" || task.status === "cancelled";
  const overdue = isOverdue(task, today);

  return (
    <ContextMenu items={() => taskMenu(task)}>
      <div
        role="button"
        tabIndex={0}
        draggable={draggable}
        onDragStart={(e) => {
          e.dataTransfer.setData("application/x-tempo-task", task.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onClick={() => openTask(task.id)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter") openTask(task.id);
          if (e.key === " ") {
            e.preventDefault();
            void attempt(() => toggleTask(task));
          }
        }}
        className={cx("group flex min-h-[36px] items-center gap-2.5 border-b border-line px-3 py-1.5 outline-none transition-colors hover:bg-hover/60 focus-visible:bg-hover", selected && "bg-accent/10 hover:bg-accent/10", indent && "ps-9")}
      >
        {indent && <CornerDownRight size={12} className="rtl:rotate-180 -ms-5 shrink-0 text-ink-3" />}
        <TaskCheck task={task} />
        <div className="min-w-0 flex-1">
          <div className={cx("truncate", done && "text-ink-3 line-through")}>{task.title}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2.5 text-xs text-ink-2">
          {blocked && !done && <span className="text-warn" title={tr("Waiting on another task")}>{tr("Blocked")}</span>}
          {task.status === "in_progress" && <span className="text-accent">{tr("In progress")}</span>}
          {task.status === "on_hold" && <span>{tr("On hold")}</span>}
          {subCount > 0 && <span className="tabular" title={tr("Subtasks done")}>{subDone}/{subCount}</span>}
          {(task.estimated_seconds || actual > 0) && (
            <span className="tabular inline-flex items-center gap-1" title={tr("Tracked / estimated")}>
              <Clock size={11} className="text-ink-3" />
              {actual > 0 ? fmtDuration(actual) : "0m"}
              {task.estimated_seconds ? <span className="text-ink-3">/ {fmtDuration(task.estimated_seconds)}</span> : null}
            </span>
          )}
          {task.series_id && <Repeat size={11} className="text-ink-3" aria-label={tr("Recurring")} />}
          {showProject && project && (
            <span className="inline-flex max-w-[140px] items-center gap-1.5 truncate">
              <ProjectDot project={project} />
              <span className="truncate">{project.name}</span>
            </span>
          )}
          {task.due_date && <span className={cx("tabular", overdue && "font-medium text-danger")}>{fmtDate(task.due_date, today)}</span>}
          <PriorityFlag priority={task.priority} />
        </div>
      </div>
    </ContextMenu>
  );
});

/** Top-level tasks with their subtasks nested underneath. */
export function TaskList({ tasks, showProject, withSubtasks = true, draggable }: { tasks: Task[]; showProject?: boolean; withSubtasks?: boolean; draggable?: boolean }) {
  const children = useData((s) => subtasksByParent(s.tasks));
  return (
    <div>
      {tasks.map((t) => (
        <div key={t.id}>
          <TaskRow task={t} showProject={showProject} draggable={draggable} />
          {withSubtasks && !t.parent_id && (children.get(t.id) ?? []).filter((s) => s.status !== "completed").map((s) => <TaskRow key={s.id} task={s} indent showProject={false} />)}
        </div>
      ))}
    </div>
  );
}

/** <option>s for a project picker, indented by depth. */
export function ProjectOptions({ projects, exclude }: { projects: Project[]; exclude?: Set<string> }) {
  const out: Array<{ p: Project; depth: number }> = [];
  const walk = (parent: string | null, depth: number) => {
    for (const p of projects) {
      if (p.parent_id !== parent || exclude?.has(p.id)) continue;
      out.push({ p, depth });
      walk(p.id, depth + 1);
    }
  };
  walk(null, 0);
  return (
    <>
      {out.map(({ p, depth }) => (
        <option key={p.id} value={p.id}>
          {"  ".repeat(depth) + p.name}
        </option>
      ))}
    </>
  );
}
