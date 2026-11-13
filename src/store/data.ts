import { tr } from "@/i18n";
import { create } from "zustand";
import { db } from "@/db/driver";
import { parseRows } from "@/db/sql";
import type { Statement } from "@/db/driver";
import type {
  ActivityLog, CalendarEvent, Category, FocusSession, Goal, Habit, HabitEntry, JournalEntry, Milestone, Profile,
  Project, Redemption, Reward, RuleRow, SmartView, Tag, Task, TaskSeries, TimeEntry, TimeTarget,
} from "@/domain/types";

export interface WidgetConfig {
  id: string;
  visible: boolean;
  wide: boolean;
}

export const ACCENTS = ["teal", "green", "blue", "purple", "pink", "rose", "orange", "brown", "graphite"] as const;
export type Accent = (typeof ACCENTS)[number];

export interface Settings {
  theme: "system" | "light" | "dark";
  /** accent colour theme */
  accent: Accent;
  /** interface language; null = follow the system on first run */
  language: "en" | "ar" | null;
  /** 0 = Sunday … 6 = Saturday */
  weekStart: number;
  focusMin: number;
  shortBreakMin: number;
  longBreakMin: number;
  longBreakEvery: number;
  deepWorkMin: number;
  autoStartBreaks: boolean;
  autoStartFocus: boolean;
  askSessionNotes: boolean;
  /** overall weekly focus target in hours; 0 = not set */
  weeklyFocusTargetHours: number;
  notifications: boolean;
  sidebarCollapsed: boolean;
  detailWidth: number;
  dashboard: WidgetConfig[];
  quickCaptureShortcut: string;
  autoBackup: boolean;
  backupKeep: number;
  lastAutoBackup: number;
  /** levels, tokens, quests and rewards */
  gamification: boolean;
  rewardSounds: boolean;
  /** identity on the social server; the token is a secret and is never exported */
  social: { url: string; userId: string; token: string; host: boolean; port: number } | null;
  socialPrefs: {
    notify: { requests: boolean; friendActivity: boolean; challenges: boolean; rooms: boolean; cheers: boolean };
    /** friend ids whose notifications are silenced */
    muted: string[];
    /** "HH:MM"; empty = no quiet hours */
    quietFrom: string;
    quietTo: string;
    dndWhileFocusing: boolean;
    idleMinutes: number;
    /** start a local countdown when a room's shared timer starts */
    followRoomTimer: boolean;
  };
  share: { focusTime: boolean; sessions: boolean; tasksCompleted: boolean; streak: boolean; goals: boolean };
}

export const WIDGETS: Array<{ id: string; title: string }> = [
  { id: "schedule", title: tr("Today's schedule") },
  { id: "priority", title: tr("Priority tasks") },
  { id: "projects", title: tr("Active projects") },
  { id: "focus", title: tr("Focus this week") },
  { id: "targets", title: tr("Weekly targets") },
  { id: "deadlines", title: tr("Upcoming deadlines") },
  { id: "habits", title: tr("Habits today") },
  { id: "categories", title: tr("Time by category") },
  { id: "activity", title: tr("Recent activity") },
  { id: "quests", title: tr("Today's quests") },
];

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  accent: "teal",
  language: null,
  weekStart: 1,
  focusMin: 25,
  shortBreakMin: 5,
  longBreakMin: 15,
  longBreakEvery: 4,
  deepWorkMin: 90,
  autoStartBreaks: true,
  autoStartFocus: false,
  askSessionNotes: true,
  weeklyFocusTargetHours: 0,
  notifications: true,
  sidebarCollapsed: false,
  detailWidth: 420,
  dashboard: WIDGETS.map((w) => ({ id: w.id, visible: true, wide: w.id === "schedule" || w.id === "focus" })),
  quickCaptureShortcut: "CommandOrControl+Shift+Space",
  autoBackup: true,
  backupKeep: 14,
  lastAutoBackup: 0,
  gamification: true,
  rewardSounds: true,
  social: null,
  socialPrefs: { notify: { requests: true, friendActivity: true, challenges: true, rooms: true, cheers: true }, muted: [], quietFrom: "", quietTo: "", dndWhileFocusing: true, idleMinutes: 5, followRoomTimer: true },
  share: { focusTime: true, sessions: true, tasksCompleted: true, streak: true, goals: false },
};

export interface DataState {
  ready: boolean;
  settings: Settings;
  profile: Profile | null;
  categories: Category[];
  tags: Tag[];
  projects: Project[];
  milestones: Milestone[];
  rules: RuleRow[];
  series: TaskSeries[];
  /** all non-deleted tasks, subtasks included */
  tasks: Task[];
  taskTags: Record<string, string[]>;
  deps: Array<{ task_id: string; depends_on_id: string }>;
  targets: TimeTarget[];
  sessions: FocusSession[];
  entries: TimeEntry[];
  events: CalendarEvent[];
  habits: Habit[];
  habitEntries: HabitEntry[];
  goals: Goal[];
  journal: Record<string, JournalEntry>;
  logs: ActivityLog[];
  smartViews: SmartView[];
  rewards: Reward[];
  redemptions: Redemption[];
}

type Loader = () => Promise<Partial<DataState>>;
const rows = async <T,>(table: string, sql: string): Promise<T[]> => parseRows<T>(table, await db().select(sql));

