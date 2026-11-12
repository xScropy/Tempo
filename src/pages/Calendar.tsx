import { AlertTriangle, ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, addMonths, atTime, dateOfMs, dayStartMs, fmtDate, fmtDuration, fmtHours, fromDateStr, monthName, startOfMonth, startOfWeek, timeOf, weekDates, weekdayName, type DateStr } from "@/domain/dates";
import { projectSubtree } from "@/domain/projects";
import { conflictingIds, conflictsFor, layoutColumns, type Block } from "@/domain/schedule";
import { isOpen, type CalendarEvent, type Task } from "@/domain/types";
import { attempt, toast } from "@/lib/notify";
import { deleteEvent, moveEvent, saveEvent, updateTask } from "@/store/actions";
import { useData } from "@/store/data";
import { byId, nextOccurrenceOnly, projectSeconds, targetSeconds } from "@/store/selectors";
import { confirmDialog, openQuickAdd, openTask, useUi } from "@/store/ui";
import { ProjectOptions } from "@/components/task-bits";
import { Button, Dialog, Empty, Field, IconButton, Input, PageHeader, Segmented, Select, Textarea, cx } from "@/components/ui";

type View = "day" | "week" | "month" | "agenda";
const HOUR = 48;
const SNAP = 15;
const MIN = 60_000;

interface CalBlock extends Block {
  kind: "task" | "event";
  ref: string;
  color: string;
  done: boolean;
  sub?: string;
}

function useBlocks(): CalBlock[] {
  const tasks = useData((s) => s.tasks);
  const events = useData((s) => s.events);
  const projects = useData((s) => s.projects);
  return useMemo(() => {
    const pm = byId(projects);
    const out: CalBlock[] = [];
    for (const t of tasks) {
      if (t.scheduled_at == null || t.status === "cancelled") continue;
      out.push({ id: `t:${t.id}`, ref: t.id, kind: "task", title: t.title, start: t.scheduled_at, end: t.scheduled_at + (t.scheduled_minutes ?? 30) * MIN, color: (t.project_id && pm.get(t.project_id)?.color) || "rgb(var(--accent))", done: t.status === "completed" });
    }
    for (const e of events) {
      out.push({ id: `e:${e.id}`, ref: e.id, kind: "event", title: e.title, start: e.start_at, end: e.end_at, color: (e.project_id && pm.get(e.project_id)?.color) || (e.kind === "focus_block" ? "rgb(var(--accent))" : "rgb(var(--ink-3))"), done: false, sub: e.kind === "focus_block" ? "Focus block" : e.kind === "meeting" ? "Meeting" : undefined });
    }
    return out;
  }, [tasks, events, projects]);
}

async function moveBlock(block: CalBlock, start: number, end: number, all: CalBlock[]) {
  const ok = await attempt(() => (block.kind === "task" ? updateTask(block.ref, { scheduled_at: start, scheduled_minutes: Math.max(5, Math.round((end - start) / MIN)) }) : moveEvent(block.ref, start, end)));
  if (!ok) return;
  const clashes = conflictsFor({ ...block, start, end }, all.filter((b) => !b.done));
  if (clashes.length) toast("Scheduling conflict", `"${block.title}" now overlaps ${clashes.map((c) => `"${c.title}"`).slice(0, 2).join(" and ")}${clashes.length > 2 ? ` and ${clashes.length - 2} more` : ""}.`, "error");
}

