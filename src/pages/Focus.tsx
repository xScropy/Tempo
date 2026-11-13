import { tn, tr } from "@/i18n";
import { AlertTriangle, Clock, Maximize2, Minimize2, Pause, Pencil, PictureInPicture2, Play, Plus, RotateCcw, SkipForward, Square, Trash2, Volume2, VolumeX } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { isTauri } from "@/db/driver";
import { addDays, atTime, dateOfMs, dayStartMs, fmtClock, fmtDate, fmtDuration, timeOf, todayStr } from "@/domain/dates";
import { findOverlaps, overlaps, totalSeconds } from "@/domain/time";
import { isRunning, remainingMs, type TimerMode } from "@/domain/timer";
import type { FocusSession, TimeEntry } from "@/domain/types";
import { attempt } from "@/lib/notify";
import { setMiniWindow } from "@/lib/platform";
import { setNoiseVolume, startNoise, stopNoise } from "@/lib/noise";
import { addManualEntry, deleteEntry, deleteSession, updateEntry, updateSession, updateTask } from "@/store/actions";
import { useData } from "@/store/data";
import { byId, intervals, sessionSeconds } from "@/store/selectors";
import { extendSession, pauseSession, restartSession, resumeSession, skipBreak, startSession, stopSession, timerElapsed, useTimer } from "@/store/timer";
import { confirmDialog, navigate, openTask, useUi } from "@/store/ui";
import { TaskPicker } from "@/components/TaskPicker";
import { ProjectOptions } from "@/components/task-bits";
import { Badge, Button, CommitInput, Dialog, DurationInput, Empty, Field, IconButton, Input, PageHeader, Section, Segmented, Select, Textarea, cx } from "@/components/ui";

const MODE_LABEL: Record<TimerMode, string> = { pomodoro: tr("Pomodoro"), deep: tr("Deep work"), countdown: tr("Countdown"), stopwatch: tr("Stopwatch") };

