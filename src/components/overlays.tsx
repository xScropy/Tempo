import { LOCALE, eg, hash, tr } from "@/i18n";
import { CalendarDays, CheckSquare, Clock, FileText, Folder, Hash, Search, Star, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { atTime, fmtClock, fmtDate, fmtDuration, timeOf, todayStr } from "@/domain/dates";
import { parseQuickAdd } from "@/domain/quickadd";
import { PRIORITY_LABEL } from "@/domain/types";
import { attempt, dismissToast, useToasts } from "@/lib/notify";
import { createProject, createTask, ensureTag, updateSession } from "@/store/actions";
import { useData } from "@/store/data";
import { sessionSeconds } from "@/store/selectors";
import { resolveGap, useTimer } from "@/store/timer";
import { navigate, openTask, useUi, type Page } from "@/store/ui";
import { ProjectOptions } from "./task-bits";
import { Badge, Button, Dialog, DurationInput, Field, Input, Select, Textarea, cx } from "./ui";

export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <div className="no-print pointer-events-none fixed bottom-4 end-4 z-[60] flex w-80 flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cx("animate-pop pointer-events-auto flex items-start gap-2 rounded-md border bg-surface px-3 py-2 shadow-pop", t.tone === "error" ? "border-danger/50" : "border-line")}>
          <div className="min-w-0 flex-1">
            <div className={cx("text-sm font-medium", t.tone === "error" && "text-danger")}>{t.title}</div>
            {t.body && <div className="mt-0.5 text-sm text-ink-2">{t.body}</div>}
          </div>
          <button type="button" aria-label={tr("Dismiss")} className="text-ink-3 hover:text-ink" onClick={() => dismissToast(t.id)}>
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function ConfirmHost() {
  const req = useUi((s) => s.confirm);
  if (!req) return null;
  const close = (ok: boolean) => {
    req.resolve(ok);
    useUi.setState({ confirm: null });
  };
  return (
    <Dialog
      open
      onClose={() => close(false)}
      title={req.title}
      width={420}
      footer={
        <>
          <Button onClick={() => close(false)}>{tr("Cancel")}</Button>
          <Button variant={req.danger ? "danger" : "primary"} autoFocus onClick={() => close(true)}>
            {req.confirmLabel ?? tr("Confirm")}
          </Button>
        </>
      }
    >
      <p className="text-base text-ink-2">{req.body}</p>
    </Dialog>
  );
}

/** Quick capture: one line, parsed offline. Everything else can be filled in later. */
export function QuickAdd() {
  const req = useUi((s) => s.quickAdd);
  const projects = useData((s) => s.projects);
  const [text, setText] = useState("");
  const [projectId, setProjectId] = useState("");
  useEffect(() => {
    if (req) {
      setText("");
      setProjectId(req.defaults.project_id ?? "");
    }
  }, [req]);
  const today = todayStr();
  const parsed = useMemo(() => parseQuickAdd(text, today), [text, today]);
  if (!req) return null;
  const close = () => useUi.setState({ quickAdd: null });

  const submit = async (open: boolean) => {
    if (!text.trim()) return;
    const ok = await attempt(async () => {
      const tag_ids = await Promise.all(parsed.tags.map((t) => ensureTag(t)));
      const due = parsed.due_date ?? req.defaults.due_date ?? null;
      const id = await createTask({
        ...req.defaults,
        title: parsed.title,
        project_id: projectId || null,
        due_date: due,
        estimated_seconds: parsed.estimated_seconds,
        priority: parsed.priority ?? req.defaults.priority,
        scheduled_at: parsed.time && due ? atTime(due, parsed.time) : (req.defaults.scheduled_at ?? null),
        scheduled_minutes: parsed.time && due ? Math.max(15, Math.round((parsed.estimated_seconds ?? 1800) / 60)) : (req.defaults.scheduled_minutes ?? null),
        tag_ids,
      });
      if (open) openTask(id);
    });
    if (ok) close();
  };

  return (
    <Dialog
      open
      onClose={close}
      title={tr("New task")}
      width={560}
      footer={
        <>
          <span className="me-auto text-xs text-ink-3">{tr("Enter to add · Ctrl+Enter to add and open")}</span>
          <Button onClick={close}>{tr("Cancel")}</Button>
          <Button variant="primary" disabled={!text.trim()} onClick={() => void submit(false)}>
            {tr("Add task")}
          </Button>
        </>
      }
    >
      <Input
        autoFocus
        value={text}
        aria-label={tr("Task")}
        placeholder={tr("Study International Humanitarian Law for 2 hours tomorrow")}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void submit(e.ctrlKey || e.metaKey)}
        className="!h-10 text-lg"
      />
      <div className="mt-2 flex min-h-[20px] flex-wrap items-center gap-1.5">
        {parsed.due_date && <Badge tone="accent"><CalendarDays size={10} /> {fmtDate(parsed.due_date, today)}{parsed.time ? ` ${parsed.time}` : ""}</Badge>}
        {parsed.estimated_seconds && <Badge tone="accent"><Clock size={10} /> {fmtDuration(parsed.estimated_seconds)}</Badge>}
        {parsed.priority && <Badge tone="accent">{PRIORITY_LABEL[parsed.priority]}</Badge>}
        {parsed.tags.map((t) => (
          <Badge key={t} tone="accent">{hash(t)}</Badge>
        ))}
        {!text && <span className="text-xs text-ink-3">{tr("Understands dates (today, tomorrow, friday), \"at 9:30\", durations (2h, 45m), !high and #tags.")}</span>}
      </div>
      <Field label={tr("Project")} className="mt-3">
        <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">{tr("No project (goes to Inbox unless dated)")}</option>
          <ProjectOptions projects={projects} />
        </Select>
      </Field>
    </Dialog>
  );
}