function EventDialog({ initial, onClose }: { initial: Partial<CalendarEvent> & { start_at: number; end_at: number }; onClose: () => void }) {
  const projects = useData((s) => s.projects);
  const targets = useData((s) => s.targets);
  const blocks = useBlocks();
  const [f, setF] = useState({
    title: initial.title ?? "", kind: initial.kind ?? "event", date: dateOfMs(initial.start_at), start: timeOf(initial.start_at), end: timeOf(initial.end_at),
    project_id: initial.project_id ?? "", target_id: initial.target_id ?? "", reminder: initial.reminder_minutes == null ? "" : String(initial.reminder_minutes), description: initial.description ?? "",
  });
  const start_at = atTime(f.date, f.start || "00:00");
  let end_at = atTime(f.date, f.end || "00:00");
  if (end_at <= start_at && f.end < f.start) end_at += 86_400_000; // past midnight
  const clashes = conflictsFor({ id: initial.id ? `e:${initial.id}` : "new", title: f.title, start: start_at, end: end_at }, blocks.filter((b) => !b.done));
  const save = async () => {
    const ok = await attempt(() => saveEvent({ id: initial.id, title: f.title, kind: f.kind, start_at, end_at, project_id: f.project_id || null, target_id: f.target_id || null, reminder_minutes: f.reminder === "" ? null : Number(f.reminder), description: f.description }));
    if (ok) onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={initial.id ? "Edit event" : "New event"}
      footer={
        <>
          {initial.id && (
            <Button variant="danger" className="mr-auto" icon={<Trash2 size={13} />} onClick={() => void confirmDialog({ title: `Delete "${f.title}"?`, confirmLabel: "Delete", danger: true }).then((ok) => { if (ok) void attempt(() => deleteEvent(initial.id!)).then(onClose); })}>
              Delete
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!f.title.trim() || end_at <= start_at} onClick={() => void save()}>
            {clashes.length ? "Save anyway" : "Save"}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-3 gap-3">
        <Field label="Title" className="col-span-2">
          <Input autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} onKeyDown={(e) => e.key === "Enter" && f.title.trim() && void save()} />
        </Field>
        <Field label="Type">
          <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as CalendarEvent["kind"] })}>
            <option value="event">Event</option>
            <option value="meeting">Meeting</option>
            <option value="focus_block">Focus block</option>
            <option value="personal">Personal</option>
          </Select>
        </Field>
        <Field label="Date">
          <Input type="date" value={f.date} onChange={(e) => e.target.value && setF({ ...f, date: e.target.value })} />
        </Field>
        <Field label="From">
          <Input type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />
        </Field>
        <Field label="To">
          <Input type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} />
        </Field>
        <Field label="Project">
          <Select value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value })}>
            <option value="">None</option>
            <ProjectOptions projects={projects} />
          </Select>
        </Field>
        <Field label="Activity">
          <Select value={f.target_id} onChange={(e) => setF({ ...f, target_id: e.target.value })}>
            <option value="">None</option>
            {targets.filter((t) => !t.archived_at).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Reminder">
          <Select value={f.reminder} onChange={(e) => setF({ ...f, reminder: e.target.value })}>
            <option value="">None</option>
            <option value="0">At start</option>
            <option value="5">5 min before</option>
            <option value="15">15 min before</option>
            <option value="60">1 hour before</option>
          </Select>
        </Field>
        <Field label="Notes" className="col-span-3">
          <Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
      </div>
      {clashes.length > 0 && (
        <div className="mt-3 flex gap-2 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" />
          <div>Overlaps {clashes.map((c) => `"${c.title}" (${timeOf(c.start)}–${timeOf(c.end)})`).slice(0, 3).join(", ")}.</div>
        </div>
      )}
    </Dialog>
  );
}

