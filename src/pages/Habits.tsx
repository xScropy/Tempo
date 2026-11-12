import { Check, Flame, Moon, MoreHorizontal, Plus, Repeat2, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { addDays, fromDateStr, startOfMonth, startOfWeek, weekDates, weekdayName, type DateStr } from "@/domain/dates";
import { consistency, currentStreak, dayState, longestStreak, type DayState } from "@/domain/habits";
import type { Habit } from "@/domain/types";
import { attempt } from "@/lib/notify";
import { archiveHabit, checkInHabit, deleteHabit, resetHabitDay, restHabitDay, saveHabit } from "@/store/actions";
import { useData } from "@/store/data";
import { habitDays } from "@/store/selectors";
import { confirmDialog, useUi } from "@/store/ui";
import { Button, Dialog, Empty, Field, IconButton, Input, Menu, PageHeader, Progress, Select, Textarea, cx } from "@/components/ui";

const KIND_LABEL: Record<Habit["kind"], string> = { boolean: "Yes / no", duration: "Duration (minutes)", quantity: "Quantity", sessions: "Number of check-ins" };
const unitOf = (h: Habit) => (h.kind === "duration" ? "min" : h.kind === "sessions" ? "×" : h.unit);

function HabitDialog({ habit, onClose }: { habit?: Habit; onClose: () => void }) {
  const categories = useData((s) => s.categories);
  const weekStart = useData((s) => s.settings.weekStart);
  const [f, setF] = useState({
    name: habit?.name ?? "", description: habit?.description ?? "", category_id: habit?.category_id ?? "", kind: habit?.kind ?? ("boolean" as Habit["kind"]),
    target_value: habit?.target_value ?? 1, unit: habit?.unit ?? "", weekdays: habit?.weekdays ?? [], reminder_time: habit?.reminder_time ?? "",
  });
  const order = Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7);
  const save = async () => {
    if (await attempt(() => saveHabit({ id: habit?.id, ...f, category_id: f.category_id || null, reminder_time: f.reminder_time || null, target_value: Number(f.target_value) || 1 }))) onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={habit ? "Edit habit" : "New habit"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!f.name.trim()} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name" className="col-span-2">
          <Input autoFocus value={f.name} placeholder="Morning reading" onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Tracked as">
          <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Habit["kind"], target_value: e.target.value === "boolean" ? 1 : f.target_value })}>
            {(Object.keys(KIND_LABEL) as Habit["kind"][]).map((k) => (
              <option key={k} value={k}>{KIND_LABEL[k]}</option>
            ))}
          </Select>
        </Field>
        {f.kind !== "boolean" ? (
          <Field label={f.kind === "duration" ? "Daily target (minutes)" : f.kind === "sessions" ? "Check-ins per day" : "Daily target"}>
            <Input type="number" min={1} value={f.target_value} onChange={(e) => setF({ ...f, target_value: Number(e.target.value) })} />
          </Field>
        ) : (
          <div />
        )}
        {f.kind === "quantity" && (
          <Field label="Unit">
            <Input value={f.unit} placeholder="pages, glasses, km…" onChange={(e) => setF({ ...f, unit: e.target.value })} />
          </Field>
        )}
        <Field label="Days" hint="No days selected means every day. Other days are rest days and never break a streak." className="col-span-2">
          <div className="flex gap-1">
            {order.map((d) => {
              const on = f.weekdays.includes(d);
              return (
                <button key={d} type="button" aria-pressed={on} onClick={() => setF({ ...f, weekdays: on ? f.weekdays.filter((x) => x !== d) : [...f.weekdays, d] })} className={cx("h-8 flex-1 rounded border text-sm", on ? "border-accent bg-accent/10 font-medium text-accent" : "border-line-strong text-ink-2 hover:bg-hover")}>
                  {weekdayName(d)}
                </button>
              );
            })}
          </div>
        </Field>
        <Field label="Reminder time">
          <Input type="time" value={f.reminder_time} onChange={(e) => setF({ ...f, reminder_time: e.target.value })} />
        </Field>
        <Field label="Category">
          <Select value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}>
            <option value="">None</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Description" className="col-span-2">
          <Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
      </div>
    </Dialog>
  );
}

