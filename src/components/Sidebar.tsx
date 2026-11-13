import { tr } from "@/i18n";
import { BarChart3, BookOpen, Coins, Moon, Sun, Trophy, CalendarDays, CheckSquare, Folder, Inbox, LayoutDashboard, PanelLeftClose, PanelLeftOpen, Pause, Play, Plus, Repeat2, Search, Settings, Square, Target, Timer, Users } from "lucide-react";
import { fmtClock } from "@/domain/dates";
import { isRunning, remainingMs } from "@/domain/timer";
import { isOverdue } from "@/domain/projects";
import { isOpen } from "@/domain/types";
import { attempt } from "@/lib/notify";
import { setSetting } from "@/store/actions";
import { useData } from "@/store/data";
import { pauseSession, resumeSession, stopSession, timerElapsed, useTimer } from "@/store/timer";
import { navigate, openQuickAdd, openSearch, useUi, type Page } from "@/store/ui";
import { levelTitle } from "@/domain/game";
import { useGame } from "@/pages/Rewards";
import { IconButton, Progress, cx } from "./ui";

/** Level and token summary. Bumps whenever XP is gained. */
function LevelChip({ compact }: { compact: boolean }) {
  const g = useGame();
  if (compact) {
    return (
      <button key={g.totals.xp} type="button" title={tr("Level {0} · {1} tokens", g.level.level, g.tokens)} onClick={() => navigate("rewards")} className="bump tabular mx-auto mb-1 flex h-7 w-9 items-center justify-center rounded border border-line text-2xs font-semibold text-ink-2 hover:bg-hover">
        L{g.level.level}
      </button>
    );
  }
  return (
    <button key={g.totals.xp} type="button" onClick={() => navigate("rewards")} className="bump mx-2 mb-2 block rounded-md border border-line bg-surface px-2.5 py-2 text-start hover:border-line-strong">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 font-semibold">
          <span className="tabular flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-2xs text-accent-ink">{g.level.level}</span>
          {levelTitle(g.level.level)}
        </span>
        <span className="tabular inline-flex items-center gap-1 text-ink-2">
          <Coins size={11} className="text-warn" />
          {g.tokens}
        </span>
      </div>
      <Progress value={g.level.fraction} className="mt-1.5" />
      <div className="tabular mt-1 text-2xs text-ink-3">{g.level.needed - g.level.into}{" "}{tr("XP to level")}{" "}{g.level.level + 1}</div>
    </button>
  );
}

const ITEMS: Array<{ page: Page; label: string; icon: typeof Inbox }> = [
  { page: "dashboard", label: tr("Dashboard"), icon: LayoutDashboard },
  { page: "inbox", label: tr("Inbox"), icon: Inbox },
  { page: "tasks", label: tr("My Tasks"), icon: CheckSquare },
  { page: "projects", label: tr("Projects"), icon: Folder },
  { page: "calendar", label: tr("Calendar"), icon: CalendarDays },
  { page: "focus", label: tr("Focus"), icon: Timer },
  { page: "habits", label: tr("Habits"), icon: Repeat2 },
  { page: "goals", label: tr("Goals"), icon: Target },
  { page: "analytics", label: tr("Analytics"), icon: BarChart3 },
  { page: "rewards", label: tr("Rewards"), icon: Trophy },
  { page: "journal", label: tr("Journal"), icon: BookOpen },
  { page: "friends", label: tr("Social"), icon: Users },
];

export function TimerChip({ compact }: { compact?: boolean }) {
  const timer = useTimer((s) => s.timer);
  const elapsed = useTimer(timerElapsed);
  const now = useTimer((s) => s.now);
  const task = useData((s) => (timer?.taskId ? s.tasks.find((t) => t.id === timer.taskId) : undefined));
  if (!timer) return null;
  const remaining = remainingMs(timer, now);
  const running = isRunning(timer);
  const label = timer.phase === "focus" ? (task?.title ?? (timer.objective || "Quick focus")) : timer.phase === "long_break" ? "Long break" : "Short break";
  const clock = fmtClock((remaining ?? elapsed) / 1000);
  if (compact) {
    return (
      <button type="button" title={`${label} — ${clock}`} onClick={() => navigate("focus")} className={cx("tabular mx-auto mb-1 flex h-9 w-9 items-center justify-center rounded text-2xs font-semibold", running ? "bg-accent text-accent-ink" : "bg-hover text-ink-2")}>
        {clock.slice(0, 5)}
      </button>
    );
  }
  return (
    <div className="mx-2 mb-2 rounded-md border border-line bg-surface p-2">
      <button type="button" className="block w-full text-start" onClick={() => navigate("focus")}>
        <div className="truncate text-xs text-ink-2">{label}</div>
        <div className={cx("tabular text-xl font-semibold leading-7", !running && "text-ink-3")}>{clock}</div>
      </button>
      <div className="mt-1 flex gap-1">
        <IconButton label={running ? tr("Pause") : tr("Resume")} onClick={() => void attempt(running ? pauseSession : resumeSession)}>
          {running ? <Pause size={14} /> : <Play size={14} />}
        </IconButton>
        <IconButton label={tr("Stop")} onClick={() => void attempt(stopSession)}>
          <Square size={13} />
        </IconButton>
      </div>
    </div>
  );
}