const LOADERS: Record<string, Loader> = {
  settings: async () => {
    const list = await db().select<{ key: string; value: string }>("SELECT key, value FROM settings");
    const settings: Settings = { ...DEFAULT_SETTINGS };
    for (const r of list) {
      if (!(r.key in DEFAULT_SETTINGS)) continue;
      try {
        (settings as unknown as Record<string, unknown>)[r.key] = JSON.parse(r.value);
      } catch {
        /* keep default */
      }
    }
    // Dashboard config written by an older version may lack newer widgets.
    const known = new Set(settings.dashboard.map((w) => w.id));
    settings.dashboard = [
      ...settings.dashboard.filter((w) => WIDGETS.some((x) => x.id === w.id)),
      ...DEFAULT_SETTINGS.dashboard.filter((w) => !known.has(w.id)),
    ];
    settings.share = { ...DEFAULT_SETTINGS.share, ...settings.share };
    settings.socialPrefs = { ...DEFAULT_SETTINGS.socialPrefs, ...settings.socialPrefs, notify: { ...DEFAULT_SETTINGS.socialPrefs.notify, ...settings.socialPrefs?.notify } };
    return { settings };
  },
  profiles: async () => ({ profile: (await rows<Profile>("profiles", "SELECT * FROM profiles LIMIT 1"))[0] ?? null }),
  categories: async () => ({ categories: await rows("categories", "SELECT * FROM categories ORDER BY sort_order, name") }),
  tags: async () => ({ tags: await rows("tags", "SELECT * FROM tags ORDER BY name") }),
  projects: async () => ({ projects: await rows("projects", "SELECT * FROM projects ORDER BY sort_order, created_at") }),
  milestones: async () => ({ milestones: await rows("milestones", "SELECT * FROM milestones ORDER BY sort_order, created_at") }),
  recurrence_rules: async () => ({ rules: await rows("recurrence_rules", "SELECT * FROM recurrence_rules") }),
  task_series: async () => ({ series: await rows("task_series", "SELECT * FROM task_series") }),
  tasks: async () => ({ tasks: await rows("tasks", "SELECT * FROM tasks WHERE deleted_at IS NULL ORDER BY sort_order, created_at") }),
  task_tags: async () => {
    const list = await db().select<{ task_id: string; tag_id: string }>("SELECT task_id, tag_id FROM task_tags");
    const taskTags: Record<string, string[]> = {};
    for (const r of list) (taskTags[r.task_id] ??= []).push(r.tag_id);
    return { taskTags };
  },
  task_dependencies: async () => ({ deps: await db().select("SELECT task_id, depends_on_id FROM task_dependencies") }),
  time_targets: async () => ({ targets: await rows("time_targets", "SELECT * FROM time_targets ORDER BY created_at") }),
  focus_sessions: async () => ({ sessions: await rows("focus_sessions", "SELECT * FROM focus_sessions ORDER BY started_at DESC") }),
  time_entries: async () => ({ entries: await rows("time_entries", "SELECT * FROM time_entries ORDER BY started_at") }),
  calendar_events: async () => ({ events: await rows("calendar_events", "SELECT * FROM calendar_events ORDER BY start_at") }),
  habits: async () => ({ habits: await rows("habits", "SELECT * FROM habits ORDER BY sort_order, created_at") }),
  habit_entries: async () => ({ habitEntries: await rows("habit_entries", "SELECT * FROM habit_entries ORDER BY created_at") }),
  goals: async () => ({ goals: await rows("goals", "SELECT * FROM goals ORDER BY created_at") }),
  journal_entries: async () => {
    const list = await rows<JournalEntry>("journal_entries", "SELECT * FROM journal_entries");
    return { journal: Object.fromEntries(list.map((j) => [j.date, j])) };
  },
  activity_logs: async () => ({ logs: await rows("activity_logs", "SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 2000") }),
  smart_views: async () => ({ smartViews: await rows("smart_views", "SELECT * FROM smart_views ORDER BY created_at") }),
  rewards: async () => ({ rewards: await rows("rewards", "SELECT * FROM rewards ORDER BY cost, created_at") }),
  reward_redemptions: async () => ({ redemptions: await rows("reward_redemptions", "SELECT * FROM reward_redemptions ORDER BY redeemed_at DESC") }),
};

export type LoadKey = keyof typeof LOADERS;

export const useData = create<DataState>(() => ({
  ready: false,
  settings: DEFAULT_SETTINGS,
  profile: null,
  categories: [],
  tags: [],
  projects: [],
  milestones: [],
  rules: [],
  series: [],
  tasks: [],
  taskTags: {},
  deps: [],
  targets: [],
  sessions: [],
  entries: [],
  events: [],
  habits: [],
  habitEntries: [],
  goals: [],
  journal: {},
  logs: [],
  smartViews: [],
  rewards: [],
  redemptions: [],
}));

export async function reload(tables: string[] = Object.keys(LOADERS)): Promise<void> {
  const parts = await Promise.all(tables.map((t) => LOADERS[t]!()));
  useData.setState(Object.assign({}, ...parts));
}

/** Runs statements atomically, then refreshes the affected slices of state. */
export async function mutate(statements: Statement[], tables: string[]): Promise<void> {
  if (statements.length) await db().batch(statements);
  await reload(tables);
}

export const data = () => useData.getState();