function Setup() {
  const settings = useData((s) => s.settings);
  const projects = useData((s) => s.projects);
  const targets = useData((s) => s.targets);
  const tasks = useData((s) => s.tasks);
  const [mode, setMode] = useState<TimerMode>("pomodoro");
  const [minutes, setMinutes] = useState<Record<TimerMode, number>>({ pomodoro: settings.focusMin, deep: settings.deepWorkMin, countdown: 45, stopwatch: 0 });
  const [taskId, setTaskId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [objective, setObjective] = useState("");
  const task = taskId ? byId(tasks).get(taskId) : undefined;
  const activeTargets = targets.filter((t) => !t.archived_at);

  const start = () =>
    void attempt(() =>
      startSession({ mode, minutes: minutes[mode], taskId, projectId: task ? undefined : projectId || null, targetId: targetId || null, objective }),
    );

  return (
    <div className="mx-auto w-full max-w-[460px] py-8">
      <div className="flex justify-center">
        <Segmented value={mode} onChange={setMode} options={(Object.keys(MODE_LABEL) as TimerMode[]).map((m) => ({ value: m, label: MODE_LABEL[m] }))} />
      </div>
      <div className="tabular my-8 text-center text-[72px] font-semibold leading-none tracking-tight">{mode === "stopwatch" ? "0:00" : fmtClock(minutes[mode] * 60)}</div>
      <div className="space-y-3">
        {mode !== "stopwatch" && (
          <Field label={tr("Length (minutes)")} hint={mode === "pomodoro" ? tr("Followed by a {0}-minute break; a {1}-minute break after every {2} sessions.", settings.shortBreakMin, settings.longBreakMin, settings.longBreakEvery) : undefined}>
            <Input type="number" min={1} max={720} value={minutes[mode]} onChange={(e) => setMinutes({ ...minutes, [mode]: Math.max(1, Math.min(720, Number(e.target.value) || 1)) })} />
          </Field>
        )}
        <Field group label={tr("Task")}>
          <TaskPicker value={taskId} onChange={setTaskId} />
        </Field>
        {!task && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={tr("Project")}>
              <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">{tr("None")}</option>
                <ProjectOptions projects={projects} />
              </Select>
            </Field>
            <Field label={tr("Activity (weekly target)")}>
              <Select value={targetId} onChange={(e) => setTargetId(e.target.value)} disabled={!activeTargets.length}>
                <option value="">{activeTargets.length ? tr("None") : tr("None defined")}</option>
                {activeTargets.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </Select>
            </Field>
          </div>
        )}
        <Field label={tr("Objective (optional)")}>
          <Input value={objective} placeholder={tr("What do you want to get done?")} onChange={(e) => setObjective(e.target.value)} onKeyDown={(e) => e.key === "Enter" && start()} />
        </Field>
        <Button variant="primary" className="!h-10 w-full text-base" icon={<Play size={15} />} onClick={start}>
          {tr("Start")}{" "}{MODE_LABEL[mode].toLowerCase()}
        </Button>
      </div>
    </div>
  );
}

function Running() {
  const timer = useTimer((s) => s.timer)!;
  const elapsed = useTimer(timerElapsed);
  const now = useTimer((s) => s.now);
  const task = useData((s) => (timer.taskId ? byId(s.tasks).get(timer.taskId) : undefined));
  const project = useData((s) => (timer.projectId ? byId(s.projects).get(timer.projectId) : undefined));
  const target = useData((s) => (timer.targetId ? s.targets.find((t) => t.id === timer.targetId) : undefined));
  const focusMode = useUi((s) => s.focusMode);
  const [noise, setNoise] = useState(false);
  const [volume, setVolume] = useState(0.4);
  const remaining = remainingMs(timer, now);
  const running = isRunning(timer);
  const isBreak = timer.phase !== "focus";
  const fraction = timer.plannedMs ? Math.min(1, elapsed / timer.plannedMs) : null;

  useEffect(() => () => stopNoise(), []);
  const R = 138;
  const C = 2 * Math.PI * R;

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col items-center py-8">
      <div className="text-xs font-semibold uppercase tracking-widest text-ink-2">{isBreak ? (timer.phase === "long_break" ? tr("Long break") : tr("Short break")) : `${MODE_LABEL[timer.mode]}${timer.mode === "pomodoro" ? ` · session ${timer.cycleCount + 1}` : ""}`}</div>
      <div className="relative my-6 flex h-[300px] w-[300px] items-center justify-center">
        <svg viewBox="0 0 300 300" className="absolute inset-0 -rotate-90" aria-hidden>
          <circle cx="150" cy="150" r={R} fill="none" stroke="rgb(var(--line))" strokeWidth="4" />
          {fraction != null && <circle cx="150" cy="150" r={R} fill="none" stroke={isBreak ? "rgb(var(--ink-3))" : "rgb(var(--accent))"} strokeWidth="4" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - fraction)} />}
        </svg>
        <div className="text-center">
          <div role="timer" aria-live="off" className={cx("tabular text-[64px] font-semibold leading-none tracking-tight", !running && "text-ink-3")}>{fmtClock((remaining ?? elapsed) / 1000)}</div>
          <div className="mt-2 text-sm text-ink-2">{!running ? tr("Paused") : remaining != null ? tr("{0} elapsed", fmtClock(elapsed / 1000)) : tr("Counting up")}</div>
        </div>
      </div>

      {!isBreak && (
        <div className="mb-5 max-w-full text-center">
          {task ? (
            <button type="button" className="max-w-full truncate text-lg font-medium hover:underline" onClick={() => openTask(task.id)}>
              {task.title}
            </button>
          ) : (
            <div className="text-lg font-medium">{timer.objective || target?.name || tr("Quick focus")}</div>
          )}
          <div className="mt-0.5 text-sm text-ink-2">{[project?.name, task && target?.name, task && timer.objective].filter(Boolean).join(" · ")}</div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="primary" className="!h-10 w-32 text-base" icon={running ? <Pause size={15} /> : <Play size={15} />} onClick={() => void attempt(running ? pauseSession : resumeSession)}>
          {running ? tr("Pause") : tr("Resume")}
        </Button>
        {isBreak ? (
          <Button className="!h-10" icon={<SkipForward size={14} />} onClick={() => void attempt(skipBreak)}>
            {tr("Skip break")}
          </Button>
        ) : (
          <>
            <Button className="!h-10" icon={<Square size={13} />} onClick={() => void attempt(stopSession)}>
              {timer.plannedMs == null ? tr("Finish") : tr("Stop")}
            </Button>
            {timer.plannedMs != null && (
              <Button className="!h-10" title={tr("Extend by 5 minutes")} onClick={() => void attempt(() => extendSession(5))}>
                {tr("+5 min")}
              </Button>
            )}
            <IconButton
              label={tr("Restart session (discards this session's time)")}
              className="!h-10 !w-10"
              onClick={() => void confirmDialog({ title: tr("Restart this session?"), body: tr("The time recorded in this session so far is discarded and the timer starts over."), confirmLabel: tr("Restart"), danger: true }).then((ok) => ok && attempt(restartSession))}
            >
              <RotateCcw size={15} />
            </IconButton>
          </>
        )}
      </div>

      <div className="mt-6 flex items-center gap-1">
        <IconButton
          label={noise ? tr("Turn ambient sound off") : tr("Turn ambient sound on (brown noise)")}
          active={noise}
          onClick={() => {
            if (noise) stopNoise();
            else startNoise(volume);
            setNoise(!noise);
          }}
        >
          {noise ? <Volume2 size={15} /> : <VolumeX size={15} />}
        </IconButton>
        {noise && <input type="range" min={0} max={1} step={0.05} value={volume} aria-label={tr("Ambient sound volume")} onChange={(e) => (setVolume(Number(e.target.value)), setNoiseVolume(Number(e.target.value)))} className="w-24 accent-[rgb(var(--accent))]" />}
        <IconButton label={focusMode ? tr("Leave focus mode (Esc)") : tr("Focus mode — hide everything else")} active={focusMode} onClick={() => useUi.setState({ focusMode: !focusMode })}>
          {focusMode ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </IconButton>
        {isTauri() && (
          <IconButton label={tr("Mini timer (always on top)")} onClick={() => void attempt(() => setMiniWindow(true)).then((ok) => ok && useUi.setState({ mini: true }))}>
            <PictureInPicture2 size={15} />
          </IconButton>
        )}
      </div>

      {task && !isBreak && (
        <div className="mt-6 w-full">
          <div className="mb-1 text-xs font-medium text-ink-2">{tr("Task notes")}</div>
          <CommitInput multiline rows={4} value={task.notes} placeholder={tr("Jot down anything you want to keep from this session…")} onCommit={(v) => void attempt(() => updateTask(task.id, { notes: v }))} />
        </div>
      )}
    </div>
  );
}

/** Compact always-on-top timer shown when the window is shrunk to mini mode. */
export function MiniTimer() {
  const timer = useTimer((s) => s.timer);
  const elapsed = useTimer(timerElapsed);
  const now = useTimer((s) => s.now);
  const task = useData((s) => (timer?.taskId ? byId(s.tasks).get(timer.taskId) : undefined));
  const restore = () => void attempt(() => setMiniWindow(false)).then(() => useUi.setState({ mini: false }));
  const running = timer ? isRunning(timer) : false;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 bg-surface px-3" data-tauri-drag-region>
      <div className="max-w-full truncate text-xs text-ink-2">{!timer ? tr("No active session") : timer.phase !== "focus" ? tr("Break") : (task?.title ?? (timer.objective || tr("Quick focus")))}</div>
      <div className={cx("tabular text-[40px] font-semibold leading-none", !running && "text-ink-3")}>{timer ? fmtClock(((remainingMs(timer, now) ?? elapsed) as number) / 1000) : "--:--"}</div>
      <div className="mt-1 flex gap-1">
        {timer && (
          <>
            <IconButton label={running ? tr("Pause") : tr("Resume")} onClick={() => void attempt(running ? pauseSession : resumeSession)}>
              {running ? <Pause size={14} /> : <Play size={14} />}
            </IconButton>
            <IconButton label={tr("Stop")} onClick={() => void attempt(stopSession)}>
              <Square size={13} />
            </IconButton>
          </>
        )}
        <IconButton label={tr("Back to full window")} onClick={restore}>
          <Maximize2 size={14} />
        </IconButton>
      </div>
    </div>
  );
}