const COLORS = ["#5b7a99", "#1f6f5c", "#8a6d3b", "#9b4d5c", "#6b5b95", "#4a7c59", "#b0653a", "#52677a"];

export function ProjectDialog() {
  const req = useUi((s) => s.projectDialog);
  const projects = useData((s) => s.projects);
  const categories = useData((s) => s.categories);
  const [f, setF] = useState({ name: "", parent_id: "", category_id: "", color: COLORS[0]!, start_date: "", deadline: "", estimated: null as number | null, weekly: null as number | null });
  useEffect(() => {
    if (req) setF({ name: "", parent_id: req.parentId ?? "", category_id: "", color: COLORS[projects.length % COLORS.length]!, start_date: todayStr(), deadline: "", estimated: null, weekly: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req]);
  if (!req) return null;
  const close = () => useUi.setState({ projectDialog: null });
  const submit = async () => {
    let id = "";
    const ok = await attempt(async () => {
      id = await createProject({
        name: f.name, parent_id: f.parent_id || null, category_id: f.category_id || null, color: f.color,
        start_date: f.start_date || null, deadline: f.deadline || null, estimated_seconds: f.estimated, weekly_target_seconds: f.weekly,
      });
    });
    if (ok) {
      close();
      navigate("projects", id);
    }
  };
  return (
    <Dialog
      open
      onClose={close}
      title={f.parent_id ? tr("New subproject") : tr("New project")}
      footer={
        <>
          <Button onClick={close}>{tr("Cancel")}</Button>
          <Button variant="primary" disabled={!f.name.trim()} onClick={() => void submit()}>
            {tr("Create project")}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={tr("Name")} className="col-span-2">
          <Input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && f.name.trim() && void submit()} placeholder={tr("Prepare for International Moot Court")} />
        </Field>
        <Field label={tr("Parent project")}>
          <Select value={f.parent_id} onChange={(e) => setF({ ...f, parent_id: e.target.value })}>
            <option value="">{tr("None (top level)")}</option>
            <ProjectOptions projects={projects} />
          </Select>
        </Field>
        <Field label={tr("Category")}>
          <Select value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}>
            <option value="">{tr("None")}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
        <Field label={tr("Start date")}>
          <Input type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} />
        </Field>
        <Field label={tr("Deadline")}>
          <Input type="date" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} />
        </Field>
        <Field label={tr("Estimated total time")}>
          <DurationInput value={f.estimated} onChange={(v) => setF({ ...f, estimated: v })} placeholder={eg("100h")} />
        </Field>
        <Field label={tr("Weekly time target")}>
          <DurationInput value={f.weekly} onChange={(v) => setF({ ...f, weekly: v })} placeholder={eg("12h")} />
        </Field>
        <Field group label={tr("Color")} className="col-span-2">
          <div className="flex gap-1.5">
            {COLORS.map((c) => (
              <button key={c} type="button" aria-label={tr("Color {0}", c)} aria-pressed={f.color === c} onClick={() => setF({ ...f, color: c })} className={cx("h-6 w-6 rounded", f.color === c && "ring-2 ring-ink ring-offset-2 ring-offset-surface")} style={{ background: c }} />
            ))}
          </div>
        </Field>
      </div>
    </Dialog>
  );
}

