import { BarChart3, BookOpen, Moon, Sun, Trophy, CalendarDays, CheckSquare, Folder, Inbox, LayoutDashboard, PanelLeftClose, PanelLeftOpen, Pause, Play, Plus, Repeat2, Search, Settings, Square, Target, Timer, Users } from "lucide-react";
import { fmtClock } from "@/domain/dates";
import { isRunning, remainingMs } from "@/domain/timer";
import { isOverdue } from "@/domain/projects";
import { isOpen } from "@/domain/types";
import { attempt } from "@/lib/notify";
import { setSetting } from "@/store/actions";
import { useData } from "@/store/data";
import { pauseSession, resumeSession, stopSession, timerElapsed, useTimer } from "@/store/timer";
import { navigate, openQuickAdd, openSearch, useUi, type Page } from "@/store/ui";
import { useEffect, useRef } from "react";
import { levelTitle } from "@/domain/game";
import { toast } from "@/lib/notify";
import { useGame } from "@/pages/Rewards";
import { IconButton, Progress, cx } from "./ui";

/** Level and token summary; announces level-ups as they happen. */
function LevelChip({ compact }: { compact: boolean }) {
  const g = useGame();
  const prev = useRef(g.level.level);
  useEffect(() => {
    if (g.level.level > prev.current) toast(`Level ${g.level.level} reached`, `You are now "${levelTitle(g.level.level)}". Keep going.`, "ok");
    prev.current = g.level.level;
  }, [g.level.level]);
  if (compact) {
    return (
      <button type="button" title={`Level ${g.level.level} · ${g.tokens} tokens`} onClick={() => navigate("rewards")} className="tabular mx-auto mb-1 flex h-7 w-9 items-center justify-center rounded border border-line text-2xs font-semibold text-ink-2 hover:bg-hover">
        L{g.level.level}
      </button>
    );
  }
  return (
    <button type="button" onClick={() => navigate("rewards")} className="mx-2 mb-2 block rounded-md border border-line px-2 py-1.5 text-left hover:bg-hover/60">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium">Level {g.level.level}</span>
        <span className="tabular text-ink-2">{g.tokens} token{g.tokens === 1 ? "" : "s"}</span>
      </div>
      <Progress value={g.level.fraction} className="mt-1" />
    </button>
  );
}

const ITEMS: Array<{ page: Page; label: string; icon: typeof Inbox }> = [
  { page: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { page: "inbox", label: "Inbox", icon: Inbox },
  { page: "tasks", label: "My Tasks", icon: CheckSquare },
  { page: "projects", label: "Projects", icon: Folder },
  { page: "calendar", label: "Calendar", icon: CalendarDays },
  { page: "focus", label: "Focus", icon: Timer },
  { page: "habits", label: "Habits", icon: Repeat2 },
  { page: "goals", label: "Goals", icon: Target },
  { page: "analytics", label: "Analytics", icon: BarChart3 },
  { page: "rewards", label: "Rewards", icon: Trophy },
  { page: "journal", label: "Journal", icon: BookOpen },
  { page: "friends", label: "Friends", icon: Users },
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
      <button type="button" className="block w-full text-left" onClick={() => navigate("focus")}>
        <div className="truncate text-xs text-ink-2">{label}</div>
        <div className={cx("tabular text-xl font-semibold leading-7", !running && "text-ink-3")}>{clock}</div>
      </button>
      <div className="mt-1 flex gap-1">
        <IconButton label={running ? "Pause" : "Resume"} onClick={() => void attempt(running ? pauseSession : resumeSession)}>
          {running ? <Pause size={14} /> : <Play size={14} />}
        </IconButton>
        <IconButton label="Stop" onClick={() => void attempt(stopSession)}>
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
    <nav aria-label="Main" className={cx("no-print flex shrink-0 flex-col border-r border-line bg-raised transition-[width] duration-150", collapsed ? "w-[52px]" : "w-[216px]")}>
      <div className={cx("flex h-[52px] shrink-0 items-center", collapsed ? "justify-center" : "justify-between px-3")}>
        {!collapsed && <span className="text-base font-semibold tracking-tight">Tempo</span>}
        <IconButton label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={() => void attempt(() => setSetting("sidebarCollapsed", !collapsed))}>
          {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </IconButton>
      </div>
      <div className={cx("mb-2 flex gap-1.5", collapsed ? "flex-col items-center" : "px-2")}>
        <button type="button" title="New task (N)" onClick={() => openQuickAdd()} className={cx("flex h-8 items-center justify-center gap-1.5 rounded bg-accent text-sm font-medium text-accent-ink hover:bg-accent/90", collapsed ? "w-8" : "flex-1")}>
          <Plus size={15} />
          {!collapsed && "New task"}
        </button>
        <button type="button" title="Search (Ctrl+K)" aria-label="Search" onClick={openSearch} className="flex h-8 w-8 items-center justify-center rounded border border-line-strong bg-surface text-ink-2 hover:bg-hover hover:text-ink">
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
            {!collapsed && <span className="flex-1 text-left">{label}</span>}
            {!collapsed && !!counts[p] && <span className="tabular text-xs text-ink-3">{counts[p]}</span>}
          </button>
        ))}
      </div>
      {gamified && <LevelChip compact={collapsed} />}
      <TimerChip compact={collapsed} />
      <div className={cx("flex gap-1 border-t border-line p-2", collapsed && "flex-col items-center")}>
        <button
          type="button"
          title={collapsed ? "Settings" : undefined}
          aria-current={page === "settings" ? "page" : undefined}
          onClick={() => navigate("settings")}
          className={cx("flex h-8 min-w-0 flex-1 items-center gap-2.5 rounded text-sm", collapsed ? "w-8 flex-none justify-center" : "px-2", page === "settings" ? "bg-hover font-medium text-ink" : "text-ink-2 hover:bg-hover/70 hover:text-ink")}
        >
          <Settings size={15} />
          {!collapsed && "Settings"}
        </button>
        <IconButton label={isDark ? "Switch to light mode" : "Switch to dark mode"} className="!h-8 !w-8" onClick={() => void attempt(() => setSetting("theme", isDark ? "light" : "dark"))}>
          {isDark ? <Sun size={15} /> : <Moon size={15} />}
        </IconButton>
      </div>
    </nav>
  );
}
