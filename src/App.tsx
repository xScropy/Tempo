import { useEffect, useRef, useState } from "react";
import { isTauri, openDatabase } from "@/db/driver";
import { todayStr } from "@/domain/dates";
import { isRunning } from "@/domain/timer";
import { attempt, reportError } from "@/lib/notify";
import { backups, registerQuickCapture, setMiniWindow } from "@/lib/platform";
import { checkReminders } from "@/lib/reminders";
import { generateOccurrences, setSetting } from "@/store/actions";
import { data, reload, useData } from "@/store/data";
import { pauseSession, restoreTimer, resumeSession, startSession, tick, useTimer } from "@/store/timer";
import { PAGES, navigate, openQuickAdd, openSearch, openTask, useUi, type Page } from "@/store/ui";
import { Sidebar } from "@/components/Sidebar";
import { TaskDetail } from "@/components/TaskDetail";
import { ConfirmHost, GapDialog, ProjectDialog, QuickAdd, SearchPalette, SessionReview, Toasts } from "@/components/overlays";
import { AnalyticsPage } from "@/pages/Analytics";
import { CalendarPage } from "@/pages/Calendar";
import { DashboardPage } from "@/pages/Dashboard";
import { FocusPage, MiniTimer } from "@/pages/Focus";
import { FriendsPage } from "@/pages/Friends";
import { GoalsPage } from "@/pages/Goals";
import { HabitsPage } from "@/pages/Habits";
import { JournalPage } from "@/pages/Journal";
import { ProjectsPage } from "@/pages/Projects";
import { SettingsPage } from "@/pages/Settings";
import { InboxPage, TasksPage } from "@/pages/Tasks";

const ROUTES: Record<Page, () => JSX.Element> = {
  dashboard: DashboardPage, inbox: InboxPage, tasks: TasksPage, projects: ProjectsPage, calendar: CalendarPage, focus: FocusPage,
  habits: HabitsPage, goals: GoalsPage, analytics: AnalyticsPage, journal: JournalPage, friends: FriendsPage, settings: SettingsPage,
};

let booting: Promise<void> | null = null;
/** Runs once even though React StrictMode mounts effects twice in development. */
const boot = () => (booting ??= bootOnce());

async function bootOnce() {
  await openDatabase();
  await reload();
  await generateOccurrences();
  await restoreTimer();
  useData.setState({ ready: true });
  const s = data().settings;
  void registerQuickCapture(s.quickCaptureShortcut, () => openQuickAdd()).catch(() => undefined);
  if (isTauri() && s.autoBackup && Date.now() - s.lastAutoBackup > 24 * 3_600_000) {
    void backups.create("auto", s.backupKeep).then(() => setSetting("lastAutoBackup", Date.now())).catch(() => undefined);
  }
}

function useTheme() {
  const theme = useData((s) => s.settings.theme);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && mq.matches));
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
}

/** One loop drives the timer, reminders, and the midnight rollover. */
function useLoops(ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    let n = 0;
    const run = () => {
      void tick().catch(reportError);
      if (n++ % 30 === 0) {
        void checkReminders().catch(() => undefined);
        const today = todayStr();
        if (today !== useUi.getState().today) {
          useUi.setState({ today });
          void generateOccurrences(today).catch(reportError);
        }
      }
    };
    run();
    const id = setInterval(run, 1000);
    // Timers are throttled in hidden windows; catch up the moment we are visible again.
    const wake = () => document.visibilityState === "visible" && run();
    document.addEventListener("visibilitychange", wake);
    return () => (clearInterval(id), document.removeEventListener("visibilitychange", wake));
  }, [ready]);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const ui = useUi.getState();
      const done = () => e.preventDefault();
      if (mod && key === "k") return (done(), openSearch());
      if (mod && e.shiftKey && key === "p") return (done(), useUi.setState({ projectDialog: { parentId: null } }));
      if (mod && key === "n") return (done(), openQuickAdd());
      if (e.altKey && key === "t") {
        done();
        const t = useTimer.getState().timer;
        if (!t) return void attempt(() => startSession({ mode: "pomodoro" }));
        return void attempt(isRunning(t) ? pauseSession : resumeSession);
      }
      if (e.altKey && key === "c") return (done(), navigate("calendar"));
      if (e.altKey && /^[1-9]$/.test(key)) return (done(), navigate(PAGES[Number(key) - 1]!));
      if (e.key === "Escape" && !ui.search && !ui.quickAdd && !ui.confirm && !ui.projectDialog && !document.querySelector('[role="dialog"]')) {
        if (typing) return el.blur();
        if (ui.focusMode) return useUi.setState({ focusMode: false });
        if (ui.taskId) return openTask(null);
      }
      if (typing || mod || e.altKey) return;
      if (key === "n") return (done(), openQuickAdd());
      if (key === "/") return (done(), openSearch());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function DetailPanel({ taskId }: { taskId: string }) {
  const width = useData((s) => s.settings.detailWidth);
  const [drag, setDrag] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const start = (e: React.PointerEvent) => {
    e.preventDefault();
    const right = ref.current!.getBoundingClientRect().right;
    const clamp = (x: number) => Math.min(720, Math.max(340, right - x));
    const move = (ev: PointerEvent) => setDrag(clamp(ev.clientX));
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      void attempt(() => setSetting("detailWidth", Math.round(clamp(ev.clientX))));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <aside ref={ref} aria-label="Task details" className="no-print relative shrink-0 border-l border-line bg-surface" style={{ width: drag ?? width }}>
      <div role="separator" aria-orientation="vertical" aria-label="Resize panel" onPointerDown={start} className="absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize hover:bg-accent/30" />
      <TaskDetail taskId={taskId} />
    </aside>
  );
}

export function App() {
  const ready = useData((s) => s.ready);
  const page = useUi((s) => s.page);
  const taskId = useUi((s) => s.taskId);
  const focusMode = useUi((s) => s.focusMode);
  const mini = useUi((s) => s.mini);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    boot().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useTheme();
  useLoops(ready);
  useShortcuts();
  useEffect(() => {
    // Leaving mini mode without the button (e.g. the session ended) restores the window.
    if (mini && !isTauri()) useUi.setState({ mini: false });
    return () => void (mini && setMiniWindow(false));
  }, [mini]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md text-center">
          <div className="text-lg font-semibold">Tempo could not open its database</div>
          <div className="selectable mt-2 text-sm text-ink-2">{error}</div>
          <div className="mt-2 text-sm text-ink-2">Your data has not been modified. Restart Tempo; if this keeps happening, restore the most recent file from the backups folder.</div>
        </div>
      </div>
    );
  }
  if (!ready) return null;
  if (mini) return <MiniTimer />;

  const PageView = ROUTES[page];
  return (
    <div className="flex h-full">
      {!focusMode && <Sidebar />}
      <main className="print-area min-w-0 flex-1">{focusMode ? <FocusPage /> : <PageView />}</main>
      {taskId && !focusMode && <DetailPanel taskId={taskId} />}
      <QuickAdd />
      <ProjectDialog />
      <SearchPalette />
      <GapDialog />
      <SessionReview />
      <ConfirmHost />
      <Toasts />
    </div>
  );
}
