import { tr } from "@/i18n";
import { isTauri } from "@/db/driver";
import { toast } from "./notify";

/** Saves text to a file: native save dialog in the desktop app, download in a browser. */
export async function saveFile(name: string, content: string, mime: string): Promise<boolean> {
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    const ext = name.split(".").pop() ?? "txt";
    const path = await save({ defaultPath: name, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (!path) return false;
    await writeTextFile(path, content);
    toast(tr("Saved"), path, "ok");
    return true;
  }
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

/** Lets the user pick a text file and returns its contents (null if cancelled). */
export async function pickTextFile(ext: string): Promise<string | null> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    const path = await open({ multiple: false, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    return typeof path === "string" ? readTextFile(path) : null;
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = `.${ext}`;
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      void f.text().then(resolve);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export interface BackupInfo {
  name: string;
  size: number;
  modified_ms: number;
}

const invoke = async <T,>(cmd: string, args?: Record<string, unknown>): Promise<T> => (await import("@tauri-apps/api/core")).invoke<T>(cmd, args);

export const backups = {
  create: (label: "auto" | "manual", keep: number) => invoke<BackupInfo>("backup_create", { label, keep }),
  list: () => invoke<BackupInfo[]>("backup_list"),
  restore: (name: string) => invoke<void>("backup_restore", { name }),
  location: () => invoke<string>("db_location"),
};

/** Shrinks the window to an always-on-top mini timer, or restores it (desktop app only). */
export async function setMiniWindow(on: boolean): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow, LogicalSize } = await import("@tauri-apps/api/window");
  const w = getCurrentWindow();
  await w.setAlwaysOnTop(on);
  await w.setSize(on ? new LogicalSize(320, 180) : new LogicalSize(1280, 820));
}

let registered: string | null = null;
/** Registers the system-wide quick-capture shortcut (desktop app only). */
export async function registerQuickCapture(shortcut: string, onTrigger: () => void): Promise<void> {
  if (!isTauri()) return;
  const gs = await import("@tauri-apps/plugin-global-shortcut");
  if (registered) await gs.unregister(registered).catch(() => undefined);
  registered = null;
  if (!shortcut) return;
  await gs.register(shortcut, async (e) => {
    if (e.state !== "Pressed") return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const w = getCurrentWindow();
    await w.unminimize();
    await w.show();
    await w.setFocus();
    onTrigger();
  });
  registered = shortcut;
}
