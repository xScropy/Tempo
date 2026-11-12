import { useState } from "react";
import { todayStr, weekdayName, weekdayOf } from "@/domain/dates";
import { describeRule, occurrencesBetween, type RecurrenceRule } from "@/domain/recurrence";
import type { Task } from "@/domain/types";
import { attempt } from "@/lib/notify";
import { createSeries, endSeries, updateSeries, type SeriesTemplate } from "@/store/actions";
import { useData } from "@/store/data";
import { confirmDialog, openTask } from "@/store/ui";
import { Button, Dialog, DurationInput, Field, Input, Select, cx } from "./ui";

/** Creates a recurring series from a task, or edits the series an occurrence belongs to. */
export function RecurrenceDialog({ task, onClose }: { task: Task; onClose: () => void }) {
  const { series, rules, settings, taskTags } = useData.getState();
  const existing = task.series_id ? series.find((s) => s.id === task.series_id) : undefined;
  const existingRule = existing ? rules.find((r) => r.id === existing.rule_id) : undefined;
  const anchor = task.occurrence_date ?? task.due_date ?? todayStr();

  const [rule, setRule] = useState<RecurrenceRule>(
    existingRule
      ? { freq: existingRule.freq, interval: existingRule.interval, weekdays: existingRule.weekdays, monthdays: existingRule.monthdays, start_date: existingRule.start_date, end_date: existingRule.end_date, count: existingRule.count }
      : { freq: "daily", interval: 1, weekdays: [weekdayOf(anchor)], monthdays: [Number(anchor.slice(8, 10))], start_date: anchor, end_date: null, count: null },
  );
  const [tpl, setTpl] = useState<SeriesTemplate>({
    title: existing?.title ?? task.title,
    description: existing?.description ?? task.description,
    priority: existing?.priority ?? task.priority,
    project_id: existing ? existing.project_id : task.project_id,
    category_id: existing ? existing.category_id : task.category_id,
    estimated_seconds: existing ? existing.estimated_seconds : task.estimated_seconds,
    scheduled_time: existing?.scheduled_time ?? null,
    tag_ids: existing?.tag_ids ?? taskTags[task.id] ?? [],
  });
  const [ends, setEnds] = useState<"never" | "date" | "count">(rule.end_date ? "date" : rule.count ? "count" : "never");
  const [scope, setScope] = useState<"future" | "all">("future");
  const [monthText, setMonthText] = useState(rule.monthdays.join(", "));

  const set = (patch: Partial<RecurrenceRule>) => setRule((r) => ({ ...r, ...patch }));
  const effective: RecurrenceRule = { ...rule, end_date: ends === "date" ? rule.end_date : null, count: ends === "count" ? rule.count : null };
  const preview = occurrencesBetween(effective, effective.start_date, "2100-01-01", settings.weekStart).slice(0, 4);
  const order = Array.from({ length: 7 }, (_, i) => (settings.weekStart + i) % 7);

  const save = async () => {
    const ok = await attempt(async () => {
      if (existing) await updateSeries(existing.id, tpl, effective, scope, anchor);
      else await createSeries(tpl, effective, task.id);
    });
    if (ok) {
      if (!existing) openTask(null);
      onClose();
    }
  };

  const stop = async () => {
    if (!existing) return;
    if (!(await confirmDialog({ title: "Stop repeating?", body: "Completed occurrences stay in your history. Future open occurrences are removed.", confirmLabel: "Stop repeating", danger: true }))) return;
    if (await attempt(() => endSeries(existing.id))) onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={existing ? "Edit recurring task" : "Repeat task"}
      width={520}
      footer={
        <>
          {existing && (
            <Button variant="danger" className="mr-auto" onClick={stop}>
              Stop repeating
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            {existing ? "Save changes" : "Create series"}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Title" className="col-span-2">
          <Input value={tpl.title} onChange={(e) => setTpl({ ...tpl, title: e.target.value })} />
        </Field>
        <Field label="Repeats">
          <Select value={rule.freq} onChange={(e) => set({ freq: e.target.value as RecurrenceRule["freq"] })}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </Select>
        </Field>
        <Field label={`Every … ${rule.freq === "daily" ? "day(s)" : rule.freq === "weekly" ? "week(s)" : "month(s)"}`}>
          <Input type="number" min={1} max={365} value={rule.interval} onChange={(e) => set({ interval: Math.max(1, Number(e.target.value) || 1) })} />
        </Field>
        {rule.freq === "weekly" && (
          <Field group label="On" className="col-span-2">
            <div className="flex gap-1">
              {order.map((d) => {
                const on = rule.weekdays.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set({ weekdays: on ? rule.weekdays.filter((x) => x !== d) : [...rule.weekdays, d] })}
                    className={cx("h-8 flex-1 rounded border text-sm", on ? "border-accent bg-accent/10 font-medium text-accent" : "border-line-strong text-ink-2 hover:bg-hover")}
                  >
                    {weekdayName(d)}
                  </button>
                );
              })}
            </div>
          </Field>
        )}
        {rule.freq === "monthly" && (
          <Field label="Days of the month" hint="Comma-separated, e.g. 1, 15. Days past the end of a month fall on its last day." className="col-span-2">
            <Input
              value={monthText}
              onChange={(e) => {
                setMonthText(e.target.value);
                set({ monthdays: e.target.value.split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 31) });
              }}
            />
          </Field>
        )}
        <Field label="Starts">
          <Input type="date" value={rule.start_date} onChange={(e) => e.target.value && set({ start_date: e.target.value })} />
        </Field>
        <Field label="Ends">
          <Select value={ends} onChange={(e) => setEnds(e.target.value as typeof ends)}>
            <option value="never">Never</option>
            <option value="date">On a date</option>
            <option value="count">After a number of times</option>
          </Select>
        </Field>
        {ends === "date" && (
          <Field label="End date">
            <Input type="date" value={rule.end_date ?? ""} min={rule.start_date} onChange={(e) => set({ end_date: e.target.value || null })} />
          </Field>
        )}
        {ends === "count" && (
          <Field label="Occurrences">
            <Input type="number" min={1} value={rule.count ?? 10} onChange={(e) => set({ count: Math.max(1, Number(e.target.value) || 1) })} />
          </Field>
        )}
        <Field label="Time of day (optional)">
          <Input type="time" value={tpl.scheduled_time ?? ""} onChange={(e) => setTpl({ ...tpl, scheduled_time: e.target.value || null })} />
        </Field>
        <Field label="Estimate per occurrence">
          <DurationInput value={tpl.estimated_seconds ?? null} onChange={(v) => setTpl({ ...tpl, estimated_seconds: v })} />
        </Field>
        {existing && (
          <Field label="Apply changes to" className="col-span-2">
            <Select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
              <option value="future">This and future occurrences</option>
              <option value="all">All open occurrences</option>
            </Select>
          </Field>
        )}
      </div>
      <div className="mt-3 rounded border border-line bg-raised px-3 py-2 text-sm text-ink-2">
        <div className="font-medium text-ink">{describeRule(effective)}</div>
        <div className="mt-0.5">{preview.length ? `Next: ${preview.join(" · ")}` : "This rule produces no occurrences."}</div>
        {existing && <div className="mt-1 text-xs text-ink-3">Completed occurrences and ones you edited individually are never changed. To change a single occurrence, just edit it in the task panel.</div>}
      </div>
    </Dialog>
  );
}
