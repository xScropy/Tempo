import { LOCALE, tn, tr } from "@/i18n";
import { Check, Coins, Flame, Gift, Lock, Plus, Trash2, Trophy } from "lucide-react";
import { useMemo, useState } from "react";
import { addDays, fmtDate, fmtDuration, fromDateStr, weekdayName } from "@/domain/dates";
import { EMPTY_DAY, XP_PER_TOKEN, XP_RULES, achievementsFor, dayXp, levelTitle, questsFor } from "@/domain/game";
import { confetti } from "@/lib/celebrate";
import { attempt, toast } from "@/lib/notify";
import { archiveReward, redeemReward, saveReward } from "@/store/actions";
import { useData } from "@/store/data";
import { focusStreak, gameState } from "@/store/selectors";
import { confirmDialog, useUi } from "@/store/ui";
import { Badge, Button, IconButton, Input, PageHeader, Progress, Section, Stat, cx } from "@/components/ui";

const RING = 2 * Math.PI * 54;

export function useGame() {
  const today = useUi((s) => s.today);
  const entries = useData((s) => s.entries);
  const tasks = useData((s) => s.tasks);
  const sessions = useData((s) => s.sessions);
  const habits = useData((s) => s.habits);
  const habitEntries = useData((s) => s.habitEntries);
  const redemptions = useData((s) => s.redemptions);
  return useMemo(() => gameState({ entries, tasks, sessions, habits, habitEntries, redemptions }, today), [entries, tasks, sessions, habits, habitEntries, redemptions, today]);
}