interface EntryForm {
  id?: string;
  date: string;
  start: string;
  seconds: number | null;
  taskId: string | null;
  projectId: string;
  targetId: string;
  description: string;
}

export function EntryDialog({ entry, onClose }: { entry?: TimeEntry; onClose: () => void }) {
  const projects = useData((s) => s.projects);
  const targets = useData((s) => s.targets);
  const entries = useData((s) => s.entries);
  const tasks = useData((s) => s.tasks);
  const [f, setF] = useState<EntryForm>(() =>
    entry
      ? { id: entry.id, date: dateOfMs(entry.started_at), start: timeOf(entry.started_at), seconds: Math.round((entry.ended_at - entry.started_at) / 1000), taskId: entry.task_id, projectId: entry.project_id ?? "", targetId: entry.target_id ?? "", description: entry.description }
      : { date: todayStr(), start: timeOf(Date.now() - 30 * 60_000), seconds: 30 * 60, taskId: null, projectId: "", targetId: "", description: "" },
  );
  const started = atTime(f.date, f.start || "00:00");
  const ended = started + (f.seconds ?? 0) * 1000;
  const clashes = useMemo(() => (f.seconds ? intervals(entries).filter((e) => e.id !== f.id && overlaps(e, { start: started, end: ended })) : []), [entries, started, ended, f.id, f.seconds]);
  const task = f.taskId ? byId(tasks).get(f.taskId) : undefined;
  const inFuture = ended > Date.now() + 60_000;

  const save = async () => {
    const input = { started_at: started, ended_at: ended, task_id: f.taskId, project_id: task ? task.project_id : f.projectId || null, target_id: f.targetId || null, description: f.description };
    if (await attempt(() => (f.id ? updateEntry(f.id, input) : addManualEntry(input)))) onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={entry ? tr("Edit time entry") : tr("Add time manually")}
      footer={
        <>
          <Button onClick={onClose}>{tr("Cancel")}</Button>
          <Button variant="primary" disabled={!f.seconds || inFuture} onClick={() => void save()}>
            {clashes.length ? tr("Save anyway") : tr("Save")}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-3 gap-3">
        <Field label={tr("Date")}>
          <Input type="date" max={todayStr()} value={f.date} onChange={(e) => e.target.value && setF({ ...f, date: e.target.value })} />
        </Field>
        <Field label={tr("Started at")}>
          <Input type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />
        </Field>
        <Field label={tr("Duration")} hint={!f.seconds ? undefined : inFuture ? tr("Ends {0} — that is in the future. Move the start earlier.", timeOf(ended)) : tr("Ends {0}", timeOf(ended))}>
          <DurationInput value={f.seconds} onChange={(v) => setF({ ...f, seconds: v })} placeholder="45m" />
        </Field>
        <Field group label={tr("Task")} className="col-span-3">
          <TaskPicker value={f.taskId} onChange={(id) => setF({ ...f, taskId: id })} placeholder={tr("No task")} />
        </Field>
        {!task && (
          <Field label={tr("Project")} className="col-span-3">
            <Select value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}>
              <option value="">{tr("None")}</option>
              <ProjectOptions projects={projects} />
            </Select>
          </Field>
        )}
        {targets.some((t) => !t.archived_at) && (
          <Field label={tr("Activity (weekly target)")} className="col-span-3">
            <Select value={f.targetId} onChange={(e) => setF({ ...f, targetId: e.target.value })}>
              <option value="">{tr("None")}</option>
              {targets.filter((t) => !t.archived_at).map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={tr("Description")} className="col-span-3">
          <Textarea rows={2} value={f.description} placeholder={tr("I spent 45 minutes reading a judgment")} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
      </div>
      {clashes.length > 0 && (
        <div className="mt-3 flex gap-2 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" />
          <div>
            {tr("Overlaps")}{" "}{clashes.length}{" "}{tr("existing entr")}{clashes.length === 1 ? "y" : tr("ies")} ({clashes.slice(0, 3).map((c) => `${timeOf(c.start)}–${timeOf(c.end)}`).join(", ")}{tr("). Overlapping minutes are only counted once in daily, weekly and project totals.")}
          </div>
        </div>
      )}
    </Dialog>
  );
}

function SessionDialog({ session, onClose }: { session: FocusSession; onClose: () => void }) {
  const [notes, setNotes] = useState(session.notes);
  const [rating, setRating] = useState(session.rating);
  return (
    <Dialog
      open
      onClose={onClose}
      title={tr("Session notes")}
      width={440}
      footer={
        <>
          <Button onClick={onClose}>{tr("Cancel")}</Button>
          <Button variant="primary" onClick={() => void attempt(() => updateSession(session.id, { notes, rating })).then((ok) => ok && onClose())}>
            {tr("Save")}
          </Button>
        </>
      }
    >
      <Field label={tr("What did you accomplish?")}>
        <Textarea autoFocus rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="mt-3 flex items-center gap-1">
        <span className="me-2 text-xs font-medium text-ink-2">{tr("Focus rating")}</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" aria-pressed={rating === n} onClick={() => setRating(rating === n ? null : n)} className={cx("h-7 w-8 rounded border text-sm", rating === n ? "border-accent bg-accent/10 font-medium text-accent" : "border-line-strong text-ink-2 hover:bg-hover")}>
            {n}
          </button>
        ))}
      </div>
    </Dialog>
  );
}

function History() {
  const today = useUi((s) => s.today);
  const entries = useData((s) => s.entries);
  const sessions = useData((s) => s.sessions);
  const tasks = useData((s) => s.tasks);
  const projects = useData((s) => s.projects);
  const targets = useData((s) => s.targets);
  const [days, setDays] = useState(14);
  const [editing, setEditing] = useState<TimeEntry | "new" | null>(null);
  const [noting, setNoting] = useState<FocusSession | null>(null);

  const from = dayStartMs(addDays(today, -days + 1));
  const recent = useMemo(() => intervals(entries).filter((e) => e.end > from).reverse(), [entries, from]);
  const clashing = useMemo(() => new Set(findOverlaps(recent).flatMap(([a, b]) => [a.id, b.id])), [recent]);
  const byDay = useMemo(() => {
    const m = new Map<string, typeof recent>();
    for (const e of recent) {
      const d = dateOfMs(e.start);
      m.set(d, [...(m.get(d) ?? []), e]);
    }
    return [...m.entries()];
  }, [recent]);
  const taskMap = byId(tasks);
  const projectMap = byId(projects);
  const sessionMap = byId(sessions);

  return (
    <div className="mx-auto w-full max-w-[860px] px-5 py-4">
      <div className="mb-3 flex items-center gap-2">
        <div className="me-auto text-sm text-ink-2">{tr("Every stretch of tracked time, newest first. Timer sessions are recorded automatically; anything else can be added by hand.")}</div>
        <Button icon={<Plus size={14} />} onClick={() => setEditing("new")}>
          {tr("Add time")}
        </Button>
      </div>
      {byDay.length === 0 && <Empty title={tr("No time tracked yet")} body={tr("Start a focus session or add time manually. Sessions and their real, pause-free durations will be listed here.")} />}
      {byDay.map(([date, list]) => (
        <Section key={date} className="mb-3" title={fmtDate(date, today)} action={<span className="tabular text-xs text-ink-2">{fmtDuration(totalSeconds(list))}{" "}{tr("tracked")}</span>}>
          {list.map((e) => {
            const session = e.session_id ? sessionMap.get(e.session_id) : undefined;
            const task = e.task_id ? taskMap.get(e.task_id) : undefined;
            const label = task?.title ?? (e.description || session?.objective || targets.find((t) => t.id === e.target_id)?.name || "Untitled focus");
            return (
              <div key={e.id} className="group flex items-center gap-3 border-b border-line px-3 py-1.5 text-sm last:border-0">
                <span className="tabular w-[92px] shrink-0 text-ink-2">{timeOf(e.start)} – {timeOf(e.end)}</span>
                <span className="tabular w-14 shrink-0 font-medium">{fmtDuration((e.end - e.start) / 1000)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{label}</span>
                  {(session?.notes || (task && e.description)) && <span className="block truncate text-xs text-ink-2">{session?.notes || e.description}</span>}
                </span>
                {e.project_id && <span className="max-w-[130px] shrink-0 truncate text-xs text-ink-2">{projectMap.get(e.project_id)?.name}</span>}
                {clashing.has(e.id) && <Badge tone="warn">{tr("Overlap")}</Badge>}
                {e.source === "manual" ? <Badge>{tr("Manual")}</Badge> : session?.status === "interrupted" ? <Badge>{tr("Interrupted")}</Badge> : session?.rating ? <Badge>{session.rating}/5</Badge> : null}
                <span className="flex shrink-0 opacity-0 focus-within:opacity-100 group-hover:opacity-100">
                  {session && (
                    <IconButton label={tr("Session notes and rating")} onClick={() => setNoting(session)}>
                      <Pencil size={13} />
                    </IconButton>
                  )}
                  <IconButton label={session ? tr("Correct start time and duration") : tr("Edit entry")} onClick={() => setEditing(e)}>
                    {session ? <Clock size={13} /> : <Pencil size={13} />}
                  </IconButton>
                  <IconButton
                    label={tr("Delete entry")}
                    onClick={() =>
                      void confirmDialog({ title: tr("Delete this time entry?"), body: tr("{0} of tracked time will be removed from all totals.", fmtDuration((e.end - e.start) / 1000)), confirmLabel: tr("Delete"), danger: true }).then(
                        (ok) => ok && attempt(() => (session && sessionSeconds(session.id, entries) === Math.round((e.end - e.start) / 1000) ? deleteSession(session.id) : deleteEntry(e.id))),
                      )
                    }
                  >
                    <Trash2 size={13} />
                  </IconButton>
                </span>
              </div>
            );
          })}
        </Section>
      ))}
      {recent.length > 0 && (
        <div className="flex justify-center py-2">
          <Button variant="ghost" onClick={() => setDays(days + 30)}>
            {tr("Show earlier entries")}
          </Button>
        </div>
      )}
      {editing && <EntryDialog entry={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
      {noting && <SessionDialog session={noting} onClose={() => setNoting(null)} />}
    </div>
  );
}

export function FocusPage() {
  const timer = useTimer((s) => s.timer);
  const routeId = useUi((s) => s.routeId);
  const focusMode = useUi((s) => s.focusMode);
  const today = useUi((s) => s.today);
  const entries = useData((s) => s.entries);
  const sessions = useData((s) => s.sessions);
  const tab = routeId === "history" ? "history" : "timer";
  const todayFrom = dayStartMs(today);
  const todaySeconds = useMemo(() => totalSeconds(intervals(entries), todayFrom, todayFrom + 86_400_000), [entries, todayFrom]);
  const todaySessions = sessions.filter((s) => s.started_at >= todayFrom && s.status === "completed").length;

  if (focusMode) {
    return (
      <div className="flex h-full items-center justify-center overflow-y-auto">
        {timer ? <Running /> : <Setup />}
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col">
      <PageHeader title={tr("Focus")} subtitle={tr("Today: {0} focused · {1} completed", fmtDuration(todaySeconds), tn(todaySessions, "session"))}>
        <Segmented value={tab} onChange={(t) => navigate("focus", t === "history" ? "history" : null)} options={[{ value: "timer", label: tr("Timer") }, { value: "history", label: tr("Time log") }]} />
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-5">{tab === "history" ? <History /> : timer ? <Running /> : <Setup />}</div>
    </div>
  );
}