function DayColumn({ date, blocks, all, conflicts, onNew, onOpen }: { date: DateStr; blocks: CalBlock[]; all: CalBlock[]; conflicts: Set<string>; onNew: (start: number) => void; onOpen: (b: CalBlock) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const today = useUi((s) => s.today);
  const now = Date.now();
  const [over, setOver] = useState(false);
  const [resize, setResize] = useState<{ id: string; end: number } | null>(null);
  const dayStart = dayStartMs(date);
  const laid = useMemo(() => layoutColumns(blocks.map((b) => ({ ...b, start: Math.max(b.start, dayStart), end: Math.min(b.end, dayStart + 86_400_000) }))), [blocks, dayStart]);
  const minutesAt = (clientY: number) => {
    const rect = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(24 * 60 - SNAP, Math.round(((clientY - rect.top) / HOUR) * 60 / SNAP) * SNAP));
  };

  const drop = (e: React.DragEvent) => {
    setOver(false);
    const dt = e.dataTransfer;
    const blockData = dt.getData("application/x-tempo-block");
    const taskId = dt.getData("application/x-tempo-task");
    const targetData = dt.getData("application/x-tempo-target");
    if (blockData) {
      const [id, grab] = blockData.split("|");
      const b = all.find((x) => x.id === id);
      if (!b) return;
      const start = dayStart + Math.max(0, minutesAt(e.clientY - Number(grab))) * MIN;
      void moveBlock(b, start, start + (b.end - b.start), all);
    } else if (taskId) {
      const t = useData.getState().tasks.find((x) => x.id === taskId);
      if (!t) return;
      const start = dayStart + minutesAt(e.clientY) * MIN;
      const mins = Math.min(240, Math.max(15, Math.round((t.estimated_seconds ?? 1800) / 60 / SNAP) * SNAP));
      void moveBlock({ id: `t:${t.id}`, ref: t.id, kind: "task", title: t.title, start, end: start + mins * MIN, color: "", done: false }, start, start + mins * MIN, all);
    } else if (targetData) {
      const [kind, id, name] = targetData.split("|");
      const start = dayStart + minutesAt(e.clientY) * MIN;
      void attempt(() => saveEvent({ title: name ?? "Focus", kind: "focus_block", start_at: start, end_at: start + 60 * MIN, project_id: kind === "project" ? id : null, target_id: kind === "target" ? id : null }));
    }
  };

  const startResize = (e: React.PointerEvent, b: CalBlock) => {
    e.stopPropagation();
    e.preventDefault();
    const move = (ev: PointerEvent) => setResize({ id: b.id, end: Math.max(b.start + SNAP * MIN, dayStart + (minutesAt(ev.clientY) + SNAP) * MIN) });
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const end = Math.max(b.start + SNAP * MIN, dayStart + (minutesAt(ev.clientY) + SNAP) * MIN);
      setResize(null);
      if (end !== b.end) void moveBlock(b, b.start, end, all);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      ref={ref}
      className={cx("relative min-w-0 flex-1 basis-0 border-l border-line", over && "bg-accent/5", date === today && "bg-accent/[0.03]")}
      style={{ height: 24 * HOUR }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      onDoubleClick={(e) => e.target === e.currentTarget && onNew(dayStart + minutesAt(e.clientY) * MIN)}
    >
      {Array.from({ length: 24 }, (_, h) => (
        <div key={h} className="pointer-events-none absolute inset-x-0 border-t border-line" style={{ top: h * HOUR }} />
      ))}
      {date === today && <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-danger" style={{ top: ((now - dayStart) / 3_600_000) * HOUR }} />}
      {laid.map((b) => {
        const end = resize?.id === b.id ? resize.end : b.end;
        const top = ((b.start - dayStart) / 3_600_000) * HOUR;
        const height = Math.max(18, ((end - b.start) / 3_600_000) * HOUR - 2);
        const clash = conflicts.has(b.id);
        return (
          <div
            key={b.id}
            role="button"
            tabIndex={0}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("application/x-tempo-block", `${b.id}|${e.clientY - e.currentTarget.getBoundingClientRect().top}`);
              e.dataTransfer.effectAllowed = "move";
            }}
            onClick={() => onOpen(b)}
            onKeyDown={(e) => e.key === "Enter" && onOpen(b)}
            title={`${b.title}\n${timeOf(b.start)} – ${timeOf(end)}${clash ? "\nOverlaps another item" : ""}`}
            className={cx("absolute z-[5] overflow-hidden rounded-sm border-l-[3px] bg-surface px-1.5 py-0.5 text-xs shadow-sm ring-1", clash ? "ring-warn" : "ring-line", b.done && "opacity-50")}
            style={{ top, height, left: `calc(${(b.col / b.cols) * 100}% + 2px)`, width: `calc(${100 / b.cols}% - 4px)`, borderLeftColor: b.color }}
          >
            <div className={cx("truncate font-medium leading-4", b.done && "line-through")}>{b.title}</div>
            {height > 30 && (
              <div className="tabular truncate text-2xs text-ink-2">
                {timeOf(b.start)} – {timeOf(end)}
                {b.sub ? ` · ${b.sub}` : ""}
              </div>
            )}
            {clash && <AlertTriangle size={10} className="absolute right-1 top-1 text-warn" />}
            <div className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize" onPointerDown={(e) => startResize(e, b)} />
          </div>
        );
      })}
    </div>
  );
}

interface DayItems {
  due: Task[];
  marks: Array<{ key: string; label: string; onClick?: () => void }>;
}

