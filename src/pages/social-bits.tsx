import { useMemo } from "react";
import { fmtClock, fmtDuration } from "@/domain/dates";
import { useSocial } from "@/social/client";
import type { FriendView, MeView, PeriodStats, Presence, PublicProfile } from "@/social/protocol";
import { cx } from "@/components/ui";

export function Avatar({ user, size = 28 }: { user: PublicProfile; size?: number }) {
  const initials = user.displayName.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <span aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white" style={{ width: size, height: size, background: user.color, fontSize: size * 0.38 }}>
      {initials}
    </span>
  );
}

const MODE: Record<string, string> = { pomodoro: "Pomodoro", deep: "Deep work", countdown: "Countdown", stopwatch: "Stopwatch", short_break: "Short break", long_break: "Long break" };
const DOT: Record<Presence["status"], string> = { focusing: "bg-ok", break: "bg-warn", online: "bg-accent", idle: "bg-ink-3", offline: "bg-line-strong" };
export const STATUS_LABEL: Record<Presence["status"], string> = { focusing: "Focusing", break: "On break", online: "Online", idle: "Idle", offline: "Offline" };

function ago(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
}

/** Live status line. Elapsed and remaining time are extrapolated from the server's timestamps. */
export function PresenceLine({ presence, compact }: { presence: Presence; compact?: boolean }) {
  const now = useSocial((s) => s.now);
  const offset = useSocial((s) => s.offsetMs);
  const p = presence;
  let detail = "";
  if (p.status === "offline") detail = p.lastSeen ? `last seen ${ago(now + offset - p.lastSeen)}` : "";
  else if ((p.status === "focusing" || p.status === "break") && p.at != null) {
    const elapsed = Math.max(0, (p.elapsedMs ?? 0) + (now + offset - p.at));
    const planned = p.plannedMs;
    const kind = p.mode ? (MODE[p.mode] ?? p.mode) : "";
    detail = planned ? `${Math.round(planned / 60_000)}-minute ${kind.toLowerCase()} · ${fmtClock(Math.min(elapsed, planned) / 1000)} elapsed · ${fmtClock(Math.max(0, planned - elapsed) / 1000)} left` : `${kind} · ${fmtClock(elapsed / 1000)} elapsed`;
  } else if (p.status === "focusing" || p.status === "break") detail = p.mode ? (MODE[p.mode] ?? "") : "";
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs">
      <span className={cx("h-2 w-2 shrink-0 rounded-full", DOT[p.status])} />
      <span className={cx("shrink-0 font-medium", p.status === "focusing" ? "text-ok" : p.status === "break" ? "text-warn" : p.status === "offline" ? "text-ink-3" : "text-ink-2")}>{STATUS_LABEL[p.status]}</span>
      {!compact && detail && <span className="tabular truncate text-ink-2">· {detail}</span>}
      {!compact && p.objective && <span className="truncate text-ink-3">· “{p.objective}”</span>}
    </span>
  );
}

export const pct = (s: PeriodStats) => (s.seconds != null && s.targetSeconds ? s.seconds / s.targetSeconds : null);
export const hrs = (seconds: number | null) => (seconds == null ? "—" : fmtDuration(seconds));

export type BoardMetric = "focus" | "sessions" | "goal" | "streak" | "consistency";
export const METRIC_LABEL: Record<BoardMetric, string> = { focus: "Focus hours", sessions: "Completed sessions", goal: "Weekly goal completion", streak: "Current streak", consistency: "Consistency (productive days)" };

type Person = (FriendView | MeView) & { me?: boolean };

function metricValue(p: Person, metric: BoardMetric, period: "week" | "lastWeek" | "month"): number | null {
  const s = p[period];
  switch (metric) {
    case "focus":
      return s.seconds;
    case "sessions":
      return s.sessions;
    case "goal":
      return pct(period === "month" ? p.week : s);
    case "streak":
      return p.streak;
    case "consistency":
      return s.productiveDays;
  }
}

export interface BoardRow {
  person: Person;
  value: number | null;
  rank: number | null;
  /** positive = moved up compared with last week */
  change: number | null;
}

/** Ranks you and your friends on one metric. People who do not share that statistic are listed unranked. */
export function leaderboard(people: Person[], metric: BoardMetric, period: "week" | "month"): BoardRow[] {
  const rankOf = (per: "week" | "lastWeek" | "month") => {
    const vals = people.map((p) => ({ id: p.id, v: metricValue(p, metric, per) })).filter((x): x is { id: string; v: number } => x.v != null).sort((a, b) => b.v - a.v);
    const ranks = new Map<string, number>();
    vals.forEach((x, i) => ranks.set(x.id, i > 0 && vals[i - 1]!.v === x.v ? ranks.get(vals[i - 1]!.id)! : i + 1));
    return ranks;
  };
  const cur = rankOf(period);
  const prev = period === "week" && metric !== "streak" ? rankOf("lastWeek") : null;
  return people
    .map((person): BoardRow => {
      const rank = cur.get(person.id) ?? null;
      const before = prev?.get(person.id) ?? null;
      return { person, value: metricValue(person, metric, period), rank, change: rank != null && before != null ? before - rank : null };
    })
    .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.person.displayName.localeCompare(b.person.displayName));
}

export function fmtMetric(metric: BoardMetric, v: number | null): string {
  if (v == null) return "not shared";
  if (metric === "focus") return fmtDuration(v);
  if (metric === "goal") return `${Math.round(v * 100)}%`;
  if (metric === "streak") return `${v} day${v === 1 ? "" : "s"}`;
  if (metric === "consistency") return `${v} day${v === 1 ? "" : "s"}`;
  return String(v);
}

export function usePeople(): Person[] {
  const snap = useSocial((s) => s.snap);
  return useMemo(() => (snap ? [{ ...snap.me, me: true }, ...snap.friends] : []), [snap]);
}

/** Seven (or more) small bars for a period's daily focus. */
export function DayBars({ days, labels, highlight }: { days: number[]; labels?: string[]; highlight?: number }) {
  const max = Math.max(3600, ...days);
  return (
    <div className="flex h-24 items-end gap-1.5" role="img" aria-label={`Focus per day: ${days.map((d) => fmtDuration(d)).join(", ")}`}>
      {days.map((s, i) => (
        <div key={i} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${labels?.[i] ?? `Day ${i + 1}`}: ${fmtDuration(s)}`}>
          <div className="w-full max-w-[26px] rounded-t-[3px]" style={{ height: `${Math.max(s > 0 ? 4 : 1, (s / max) * 82)}%`, background: s > 0 ? "var(--chart-1)" : "rgb(var(--line-strong))" }} />
          {labels && <span className={cx("text-2xs", i === highlight ? "font-semibold text-accent" : "text-ink-3")}>{labels[i]}</span>}
        </div>
      ))}
    </div>
  );
}
