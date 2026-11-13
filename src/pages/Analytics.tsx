import { isRtl, tn, tr } from "@/i18n";
import { Printer } from "lucide-react";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { addDays, addMonths, dateOfMs, dayStartMs, diffDays, fmtDate, fmtDuration, fromDateStr, startOfMonth, startOfWeek, weekdayName, type DateStr } from "@/domain/dates";
import { consistency } from "@/domain/habits";
import { estimationStats, secondsByDay, secondsByGroup, secondsByHour, totalSeconds } from "@/domain/time";
import { useData } from "@/store/data";
import { byId, habitDays, intervals, taskSeconds } from "@/store/selectors";
import { useUi } from "@/store/ui";
import { Button, Empty, PageHeader, Section, Segmented, Select, Stat, cx } from "@/components/ui";

type RangeKey = "week" | "last_week" | "month" | "last_month" | "d30" | "d90";
const RANGE_LABEL: Record<RangeKey, string> = { week: tr("This week"), last_week: tr("Last week"), month: tr("This month"), last_month: tr("Last month"), d30: tr("Last 30 days"), d90: tr("Last 90 days") };

function rangeOf(key: RangeKey, today: DateStr, weekStart: number): { start: DateStr; end: DateStr } {
  const w = startOfWeek(today, weekStart);
  const m = startOfMonth(today);
  switch (key) {
    case "week":
      return { start: w, end: addDays(w, 6) };
    case "last_week":
      return { start: addDays(w, -7), end: addDays(w, -1) };
    case "month":
      return { start: m, end: addDays(addMonths(m, 1), -1) };
    case "last_month":
      return { start: addMonths(m, -1), end: addDays(m, -1) };
    case "d30":
      return { start: addDays(today, -29), end: today };
    case "d90":
      return { start: addDays(today, -89), end: today };
  }
}

const hours = (s: number) => Math.round((s / 3600) * 100) / 100;

function ChartTip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded border border-line bg-surface px-2.5 py-1.5 text-xs shadow-pop">
      <div className="mb-0.5 font-medium">{label}</div>
      {payload.map((p) => (
        <div key={p.name} className="tabular flex items-center gap-1.5 text-ink-2">
          <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />
          {p.name}: <span className="text-ink">{fmtDuration(p.value * 3600)}</span>
        </div>
      ))}
    </div>
  );
}

const axis = { fontSize: 11, fill: "rgb(var(--ink-3))" };

function Distribution({ rows, total }: { rows: Array<{ key: string; label: string; seconds: number }>; total: number }) {
  if (!rows.length) return <div className="px-3 py-6 text-center text-sm text-ink-2">{tr("No tracked time in this period.")}</div>;
  const max = rows[0]!.seconds;
  return (
    <div className="px-3 py-2">
      {rows.slice(0, 12).map((r) => (
        <div key={r.key} className="flex items-center gap-3 py-1 text-sm">
          <span className={cx("w-44 shrink-0 truncate", r.key === "" && "text-ink-2")}>{r.label}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-sm bg-hover">
            <div className="h-full rounded-sm" style={{ width: `${(r.seconds / max) * 100}%`, background: r.key === "" ? "rgb(var(--ink-3))" : "var(--chart-1)" }} />
          </div>
          <span className="tabular w-20 shrink-0 whitespace-nowrap text-end">{fmtDuration(r.seconds)}</span>
          <span className="tabular w-10 shrink-0 text-end text-xs text-ink-3">{total ? Math.round((r.seconds / total) * 100) : 0}%</span>
        </div>
      ))}
      {rows.length > 12 && <div className="pt-1 text-xs text-ink-3">+{rows.length - 12}{" "}{tr("more with")}{" "}{fmtDuration(rows.slice(12).reduce((a, r) => a + r.seconds, 0))}</div>}
    </div>
  );
}

