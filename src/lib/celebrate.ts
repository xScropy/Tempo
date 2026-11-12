import { create } from "zustand";

export interface XpPop {
  id: number;
  amount: number;
  label?: string;
}
export interface Burst {
  id: number;
  /** viewport origin in px */
  x: number;
  y: number;
  size: "small" | "big";
}

interface CelebrateState {
  pops: XpPop[];
  bursts: Burst[];
  levelUp: { level: number; tokens: number } | null;
}

export const useCelebrate = create<CelebrateState>(() => ({ pops: [], bursts: [], levelUp: null }));
let seq = 0;

export const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function popXp(amount: number, label?: string) {
  const id = ++seq;
  useCelebrate.setState((s) => ({ pops: [...s.pops.slice(-3), { id, amount, label }] }));
  setTimeout(() => useCelebrate.setState((s) => ({ pops: s.pops.filter((p) => p.id !== id) })), 2200);
}

export function confetti(size: Burst["size"] = "small", x = window.innerWidth / 2, y = window.innerHeight * 0.35) {
  if (reducedMotion()) return;
  const id = ++seq;
  useCelebrate.setState((s) => ({ bursts: [...s.bursts, { id, x, y, size }] }));
  setTimeout(() => useCelebrate.setState((s) => ({ bursts: s.bursts.filter((b) => b.id !== id) })), 2200);
}

let audio: AudioContext | null = null;
/** Short synthesised chime — generated locally, no audio files. */
export function chime(kind: "xp" | "quest" | "level") {
  try {
    audio ??= new AudioContext();
    void audio.resume();
    const notes = { xp: [880], quest: [659.25, 987.77], level: [523.25, 659.25, 783.99, 1046.5] }[kind];
    const t0 = audio.currentTime;
    notes.forEach((freq, i) => {
      const osc = audio!.createOscillator();
      const gain = audio!.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const at = t0 + i * 0.09;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(kind === "xp" ? 0.05 : 0.09, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.45);
      osc.connect(gain).connect(audio!.destination);
      osc.start(at);
      osc.stop(at + 0.5);
    });
  } catch {
    /* sound is a nicety; never let it break anything */
  }
}