function useDayItems(): (date: DateStr) => DayItems {
  const tasks = useData((s) => s.tasks);
  const projects = useData((s) => s.projects);
  const milestones = useData((s) => s.milestones);
  return useMemo(() => {
    const due = new Map<DateStr, Task[]>();
    for (const t of tasks) if (t.due_date && t.scheduled_at == null && !t.parent_id && isOpen(t)) due.set(t.due_date, [...(due.get(t.due_date) ?? []), t]);
    const marks = new Map<DateStr, DayItems["marks"]>();
    const add = (d: DateStr, m: DayItems["marks"][number]) => marks.set(d, [...(marks.get(d) ?? []), m]);
    for (const p of projects) if (p.deadline && p.status !== "completed" && p.status !== "cancelled") add(p.deadline, { key: `p${p.id}`, label: `Deadline: ${p.name}`, onClick: () => (window.location.hash = `/projects/${p.id}`) });
    for (const m of milestones) if (m.due_date && !m.completed_at) add(m.due_date, { key: `m${m.id}`, label: `Milestone: ${m.title}`, onClick: () => (window.location.hash = `/projects/${m.project_id}`) });
    return (d) => ({ due: due.get(d) ?? [], marks: marks.get(d) ?? [] });
  }, [tasks, projects, milestones]);
}

function AllDayCell({ date, items }: { date: DateStr; items: DayItems }) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={cx("min-h-[30px] min-w-0 flex-1 basis-0 space-y-0.5 border-l border-line p-1", over && "bg-accent/10")}
      onDragOver={(e) => e.dataTransfer.types.includes("application/x-tempo-task") && (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const id = e.dataTransfer.getData("application/x-tempo-task");
        if (id) void attempt(() => updateTask(id, { due_date: date }));
      }}
    >
      {items.marks.map((m) => (
        <button key={m.key} type="button" onClick={m.onClick} className="block w-full truncate rounded-sm bg-warn/10 px-1 text-left text-2xs font-medium text-warn">
          {m.label}
        </button>
      ))}
      {items.due.slice(0, 3).map((t) => (
        <button key={t.id} type="button" draggable onDragStart={(e) => e.dataTransfer.setData("application/x-tempo-task", t.id)} onClick={() => openTask(t.id)} className="block w-full truncate rounded-sm bg-hover px-1 text-left text-2xs text-ink-2 hover:text-ink">
          {t.title}
        </button>
      ))}
      {items.due.length > 3 && <div className="px-1 text-2xs text-ink-3">+{items.due.length - 3} more due</div>}
    </div>
  );
}

