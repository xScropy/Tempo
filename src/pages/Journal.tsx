import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { addDays, dayStartMs, fmtDate, fmtDuration } from "@/domain/dates";
import { totalSeconds } from "@/domain/time";
import type { JournalEntry } from "@/domain/types";
import { attempt } from "@/lib/notify";
import { saveJournal } from "@/store/actions";
import { useData } from "@/store/data";
import { intervals } from "@/store/selectors";
import { navigate, useUi } from "@/store/ui";
import { Button, CommitInput, IconButton, PageHeader, cx } from "@/components/ui";

const SECTIONS: Array<{ key: keyof Omit<JournalEntry, "date" | "updated_at">; label: string; hint: string }> = [
  { key: "accomplishments", label: "Today's accomplishments", hint: "What did you get done?" },
  { key: "went_well", label: "What went well?", hint: "" },
  { key: "went_wrong", label: "What went wrong?", hint: "" },
  { key: "improve", label: "What needs improvement?", hint: "" },
  { key: "tomorrow", label: "Tomorrow's priorities", hint: "The one to three things that matter most" },
];

export function JournalPage() {
  const today = useUi((s) => s.today);
  const routeId = useUi((s) => s.routeId);
  const journal = useData((s) => s.journal);
  const tasks = useData((s) => s.tasks);
  const entries = useData((s) => s.entries);
  const date = routeId && /^\d{4}-\d{2}-\d{2}$/.test(routeId) ? routeId : today;
  const entry = journal[date];
  const from = dayStartMs(date);
  const focus = useMemo(() => totalSeconds(intervals(entries), from, from + 86_400_000), [entries, from]);
  const done = useMemo(() => tasks.filter((t) => t.completed_at != null && t.completed_at >= from && t.completed_at < from + 86_400_000 && !t.parent_id), [tasks, from]);
  const past = useMemo(() => Object.values(journal).filter((j) => SECTIONS.some((s) => j[s.key].trim())).sort((a, b) => b.date.localeCompare(a.date)), [journal]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Journal" subtitle={fmtDate(date, today)}>
        <div className="flex items-center">
          <IconButton label="Previous day" onClick={() => navigate("journal", addDays(date, -1))}>
            <ChevronLeft size={15} />
          </IconButton>
          <Button variant="ghost" size="sm" onClick={() => navigate("journal", null)}>
            Today
          </Button>
          <IconButton label="Next day" disabled={date >= today} onClick={() => navigate("journal", addDays(date, 1))}>
            <ChevronRight size={15} />
          </IconButton>
        </div>
      </PageHeader>
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="mx-auto max-w-[680px] space-y-4">
            <div className="rounded-md border border-line bg-raised px-3 py-2 text-sm text-ink-2">
              <span className="tabular font-medium text-ink">{fmtDuration(focus)}</span> focused · <span className="tabular font-medium text-ink">{done.length}</span> task{done.length === 1 ? "" : "s"} completed
              {done.length > 0 && <span> — {done.slice(0, 4).map((t) => t.title).join(", ")}{done.length > 4 ? "…" : ""}</span>}
            </div>
            {SECTIONS.map((s) => (
              <label key={`${date}-${s.key}`} className="block">
                <span className="mb-1 block text-sm font-semibold">{s.label}</span>
                <CommitInput multiline rows={3} value={entry?.[s.key] ?? ""} placeholder={s.hint || "Markdown supported"} onCommit={(v) => void attempt(() => saveJournal(date, { [s.key]: v }))} />
              </label>
            ))}
            <div className="text-xs text-ink-3">Saved automatically when you leave a field.{entry ? ` Last saved ${new Date(entry.updated_at).toLocaleString()}.` : ""}</div>
          </div>
        </div>
        <aside className="w-[220px] shrink-0 overflow-y-auto border-l border-line bg-raised p-2">
          <div className="px-2 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-ink-2">Entries</div>
          {past.length === 0 && <div className="px-2 text-xs text-ink-3">Your reflections will be listed here.</div>}
          {past.map((j) => (
            <button key={j.date} type="button" onClick={() => navigate("journal", j.date)} className={cx("block w-full rounded px-2 py-1.5 text-left hover:bg-hover", j.date === date && "bg-hover")}>
              <div className="text-sm font-medium">{fmtDate(j.date, today)}</div>
              <div className="truncate text-xs text-ink-2">{SECTIONS.map((s) => j[s.key]).find((v) => v.trim())?.split("\n")[0]}</div>
            </button>
          ))}
        </aside>
      </div>
    </div>
  );
}
