import { db } from "@/db/driver";
import { newId } from "@/db/sql";
import { addDays, atTime, fmtDate, timeOf, todayStr } from "@/domain/dates";
import { isDone, isScheduled } from "@/domain/habits";
import { isOpen } from "@/domain/types";
import { data } from "@/store/data";
import { habitDays } from "@/store/selectors";
import { notify } from "./notify";

interface Due {
  key: string;
  kind: string;
  title: string;
  body: string;
}

const HOUR = 3_600_000;

/** Reminders that are due right now. Pure with respect to its inputs, so it can be tested. */
export function dueReminders(now: number, s = data()): Due[] {
  const out: Due[] = [];
  const today = todayStr(new Date(now));
  for (const t of s.tasks) {
    if (t.reminder_at && t.reminder_at <= now && t.reminder_at > now - 6 * HOUR && isOpen(t)) {
      out.push({ key: `task:${t.id}:${t.reminder_at}`, kind: "task", title: t.title, body: t.due_date ? `Due ${fmtDate(t.due_date, today).toLowerCase()}` : "Task reminder" });
    }
  }
  for (const e of s.events) {
    if (e.reminder_minutes == null) continue;
    const at = e.start_at - e.reminder_minutes * 60_000;
    if (at <= now && now < e.start_at + 5 * 60_000 && at > now - 6 * HOUR) out.push({ key: `event:${e.id}:${e.start_at}`, kind: "event", title: e.title, body: `Starts at ${timeOf(e.start_at)}` });
  }
  for (const h of s.habits) {
    if (!h.reminder_time || h.archived_at || !isScheduled(h, today)) continue;
    const at = atTime(today, h.reminder_time);
    if (at <= now && at > now - 2 * HOUR && !isDone(h, habitDays(h.id, s.habitEntries).get(today))) out.push({ key: `habit:${h.id}:${today}`, kind: "habit", title: h.name, body: "Habit reminder" });
  }
  if (now >= atTime(today, "09:00")) {
    for (const p of s.projects) {
      if (!p.deadline || p.status === "completed" || p.status === "cancelled") continue;
      if (p.deadline === today || p.deadline === addDays(today, 1)) out.push({ key: `deadline:${p.id}:${p.deadline}:${today}`, kind: "deadline", title: `${p.name} is due ${p.deadline === today ? "today" : "tomorrow"}`, body: "Project deadline" });
    }
    for (const m of s.milestones) {
      if (m.due_date === today && !m.completed_at) out.push({ key: `milestone:${m.id}:${today}`, kind: "deadline", title: `Milestone due today: ${m.title}`, body: s.projects.find((p) => p.id === m.project_id)?.name ?? "" });
    }
  }
  return out;
}

let fired: Set<string> | null = null;

/** Fires each due reminder exactly once; the notifications table is the durable record. */
export async function checkReminders(): Promise<void> {
  const now = Date.now();
  if (!fired) fired = new Set((await db().select<{ dedupe_key: string }>("SELECT dedupe_key FROM notifications WHERE fired_at > ?", [now - 14 * 24 * HOUR])).map((r) => r.dedupe_key));
  for (const d of dueReminders(now)) {
    if (fired.has(d.key)) continue;
    fired.add(d.key);
    await db().execute("INSERT OR IGNORE INTO notifications (id, dedupe_key, kind, title, body, fired_at) VALUES (?, ?, ?, ?, ?, ?)", [newId(), d.key, d.kind, d.title, d.body, now]);
    void notify(d.title, d.body, data().settings.notifications);
  }
}