function PlanningPanel({ weekStartDate }: { weekStartDate: DateStr }) {
  const today = useUi((s) => s.today);
  const tasks = useData((s) => s.tasks);
  const projects = useData((s) => s.projects);
  const targets = useData((s) => s.targets);
  const events = useData((s) => s.events);
  const entries = useData((s) => s.entries);
  const from = dayStartMs(weekStartDate);
  const to = dayStartMs(addDays(weekStartDate, 7));

  const unscheduled = useMemo(
    () =>
      nextOccurrenceOnly(tasks.filter((t) => isOpen(t) && t.scheduled_at == null && !t.parent_id && t.status !== "inbox"))
        .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || a.priority - b.priority)
        .slice(0, 40),
    [tasks],
  );

  const rows = useMemo(() => {
    const inWeek = (s: number) => s >= from && s < to;
    const out: Array<{ key: string; drag: string; name: string; target: number; planned: number; actual: number }> = [];
    for (const p of projects) {
      if (!p.weekly_target_seconds || p.status === "completed" || p.status === "cancelled") continue;
      const ids = projectSubtree(p.id, projects);
      const planned =
        events.filter((e) => e.kind === "focus_block" && e.project_id && ids.has(e.project_id) && inWeek(e.start_at)).reduce((a, e) => a + (e.end_at - e.start_at) / 1000, 0) +
        tasks.filter((t) => t.scheduled_at != null && t.project_id && ids.has(t.project_id) && inWeek(t.scheduled_at) && t.status !== "cancelled").reduce((a, t) => a + (t.scheduled_minutes ?? 30) * 60, 0);
      out.push({ key: p.id, drag: `project|${p.id}|${p.name}`, name: p.name, target: p.weekly_target_seconds, planned, actual: projectSeconds(p.id, projects, entries, from, to) });
    }
    for (const t of targets) {
      if (t.archived_at) continue;
      const planned = events.filter((e) => e.target_id === t.id && inWeek(e.start_at)).reduce((a, e) => a + (e.end_at - e.start_at) / 1000, 0);
      out.push({ key: t.id, drag: `target|${t.id}|${t.name}`, name: t.name, target: t.weekly_seconds, planned, actual: targetSeconds(t.id, entries, from, to) });
    }
    return out;
  }, [projects, targets, events, tasks, entries, from, to]);

  return (
    <aside className="no-print flex w-[232px] shrink-0 flex-col overflow-y-auto border-r border-line bg-raised">
      {rows.length > 0 && (
        <div className="border-b border-line p-2.5">
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">Weekly targets</div>
          <div className="mb-2 text-2xs leading-[14px] text-ink-3">Drag onto a day to plan a focus block. Planned time is what you have put on the calendar; actual is what you tracked.</div>
          <div className="space-y-1.5">
            {rows.map((r) => (
              <div key={r.key} draggable onDragStart={(e) => e.dataTransfer.setData("application/x-tempo-target", r.drag)} className="cursor-grab rounded border border-line bg-surface px-2 py-1.5 active:cursor-grabbing">
                <div className="truncate text-sm font-medium">{r.name}</div>
                <div className="tabular mt-0.5 grid grid-cols-3 text-2xs text-ink-2">
                  <span title="Weekly target">Target {fmtHours(r.target)}</span>
                  <span title="Planned on the calendar this week" className={r.planned < r.target ? "text-warn" : undefined}>Plan {fmtHours(r.planned)}</span>
                  <span title="Actually tracked this week">Done {fmtHours(r.actual)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="p-2.5">
        <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">Unscheduled tasks</div>
        {unscheduled.length === 0 && <div className="text-xs text-ink-3">Every open task has a slot.</div>}
        <div className="space-y-1">
          {unscheduled.map((t) => (
            <div
              key={t.id}
              role="button"
              tabIndex={0}
              draggable
              onDragStart={(e) => e.dataTransfer.setData("application/x-tempo-task", t.id)}
              onClick={() => openTask(t.id)}
              onKeyDown={(e) => e.key === "Enter" && openTask(t.id)}
              className="cursor-grab rounded border border-line bg-surface px-2 py-1 text-sm hover:border-line-strong active:cursor-grabbing"
            >
              <div className="truncate">{t.title}</div>
              <div className="flex gap-2 text-2xs text-ink-2">
                {t.due_date && <span className={t.due_date < today ? "font-medium text-danger" : undefined}>{fmtDate(t.due_date, today)}</span>}
                {t.estimated_seconds ? <span>{fmtDuration(t.estimated_seconds)}</span> : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

export function CalendarPage() {
  const today = useUi((s) => s.today);
  const weekStart = useData((s) => s.settings.weekStart);
  const events = useData((s) => s.events);
  const [view, setView] = useState<View>("week");
  const [cursor, setCursor] = useState<DateStr>(today);
  const [dialog, setDialog] = useState<(Partial<CalendarEvent> & { start_at: number; end_at: number }) | null>(null);
  const blocks = useBlocks();
  const dayItems = useDayItems();
  const scroller = useRef<HTMLDivElement>(null);
  const conflicts = useMemo(() => conflictingIds(blocks.filter((b) => !b.done)), [blocks]);

  useEffect(() => {
    if (view === "day" || view === "week") scroller.current?.scrollTo({ top: 7 * HOUR });
  }, [view]);

  const days = view === "day" ? [cursor] : weekDates(startOfWeek(cursor, weekStart));
  const step = (dir: number) => setCursor(view === "month" ? addMonths(startOfMonth(cursor), dir) : addDays(cursor, dir * (view === "day" ? 1 : view === "agenda" ? 14 : 7)));
  const open = (b: CalBlock) => {
    if (b.kind === "task") return openTask(b.ref);
    const e = events.find((x) => x.id === b.ref);
    if (e) setDialog(e);
  };
  const blocksOn = (d: DateStr) => {
    const s = dayStartMs(d);
    return blocks.filter((b) => b.start < s + 86_400_000 && b.end > s);
  };
  const cd = fromDateStr(cursor);
  const title = view === "month" ? `${monthName(cd.getMonth())} ${cd.getFullYear()}` : view === "day" ? fmtDate(cursor, today) : view === "agenda" ? `From ${fmtDate(cursor, today)}` : `${fmtDate(days[0]!, "")} – ${fmtDate(days[6]!, "")}`;

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Calendar" subtitle={title}>
        {conflicts.size > 0 && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-warn">
            <AlertTriangle size={13} /> {conflicts.size} overlapping items
          </span>
        )}
        <div className="flex items-center">
          <IconButton label="Previous" onClick={() => step(-1)}>
            <ChevronLeft size={15} />
          </IconButton>
          <Button variant="ghost" size="sm" onClick={() => setCursor(today)}>
            Today
          </Button>
          <IconButton label="Next" onClick={() => step(1)}>
            <ChevronRight size={15} />
          </IconButton>
        </div>
        <Segmented value={view} onChange={setView} options={[{ value: "day", label: "Day" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }, { value: "agenda", label: "Agenda" }]} />
        <Button variant="primary" icon={<Plus size={14} />} onClick={() => setDialog({ start_at: atTime(view === "day" ? cursor : today, "09:00"), end_at: atTime(view === "day" ? cursor : today, "10:00") })}>
          Event
        </Button>
      </PageHeader>

      <div className="flex min-h-0 flex-1">
        {(view === "day" || view === "week") && <PlanningPanel weekStartDate={startOfWeek(cursor, weekStart)} />}
        {(view === "day" || view === "week") && (
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex shrink-0 border-b border-line pr-[10px]">
              <div className="w-12 shrink-0" />
              {days.map((d) => {
                const dt = fromDateStr(d);
                return (
                  <button key={d} type="button" onClick={() => (setCursor(d), setView("day"))} className={cx("min-w-0 flex-1 basis-0 border-l border-line py-1 text-center text-xs hover:bg-hover/50", d === today ? "font-semibold text-accent" : "text-ink-2")}>
                    {weekdayName(dt.getDay())} <span className="tabular">{dt.getDate()}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex shrink-0 border-b border-line pr-[10px]">
              <div className="w-12 shrink-0 px-1 pt-1 text-right text-2xs text-ink-3">Due</div>
              {days.map((d) => (
                <AllDayCell key={d} date={d} items={dayItems(d)} />
              ))}
            </div>
            <div ref={scroller} className="min-h-0 flex-1 overflow-y-scroll">
              <div className="flex">
                <div className="relative w-12 shrink-0" style={{ height: 24 * HOUR }}>
                  {Array.from({ length: 23 }, (_, i) => (
                    <div key={i} className="tabular absolute right-1.5 -translate-y-1/2 text-2xs text-ink-3" style={{ top: (i + 1) * HOUR }}>
                      {String(i + 1).padStart(2, "0")}:00
                    </div>
                  ))}
                </div>
                {days.map((d) => (
                  <DayColumn key={d} date={d} blocks={blocksOn(d)} all={blocks} conflicts={conflicts} onOpen={open} onNew={(start) => setDialog({ start_at: start, end_at: start + 60 * MIN })} />
                ))}
              </div>
            </div>
            <div className="no-print shrink-0 border-t border-line px-3 py-1 text-2xs text-ink-3">Double-click an empty slot to add an event · drag to move · drag the bottom edge to resize</div>
          </div>
        )}

        {view === "month" && <MonthGrid cursor={cursor} blocksOn={blocksOn} dayItems={dayItems} onPick={(d) => (setCursor(d), setView("day"))} />}
        {view === "agenda" && <Agenda from={cursor} blocksOn={blocksOn} dayItems={dayItems} onOpen={open} />}
      </div>
      {dialog && <EventDialog initial={dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}

function MonthGrid({ cursor, blocksOn, dayItems, onPick }: { cursor: DateStr; blocksOn: (d: DateStr) => CalBlock[]; dayItems: (d: DateStr) => DayItems; onPick: (d: DateStr) => void }) {
  const today = useUi((s) => s.today);
  const weekStart = useData((s) => s.settings.weekStart);
  const first = startOfWeek(startOfMonth(cursor), weekStart);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(first, i));
  const month = cursor.slice(0, 7);
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="grid shrink-0 grid-cols-7 border-b border-line">
        {cells.slice(0, 7).map((d) => (
          <div key={d} className="border-l border-line py-1 text-center text-xs text-ink-2 first:border-l-0">{weekdayName(fromDateStr(d).getDay())}</div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        {cells.map((d) => {
          const items = [...dayItems(d).marks.map((m) => ({ key: m.key, label: m.label, tone: "warn" as const })), ...blocksOn(d).sort((a, b) => a.start - b.start).map((b) => ({ key: b.id, label: `${timeOf(b.start)} ${b.title}`, tone: "block" as const })), ...dayItems(d).due.map((t) => ({ key: t.id, label: t.title, tone: "due" as const }))];
          return (
            <div
              key={d}
              role="button"
              tabIndex={0}
              onClick={() => onPick(d)}
              onKeyDown={(e) => e.key === "Enter" && onPick(d)}
              onDragOver={(e) => e.dataTransfer.types.includes("application/x-tempo-task") && e.preventDefault()}
              onDrop={(e) => {
                const id = e.dataTransfer.getData("application/x-tempo-task");
                if (id) void attempt(() => updateTask(id, { due_date: d }));
              }}
              className={cx("min-h-0 overflow-hidden border-b border-l border-line p-1 text-left hover:bg-hover/40", d.slice(0, 7) !== month && "bg-raised/60")}
            >
              <div className={cx("tabular mb-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs", d === today ? "bg-accent font-semibold text-accent-ink" : d.slice(0, 7) !== month ? "text-ink-3" : "text-ink-2")}>{Number(d.slice(8))}</div>
              {items.slice(0, 3).map((it) => (
                <div key={it.key} className={cx("truncate rounded-sm px-1 text-2xs leading-4", it.tone === "warn" ? "bg-warn/10 font-medium text-warn" : it.tone === "block" ? "bg-accent/10 text-ink" : "text-ink-2")}>{it.label}</div>
              ))}
              {items.length > 3 && <div className="px-1 text-2xs text-ink-3">+{items.length - 3} more</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Agenda({ from, blocksOn, dayItems, onOpen }: { from: DateStr; blocksOn: (d: DateStr) => CalBlock[]; dayItems: (d: DateStr) => DayItems; onOpen: (b: CalBlock) => void }) {
  const today = useUi((s) => s.today);
  const days = Array.from({ length: 30 }, (_, i) => addDays(from, i)).filter((d) => blocksOn(d).length || dayItems(d).due.length || dayItems(d).marks.length);
  if (!days.length) return <div className="flex-1"><Empty title="Nothing scheduled in the next 30 days" body="Schedule tasks or add events and they will be listed here in order." action={<Button onClick={() => openQuickAdd({ due_date: from })}>Add a task</Button>} /></div>;
  return (
    <div className="min-w-0 flex-1 overflow-y-auto px-5 py-3">
      <div className="mx-auto max-w-[720px] space-y-3">
        {days.map((d) => (
          <div key={d} className="flex gap-4">
            <div className={cx("w-28 shrink-0 pt-1.5 text-sm font-medium", d === today && "text-accent")}>{fmtDate(d, today)}</div>
            <div className="min-w-0 flex-1 rounded-md border border-line bg-surface">
              {dayItems(d).marks.map((m) => (
                <button key={m.key} type="button" onClick={m.onClick} className="flex w-full gap-3 border-b border-line px-3 py-1.5 text-left text-sm font-medium text-warn last:border-0">
                  <span className="w-24 shrink-0">All day</span>
                  {m.label}
                </button>
              ))}
              {blocksOn(d).sort((a, b) => a.start - b.start).map((b) => (
                <button key={b.id} type="button" onClick={() => onOpen(b)} className="flex w-full items-center gap-3 border-b border-line px-3 py-1.5 text-left text-sm last:border-0 hover:bg-hover/50">
                  <span className="tabular w-24 shrink-0 text-ink-2">{timeOf(b.start)} – {timeOf(b.end)}</span>
                  <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: b.color }} />
                  <span className={cx("min-w-0 flex-1 truncate", b.done && "text-ink-3 line-through")}>{b.title}</span>
                  {b.sub && <span className="text-xs text-ink-3">{b.sub}</span>}
                </button>
              ))}
              {dayItems(d).due.map((t) => (
                <button key={t.id} type="button" onClick={() => openTask(t.id)} className="flex w-full gap-3 border-b border-line px-3 py-1.5 text-left text-sm last:border-0 hover:bg-hover/50">
                  <span className="w-24 shrink-0 text-ink-3">Due</span>
                  <span className="min-w-0 flex-1 truncate">{t.title}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
