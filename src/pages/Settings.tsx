import { LOCALE, hash, lang, storeLang, tr, type Lang } from "@/i18n";
import { Check, Download, Trash2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { isTauri } from "@/db/driver";
import { dateOfMs, timeOf, todayStr, weekdayLong } from "@/domain/dates";
import { PRIORITY_LABEL, STATUS_LABEL } from "@/domain/types";
import { attempt, notify, toast } from "@/lib/notify";
import { backups, pickTextFile, registerQuickCapture, saveFile, type BackupInfo } from "@/lib/platform";
import { deleteCategory, deleteTag, exportAll, importAll, saveCategory, setSetting, toCsv } from "@/store/actions";
import { ACCENTS, data, reload, useData, type Accent, type Settings } from "@/store/data";
import { taskSeconds } from "@/store/selectors";
import { restoreTimer } from "@/store/timer";
import { confirmDialog, openQuickAdd } from "@/store/ui";
import { Badge, Button, Checkbox, Field, IconButton, Input, PageHeader, Section, Segmented, Select , cx } from "@/components/ui";

const ACCENT_LABEL: Record<Accent, string> = { teal: "Teal", green: "Green", blue: "Blue", purple: "Purple", pink: "Pink", rose: "Deep pink", orange: "Orange", brown: "Brown", graphite: "Graphite" };
const ACCENT_SWATCH: Record<Accent, string> = { teal: "#1f6f5c", green: "#1e783a", blue: "#215eba", purple: "#6c3ebe", pink: "#c72479", rose: "#96164a", orange: "#b05008", brown: "#7a4a2b", graphite: "#3e3e3c" };

function Num({ k, label, min, max, hint }: { k: keyof Settings; label: string; min: number; max: number; hint?: string }) {
  const value = useData((s) => s.settings[k]) as number;
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <Field label={label} hint={hint}>
      <Input
        type="number"
        min={min}
        max={max}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = Math.round(Number(draft));
          if (!Number.isFinite(n) || n < min || n > max) return (setDraft(String(value)), toast(tr("Out of range"), tr("{0} must be between {1} and {2}.", label, min, max), "error"));
          if (n !== value) void attempt(() => setSetting(k, n as never));
        }}
      />
    </Field>
  );
}

function Toggle({ k, label }: { k: keyof Settings; label: string }) {
  const value = useData((s) => s.settings[k]) as boolean;
  return <Checkbox checked={value} label={label} onChange={(v) => void attempt(() => setSetting(k, v as never))} />;
}

const stamp = () => todayStr().replace(/-/g, "");

async function exportJson() {
  await attempt(async () => {
    await saveFile(`tempo-export-${stamp()}.json`, JSON.stringify(await exportAll()), "application/json");
  });
}

async function exportTasksCsv() {
  const s = data();
  const actual = taskSeconds(s.entries);
  const lines = s.tasks.map((t) => [
    t.title, STATUS_LABEL[t.status], PRIORITY_LABEL[t.priority], s.projects.find((p) => p.id === t.project_id)?.name ?? "", s.categories.find((c) => c.id === t.category_id)?.name ?? "",
    (s.taskTags[t.id] ?? []).map((id) => s.tags.find((g) => g.id === id)?.name).filter(Boolean).join(" "), t.start_date ?? "", t.due_date ?? "",
    t.estimated_seconds ? Math.round(t.estimated_seconds / 60) : "", Math.round((actual.get(t.id) ?? 0) / 60), t.completed_at ? new Date(t.completed_at).toISOString() : "", t.parent_id ? (s.tasks.find((p) => p.id === t.parent_id)?.title ?? "") : "",
  ]);
  await attempt(() => saveFile(`tempo-tasks-${stamp()}.csv`, toCsv([tr("Title"), tr("Status"), tr("Priority"), tr("Project"), tr("Category"), tr("Tags"), tr("Start date"), tr("Due date"), tr("Estimated (min)"), tr("Tracked (min)"), tr("Completed at"), tr("Parent task")], lines), "text/csv"));
}

async function exportTimeCsv() {
  const s = data();
  const lines = s.entries.map((e) => [
    dateOfMs(e.started_at), timeOf(e.started_at), timeOf(e.ended_at), Math.round((e.ended_at - e.started_at) / 60_000), s.tasks.find((t) => t.id === e.task_id)?.title ?? "",
    s.projects.find((p) => p.id === e.project_id)?.name ?? "", s.categories.find((c) => c.id === e.category_id)?.name ?? "", s.targets.find((t) => t.id === e.target_id)?.name ?? "", e.source, e.description,
  ]);
  await attempt(() => saveFile(`tempo-time-${stamp()}.csv`, toCsv([tr("Date"), tr("Start time"), tr("End time"), tr("Minutes"), tr("Task"), tr("Project"), tr("Category"), tr("Activity"), tr("Source"), tr("Description")], lines), "text/csv"));
}

