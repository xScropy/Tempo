import { addDays, weekdayOf, type DateStr } from "./dates";

export interface QuickAdd {
  title: string;
  due_date: DateStr | null;
  estimated_seconds: number | null;
  /** "HH:MM" */
  time: string | null;
  priority: number | null;
  tags: string[];
}

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/**
 * Rule-based quick-add parser — no AI, fully offline.
 * Understands: today / tomorrow / weekday names, "for 2 hours" / "90m" / "1.5h",
 * "at 9:30" / "at 9am", !1–!4 or !critical/!high/!medium/!low, and #tags.
 * Anything it does not recognise stays in the title.
 */
export function parseQuickAdd(input: string, today: DateStr): QuickAdd {
  let text = ` ${input} `;
  const out: QuickAdd = { title: "", due_date: null, estimated_seconds: null, time: null, priority: null, tags: [] };
  const take = (re: RegExp, fn: (m: RegExpExecArray) => boolean | void) => {
    const m = re.exec(text);
    if (m && fn(m) !== false) text = text.slice(0, m.index) + " " + text.slice(m.index + m[0].length);
  };

  for (const m of text.matchAll(/\s#([\p{L}\p{N}_-]+)/gu)) out.tags.push(m[1]!);
  text = text.replace(/\s#([\p{L}\p{N}_-]+)/gu, " ");

  take(/\s!(1|2|3|4|critical|high|medium|low)\b/i, (m) => {
    const v = m[1]!.toLowerCase();
    out.priority = { "1": 1, "2": 2, "3": 3, "4": 4, critical: 1, high: 2, medium: 3, low: 4 }[v] ?? null;
  });

  take(/\s(?:for\s+)?(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/i, (m) => {
    out.estimated_seconds = Math.round(Number(m[1]) * (m[2]!.toLowerCase().startsWith("h") ? 3600 : 60));
  });

  take(/\sat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i, (m) => {
    let h = Number(m[1]);
    const min = Number(m[2] ?? 0);
    const ap = m[3]?.toLowerCase();
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    if (h > 23 || min > 59) return false;
    out.time = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  });

  take(/\s(today|tonight|tomorrow)\b/i, (m) => {
    out.due_date = m[1]!.toLowerCase() === "tomorrow" ? addDays(today, 1) : today;
  });
  if (!out.due_date) {
    take(/\s(?:on\s+|next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i, (m) => {
      const target = DAYS.indexOf(m[1]!.toLowerCase());
      const ahead = (target - weekdayOf(today) + 7) % 7 || 7;
      out.due_date = addDays(today, ahead);
    });
  }
  if (out.time && !out.due_date) out.due_date = today;

  out.title = text.replace(/\s+/g, " ").trim().replace(/[\s,.;:-]+$/, "");
  if (!out.title) out.title = input.trim();
  return out;
}
