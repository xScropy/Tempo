import { td, tr } from "@/i18n";
import { create } from "zustand";
import { isTauri } from "@/db/driver";

export interface Toast {
  id: number;
  title: string;
  body?: string;
  tone: "info" | "error" | "ok";
}

export const useToasts = create<{ toasts: Toast[] }>(() => ({ toasts: [] }));
let seq = 0;

export function toast(title: string, body?: string, tone: Toast["tone"] = "info") {
  const id = ++seq;
  useToasts.setState((s) => ({ toasts: [...s.toasts, { id, title, body, tone }] }));
  setTimeout(() => dismissToast(id), tone === "error" ? 8000 : 4500);
}
export const dismissToast = (id: number) => useToasts.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));

/** Reports a failed action to the user instead of failing silently. */
export function reportError(e: unknown) {
  const issues = (e as { issues?: Array<{ message: string }> })?.issues;
  const msg = issues?.[0]?.message ?? (e instanceof Error ? e.message : String(e));
  toast(tr("Could not complete that"), td(msg), "error");
}

/** Wraps an async action so any failure surfaces as a toast. Returns true on success. */
export async function attempt(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (e) {
    reportError(e);
    return false;
  }
}

/** Native desktop notification (Tauri plugin, or the Web Notification API in a browser) plus an in-app toast. */
export async function notify(title: string, body: string, native = true): Promise<void> {
  toast(title, body, "info");
  if (!native) return;
  try {
    if (isTauri()) {
      const n = await import("@tauri-apps/plugin-notification");
      let ok = await n.isPermissionGranted();
      if (!ok) ok = (await n.requestPermission()) === "granted";
      if (ok) n.sendNotification({ title, body });
    } else if (typeof Notification !== "undefined") {
      if (Notification.permission === "default") await Notification.requestPermission();
      if (Notification.permission === "granted") new Notification(title, { body });
    }
  } catch {
    /* the in-app toast has already been shown */
  }
}
