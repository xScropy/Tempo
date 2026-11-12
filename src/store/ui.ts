import { create } from "zustand";
import { todayStr, type DateStr } from "@/domain/dates";
import type { TaskInput } from "@/domain/types";

export const PAGES = ["dashboard", "inbox", "tasks", "projects", "calendar", "focus", "habits", "goals", "analytics", "journal", "friends", "settings"] as const;
export type Page = (typeof PAGES)[number];

export interface ConfirmRequest {
  title: string;
  body?: string;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

interface UiState {
  page: Page;
  /** id segment of the route, e.g. the open project */
  routeId: string | null;
  /** task shown in the context panel */
  taskId: string | null;
  quickAdd: { defaults: Partial<TaskInput> } | null;
  search: boolean;
  confirm: ConfirmRequest | null;
  focusMode: boolean;
  mini: boolean;
  projectDialog: { parentId: string | null } | null;
  /** current local date; refreshed by the app loop so views roll over at midnight */
  today: DateStr;
}

function parseHash(): { page: Page; routeId: string | null } {
  const [, page, id] = window.location.hash.split("/");
  return { page: (PAGES as readonly string[]).includes(page ?? "") ? (page as Page) : "dashboard", routeId: id ? decodeURIComponent(id) : null };
}

export const useUi = create<UiState>(() => ({
  ...(typeof window === "undefined" ? { page: "dashboard" as Page, routeId: null } : parseHash()),
  taskId: null,
  quickAdd: null,
  search: false,
  confirm: null,
  focusMode: false,
  mini: false,
  projectDialog: null,
  today: todayStr(),
}));

if (typeof window !== "undefined") {
  window.addEventListener("hashchange", () => useUi.setState(parseHash()));
}

export function navigate(page: Page, routeId?: string | null) {
  window.location.hash = `/${page}${routeId ? `/${encodeURIComponent(routeId)}` : ""}`;
}
export const openTask = (taskId: string | null) => useUi.setState({ taskId });
export const openQuickAdd = (defaults: Partial<TaskInput> = {}) => useUi.setState({ quickAdd: { defaults } });
export const openSearch = () => useUi.setState({ search: true });

export function confirmDialog(req: Omit<ConfirmRequest, "resolve">): Promise<boolean> {
  return new Promise((resolve) => useUi.setState({ confirm: { ...req, resolve } }));
}
