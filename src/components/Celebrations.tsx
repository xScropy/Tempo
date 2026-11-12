import { Coins, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { EMPTY_DAY, achievementsFor, levelTitle, questsFor, tokensEarned, xpForLevel } from "@/domain/game";
import { chime, confetti, popXp, useCelebrate, type Burst } from "@/lib/celebrate";
import { toast } from "@/lib/notify";
import { useGame } from "@/pages/Rewards";
import { useData } from "@/store/data";
import { navigate, useUi } from "@/store/ui";
import { Button } from "./ui";

const COLORS = ["var(--chart-1)", "var(--chart-2)", "rgb(var(--accent))", "rgb(var(--warn))", "rgb(var(--ink))"];

function ConfettiBurst({ burst }: { burst: Burst }) {
  const pieces = useMemo(() => {
    const n = burst.size === "big" ? 90 : 28;
    const reach = burst.size === "big" ? 520 : 200;
    return Array.from({ length: n }, (_, i) => {
      const angle = Math.random() * Math.PI * 2;
      const dist = reach * (0.35 + Math.random() * 0.65);
      return { i, dx: Math.cos(angle) * dist, dy: Math.sin(angle) * dist - reach * 0.35, rot: Math.random() * 720 - 360, color: COLORS[i % COLORS.length]!, w: 5 + Math.random() * 5, delay: Math.random() * 90, round: i % 3 === 0 };
    });
  }, [burst]);
  return (
    <div className="pointer-events-none fixed z-[70]" style={{ left: burst.x, top: burst.y }} aria-hidden>
      {pieces.map((p) => (
        <span
          key={p.i}
          className="confetti-piece absolute block"
          style={{ width: p.w, height: p.round ? p.w : p.w * 0.45, borderRadius: p.round ? "50%" : 1, background: p.color, animationDelay: `${p.delay}ms`, ["--dx" as string]: `${p.dx}px`, ["--dy" as string]: `${p.dy}px`, ["--rot" as string]: `${p.rot}deg` }}
        />
      ))}
    </div>
  );
}

/**
 * Watches the (derived) game state and celebrates changes as they happen:
 * XP gains, finished quests, unlocked achievements and level-ups.
 * It only reacts to increases after the first render, so loading or restoring
 * data never triggers a celebration.
 */
export function Celebrations() {
  const g = useGame();
  const today = useUi((s) => s.today);
  const sounds = useData((s) => s.settings.rewardSounds);
  const pops = useCelebrate((s) => s.pops);
  const bursts = useCelebrate((s) => s.bursts);
  const levelUp = useCelebrate((s) => s.levelUp);

  const quests = questsFor(g.days.get(today) ?? EMPTY_DAY).filter((q) => q.done).map((q) => `${today}:${q.id}`);
  const unlocked = achievementsFor(g.totals).filter((a) => a.unlocked);
  const prev = useRef<{ xp: number; level: number; quests: Set<string>; unlocked: Set<string> } | null>(null);

  useEffect(() => {
    const p = prev.current;
    prev.current = { xp: g.totals.xp, level: g.level.level, quests: new Set(quests), unlocked: new Set(unlocked.map((a) => a.id)) };
    if (!p) return;
    const gained = g.totals.xp - p.xp;
    // A jump this large is an import or restore, not something the user just did.
    if (gained <= 0 || gained > 2000) return;

    const newQuests = quests.filter((q) => !p.quests.has(q));
    const newAch = unlocked.filter((a) => !p.unlocked.has(a.id));
    popXp(gained, newQuests.length ? "Quest complete" : undefined);

    if (g.level.level > p.level) {
      useCelebrate.setState({ levelUp: { level: g.level.level, tokens: tokensEarned(xpForLevel(g.level.level)) - tokensEarned(xpForLevel(p.level)) } });
      confetti("big");
      if (sounds) chime("level");
      return;
    }
    if (newAch.length) {
      for (const a of newAch) toast(`Achievement unlocked: ${a.title}`, a.description, "ok");
      confetti("big");
      if (sounds) chime("level");
    } else if (newQuests.length) {
      confetti("small", 120, window.innerHeight - 110);
      if (sounds) chime("quest");
    } else if (sounds) chime("xp");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.totals.xp]);

  return (
    <>
      <div className="no-print pointer-events-none fixed bottom-[118px] left-3 z-[65] flex flex-col-reverse gap-1" aria-live="polite">
        {pops.map((p) => (
          <div key={p.id} className="xp-pop inline-flex w-max items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-sm font-semibold text-accent-ink shadow-pop">
            <Sparkles size={13} />
            <span className="tabular">+{p.amount} XP</span>
            {p.label && <span className="font-normal opacity-90">· {p.label}</span>}
          </div>
        ))}
      </div>
      {bursts.map((b) => (
        <ConfettiBurst key={b.id} burst={b} />
      ))}
      {levelUp && (
        <div className="fixed inset-0 z-[68] flex items-center justify-center bg-black/45" role="dialog" aria-label={`Level ${levelUp.level} reached`} onClick={() => useCelebrate.setState({ levelUp: null })}>
          <div className="level-card w-[min(92vw,360px)] rounded-xl border border-line bg-surface px-6 py-7 text-center shadow-pop" onClick={(e) => e.stopPropagation()}>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Level up</div>
            <div className="level-number tabular mx-auto my-3 flex h-28 w-28 items-center justify-center rounded-full text-[56px] font-bold leading-none text-accent-ink">{levelUp.level}</div>
            <div className="text-lg font-semibold">{levelTitle(levelUp.level)}</div>
            <div className="mt-1 text-sm text-ink-2">Earned by real focus time, finished tasks and habits.</div>
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-warn/10 px-3 py-1 text-sm font-medium text-warn">
              <Coins size={14} /> {g.tokens} tokens to spend
            </div>
            <div className="mt-5 flex justify-center gap-2">
              <Button onClick={() => (useCelebrate.setState({ levelUp: null }), navigate("rewards"))}>See rewards</Button>
              <Button variant="primary" autoFocus onClick={() => useCelebrate.setState({ levelUp: null })}>
                Keep going
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
