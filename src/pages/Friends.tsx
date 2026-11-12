import { Copy, Lock, Wifi } from "lucide-react";
import { useMemo } from "react";
import { fmtDate, fmtHours } from "@/domain/dates";
import { totalSeconds } from "@/domain/time";
import { attempt, toast } from "@/lib/notify";
import { saveProfile, setSetting } from "@/store/actions";
import { useData, type Settings } from "@/store/data";
import { focusStreak, goalProgress, intervals, weekRange } from "@/store/selectors";
import { useUi } from "@/store/ui";
import { Button, Checkbox, CommitInput, Field, PageHeader, Section } from "@/components/ui";

const SHARE: Array<{ key: keyof Settings["share"]; label: string }> = [
  { key: "focusTime", label: "Weekly focus hours" },
  { key: "sessions", label: "Completed focus sessions" },
  { key: "tasksCompleted", label: "Number of tasks completed" },
  { key: "streak", label: "Daily focus streak" },
  { key: "goals", label: "Number of goals reached" },
];

export function FriendsPage() {
  const today = useUi((s) => s.today);
  const profile = useData((s) => s.profile);
  const settings = useData((s) => s.settings);
  const entries = useData((s) => s.entries);
  const sessions = useData((s) => s.sessions);
  const tasks = useData((s) => s.tasks);
  const goals = useData((s) => s.goals);
  const projects = useData((s) => s.projects);
  const share = settings.share;

  /** Exactly what would leave this device — aggregates only, built from the sharing choices below. */
  const summary = useMemo(() => {
    const week = weekRange(today, settings.weekStart);
    const out: Record<string, string | number> = { name: profile?.display_name ?? "(no name set)", week_of: week.start };
    if (share.focusTime) out.focus_hours = Math.round((totalSeconds(intervals(entries), week.from, week.to) / 3600) * 10) / 10;
    if (share.sessions) out.sessions_completed = sessions.filter((s) => s.status === "completed" && s.started_at >= week.from && s.started_at < week.to).length;
    if (share.tasksCompleted) out.tasks_completed = tasks.filter((t) => t.completed_at != null && t.completed_at >= week.from && t.completed_at < week.to).length;
    if (share.streak) out.focus_streak_days = focusStreak(entries, today);
    if (share.goals) out.goals_reached = goals.filter((g) => goalProgress(g, { tasks, entries, sessions, projects, weekStart: settings.weekStart }, today).fraction >= 1).length;
    return out;
  }, [today, settings.weekStart, profile, share, entries, sessions, tasks, goals, projects]);

  const text = `${summary.name} — week of ${fmtDate(String(summary.week_of), "")}\n` + [
    summary.focus_hours != null && `Focus: ${fmtHours(Number(summary.focus_hours) * 3600)}`,
    summary.sessions_completed != null && `Sessions: ${summary.sessions_completed}`,
    summary.tasks_completed != null && `Tasks completed: ${summary.tasks_completed}`,
    summary.focus_streak_days != null && `Streak: ${summary.focus_streak_days} days`,
    summary.goals_reached != null && `Goals reached: ${summary.goals_reached}`,
  ].filter(Boolean).join("\n");

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Friends" subtitle="Optional. Tempo works fully without it, and nothing is shared unless you choose to." />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="mx-auto max-w-[720px] space-y-4">
          <div className="flex gap-3 rounded-md border border-line bg-raised px-4 py-3 text-sm">
            <Wifi size={16} className="mt-0.5 shrink-0 text-ink-3" />
            <div>
              <div className="font-medium">Connecting with friends is not built yet</div>
              <p className="mt-1 text-ink-2">
                Invitations, groups, challenges, leaderboards and shared focus rooms are planned for a later phase (see ROADMAP.md). The design is local-first: devices on the same Wi-Fi discover each other directly; friends on other networks need either a direct peer-to-peer link or an optional encrypted relay, because two home networks cannot reliably reach each other without some infrastructure in between.
              </p>
              <p className="mt-1 text-ink-2">What already works today: your local profile, your sharing choices, and a weekly summary you can copy and send yourself.</p>
            </div>
          </div>

          <Section title="Local profile">
            <div className="px-3 py-3">
              <Field label="Display name" hint="Stored only on this device. This is the name friends would see.">
                <CommitInput value={profile?.display_name ?? ""} placeholder="Your name" onCommit={(v) => void attempt(() => saveProfile(v))} className="max-w-xs" />
              </Field>
            </div>
          </Section>

          <Section title="What you are willing to share">
            <div className="space-y-2 px-3 py-3">
              {SHARE.map((o) => (
                <Checkbox key={o.key} checked={share[o.key]} label={o.label} onChange={(v) => void attempt(() => setSetting("share", { ...share, [o.key]: v }))} />
              ))}
              <div className="flex gap-2 pt-2 text-xs text-ink-2">
                <Lock size={13} className="mt-px shrink-0" />
                Task titles, notes, project details, calendar events and activity logs are never part of what is shared — there is no setting that includes them.
              </div>
            </div>
          </Section>

          <Section
            title="Your weekly summary"
            action={
              <Button size="sm" variant="ghost" icon={<Copy size={12} />} onClick={() => void navigator.clipboard.writeText(text).then(() => toast("Summary copied", "Paste it wherever you like.", "ok"), () => toast("Could not copy", "Clipboard access was denied.", "error"))}>
                Copy
              </Button>
            }
          >
            <pre className="selectable whitespace-pre-wrap px-3 py-3 font-mono text-sm">{text}</pre>
            <div className="border-t border-line px-3 py-2 text-xs text-ink-3">This is the complete set of data covered by your choices above, computed from your real tracked time.</div>
          </Section>
        </div>
      </div>
    </div>
  );
}