export function Sidebar() {
  const page = useUi((s) => s.page);
  const today = useUi((s) => s.today);
  const collapsed = useData((s) => s.settings.sidebarCollapsed);
  const gamified = useData((s) => s.settings.gamification);
  const theme = useData((s) => s.settings.theme);
  const isDark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const inboxCount = useData((s) => s.tasks.reduce((n, t) => n + (t.status === "inbox" && !t.parent_id ? 1 : 0), 0));
  const todayCount = useData((s) => s.tasks.reduce((n, t) => n + (!t.parent_id && isOpen(t) && (t.due_date === today || isOverdue(t, today)) ? 1 : 0), 0));
  const counts: Partial<Record<Page, number>> = { inbox: inboxCount, tasks: todayCount };

  return (
    <nav aria-label={tr("Main")} className={cx("no-print flex shrink-0 flex-col border-e border-line bg-raised transition-[width] duration-150", collapsed ? "w-[52px]" : "w-[216px]")}>
      <div className={cx("flex h-[52px] shrink-0 items-center", collapsed ? "justify-center" : "justify-between px-3")}>
        {!collapsed && (
          <span className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
              <rect width="24" height="24" rx="6" fill="rgb(var(--accent))" />
              <path d="M12 5.5a6.5 6.5 0 1 1-6.5 6.5" fill="none" stroke="rgb(var(--accent-ink))" strokeWidth="2.2" strokeLinecap="round" />
              <circle cx="12" cy="12" r="1.7" fill="rgb(var(--accent-ink))" />
            </svg>
            {tr("Tempo")}
          </span>
        )}
        <IconButton label={collapsed ? tr("Expand sidebar") : tr("Collapse sidebar")} onClick={() => void attempt(() => setSetting("sidebarCollapsed", !collapsed))}>
          {collapsed ? <PanelLeftOpen className="rtl:rotate-180" size={15} /> : <PanelLeftClose className="rtl:rotate-180" size={15} />}
        </IconButton>
      </div>
      <div className={cx("mb-2 flex gap-1.5", collapsed ? "flex-col items-center" : "px-2")}>
        <button type="button" title={tr("New task (N)")} onClick={() => openQuickAdd()} className={cx("flex h-8 items-center justify-center gap-1.5 rounded bg-accent text-sm font-medium text-accent-ink hover:bg-accent/90", collapsed ? "w-8" : "flex-1")}>
          <Plus size={15} />
          {!collapsed && tr("New task")}
        </button>
        <button type="button" title={tr("Search (Ctrl+K)")} aria-label={tr("Search")} onClick={openSearch} className="flex h-8 w-8 items-center justify-center rounded border border-line-strong bg-surface text-ink-2 hover:bg-hover hover:text-ink">
          <Search size={14} />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-px overflow-y-auto px-2">
        {ITEMS.filter((i) => gamified || i.page !== "rewards").map(({ page: p, label, icon: Icon }) => (
          <button
            key={p}
            type="button"
            title={collapsed ? label : undefined}
            aria-current={page === p ? "page" : undefined}
            onClick={() => navigate(p)}
            className={cx("flex h-8 w-full items-center gap-2.5 rounded text-sm transition-colors", collapsed ? "justify-center" : "px-2", page === p ? "bg-hover font-medium text-ink" : "text-ink-2 hover:bg-hover/70 hover:text-ink")}
          >
            <Icon size={15} className="shrink-0" />
            {!collapsed && <span className="flex-1 text-start">{label}</span>}
            {!collapsed && !!counts[p] && <span className="tabular text-xs text-ink-3">{counts[p]}</span>}
          </button>
        ))}
      </div>
      {gamified && <LevelChip compact={collapsed} />}
      <TimerChip compact={collapsed} />
      <div className={cx("flex gap-1 border-t border-line p-2", collapsed && "flex-col items-center")}>
        <button
          type="button"
          title={collapsed ? tr("Settings") : undefined}
          aria-current={page === "settings" ? "page" : undefined}
          onClick={() => navigate("settings")}
          className={cx("flex h-8 min-w-0 flex-1 items-center gap-2.5 rounded text-sm", collapsed ? "w-8 flex-none justify-center" : "px-2", page === "settings" ? "bg-hover font-medium text-ink" : "text-ink-2 hover:bg-hover/70 hover:text-ink")}
        >
          <Settings size={15} />
          {!collapsed && tr("Settings")}
        </button>
        <IconButton label={isDark ? tr("Switch to light mode") : tr("Switch to dark mode")} className="!h-8 !w-8" onClick={() => void attempt(() => setSetting("theme", isDark ? "light" : "dark"))}>
          {isDark ? <Sun size={15} /> : <Moon size={15} />}
        </IconButton>
      </div>
    </nav>
  );
}
