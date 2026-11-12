/**
 * Wire protocol shared by the app (client) and the social server.
 * JSON over WebSocket. Requests carry an `id` and get exactly one reply;
 * the server also pushes `state`, `presence` and `notify` messages.
 */
export interface Privacy {
  /** profile (bio, badges) visible to friends */
  profile: boolean;
  weekly: boolean;
  daily: boolean;
  sessions: boolean;
  streak: boolean;
  goal: boolean;
  /** whether friends see Focusing / On break (otherwise just Online) */
  activity: boolean;
  /** elapsed and remaining time of the current session */
  sessionTime: boolean;
  /** the session objective text — the only free text that can ever leave the device */
  objective: boolean;
}

/** Aggregates are shared once the user opts in; free text stays private unless switched on. */
export const DEFAULT_PRIVACY: Privacy = { profile: true, weekly: true, daily: true, sessions: true, streak: true, goal: true, activity: true, sessionTime: true, objective: false };

/** One stretch of tracked time. Carries no task, project or note — only when, and what kind. */
export interface SharedInterval {
  id: string;
  start: number;
  end: number;
  manual: boolean;
  mode: string | null;
  /** id of the focus session it belongs to, and whether that session was completed */
  session: string | null;
  completed: boolean;
}

export type PresenceStatus = "online" | "focusing" | "break" | "idle" | "offline";

export interface Presence {
  status: PresenceStatus;
  mode?: string | null;
  /** server time the current focus/break began */
  startedAt?: number;
  plannedMs?: number | null;
  /** elapsed ms at `at` (server time); viewers extrapolate while running */
  elapsedMs?: number;
  at?: number;
  objective?: string;
  lastSeen: number;
}

/** What the client reports about itself. */
export interface PresenceReport {
  status: Exclude<PresenceStatus, "offline">;
  mode?: string | null;
  plannedMs?: number | null;
  elapsedMs?: number;
  objective?: string;
}

export interface PeriodStats {
  seconds: number | null;
  sessions: number | null;
  pomodoros: number | null;
  /** seconds per local day across the period; null when daily sharing is off */
  days: number[] | null;
  productiveDays: number | null;
  targetSeconds: number | null;
}

export interface PublicProfile {
  id: string;
  username: string;
  displayName: string;
  color: string;
}

export interface FriendView extends PublicProfile {
  bio: string | null;
  statusText: string | null;
  presence: Presence;
  week: PeriodStats;
  lastWeek: PeriodStats;
  month: PeriodStats;
  streak: number | null;
  totalPomodoros: number | null;
  badges: string[];
  since: number;
}

export interface MeView extends PublicProfile {
  bio: string;
  statusText: string;
  privacy: Privacy;
  inviteCode: string;
  weeklyTargetSeconds: number | null;
  week: PeriodStats;
  lastWeek: PeriodStats;
  month: PeriodStats;
  streak: number;
  totalPomodoros: number;
  badges: string[];
  records: { bestDaySeconds: number; bestWeekSeconds: number; longestStreak: number; challengesWon: number; challengesCompleted: number };
}

export type ChallengeMetric = "focus_seconds" | "sessions" | "days";
export type Eligibility = "verified" | "tracked" | "all";

export interface ChallengeInput {
  name: string;
  description: string;
  type: "focus_hours" | "goal" | "pomodoro" | "consistency" | "custom";
  metric: ChallengeMetric;
  /** seconds, sessions or days depending on the metric; null = no target, highest wins */
  target: number | null;
  winner: "highest" | "first";
  /** for the "days" metric: focus needed for a day to count */
  minDailySeconds: number;
  /** verified = the server saw the session live; tracked = any timer session; all = manual entries too */
  eligibility: Eligibility;
  start: number;
  end: number;
  invite: string[];
}

export interface Standing {
  user: PublicProfile;
  value: number;
  /** 0–1 when the challenge has a target */
  progress: number | null;
  reachedAt: number | null;
  rank: number;
}

export interface ChallengeView extends Omit<ChallengeInput, "invite"> {
  id: string;
  creator: PublicProfile;
  joined: boolean;
  invited: boolean;
  state: "upcoming" | "active" | "finished";
  standings: Standing[];
  invitedUsers: PublicProfile[];
  events: Array<{ at: number; text: string }>;
}

export interface RoomView {
  id: string;
  name: string;
  owner: string;
  joined: boolean;
  invited: boolean;
  members: Array<PublicProfile & { presence: Presence }>;
  invitedUsers: PublicProfile[];
  timer: { kind: "focus" | "break"; startedAt: number; plannedMs: number; by: string } | null;
  completedSessions: number;
  groupFocusSeconds: number;
  reactions: Array<{ at: number; user: string; kind: string }>;
}

export interface FeedItem {
  id: string;
  user: PublicProfile;
  at: number;
  text: string;
  kind: string;
  reactions: Record<string, string[]>;
}

export const REACTIONS = ["clap", "fire", "strong", "focus"] as const;
export const REACTION_LABEL: Record<string, string> = { clap: "Good job", fire: "On fire", strong: "Keep going", focus: "Let's focus" };

export interface Snapshot {
  serverNow: number;
  me: MeView;
  friends: FriendView[];
  incoming: Array<{ id: string; from: PublicProfile; at: number }>;
  outgoing: Array<{ id: string; to: PublicProfile; at: number }>;
  blocked: PublicProfile[];
  challenges: ChallengeView[];
  rooms: RoomView[];
  feed: FeedItem[];
}

export type NotifyKind = "friend_request" | "friend_accepted" | "friend_focus_start" | "friend_focus_end" | "challenge_invite" | "challenge_event" | "challenge_done" | "room" | "cheer";

export type ServerPush =
  | { t: "state"; state: Snapshot }
  | { t: "presence"; userId: string; presence: Presence; serverNow: number }
  | { t: "notify"; kind: NotifyKind; from: string | null; title: string; body: string }
  | { t: "room_timer"; roomId: string; timer: RoomView["timer"]; serverNow: number };

export interface Reply {
  re: number;
  ok: boolean;
  data?: unknown;
  error?: string;
}

export const HEARTBEAT_MS = 15_000;
/** No heartbeat for this long = offline, even if the socket still looks open. */
export const OFFLINE_AFTER_MS = 45_000;