async function importJson() {
  const text = await pickTextFile("json").catch(() => null);
  if (!text) return;
  const ok = await confirmDialog({ title: tr("Replace all data with this file?"), body: tr("Everything currently in Tempo is replaced by the contents of the export file. Export your current data first if you might want it back."), confirmLabel: tr("Replace my data"), danger: true });
  if (!ok) return;
  const done = await attempt(async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(tr("That file is not valid JSON"));
    }
    await importAll(parsed);
    await restoreTimer(); // the import replaced everything, including any running timer
  });
  if (done) toast(tr("Data restored"), tr("The export file was imported."), "ok");
}

function Backups() {
  const settings = useData((s) => s.settings);
  const [list, setList] = useState<BackupInfo[]>([]);
  const [where, setWhere] = useState("");
  const refresh = () => void backups.list().then(setList).catch(() => setList([]));
  useEffect(() => {
    refresh();
    void backups.location().then(setWhere).catch(() => undefined);
  }, []);
  const restore = async (b: BackupInfo) => {
    if (!(await confirmDialog({ title: tr("Restore this backup?"), body: tr("All current data is replaced with the backup from {0}. A safety copy of the current data is made first.", new Date(b.modified_ms).toLocaleString(LOCALE)), confirmLabel: tr("Restore"), danger: true }))) return;
    if (await attempt(async () => {
      await backups.restore(b.name);
      await reload();
      await restoreTimer();
    })) toast(tr("Backup restored"), undefined, "ok");
    refresh();
  };
  return (
    <>
      <div className="flex flex-wrap items-center gap-4">
        <Toggle k="autoBackup" label={tr("Back up automatically once a day")} />
        <div className="w-40">
          <Num k="backupKeep" label={tr("Automatic backups to keep")} min={1} max={90} />
        </div>
        <Button onClick={() => void attempt(() => backups.create("manual", settings.backupKeep)).then((ok) => (ok && toast(tr("Backup created"), undefined, "ok"), refresh()))}>{tr("Back up now")}</Button>
      </div>
      {where && <div className="selectable mt-2 text-xs text-ink-3">{tr("Database and backups are stored in")}{" "}{where}</div>}
      <div className="mt-2 max-h-48 overflow-y-auto rounded border border-line">
        {list.length === 0 && <div className="px-3 py-2 text-sm text-ink-2">{tr("No backups yet.")}</div>}
        {list.map((b) => (
          <div key={b.name} className="flex items-center gap-3 border-b border-line px-3 py-1.5 text-sm last:border-0">
            <span className="tabular flex-1">{new Date(b.modified_ms).toLocaleString(LOCALE)}</span>
            <Badge>{b.name.split("-")[1]}</Badge>
            <span className="tabular w-20 text-end text-xs text-ink-2">{(b.size / 1024).toFixed(0)}{" "}{tr("KB")}</span>
            <Button size="sm" onClick={() => void restore(b)}>{tr("Restore")}</Button>
          </div>
        ))}
      </div>
    </>
  );
}

const SHORTCUTS: Array<[string, string]> = [
  [tr("N  ·  Ctrl+N"), tr("New task")], [tr("Ctrl+Shift+P"), tr("New project")], [tr("Ctrl+K  ·  /"), tr("Search everything")], [tr("Alt+T"), tr("Start / pause timer")],
  [tr("Alt+C"), tr("Open calendar")], [tr("Alt+1 … Alt+9"), tr("Jump to a section")], [tr("Esc"), tr("Close the task panel or leave focus mode")], [tr("Space"), tr("Complete the focused task")],
];

