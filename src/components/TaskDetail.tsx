import { hash, tr } from "@/i18n";
import { ArrowUpRight, Clock, Link2, Play, Plus, Repeat, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { atTime, dateOfMs, fmtDate, fmtDuration, timeOf, todayStr } from "@/domain/dates";
import { describeRule } from "@/domain/recurrence";
import { PRIORITY_LABEL, STATUS_LABEL, TASK_STATUSES, type Task, type TaskStatus } from "@/domain/types";
import { attempt } from "@/lib/notify";
import { createTask, ensureTag, setDependency, setTaskTags, updateTask } from "@/store/actions";
import { useData } from "@/store/data";
import { sessionSeconds, subtasksOf, taskTotalSeconds } from "@/store/selectors";
import { startSession } from "@/store/timer";
import { navigate, openTask } from "@/store/ui";
import { RecurrenceDialog } from "./RecurrenceDialog";
import { ProjectOptions, TaskCheck, TaskRow, removeTask } from "./task-bits";
import { Badge, Button, CommitInput, DurationInput, Field, IconButton, Input, Markdown, Select, Segmented, cx } from "./ui";

function toLocalInput(ms: number | null): string {
  return ms == null ? "" : `${dateOfMs(ms)}T${timeOf(ms)}`;
}
const fromLocalInput = (v: string): number | null => (v ? atTime(v.slice(0, 10), v.slice(11, 16)) : null);

export function TaskDetail({ taskId }: { taskId: string }) {
  const task = useData((s) => s.tasks.find((t) => t.id === taskId));
  useEffect(() => {
    if (!task) openTask(null);
  }, [task]);
  if (!task) return null;
  return <Panel key={task.id} task={task} />;
}

function Panel({ task }: { task: Task }) {
  const projects = useData((s) => s.projects);
  const categories = useData((s) => s.categories);
  const tags = useData((s) => s.tags);
  const tagIds = useData((s) => s.taskTags[task.id]) ?? [];
  const subtasks = useData((s) => subtasksOf(s.tasks, task.id));
  const parent = useData((s) => (task.parent_id ? s.tasks.find((t) => t.id === task.parent_id) : undefined));
  const deps = useData((s) => s.deps);
  const allTasks = useData((s) => s.tasks);
  const entries = useData((s) => s.entries);
  const sessions = useData((s) => s.sessions);
  const series = useData((s) => (task.series_id ? s.series.find((x) => x.id === task.series_id) : undefined));
  const rule = useData((s) => (series ? s.rules.find((r) => r.id === series.rule_id) : undefined));
  const [notesMode, setNotesMode] = useState<"edit" | "preview">(task.notes ? "preview" : "edit");
  const [recur, setRecur] = useState(false);
  const [newSub, setNewSub] = useState("");
  const [newTag, setNewTag] = useState("");
  const [newLink, setNewLink] = useState("");
  const [depPick, setDepPick] = useState("");

  const save = (patch: Parameters<typeof updateTask>[1]) => void attempt(() => updateTask(task.id, patch));
  const actual = taskTotalSeconds(task, allTasks, entries);
  const myDeps = deps.filter((d) => d.task_id === task.id).map((d) => allTasks.find((t) => t.id === d.depends_on_id)).filter((t): t is Task => !!t);
  const taskSessions = sessions.filter((s) => s.task_id === task.id).slice(0, 8);
  const today = todayStr();
  const variance = task.estimated_seconds && actual ? actual - task.estimated_seconds : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-3">
        <TaskCheck task={task} size={18} />
        <div className="min-w-0 flex-1 truncate text-xs text-ink-2">
          {parent ? (
            <button type="button" className="hover:text-ink hover:underline" onClick={() => openTask(parent.id)}>
              ↑ {parent.title}
            </button>
          ) : (
            STATUS_LABEL[task.status]
          )}
        </div>
        <Button size="sm" icon={<Play size={12} />} onClick={() => void attempt(() => startSession({ mode: "pomodoro", taskId: task.id })).then((ok) => ok && navigate("focus"))}>
          {tr("Focus")}
        </Button>
        <IconButton label={tr("Delete task")} onClick={() => void removeTask(task)}>
          <Trash2 size={14} />
        </IconButton>
        <IconButton label={tr("Close panel")} onClick={() => openTask(null)}>
          <X size={15} />
        </IconButton>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
        <CommitInput
          aria-label={tr("Task title")}
          value={task.title}
          onCommit={(v) => v.trim() && save({ title: v })}
          className={cx("!h-auto border-transparent !px-0 text-lg font-semibold hover:border-line focus:!px-2", task.status === "completed" && "text-ink-2")}
        />

        <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
          <Field label={tr("Status")}>
            <Select value={task.status} onChange={(e) => save({ status: e.target.value as TaskStatus })}>
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tr("Priority")}>
            <Select value={task.priority} onChange={(e) => save({ priority: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5].map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </Select>
          </Field>
          {!task.parent_id && (
            <Field label={tr("Project")}>
              <Select value={task.project_id ?? ""} onChange={(e) => save({ project_id: e.target.value || null })}>
                <option value="">{tr("No project")}</option>
                <ProjectOptions projects={projects} />
              </Select>
            </Field>
          )}
          <Field label={tr("Category")}>
            <Select value={task.category_id ?? ""} onChange={(e) => save({ category_id: e.target.value || null })}>
              <option value="">{tr("None")}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tr("Start date")}>
            <Input type="date" value={task.start_date ?? ""} onChange={(e) => save({ start_date: e.target.value || null })} />
          </Field>
          <Field label={tr("Due date")}>
            <Input type="date" value={task.due_date ?? ""} onChange={(e) => save({ due_date: e.target.value || null })} />
          </Field>
          <Field label={tr("Scheduled")}>
            <Input
              type="datetime-local"
              value={toLocalInput(task.scheduled_at)}
              onChange={(e) => {
                const at = fromLocalInput(e.target.value);
                save({ scheduled_at: at, scheduled_minutes: at ? (task.scheduled_minutes ?? Math.max(15, Math.round((task.estimated_seconds ?? 1800) / 60))) : null });
              }}
            />
          </Field>
          <Field label={tr("Block length")}>
            <DurationInput aria-label={tr("Scheduled block length")} value={task.scheduled_minutes ? task.scheduled_minutes * 60 : null} placeholder={task.scheduled_at ? "30m" : "—"} onChange={(v) => task.scheduled_at && save({ scheduled_minutes: v ? Math.max(5, Math.round(v / 60)) : 30 })} />
          </Field>
          <Field label={tr("Estimate")}>
            <DurationInput value={task.estimated_seconds} onChange={(v) => save({ estimated_seconds: v })} />
          </Field>
          <Field label={tr("Reminder")}>
            <Input type="datetime-local" value={toLocalInput(task.reminder_at)} onChange={(e) => save({ reminder_at: fromLocalInput(e.target.value) })} />
          </Field>
        </div>

        <div className="flex items-center gap-4 rounded border border-line bg-raised px-3 py-2 text-sm">
          <Clock size={14} className="text-ink-3" />
          <div>
            <span className="tabular font-medium">{fmtDuration(actual)}</span> <span className="text-ink-2">{tr("tracked")}</span>
            {task.estimated_seconds ? <span className="text-ink-2">{" "}{tr("of")}{" "}{fmtDuration(task.estimated_seconds)}{" "}{tr("estimated")}</span> : null}
          </div>
          {variance != null && <Badge tone={variance > 0 ? "warn" : "ok"}>{variance > 0 ? tr("{0} over", fmtDuration(variance)) : tr("{0} under", fmtDuration(-variance))}</Badge>}
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-ink-2">{tr("Repeat")}</span>
            {!task.parent_id && (
              <Button size="sm" variant="ghost" icon={<Repeat size={12} />} onClick={() => setRecur(true)}>
                {series ? tr("Edit series") : tr("Make recurring")}
              </Button>
            )}
          </div>
          {series && rule ? (
            <div className="text-sm text-ink-2">
              {describeRule(rule)}
              {task.is_detached ? tr(" · this occurrence was edited on its own") : ""}
            </div>
          ) : (
            <div className="text-sm text-ink-3">{tr("Does not repeat")}</div>
          )}
        </div>

        <div>
          <div className="mb-1 text-xs font-medium text-ink-2">{tr("Tags")}</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {tagIds.map((id) => {
              const tag = tags.find((t) => t.id === id);
              return tag ? (
                <Badge key={id}>
                  {hash(tag.name)}
                  <button type="button" aria-label={tr("Remove tag {0}", tag.name)} onClick={() => void attempt(() => setTaskTags(task.id, tagIds.filter((x) => x !== id)))} className="hover:text-ink">
                    <X size={10} />
                  </button>
                </Badge>
              ) : null;
            })}
            <input
              list="tempo-tags"
              value={newTag}
              placeholder={tr("Add tag…")}
              aria-label={tr("Add tag")}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || !newTag.trim()) return;
                void attempt(async () => {
                  const id = await ensureTag(newTag);
                  if (!tagIds.includes(id)) await setTaskTags(task.id, [...tagIds, id]);
                  setNewTag("");
                });
              }}
              className="h-6 w-24 rounded border border-transparent bg-transparent px-1 text-sm placeholder:text-ink-3 hover:border-line focus:border-accent"
            />
            <datalist id="tempo-tags">
              {tags.map((t) => (
                <option key={t.id} value={t.name} />
              ))}
            </datalist>
          </div>
        </div>

        {!task.parent_id && (
          <div>
            <div className="mb-1 text-xs font-medium text-ink-2">
              {tr("Subtasks")}{" "}{subtasks.length > 0 && <span className="tabular text-ink-3">· {subtasks.filter((s) => s.status === "completed").length}/{subtasks.length}</span>}
            </div>
            <div className="rounded border border-line">
              {subtasks.map((s) => (
                <TaskRow key={s.id} task={s} showProject={false} />
              ))}
              <div className="flex items-center gap-2 px-3">
                <Plus size={14} className="text-ink-3" />
                <input
                  value={newSub}
                  placeholder={tr("Add subtask")}
                  aria-label={tr("Add subtask")}
                  onChange={(e) => setNewSub(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newSub.trim()) void attempt(() => createTask({ title: newSub, parent_id: task.id })).then((ok) => ok && setNewSub(""));
                  }}
                  className="h-8 flex-1 bg-transparent text-base placeholder:text-ink-3"
                />
              </div>
            </div>
          </div>
        )}

        <Field label={tr("Description")}>
          <CommitInput multiline value={task.description} onCommit={(v) => save({ description: v })} placeholder={tr("What is this task about?")} />
        </Field>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-ink-2">{tr("Notes")}</span>
            <Segmented size="sm" value={notesMode} onChange={setNotesMode} options={[{ value: "edit", label: tr("Write") }, { value: "preview", label: tr("Preview") }]} />
          </div>
          {notesMode === "edit" ? (
            <CommitInput multiline rows={8} value={task.notes} onCommit={(v) => save({ notes: v })} placeholder={tr("Markdown supported.\nWhat you accomplished, what you learned, problems, next steps…")} className="font-mono text-sm" />
          ) : task.notes ? (
            <button type="button" className="block w-full rounded border border-line px-3 py-2 text-start" onDoubleClick={() => setNotesMode("edit")} title={tr("Double-click to edit")}>
              <Markdown source={task.notes} />
            </button>
          ) : (
            <div className="rounded border border-dashed border-line px-3 py-4 text-center text-sm text-ink-3">{tr("No notes yet")}</div>
          )}
        </div>

        <div>
          <div className="mb-1 text-xs font-medium text-ink-2">{tr("Links")}</div>
          <div className="space-y-1">
            {task.links.map((l, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <Link2 size={12} className="shrink-0 text-ink-3" />
                <a href={/^https?:\/\//.test(l.url) ? l.url : undefined} target="_blank" rel="noreferrer noopener" className="selectable min-w-0 flex-1 truncate text-accent hover:underline">
                  {l.label || l.url}
                </a>
                <IconButton label={tr("Remove link")} className="!h-5 !w-5" onClick={() => save({ links: task.links.filter((_, j) => j !== i) })}>
                  <X size={11} />
                </IconButton>
              </div>
            ))}
            <Input
              value={newLink}
              placeholder={tr("Paste a URL or reference and press Enter")}
              aria-label={tr("Add link")}
              onChange={(e) => setNewLink(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newLink.trim()) {
                  save({ links: [...task.links, { url: newLink.trim(), label: "" }] });
                  setNewLink("");
                }
              }}
            />
          </div>
        </div>

        <div>
          <div className="mb-1 text-xs font-medium text-ink-2">{tr("Depends on")}</div>
          <div className="space-y-1">
            {myDeps.map((d) => (
              <div key={d.id} className="flex items-center gap-2 text-sm">
                <button type="button" className={cx("min-w-0 flex-1 truncate text-start hover:underline", d.status === "completed" && "text-ink-3 line-through")} onClick={() => openTask(d.id)}>
                  {d.title}
                </button>
                {d.status !== "completed" && d.status !== "cancelled" && <Badge tone="warn">{tr("Open")}</Badge>}
                <IconButton label={tr("Remove dependency")} className="!h-5 !w-5" onClick={() => void attempt(() => setDependency(task.id, d.id, false))}>
                  <X size={11} />
                </IconButton>
              </div>
            ))}
            <Select
              value={depPick}
              aria-label={tr("Add dependency")}
              onChange={(e) => {
                const id = e.target.value;
                setDepPick("");
                if (id) void attempt(() => setDependency(task.id, id, true));
              }}
            >
              <option value="">{tr("Add a task this one waits on…")}</option>
              {allTasks
                .filter((t) => t.id !== task.id && !t.parent_id && t.status !== "completed" && t.status !== "cancelled" && !myDeps.some((d) => d.id === t.id) && (!task.project_id || t.project_id === task.project_id))
                .slice(0, 200)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
            </Select>
          </div>
        </div>

        {taskSessions.length > 0 && (
          <div>
            <div className="mb-1 flex items-center justify-between text-xs font-medium text-ink-2">
              {tr("Recent sessions")}
              <button type="button" className="inline-flex items-center gap-0.5 font-normal hover:text-ink" onClick={() => navigate("focus", "history")}>
                {tr("All")}{" "}<ArrowUpRight className="rtl:rotate-180" size={11} />
              </button>
            </div>
            <div className="rounded border border-line text-sm">
              {taskSessions.map((s) => (
                <div key={s.id} className="flex items-center gap-2 border-b border-line px-3 py-1.5 last:border-0">
                  <span className="w-24 shrink-0 text-ink-2">{fmtDate(dateOfMs(s.started_at), today)}</span>
                  <span className="tabular w-14 shrink-0">{fmtDuration(sessionSeconds(s.id, entries))}</span>
                  <span className="min-w-0 flex-1 truncate text-ink-2">{s.notes || s.objective}</span>
                  {s.status === "interrupted" && <Badge>{tr("Interrupted")}</Badge>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {recur && <RecurrenceDialog task={task} onClose={() => setRecur(false)} />}
    </div>
  );
}