const CELL: Record<DayState, string> = {
  done: "border-accent bg-accent text-accent-ink",
  partial: "border-accent/60 bg-accent/15 text-accent",
  missed: "border-line-strong text-ink-3",
  rest: "border-dashed border-line-strong text-ink-3",
  off: "border-transparent text-ink-3/60",
  pending: "border-line-strong text-ink-2",
};

function HabitRow({ habit, week, onEdit }: { habit: Habit; week: DateStr[]; onEdit: () => void }) {
  const today = useUi((s) => s.today);
  const entries = useData((s) => s.habitEntries);
  const weekStart = useData((s) => s.settings.weekStart);
  const days = useMemo(() => habitDays(habit.id, entries), [habit.id, entries]);
  const [amount, setAmount] = useState("");
  const streak = currentStreak(habit, days, today);
  const best = longestStreak(habit, days, today);
  const wk = consistency(habit, days, startOfWeek(today, weekStart), addDays(startOfWeek(today, weekStart), 6), today);
  const mo = consistency(habit, days, startOfMonth(today), today, today);
  const todayDay = days.get(today);
  const value = todayDay?.value ?? 0;

  const click = (d: DateStr) => {
    if (d > today) return;
    const day = days.get(d);
    const state = dayState(habit, d, day, today);
    if (habit.kind === "boolean") void attempt(() => (state === "done" ? resetHabitDay(habit.id, d) : checkInHabit(habit.id, d, 1)));
    else if (habit.kind === "sessions") void attempt(() => (state === "done" ? resetHabitDay(habit.id, d) : checkInHabit(habit.id, d, 1)));
    else if (state === "done") void attempt(() => resetHabitDay(habit.id, d));
    else void attempt(() => checkInHabit(habit.id, d, habit.target_value - (day?.value ?? 0)));
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_230px_190px_28px] items-center gap-4 border-b border-line px-4 py-2.5">
      <div className="min-w-0">
        <div className="truncate font-medium">{habit.name}</div>
        <div className="truncate text-xs text-ink-2">
          {habit.kind === "boolean" ? "Daily check" : `Target ${habit.target_value} ${unitOf(habit)} a day`}
          {habit.weekdays.length > 0 && habit.weekdays.length < 7 ? ` · ${habit.weekdays.slice().sort().map(weekdayName).join(", ")}` : ""}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {habit.kind === "boolean" ? (
          <Button size="sm" variant={value >= 1 ? "primary" : "secondary"} icon={<Check size={13} />} onClick={() => click(today)}>
            {value >= 1 ? "Done" : "Mark done"}
          </Button>
        ) : habit.kind === "sessions" ? (
          <>
            <span className="tabular text-sm text-ink-2">{value}/{habit.target_value}</span>
            <Button size="sm" variant={value >= habit.target_value ? "primary" : "secondary"} icon={<Plus size={13} />} disabled={value >= habit.target_value} onClick={() => void attempt(() => checkInHabit(habit.id, today, 1))}>
              Check in
            </Button>
          </>
        ) : (
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(amount);
              if (n > 0) void attempt(() => checkInHabit(habit.id, today, n)).then((ok) => ok && setAmount(""));
            }}
          >
            <span className="tabular text-sm text-ink-2">{value}/{habit.target_value} {unitOf(habit)}</span>
            <Input className="!h-7 !w-16" type="number" min={0} step="any" placeholder={`+${unitOf(habit)}`} aria-label={`Add ${unitOf(habit)} for ${habit.name}`} value={amount} onChange={(e) => setAmount(e.target.value)} />
            <Button size="sm" type="submit" disabled={!(Number(amount) > 0)}>Add</Button>
          </form>
        )}
        {habit.kind !== "boolean" && <Progress value={value / habit.target_value} className="w-14" />}
      </div>

      <div className="flex gap-1">
        {week.map((d) => {
          const day = days.get(d);
          const state = dayState(habit, d, day, today);
          return (
            <button
              key={d}
              type="button"
              disabled={d > today}
              onClick={() => click(d)}
              title={`${weekdayName(fromDateStr(d).getDay())} ${d}: ${state === "rest" ? "rest day" : state === "off" ? "not scheduled" : habit.kind === "boolean" ? state : `${day?.value ?? 0}/${habit.target_value} ${unitOf(habit)}`}`}
              aria-label={`${habit.name} on ${d}: ${state}`}
              className={cx("flex h-7 w-7 items-center justify-center rounded border text-2xs", CELL[state], d === today && "ring-1 ring-ink-3 ring-offset-1 ring-offset-bg")}
            >
              {state === "done" ? <Check size={12} strokeWidth={3} /> : state === "rest" ? <Moon size={11} /> : state === "partial" && habit.kind !== "boolean" ? day?.value : weekdayName(fromDateStr(d).getDay()).slice(0, 1)}
            </button>
          );
        })}
      </div>

      <div className="text-xs text-ink-2">
        <div className="flex items-center gap-1">
          <Flame size={12} className={streak > 0 ? "text-warn" : "text-ink-3"} />
          <span className="tabular font-medium text-ink">{streak}</span> day streak <span className="text-ink-3">· best {best}</span>
        </div>
        <div className="tabular mt-0.5">Week {wk == null ? "—" : `${Math.round(wk * 100)}%`} · Month {mo == null ? "—" : `${Math.round(mo * 100)}%`}</div>
      </div>

      <Menu
        align="end"
        trigger={
          <IconButton label={`Options for ${habit.name}`}>
            <MoreHorizontal size={15} />
          </IconButton>
        }
        items={[
          { label: "Edit habit", onSelect: onEdit },
          { label: "Take a rest day today", icon: <Moon size={13} />, onSelect: () => void attempt(() => restHabitDay(habit.id, today)) },
          { label: "Clear today", icon: <RotateCcw size={13} />, onSelect: () => void attempt(() => resetHabitDay(habit.id, today)) },
          "sep",
          { label: "Archive", onSelect: () => void attempt(() => archiveHabit(habit.id)) },
          { label: "Delete with history", danger: true, onSelect: () => void confirmDialog({ title: `Delete "${habit.name}"?`, body: "The habit and its entire history are removed. Archive it instead to keep the history.", confirmLabel: "Delete", danger: true }).then((ok) => ok && attempt(() => deleteHabit(habit.id))) },
        ]}
      />
    </div>
  );
}

export function HabitsPage() {
  const today = useUi((s) => s.today);
  const habits = useData((s) => s.habits);
  const weekStart = useData((s) => s.settings.weekStart);
  const [dialog, setDialog] = useState<Habit | "new" | null>(null);
  const active = habits.filter((h) => !h.archived_at);
  const week = weekDates(startOfWeek(today, weekStart));
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Habits" subtitle="Routines you repeat. Missed days are just information — rest days never break a streak.">
        <Button variant="primary" icon={<Plus size={14} />} onClick={() => setDialog("new")}>
          New habit
        </Button>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-auto">
        {active.length === 0 ? (
          <Empty icon={<Repeat2 size={28} />} title="No habits yet" body="Track things you do regularly: a yes/no check, minutes practised, a quantity, or several check-ins a day." action={<Button variant="primary" onClick={() => setDialog("new")}>Create a habit</Button>} />
        ) : (
          <div className="min-w-[860px]">
            {active.map((h) => (
              <HabitRow key={h.id} habit={h} week={week} onEdit={() => setDialog(h)} />
            ))}
          </div>
        )}
      </div>
      {dialog && <HabitDialog habit={dialog === "new" ? undefined : dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}