export function AnalyticsPage() {
  const today = useUi((s) => s.today);
  const s = useData();
  const [rangeKey, setRangeKey] = useState<RangeKey>("week");
  const [dim, setDim] = useState<"project" | "category" | "task" | "tag">("project");
  const { start, end } = rangeOf(rangeKey, today, s.settings.weekStart);
  const from = dayStartMs(start);
  const to = dayStartMs(addDays(end, 1));
  const lastDay = end > today ? today : end;
  const elapsedDays = Math.max(1, diffDays(start, lastDay) + 1);

  const m = useMemo(() => {
    const all = intervals(s.entries);
    const inRange = all.filter((e) => e.end > from && e.start < to);
    const total = totalSeconds(inRange, from, to);
    const perDay = secondsByDay(inRange, from, to);

    // Planned time = what was put on the calendar (scheduled tasks + focus blocks).
    const planned = new Map<DateStr, number>();
    const plan = (at: number, seconds: number) => at >= from && at < to && planned.set(dateOfMs(at), (planned.get(dateOfMs(at)) ?? 0) + seconds);
    for (const t of s.tasks) if (t.scheduled_at != null && t.status !== "cancelled") plan(t.scheduled_at, (t.scheduled_minutes ?? 30) * 60);
    for (const e of s.events) if (e.kind === "focus_block") plan(e.start_at, (e.end_at - e.start_at) / 1000);
    const plannedTotal = [...planned.values()].reduce((a, b) => a + b, 0);

    const nDays = diffDays(start, end) + 1;
    const weekly = nDays > 31;
    const series: Array<{ label: string; Tracked: number; Planned: number }> = [];
    if (!weekly) {
      for (let i = 0; i < nDays; i++) {
        const d = addDays(start, i);
        const dt = fromDateStr(d);
        series.push({ label: nDays <= 7 ? weekdayName(dt.getDay()) : String(dt.getDate()), Tracked: hours(perDay.get(d) ?? 0), Planned: hours(planned.get(d) ?? 0) });
      }
    } else {
      for (let w = startOfWeek(start, s.settings.weekStart); w <= end; w = addDays(w, 7)) {
        let trk = 0;
        let pl = 0;
        for (let i = 0; i < 7; i++) {
          trk += perDay.get(addDays(w, i)) ?? 0;
          pl += planned.get(addDays(w, i)) ?? 0;
        }
        series.push({ label: fmtDate(w, "").replace(/ \d{4}$/, "").replace(/^\w+ /, ""), Tracked: hours(trk), Planned: hours(pl) });
      }
    }

    const sessions = s.sessions.filter((x) => x.started_at >= from && x.started_at < to && x.status !== "active");
    const completedSessions = sessions.filter((x) => x.status === "completed");
    const sessionTotal = inRange.filter((e) => e.session_id).reduce((a, e) => a + (e.end - e.start) / 1000, 0);

    const top = s.tasks.filter((t) => !t.parent_id);
    const completed = top.filter((t) => t.status === "completed" && t.completed_at != null && t.completed_at >= from && t.completed_at < to);
    const dueInRange = top.filter((t) => t.due_date && t.due_date >= start && t.due_date <= lastDay && t.status !== "cancelled");
    const dueDone = dueInRange.filter((t) => t.status === "completed").length;

    const actual = taskSeconds(s.entries);
    const estRows = completed
      .filter((t) => t.estimated_seconds && (actual.get(t.id) ?? 0) > 0)
      .map((t) => ({ id: t.id, title: t.title, estimated: t.estimated_seconds!, actual: actual.get(t.id)! }))
      .sort((a, b) => Math.abs(b.actual - b.estimated) - Math.abs(a.actual - a.estimated));

    return { inRange, total, plannedTotal, series, weekly, sessions, completedSessions, sessionTotal, completed, dueInRange, dueDone, estRows, est: estimationStats(estRows), byHour: secondsByHour(inRange.map((e) => ({ start: Math.max(e.start, from), end: Math.min(e.end, to) }))) };
  }, [s.entries, s.tasks, s.events, s.sessions, s.settings.weekStart, from, to, start, end, lastDay]);

  const dist = useMemo(() => {
    const pm = byId(s.projects);
    const cm = byId(s.categories);
    const tm = byId(s.tasks);
    const gm = byId(s.tags);
    const key = (e: (typeof m.inRange)[number]) => (dim === "project" ? e.project_id : dim === "category" ? e.category_id : dim === "task" ? e.task_id : e.task_id ? (s.taskTags[e.task_id] ?? []) : []);
    const label = (k: string) => (dim === "project" ? pm.get(k)?.name : dim === "category" ? cm.get(k)?.name : dim === "task" ? tm.get(k)?.title : gm.get(k) ? `#${gm.get(k)!.name}` : undefined);
    const none = { project: tr("No project"), category: tr("Uncategorised"), task: tr("No task"), tag: tr("Untagged") }[dim];
    return [...secondsByGroup(m.inRange, key, from, to).entries()].map(([k, seconds]) => ({ key: k, label: k === "" ? none : (label(k) ?? tr("(deleted)")), seconds })).sort((a, b) => b.seconds - a.seconds);
  }, [m.inRange, dim, s.projects, s.categories, s.tasks, s.tags, s.taskTags, from, to]);

  const habitRows = useMemo(() => s.habits.filter((h) => !h.archived_at).map((h) => ({ h, c: consistency(h, habitDays(h.id, s.habitEntries), start, end, today) })), [s.habits, s.habitEntries, start, end, today]);
  const peak = m.byHour.reduce((best, v, i) => (v > m.byHour[best]! ? i : best), 0);
  const hourData = m.byHour.map((v, i) => ({ label: `${String(i).padStart(2, "0")}:00`, Tracked: hours(v) }));
  const hasData = m.total > 0 || m.completed.length > 0;

  return (
    <div className="print-area flex h-full flex-col">
      <PageHeader title={tr("Analytics")} subtitle={`${fmtDate(start, "")} – ${fmtDate(end, "")}`}>
        <Select className="!w-40" aria-label={tr("Period")} value={rangeKey} onChange={(e) => setRangeKey(e.target.value as RangeKey)}>
          {(Object.keys(RANGE_LABEL) as RangeKey[]).map((k) => (
            <option key={k} value={k}>{RANGE_LABEL[k]}</option>
          ))}
        </Select>
        <Button icon={<Printer size={14} />} onClick={() => window.print()} title={tr("Print or save this report as a PDF")}>
          {tr("Print / PDF")}
        </Button>
      </PageHeader>
      <div className="print-area min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <div className="hidden text-lg font-semibold print:block">{tr("Tempo report ·")}{" "}{RANGE_LABEL[rangeKey]} ({start} – {end})</div>
        {!hasData && <Empty title={tr("Nothing to analyse in this period yet")} body={tr("Reports are built only from time you actually tracked and tasks you actually completed. Run a focus session or pick another period.")} />}

        <div className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-md border border-line bg-surface px-4 py-3 md:grid-cols-4 xl:grid-cols-7">
          <Stat label={tr("Focus time")} value={fmtDuration(m.total)} sub={tr("{0} / day average", fmtDuration(m.total / elapsedDays))} />
          <Stat label={tr("Planned time")} value={fmtDuration(m.plannedTotal)} sub={tr("scheduled on the calendar")} />
          <Stat label={tr("Sessions")} value={m.completedSessions.length} sub={tr("{0} interrupted", m.sessions.length - m.completedSessions.length)} />
          <Stat label={tr("Average session")} value={m.sessions.length ? fmtDuration(m.sessionTotal / m.sessions.length) : "—"} sub={tr("of actual focus")} />
          <Stat label={tr("Tasks completed")} value={m.completed.length} />
          <Stat label={tr("Due tasks finished")} value={m.dueInRange.length ? `${Math.round((m.dueDone / m.dueInRange.length) * 100)}%` : "—"} sub={tr("{0} of {1} due so far", m.dueDone, m.dueInRange.length)} />
          <Stat label={tr("Estimate accuracy")} value={m.est.accuracy == null ? "—" : `${Math.round(m.est.accuracy * 100)}%`} sub={m.est.samples ? tn(m.est.samples, "estimated task") : tr("no estimated tasks done")} />
        </div>

        <Section title={tr("Planned vs. tracked time per {0} (hours)", m.weekly ? tr("week") : tr("day"))}>
          <div className="h-[240px] px-2 py-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={m.series} barGap={2} barCategoryGap="22%">
                <CartesianGrid vertical={false} stroke="rgb(var(--line))" />
                <XAxis dataKey="label" reversed={isRtl} tick={axis} tickLine={false} axisLine={{ stroke: "rgb(var(--line-strong))" }} interval={m.series.length > 16 ? 1 : 0} />
                <YAxis orientation={isRtl ? "right" : "left"} tick={axis} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
                <Tooltip content={<ChartTip />} cursor={{ fill: "rgb(var(--hover))", opacity: 0.6 }} />
                <Legend itemSorter={null} iconType="square" iconSize={8} wrapperStyle={{ fontSize: 12 }} formatter={(v) => <span style={{ color: "rgb(var(--ink-2))" }}>{v}</span>} />
                <Bar dataKey="Tracked" name={tr("Tracked")} fill="var(--chart-1)" radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false} />
                <Bar dataKey="Planned" name={tr("Planned time")} fill="var(--chart-2)" radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>

        <div className="grid gap-4 xl:grid-cols-2">
          <Section
            title={tr("Where the time went")}
            action={<Segmented size="sm" value={dim} onChange={setDim} options={[{ value: "project", label: tr("Project") }, { value: "category", label: tr("Category") }, { value: "task", label: tr("Task") }, { value: "tag", label: tr("Tag") }]} />}
          >
            <Distribution rows={dist} total={m.total} />
            {dim === "tag" && dist.length > 0 && <div className="px-3 pb-2 text-xs text-ink-3">{tr("A task with several tags counts toward each of them, so tag rows can add up to more than the total.")}</div>}
          </Section>

          <Section title={tr("Most productive hours")} action={m.total > 0 ? <span className="text-xs text-ink-2">{tr("Peak")}{" "}{String(peak).padStart(2, "0")}:00–{String(peak + 1).padStart(2, "0")}:00</span> : undefined}>
            <div className="h-[210px] px-2 py-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourData} barCategoryGap="18%">
                  <CartesianGrid vertical={false} stroke="rgb(var(--line))" />
                  <XAxis dataKey="label" reversed={isRtl} tick={axis} tickLine={false} axisLine={{ stroke: "rgb(var(--line-strong))" }} interval={2} tickFormatter={(v: string) => v.slice(0, 2)} />
                  <YAxis orientation={isRtl ? "right" : "left"} tick={axis} tickLine={false} axisLine={false} width={40} />
                  <Tooltip content={<ChartTip />} cursor={{ fill: "rgb(var(--hover))", opacity: 0.6 }} />
                  <Bar dataKey="Tracked" name={tr("Tracked")} fill="var(--chart-1)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Section>
        </div>

        <Section title={tr("Estimated vs. actual time — tasks completed in this period")} action={m.est.samples ? <span className="tabular text-xs text-ink-2">{fmtDuration(m.est.totalActual)}{" "}{tr("actual vs")}{" "}{fmtDuration(m.est.totalEstimated)}{" "}{tr("estimated")}{m.est.ratio ? ` · ×${m.est.ratio.toFixed(2)}` : ""}</span> : undefined}>
          {m.estRows.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-ink-2">{tr("Complete tasks that have both an estimate and tracked time to see how accurate your estimates are.")}</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-start text-xs text-ink-3">
                  <th className="px-3 py-1.5 font-medium">{tr("Task")}</th>
                  <th className="w-24 px-3 py-1.5 text-end font-medium">{tr("Estimated")}</th>
                  <th className="w-24 px-3 py-1.5 text-end font-medium">{tr("Actual")}</th>
                  <th className="w-32 px-3 py-1.5 text-end font-medium">{tr("Variance")}</th>
                </tr>
              </thead>
              <tbody>
                {m.estRows.slice(0, 25).map((r) => {
                  const v = r.actual - r.estimated;
                  return (
                    <tr key={r.id} className="border-b border-line last:border-0">
                      <td className="max-w-0 truncate px-3 py-1.5">{r.title}</td>
                      <td className="tabular px-3 py-1.5 text-end text-ink-2">{fmtDuration(r.estimated)}</td>
                      <td className="tabular px-3 py-1.5 text-end">{fmtDuration(r.actual)}</td>
                      <td className={cx("tabular px-3 py-1.5 text-end", Math.abs(v) < 60 ? "text-ink-2" : v > 0 ? "text-warn" : "text-ok")}>{Math.abs(v) < 60 ? tr("on estimate") : `${v > 0 ? "+" : "−"}${fmtDuration(Math.abs(v))} (${Math.round((v / r.estimated) * 100)}%)`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Section>

        {habitRows.length > 0 && (
          <Section title={tr("Habit consistency in this period")}>
            <div className="px-3 py-2">
              {habitRows.map(({ h, c }) => (
                <div key={h.id} className="flex items-center gap-3 py-1 text-sm">
                  <span className="w-44 shrink-0 truncate">{h.name}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-sm bg-hover">
                    <div className="h-full rounded-sm" style={{ width: `${(c ?? 0) * 100}%`, background: "var(--chart-1)" }} />
                  </div>
                  <span className="tabular w-12 shrink-0 text-end">{c == null ? "—" : `${Math.round(c * 100)}%`}</span>
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}