export function RewardsPage() {
  const today = useUi((s) => s.today);
  const rewards = useData((s) => s.rewards);
  const redemptions = useData((s) => s.redemptions);
  const g = useGame();
  const [form, setForm] = useState({ title: "", cost: "20" });
  const day = g.days.get(today) ?? EMPTY_DAY;
  const quests = questsFor(day);
  const achievements = achievementsFor(g.totals);
  const active = rewards.filter((r) => !r.archived_at);
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6)).map((d) => ({ d, xp: dayXp(g.days.get(d) ?? EMPTY_DAY) }));
  const maxXp = Math.max(60, ...week.map((w) => w.xp));
  const entries = useData((s) => s.entries);
  const streak = useMemo(() => focusStreak(entries, today), [entries, today]);
  const todayXp = dayXp(day);
  // The cheapest reward still out of reach is the next thing to work toward.
  const next = active.filter((r) => r.cost > g.tokens).sort((a, b) => a.cost - b.cost)[0];
  const ready = active.filter((r) => r.cost <= g.tokens).sort((a, b) => b.cost - a.cost)[0];

  const redeem = async (id: string, title: string, cost: number) => {
    if (!(await confirmDialog({ title: tr("Redeem \"{0}\"?", title), body: tr("This spends {0} of your {1} tokens. Enjoy it — you earned it.", cost, g.tokens), confirmLabel: tr("Spend {0} tokens", cost) }))) return;
    if (await attempt(() => redeemReward(id))) {
      toast(tr("Reward redeemed"), tr("Enjoy: {0}", title), "ok");
      confetti("big");
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={tr("Rewards")} subtitle={tr("Levels, tokens and daily quests — earned only by real focus time, finished tasks and habits.")} />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="mx-auto max-w-[980px] space-y-4">
          <div className="grid gap-4 md:grid-cols-[1.5fr_1fr]">
            <div className="flex items-center gap-5 rounded-lg border border-line bg-surface px-5 py-4">
              <div className="relative h-[124px] w-[124px] shrink-0">
                <svg viewBox="0 0 124 124" className="-rotate-90" aria-hidden>
                  <circle cx="62" cy="62" r="54" fill="none" stroke="rgb(var(--hover))" strokeWidth="9" />
                  <circle cx="62" cy="62" r="54" fill="none" stroke="rgb(var(--accent))" strokeWidth="9" strokeLinecap="round" strokeDasharray={RING} strokeDashoffset={RING * (1 - g.level.fraction)} style={{ transition: "stroke-dashoffset 700ms cubic-bezier(0.2, 0.8, 0.2, 1)" }} />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xs font-semibold uppercase tracking-widest text-ink-3">{tr("Level")}</span>
                  <span key={g.level.level} className="bump tabular text-[40px] font-bold leading-none">{g.level.level}</span>
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xl font-semibold">{levelTitle(g.level.level)}</div>
                <div className="tabular mt-0.5 text-sm text-ink-2">
                  <span className="font-semibold text-ink">{g.level.into}</span> / {g.level.needed}{" "}{tr("XP ·")}{" "}<span className="text-accent">{g.level.needed - g.level.into}{" "}{tr("XP")}</span>{" "}{tr("to level")}{" "}{g.level.level + 1}
                </div>
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <Stat label={tr("Today")} value={<span className={todayXp > 0 ? "text-accent" : undefined}>+{todayXp}</span>} sub={tr("XP earned")} />
                  <Stat label={tr("Total XP")} value={g.totals.xp.toLocaleString(LOCALE)} />
                  <Stat
                    label={tr("Focus streak")}
                    value={
                      <span className="inline-flex items-center gap-1.5">
                        <Flame size={18} className={streak > 0 ? "flame text-warn" : "text-ink-3"} />
                        {streak} d
                      </span>
                    }
                    sub={tr("best {0} d", g.totals.bestFocusStreak)}
                  />
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-line bg-surface px-5 py-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-ink-2">{tr("Tokens")}</div>
              <div className="mt-1 flex items-center gap-2.5">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-warn/15 text-warn">
                  <Coins size={20} />
                </span>
                <span key={g.tokens} className="bump tabular text-[34px] font-bold leading-none">{g.tokens}</span>
                <span className="text-sm text-ink-2">{tr("to spend")}</span>
              </div>
              {next ? (
                <div className="mt-3">
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="truncate text-ink-2">{tr("Next:")}{" "}<span className="font-medium text-ink">{next.title}</span></span>
                    <span className="tabular shrink-0 text-ink-2">{Math.max(0, g.tokens)}/{next.cost}</span>
                  </div>
                  <Progress value={g.tokens / next.cost} tone="warn" className="mt-1.5 !h-2" />
                  <div className="mt-1 text-xs text-ink-3">{tr("{0} — about {1} of focus.", tn(next.cost - g.tokens, "more token"), tn((next.cost - g.tokens) * XP_PER_TOKEN, "minute"))}</div>
                </div>
              ) : ready ? (
                <div className="mt-3 text-sm font-medium text-ok">{tr("You can afford “")}{ready.title}{tr("”. Treat yourself.")}</div>
              ) : (
                <div className="mt-3 text-xs text-ink-3">{tr("1 token for every")}{" "}{XP_PER_TOKEN}{" "}{tr("XP. Add a reward below to have something to work toward.")}</div>
              )}
              <div className="tabular mt-2 text-2xs text-ink-3">{g.tokensEarned}{" "}{tr("earned ·")}{" "}{g.tokensSpent}{" "}{tr("spent")}</div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Section title={tr("Today's quests")} action={<span className="text-xs text-ink-2">+{XP_RULES.perQuest}{" "}{tr("XP each")}</span>}>
              {quests.map((q) => (
                <div key={q.id} className="border-b border-line px-3 py-2.5 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className={cx("flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-[1.5px]", q.done ? "border-accent bg-accent text-accent-ink" : "border-ink-3")}>{q.done && <Check size={10} strokeWidth={3} />}</span>
                    <span className={cx("flex-1", q.done && "text-ink-2")}>{q.label}</span>
                    <span className="tabular text-xs text-ink-2">{q.current}/{q.goal}</span>
                  </div>
                  <Progress value={q.current / q.goal} tone={q.done ? "ok" : "accent"} className={cx("ms-6 mt-1.5", !q.done && q.current > 0 && "shine")} />
                  {!q.done && <div className="ms-6 mt-1 text-2xs text-ink-3">{q.goal - q.current}{q.id === "focus" ? tr(" minutes") : ""}{" "}{tr("to go for +")}{XP_RULES.perQuest}{" "}{tr("XP")}</div>}
                </div>
              ))}
            </Section>

            <Section title={tr("XP in the last 7 days")}>
              <div className="px-3 py-3">
                <div className="flex h-24 items-end gap-2" role="img" aria-label={tr("XP earned per day over the last seven days")}>
                  {week.map(({ d, xp }) => (
                    <div key={d} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={tr("{0}: {1} XP", fmtDate(d, today), xp)}>
                      <span className="tabular text-2xs text-ink-2">{xp || ""}</span>
                      <div className="w-full max-w-[30px] rounded-t-[3px]" style={{ height: `${Math.max(xp ? 4 : 1, (xp / maxXp) * 72)}%`, background: xp ? "var(--chart-1)" : "rgb(var(--line-strong))" }} />
                      <span className={cx("text-2xs", d === today ? "font-semibold text-accent" : "text-ink-3")}>{weekdayName(fromDateStr(d).getDay())}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 border-t border-line pt-2 text-xs text-ink-2">
                  {tr("How XP is earned:")}{" "}{XP_RULES.perFocusMinute}{" "}{tr("per focused minute ·")}{" "}{XP_RULES.perTask}{" "}{tr("per completed task ·")}{" "}{XP_RULES.perSession}{" "}{tr("per completed session ·")}{" "}{XP_RULES.perHabit}{" "}{tr("per habit done ·")}{" "}{XP_RULES.perQuest}{" "}{tr("per quest. Breaks and paused time earn nothing.")}
                </div>
              </div>
            </Section>
          </div>

          <Section title={tr("Reward shop")}>
            {active.length === 0 && <div className="px-3 pt-3 text-sm text-ink-2">{tr("Decide what your work buys you — an episode, a coffee out, an evening off — and set its price in tokens.")}</div>}
            {active.map((r) => {
              const can = g.tokens >= r.cost;
              return (
                <div key={r.id} className="group flex items-center gap-3 border-b border-line px-3 py-2">
                  <Gift size={15} className="shrink-0 text-ink-3" />
                  <span className="min-w-0 flex-1 truncate">{r.title}</span>
                  <span className="tabular inline-flex items-center gap-1 text-sm text-ink-2">
                    <Coins size={12} className="text-warn" /> {r.cost}
                  </span>
                  <Progress value={g.tokens / r.cost} tone={can ? "ok" : "warn"} className="hidden w-24 sm:block" />
                  <Button size="sm" variant={can ? "primary" : "secondary"} disabled={!can} title={can ? undefined : tr("{0} more tokens needed", r.cost - g.tokens)} onClick={() => void redeem(r.id, r.title, r.cost)}>
                    {can ? tr("Redeem") : tr("Need {0}", r.cost - g.tokens)}
                  </Button>
                  <IconButton label={tr("Remove reward {0}", r.title)} className="opacity-0 focus:opacity-100 group-hover:opacity-100" onClick={() => void attempt(() => archiveReward(r.id))}>
                    <Trash2 size={13} />
                  </IconButton>
                </div>
              );
            })}
            <form
              className="flex items-center gap-2 px-3 py-2.5"
              onSubmit={(e) => {
                e.preventDefault();
                void attempt(() => saveReward({ title: form.title, cost: Number(form.cost) })).then((ok) => ok && setForm({ ...form, title: "" }));
              }}
            >
              <Input placeholder={tr("New reward, e.g. Watch an episode")} aria-label={tr("Reward name")} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              <Input type="number" min={1} aria-label={tr("Cost in tokens")} className="!w-24" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
              <Button type="submit" icon={<Plus size={14} />} disabled={!form.title.trim()}>{tr("Add")}</Button>
            </form>
            {redemptions.length > 0 && (
              <div className="border-t border-line px-3 py-2">
                <div className="mb-1 text-xs font-medium text-ink-2">{tr("Recently redeemed")}</div>
                {redemptions.slice(0, 6).map((r) => (
                  <div key={r.id} className="flex gap-3 py-0.5 text-sm text-ink-2">
                    <span className="tabular w-24 shrink-0 text-ink-3">{new Date(r.redeemed_at).toLocaleDateString(LOCALE, { month: "short", day: "numeric" })}</span>
                    <span className="min-w-0 flex-1 truncate">{r.title}</span>
                    <span className="tabular">−{r.cost}</span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title={tr("Achievements")} action={<span className="tabular text-xs text-ink-2">{achievements.filter((a) => a.unlocked).length}{" "}{tr("of")}{" "}{achievements.length}</span>}>
            <div className="grid gap-px bg-line sm:grid-cols-2">
              {achievements.map((a) => (
                <div key={a.id} className="flex items-center gap-3 bg-surface px-3 py-2.5">
                  <span className={cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", a.unlocked ? "bg-accent/10 text-accent" : "bg-hover text-ink-3")}>{a.unlocked ? <Trophy size={15} /> : <Lock size={13} />}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={cx("truncate font-medium", !a.unlocked && "text-ink-2")}>{a.title}</span>
                      {a.unlocked && <Badge tone="ok">{tr("Unlocked")}</Badge>}
                    </div>
                    <div className="truncate text-xs text-ink-2">{a.description}</div>
                    {!a.unlocked && <Progress value={a.current / a.goal} className="mt-1.5" />}
                  </div>
                  {!a.unlocked && <span className="tabular shrink-0 text-xs text-ink-3">{a.current}/{a.goal}</span>}
                </div>
              ))}
            </div>
          </Section>

          <div className="text-xs text-ink-3">
            {tr("Lifetime:")}{" "}{fmtDuration(g.totals.focusSeconds)}{" "}{tr("focused ·")}{" "}{g.totals.tasksCompleted}{" "}{tr("tasks ·")}{" "}{g.totals.sessionsCompleted}{" "}{tr("sessions ·")}{" "}{g.totals.habitsDone}{" "}{tr("habit days. Turn this whole feature off under Settings → Appearance.")}
          </div>
        </div>
      </div>
    </div>
  );
}
