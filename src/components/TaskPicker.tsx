import { tr } from "@/i18n";
import { ChevronDown, X } from "lucide-react";
import { useMemo, useState } from "react";
import { isOpen } from "@/domain/types";
import { useData } from "@/store/data";
import { byId } from "@/store/selectors";
import { Input, Popover, cx } from "./ui";

/** Searchable picker over open tasks (and subtasks). */
export function TaskPicker({ value, onChange, placeholder = tr("No task — quick focus") }: { value: string | null; onChange: (id: string | null) => void; placeholder?: string }) {
  const tasks = useData((s) => s.tasks);
  const projects = useData((s) => s.projects);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = value ? byId(tasks).get(value) : undefined;
  const matches = useMemo(() => {
    if (!open) return [];
    const n = q.trim().toLowerCase();
    const out = [];
    for (const t of tasks) {
      if (!isOpen(t) || (n && !t.title.toLowerCase().includes(n))) continue;
      out.push(t);
      if (out.length >= 60) break;
    }
    return out.sort((a, b) => Number(b.status === "in_progress") - Number(a.status === "in_progress"));
  }, [tasks, q, open]);
  return (
    <Popover
      open={open}
      onOpenChange={(o) => (setOpen(o), setQ(""))}
      trigger={
        <button type="button" className="flex h-8 w-full items-center gap-2 rounded border border-line-strong bg-surface px-2.5 text-start text-base hover:bg-hover/50">
          <span className={cx("min-w-0 flex-1 truncate", !selected && "text-ink-3")}>{selected?.title ?? placeholder}</span>
          {selected ? (
            <span role="button" tabIndex={0} aria-label={tr("Clear task")} className="text-ink-3 hover:text-ink" onClick={(e) => (e.stopPropagation(), onChange(null))} onKeyDown={(e) => e.key === "Enter" && (e.stopPropagation(), onChange(null))}>
              <X size={13} />
            </span>
          ) : (
            <ChevronDown size={14} className="text-ink-3" />
          )}
        </button>
      }
    >
      <div className="w-[340px]">
        <Input autoFocus placeholder={tr("Search open tasks")} aria-label={tr("Search tasks")} value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="mt-2 max-h-64 overflow-y-auto">
          {matches.length === 0 && <div className="px-2 py-3 text-sm text-ink-2">{tr("No open tasks match.")}</div>}
          {matches.map((t) => {
            const p = t.project_id ? byId(projects).get(t.project_id) : undefined;
            return (
              <button key={t.id} type="button" className={cx("flex w-full items-center gap-2 rounded px-2 py-1.5 text-start text-sm hover:bg-hover", t.id === value && "bg-hover")} onClick={() => (onChange(t.id), setOpen(false))}>
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                {p && <span className="max-w-[120px] shrink-0 truncate text-xs text-ink-3">{p.name}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </Popover>
  );
}
