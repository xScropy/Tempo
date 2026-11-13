import { lang, tr } from "@/i18n";
/**
 * Date helpers. Calendar dates are local `YYYY-MM-DD` strings (DateStr);
 * instants are epoch milliseconds. Keeping the two apart is what makes
 * week boundaries and timezone changes behave predictably.
 */
export type DateStr = string;

const pad = (n: number) => String(n).padStart(2, "0");

export function toDateStr(d: Date): DateStr {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromDateStr(s: DateStr): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

export const todayStr = (now: Date = new Date()): DateStr => toDateStr(now);

export function addDays(s: DateStr, n: number): DateStr {
  const d = fromDateStr(s);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

/** Whole days from a to b (b - a). DST-safe: computed on calendar components. */
export function diffDays(a: DateStr, b: DateStr): number {
  const utc = (s: DateStr) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y!, m! - 1, d!);
  };
  return Math.round((utc(b) - utc(a)) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday */
export const weekdayOf = (s: DateStr): number => fromDateStr(s).getDay();

export function startOfWeek(s: DateStr, weekStart: number): DateStr {
  const back = (weekdayOf(s) - weekStart + 7) % 7;
  return addDays(s, -back);
}

export const weekDates = (start: DateStr): DateStr[] => Array.from({ length: 7 }, (_, i) => addDays(start, i));

export const dayStartMs = (s: DateStr): number => fromDateStr(s).getTime();
export const dayEndMs = (s: DateStr): number => dayStartMs(addDays(s, 1));

export const startOfMonth = (s: DateStr): DateStr => s.slice(0, 8) + "01";

export function daysInMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

export function addMonths(s: DateStr, n: number): DateStr {
  const d = fromDateStr(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, daysInMonth(d.getFullYear(), d.getMonth() + 1)));
  return toDateStr(d);
}

export const startOfYear = (s: DateStr): DateStr => s.slice(0, 4) + "-01-01";

/** Local date + "HH:MM" → epoch ms */
export function atTime(date: DateStr, hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  const d = fromDateStr(date);
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d.getTime();
}

export function timeOf(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const dateOfMs = (ms: number): DateStr => toDateStr(new Date(ms));

/** "1h 30m", "45m", "0m" — "1 س 30 د" in Arabic */
export function fmtDuration(seconds: number): string {
  const mins = Math.round(Math.max(0, seconds) / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (lang === "ar") return h === 0 ? `${m} د` : m === 0 ? `${h} س` : `${h} س ${m} د`;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** "1.5h" style for dense tables and charts */
export const fmtHours = (seconds: number): string => `${(Math.round((seconds / 3600) * 10) / 10).toString()}${lang === "ar" ? " س" : "h"}`;

/** "25:00" or "1:05:00" */
export function fmtClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

const EN_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const EN_DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const AR_DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const AR_DAY_LETTERS = ["ح", "ن", "ث", "ر", "خ", "ج", "س"];
const AR_MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const wd = (i: number) => ((i % 7) + 7) % 7;
/** Short weekday name: "Mon" / "الاثنين" (Arabic day names are not abbreviated). */
export const weekdayName = (i: number) => (lang === "ar" ? AR_DAYS[wd(i)]! : EN_DAYS[wd(i)]!);
export const weekdayLong = (i: number) => (lang === "ar" ? AR_DAYS[wd(i)]! : EN_DAYS_LONG[wd(i)]!);
/** One- or two-character weekday mark for tight grids: "Mo" / "ن". */
export const weekdayMark = (i: number, chars = 2) => (lang === "ar" ? AR_DAY_LETTERS[wd(i)]! : EN_DAYS[wd(i)]!.slice(0, chars));
export const monthName = (m0: number) => (lang === "ar" ? AR_MONTHS[m0]! : EN_MONTHS[m0]!);

/** "Today", "Tomorrow", "Mon 3 Mar" (year added when it differs). */
export function fmtDate(s: DateStr, today: DateStr = todayStr()): string {
  const diff = diffDays(today, s);
  if (diff === 0) return tr("Today");
  if (diff === 1) return tr("Tomorrow");
  if (diff === -1) return tr("Yesterday");
  const d = fromDateStr(s);
  const base = `${weekdayName(d.getDay())} ${d.getDate()} ${monthName(d.getMonth())}`;
  return s.slice(0, 4) === today.slice(0, 4) ? base : `${base} ${d.getFullYear()}`;
}

const AR_HOUR = "(?:ساعات|ساعة|ساعه|س)";
const AR_MIN = "(?:دقائق|دقايق|دقيقة|دقيقه|د)";

/** Parses "1h 30m", "90m", "1.5h", "2:30", "45" (minutes) → seconds, or null. */
export function parseDuration(input: string): number | null {
  let s = input.trim().toLowerCase();
  if (!s) return null;
  // Arabic: "ساعتين", "نص ساعة", "ساعة ونص", "45 دقيقة", "1 س 30 د"
  if (/[\u0600-\u06ff]/.test(s)) {
    s = s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
    let total = 0;
    let rest = ` ${s} `;
    const take = (re: RegExp, secs: (m: RegExpExecArray) => number) => {
      const m = re.exec(rest);
      if (m) {
        total += secs(m);
        rest = rest.replace(m[0], " ");
      }
    };
    take(/\sساعتين|\sساعتان/, () => 7200);
    take(/\s(?:نص|نصف)\s+ساع[ةه]/, () => 1800);
    take(/\sربع\s+ساع[ةه]/, () => 900);
    take(new RegExp(`\\s(\\d+(?:\\.\\d+)?)\\s*${AR_HOUR}(?=\\s)`), (m) => Number(m[1]) * 3600);
    take(/\sساع[ةه](?=\s)/, () => 3600);
    take(/\sو?\s*(?:نص|نصف)(?=\s)/, () => 1800);
    take(/\sو?\s*ربع(?=\s)/, () => 900);
    take(new RegExp(`\\sو?\\s*(\\d+(?:\\.\\d+)?)\\s*${AR_MIN}(?=\\s)`), (m) => Number(m[1]) * 60);
    return total > 0 && rest.trim() === "" ? Math.round(total) : null;
  }
  const colon = /^(\d+):(\d{1,2})$/.exec(s);
  if (colon) return Number(colon[1]) * 3600 + Number(colon[2]) * 60;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * 60);
  const re = /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\b/g;
  let total = 0;
  let matched = false;
  let rest = s;
  for (const m of s.matchAll(re)) {
    matched = true;
    total += Number(m[1]) * (m[2]!.startsWith("h") ? 3600 : 60);
    rest = rest.replace(m[0], "");
  }
  if (!matched || rest.trim() !== "") return null;
  return Math.round(total);
}