export function SettingsPage() {
  const settings = useData((s) => s.settings);
  const categories = useData((s) => s.categories);
  const tags = useData((s) => s.tags);
  const [cat, setCat] = useState({ name: "", color: "#5b7a99" });
  const [shortcut, setShortcut] = useState(settings.quickCaptureShortcut);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={tr("Settings")} />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="mx-auto max-w-[760px] space-y-4">
          <Section title={tr("Appearance")}>
            <div className="flex items-center gap-4 px-3 py-3">
              <span className="text-sm text-ink-2">{tr("Theme")}</span>
              <Segmented value={settings.theme} onChange={(v) => void attempt(() => setSetting("theme", v))} options={[{ value: "system", label: tr("System") }, { value: "light", label: tr("Light") }, { value: "dark", label: tr("Dark") }]} />
            </div>
            <div className="flex items-center gap-4 border-t border-line px-3 py-3">
              <span className="text-sm text-ink-2">{tr("Colour")}</span>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={tr("Colour")}>
                {ACCENTS.map((a) => (
                  <button
                    key={a}
                    type="button"
                    role="radio"
                    aria-checked={settings.accent === a}
                    aria-label={tr(ACCENT_LABEL[a])}
                    title={tr(ACCENT_LABEL[a])}
                    onClick={() => void attempt(() => setSetting("accent", a))}
                    className={cx("flex h-7 w-7 items-center justify-center rounded-full text-white", settings.accent === a && "ring-2 ring-ink ring-offset-2 ring-offset-surface")}
                    style={{ background: ACCENT_SWATCH[a] }}
                  >
                    {settings.accent === a && <Check size={14} strokeWidth={3} />}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-4 border-t border-line px-3 py-3">
              <span className="text-sm text-ink-2">{tr("Language")}</span>
              <Select
                className="!w-44"
                aria-label={tr("Language")}
                value={lang}
                onChange={(e) => {
                  const next = e.target.value as Lang;
                  if (next === lang) return;
                  // The whole interface (direction, font, every label) follows the language, so the window restarts.
                  void attempt(() => setSetting("language", next)).then((ok) => {
                    if (!ok) return;
                    storeLang(next);
                    setTimeout(() => window.location.reload(), 250);
                  });
                }}
              >
                <option value="en">English</option>
                <option value="ar">العربية</option>
              </Select>
            </div>
            <div className="border-t border-line px-3 py-3">
              <Toggle k="gamification" label={tr("Levels, tokens, daily quests and rewards")} />
              <div className="mt-2">
                <Toggle k="rewardSounds" label={tr("Play a short chime when XP is earned")} />
              </div>
            </div>
          </Section>

          <Section title={tr("Week and targets")}>
            <div className="grid grid-cols-2 gap-3 px-3 py-3">
              <Field label={tr("Week starts on")} hint={tr("Weekly targets, goals and reports all follow this.")}>
                <Select value={settings.weekStart} onChange={(e) => void attempt(() => setSetting("weekStart", Number(e.target.value)))}>
                  {[1, 0, 6].map((d) => (
                    <option key={d} value={d}>{weekdayLong(d)}</option>
                  ))}
                </Select>
              </Field>
              <Num k="weeklyFocusTargetHours" label={tr("Overall weekly focus target (hours)")} min={0} max={120} hint={tr("0 turns the overall target off.")} />
            </div>
          </Section>

          <Section title={tr("Timer")}>
            <div className="grid grid-cols-2 gap-3 px-3 py-3 md:grid-cols-5">
              <Num k="focusMin" label={tr("Focus (min)")} min={1} max={240} />
              <Num k="shortBreakMin" label={tr("Short break")} min={1} max={60} />
              <Num k="longBreakMin" label={tr("Long break")} min={1} max={120} />
              <Num k="longBreakEvery" label={tr("Long break every")} min={2} max={12} />
              <Num k="deepWorkMin" label={tr("Deep work (min)")} min={15} max={480} />
            </div>
            <div className="space-y-2 border-t border-line px-3 py-3">
              <Toggle k="autoStartBreaks" label={tr("Start breaks automatically when a Pomodoro ends")} />
              <Toggle k="autoStartFocus" label={tr("Start the next focus session automatically when a break ends")} />
              <Toggle k="askSessionNotes" label={tr("Ask what I accomplished after each session")} />
            </div>
          </Section>

          <Section title={tr("Notifications and capture")}>
            <div className="space-y-3 px-3 py-3">
              <div className="flex items-center gap-3">
                <Toggle k="notifications" label={tr("Show desktop notifications for reminders and finished sessions")} />
                <Button size="sm" variant="ghost" onClick={() => void notify(tr("Tempo"), tr("This is what a reminder looks like."), true)}>{tr("Send a test")}</Button>
              </div>
              <div className="text-xs text-ink-3">{tr("Reminders are checked every 30 seconds while Tempo is running. One missed while Tempo was closed is delivered on the next start if it is less than six hours old.")}</div>
              <Field group label={tr("Global quick-capture shortcut")} hint={isTauri() ? tr("Works from any application while Tempo is running. Leave empty to disable.") : tr("Available in the desktop app. In a browser, press N inside Tempo.")}>
                <div className="flex max-w-sm gap-2">
                  <Input value={shortcut} disabled={!isTauri()} placeholder={tr("CommandOrControl+Shift+Space")} onChange={(e) => setShortcut(e.target.value)} />
                  <Button
                    disabled={!isTauri() || shortcut === settings.quickCaptureShortcut}
                    onClick={() =>
                      void attempt(async () => {
                        await registerQuickCapture(shortcut.trim(), () => openQuickAdd());
                        await setSetting("quickCaptureShortcut", shortcut.trim());
                      }).then((ok) => ok && toast(tr("Shortcut updated"), undefined, "ok"))
                    }
                  >
                    {tr("Apply")}
                  </Button>
                </div>
              </Field>
            </div>
          </Section>

          <Section title={tr("Categories")}>
            <div className="px-3 py-3">
              {categories.length === 0 && <div className="mb-2 text-sm text-ink-2">{tr("Categories group tasks, projects and tracked time into areas such as Education, Work or Health.")}</div>}
              <div className="mb-2 flex flex-wrap gap-1.5">
                {categories.map((c) => (
                  <span key={c.id} className="inline-flex h-7 items-center gap-1.5 rounded border border-line ps-2 pe-0.5 text-sm">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: c.color }} />
                    {c.name}
                    <IconButton label={tr("Delete category {0}", c.name)} className="!h-6 !w-6" onClick={() => void confirmDialog({ title: tr("Delete the category \"{0}\"?", c.name), body: tr("Items in this category are kept and become uncategorised."), confirmLabel: tr("Delete"), danger: true }).then((ok) => ok && attempt(() => deleteCategory(c.id)))}>
                      <Trash2 size={12} />
                    </IconButton>
                  </span>
                ))}
              </div>
              <form className="flex max-w-sm gap-2" onSubmit={(e) => (e.preventDefault(), void attempt(() => saveCategory(cat)).then((ok) => ok && setCat({ ...cat, name: "" })))}>
                <Input placeholder={tr("New category")} aria-label={tr("New category name")} value={cat.name} onChange={(e) => setCat({ ...cat, name: e.target.value })} />
                <Input type="color" aria-label={tr("Category color")} className="!w-12 !p-1" value={cat.color} onChange={(e) => setCat({ ...cat, color: e.target.value })} />
                <Button type="submit" disabled={!cat.name.trim()}>{tr("Add")}</Button>
              </form>
            </div>
          </Section>

          {tags.length > 0 && (
            <Section title={tr("Tags")}>
              <div className="flex flex-wrap gap-1.5 px-3 py-3">
                {tags.map((t) => (
                  <span key={t.id} className="inline-flex h-7 items-center gap-1 rounded border border-line ps-2 pe-0.5 text-sm">
                    {hash(t.name)}
                    <IconButton label={tr("Delete tag {0}", t.name)} className="!h-6 !w-6" onClick={() => void confirmDialog({ title: tr("Delete the tag \"#{0}\"?", t.name), body: tr("It is removed from every task that has it."), confirmLabel: tr("Delete"), danger: true }).then((ok) => ok && attempt(() => deleteTag(t.id)))}>
                      <Trash2 size={12} />
                    </IconButton>
                  </span>
                ))}
              </div>
            </Section>
          )}

          <Section title={tr("Your data")}>
            <div className="space-y-3 px-3 py-3">
              <div className="text-sm text-ink-2">{tr("Everything is stored locally in a SQLite database on this computer. Nothing is sent anywhere.")}</div>
              <div className="flex flex-wrap gap-2">
                <Button icon={<Download size={14} />} onClick={() => void exportJson()}>{tr("Export everything (JSON)")}</Button>
                <Button icon={<Download size={14} />} onClick={() => void exportTasksCsv()}>{tr("Tasks (CSV)")}</Button>
                <Button icon={<Download size={14} />} onClick={() => void exportTimeCsv()}>{tr("Time entries (CSV)")}</Button>
                <Button icon={<Upload size={14} />} onClick={() => void importJson()}>{tr("Restore from export…")}</Button>
              </div>
              <div className="text-xs text-ink-3">{tr("Reports can be saved as PDF from Analytics → Print / PDF.")}</div>
              {isTauri() ? <Backups /> : <div className="text-xs text-ink-3">{tr("Automatic database backups run in the desktop app. In a browser, use the JSON export.")}</div>}
            </div>
          </Section>

          <Section title={tr("Keyboard shortcuts")}>
            <div className="grid grid-cols-2 gap-x-6 px-3 py-2">
              {SHORTCUTS.map(([keys, what]) => (
                <div key={keys} className="flex items-center justify-between border-b border-line py-1.5 text-sm">
                  <span>{what}</span>
                  <kbd className="rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-xs text-ink-2">{keys}</kbd>
                </div>
              ))}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
