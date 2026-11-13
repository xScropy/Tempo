/**
 * Localisation.
 *
 * English text is the key: `tr("New task")` returns the Arabic string when the
 * app runs in Arabic and the text itself otherwise, so the source stays
 * readable and a missing translation degrades to English instead of a blank.
 *
 * The language is read once, synchronously, before anything renders (it is
 * mirrored in localStorage), and changing it reloads the window. That keeps
 * `tr` a plain function usable anywhere — module-level tables included.
 */
import { AR, AR_NOUNS, AR_PATTERNS } from "./ar";

export type Lang = "en" | "ar";
const KEY = "tempo.lang";

function initial(): Lang {
  try {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (v === "ar" || v === "en") return v;
    if (typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("ar")) return "ar";
  } catch {
    /* storage unavailable: fall through to English */
  }
  return "en";
}

export const lang: Lang = initial();
export const isRtl = lang === "ar";
export const dir: "rtl" | "ltr" = isRtl ? "rtl" : "ltr";
/** For `toLocaleString`. Arabic uses Western digits here: they read unambiguously next to times and durations. */
export const LOCALE: string | undefined = lang === "ar" ? "ar-EG-u-nu-latn" : undefined;

export function storeLang(next: Lang) {
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* ignore */
  }
}

const fill = (template: string, args: Array<string | number>) => template.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? ""));

/** Strings seen in Arabic mode that have no translation yet (development aid). */
export const missing = new Set<string>();
if (typeof window !== "undefined") (window as unknown as { __tempoMissing: Set<string> }).__tempoMissing = missing;

export function tr(text: string, ...args: Array<string | number>): string {
  if (lang === "en") return args.length ? fill(text, args) : text;
  const hit = AR[text];
  if (hit === undefined) missing.add(text);
  return args.length ? fill(hit ?? text, args) : (hit ?? text);
}

export type Noun = keyof typeof AR_NOUNS;
const EN_PLURAL: Partial<Record<string, string>> = { entry: "entries" };

/**
 * A counted noun: "3 tasks" / "٣ مهام". Arabic has separate forms for one,
 * two, three-to-ten and eleven-and-up, so this cannot be done with a suffix.
 */
export function tn(n: number, noun: Noun): string {
  if (lang === "en") return `${n} ${n === 1 ? noun : (EN_PLURAL[noun] ?? `${noun}s`)}`;
  const f = AR_NOUNS[noun];
  if (n === 1) return f.one;
  if (n === 2) return f.two;
  const mod = n % 100;
  return `${n} ${n === 0 || (mod >= 3 && mod <= 10) ? f.few : f.many}`;
}

let compiled: Array<{ re: RegExp; to: string }> | null = null;

/**
 * Translates text that was composed elsewhere (the social server writes feed
 * items, notifications and errors in English): tries an exact match, then the
 * known sentence patterns with their placeholders.
 */
export function td(text: string): string {
  if (lang === "en" || !text) return text;
  const exact = AR[text];
  if (exact !== undefined) return exact;
  compiled ??= Object.entries(AR_PATTERNS).map(([from, to]) => ({
    re: new RegExp(`^${from.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{(\d+)\}/g, "(.+?)")}$`),
    to,
  }));
  for (const { re, to } of compiled) {
    const m = re.exec(text);
    if (m) return to.replace(/\{(\d+)\}/g, (_, i) => td(m[Number(i) + 1] ?? "")).replace(/(\d+(?:\.\d+)?)h(?![a-z])/g, "$1 س");
  }
  return text;
}

/** "@name" kept intact inside right-to-left text (isolated, so the @ does not jump to the other side). */
export const at = (username: string) => `\u2066@${username}\u2069`;
export const hash = (name: string | number) => `\u2066#${name}\u2069`;

/** Example placeholder for a duration field: "e.g. 1h 30m" / "مثال: 1 س 30 د". */
export const eg = (sample: string) => (lang === "ar" ? `مثال: ${sample.replace(/(\d)h/g, "$1 س").replace(/(\d)m/g, "$1 د")}` : `e.g. ${sample}`);