interface Hit {
  key: string;
  icon: React.ReactNode;
  title: string;
  sub?: string;
  run: () => void;
}

const NAV: Array<{ page: Page; label: string }> = [
  { page: "dashboard", label: tr("Dashboard") }, { page: "inbox", label: tr("Inbox") }, { page: "tasks", label: tr("My Tasks") }, { page: "projects", label: tr("Projects") },
  { page: "calendar", label: tr("Calendar") }, { page: "focus", label: tr("Focus") }, { page: "habits", label: tr("Habits") }, { page: "goals", label: tr("Goals") },
  { page: "analytics", label: tr("Analytics") }, { page: "rewards", label: tr("Rewards") }, { page: "journal", label: tr("Journal") }, { page: "friends", label: tr("Social") }, { page: "settings", label: tr("Settings") },
];

/** Global search across tasks, projects, notes, sessions, journal, tags and categories. */
export function SearchPalette() {
  const open = useUi((s) => s.search);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) (setQ(""), setSel(0));
  }, [open]);

  const hits = useMemo<Hit[]>(() => {
    if (!open) return [];
    const s = useData.getState();
    const needle = q.trim().toLowerCase();
    const out: Hit[] = [];
    const has = (...fields: Array<string | null | undefined>) => fields.some((f) => f && f.toLowerCase().includes(needle));
    const snippet = (text: string) => {
      const i = text.toLowerCase().indexOf(needle);
      return i < 0 ? undefined : (i > 30 ? "…" : "") + text.slice(Math.max(0, i - 30), i + 60).replace(/\s+/g, " ");
    };
    for (const n of NAV) if (!needle || n.label.toLowerCase().includes(needle)) out.push({ key: `nav-${n.page}`, icon: <Star size={14} />, title: tr("Go to {0}", n.label), run: () => navigate(n.page) });
    if (!needle) return out;
    const projectName = (id: string | null) => s.projects.find((p) => p.id === id)?.name;
    for (const t of s.tasks) {
      if (out.length > 60) break;
      if (has(t.title, t.description, t.notes)) {
        out.push({ key: `t-${t.id}`, icon: <CheckSquare size={14} />, title: t.title, sub: [projectName(t.project_id), t.status === "completed" ? "Completed" : null, !t.title.toLowerCase().includes(needle) ? snippet(t.notes) ?? snippet(t.description) : null].filter(Boolean).join(" · "), run: () => (navigate("tasks"), openTask(t.id)) });
      }
    }
    for (const p of s.projects) if (has(p.name, p.description, p.notes)) out.push({ key: `p-${p.id}`, icon: <Folder size={14} />, title: p.name, sub: tr("Project"), run: () => navigate("projects", p.id) });
    for (const x of s.sessions) {
      if (out.length > 90) break;
      if (has(x.notes, x.objective)) out.push({ key: `s-${x.id}`, icon: <Clock size={14} />, title: snippet(x.notes) ?? x.objective, sub: tr("Session · {0} · {1}", new Date(x.started_at).toLocaleDateString(LOCALE), fmtDuration(sessionSeconds(x.id, s.entries))), run: () => navigate("focus", "history") });
    }
    for (const j of Object.values(s.journal)) {
      const text = [j.accomplishments, j.went_well, j.went_wrong, j.improve, j.tomorrow].join("\n");
      if (text.toLowerCase().includes(needle)) out.push({ key: `j-${j.date}`, icon: <FileText size={14} />, title: snippet(text) ?? j.date, sub: tr("Journal · {0}", j.date), run: () => navigate("journal", j.date) });
    }
    for (const t of s.tags) if (has(t.name)) out.push({ key: `g-${t.id}`, icon: <Hash size={14} />, title: `#${t.name}`, sub: tr("Tag — show tasks"), run: () => navigate("tasks", `tag:${t.id}`) });
    for (const c of s.categories) if (has(c.name)) out.push({ key: `c-${c.id}`, icon: <Hash size={14} />, title: c.name, sub: tr("Category — show tasks"), run: () => navigate("tasks", `category:${c.id}`) });
    return out;
  }, [q, open]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => listRef.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" }), [sel]);
  if (!open) return null;
  const close = () => useUi.setState({ search: false });
  const run = (h: Hit | undefined) => {
    if (!h) return;
    close();
    h.run();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/35" onMouseDown={close}>
      <div className="animate-pop mx-auto mt-[12vh] w-[min(94vw,600px)] overflow-hidden rounded-lg border border-line bg-surface shadow-pop" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={tr("Search")}>
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Search size={15} className="text-ink-3" />
          <input
            autoFocus
            value={q}
            placeholder={tr("Search tasks, projects, notes, sessions…")}
            aria-label={tr("Search")}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              if (e.key === "ArrowDown") (e.preventDefault(), setSel((i) => Math.min(hits.length - 1, i + 1)));
              if (e.key === "ArrowUp") (e.preventDefault(), setSel((i) => Math.max(0, i - 1)));
              if (e.key === "Enter") run(hits[sel]);
            }}
            className="h-11 flex-1 bg-transparent text-lg placeholder:text-ink-3"
          />
        </div>
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-1">
          {hits.length === 0 && <div className="px-3 py-6 text-center text-sm text-ink-2">{tr("Nothing matches \"")}{q}"</div>}
          {hits.map((h, i) => (
            <button key={h.key} type="button" data-i={i} onMouseEnter={() => setSel(i)} onClick={() => run(h)} className={cx("flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-start", i === sel && "bg-hover")}>
              <span className="text-ink-3">{h.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{h.title}</span>
                {h.sub && <span className="block truncate text-xs text-ink-2">{h.sub}</span>}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Asked when a session was running while Tempo was closed or the computer slept. */
export function GapDialog() {
  const gap = useTimer((s) => s.gap);
  const timer = useTimer((s) => s.timer);
  if (!gap || !timer) return null;
  return (
    <Dialog open onClose={() => undefined} title={tr("Were you still working?")} width={460}>
      <p className="text-base text-ink-2">
        {tr("A focus session was running, but Tempo was closed or your computer was asleep for")}{" "}<strong className="text-ink">{fmtDuration(gap.ms / 1000)}</strong> ({timeOf(gap.from)} – {timeOf(gap.to)}).
      </p>
      <p className="mt-2 text-base text-ink-2">{tr("Should that time count as focused work?")}</p>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={() => void attempt(() => resolveGap(false))}>{tr("No — pause at")}{" "}{timeOf(gap.from)}</Button>
        <Button variant="primary" onClick={() => void attempt(() => resolveGap(true))}>
          {tr("Yes, keep")}{" "}{fmtClock(gap.ms / 1000)}
        </Button>
      </div>
    </Dialog>
  );
}

/** Optional reflection after a session ends. */
export function SessionReview() {
  const id = useTimer((s) => s.review);
  const session = useData((s) => (id ? s.sessions.find((x) => x.id === id) : undefined));
  const entries = useData((s) => s.entries);
  const task = useData((s) => (session?.task_id ? s.tasks.find((t) => t.id === session.task_id) : undefined));
  const [notes, setNotes] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  useEffect(() => (setNotes(""), setRating(null)), [id]);
  if (!id || !session) return null;
  const close = () => useTimer.setState({ review: null });
  const save = async () => {
    if (notes.trim() || rating) await attempt(() => updateSession(id, { notes, rating }));
    close();
  };
  return (
    <Dialog
      open
      onClose={close}
      title={session.status === "completed" ? tr("Session complete") : tr("Session stopped")}
      width={460}
      footer={
        <>
          <Button onClick={close}>{tr("Skip")}</Button>
          <Button variant="primary" onClick={() => void save()}>
            {tr("Save")}
          </Button>
        </>
      }
    >
      <div className="mb-3 text-sm text-ink-2">
        <span className="tabular font-medium text-ink">{fmtDuration(sessionSeconds(id, entries))}</span>{" "}{tr("recorded")}{task ? tr(" on \"{0}\"", task.title) : ""}.
      </div>
      <Field label={tr("What did you accomplish during this session?")}>
        <Textarea autoFocus value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} onKeyDown={(e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && void save()} />
      </Field>
      <div className="mt-3">
        <div className="mb-1 text-xs font-medium text-ink-2">{tr("How focused were you? (optional)")}</div>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" aria-pressed={rating === n} onClick={() => setRating(rating === n ? null : n)} className={cx("h-8 w-9 rounded border text-sm", rating === n ? "border-accent bg-accent/10 font-medium text-accent" : "border-line-strong text-ink-2 hover:bg-hover")}>
              {n}
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
