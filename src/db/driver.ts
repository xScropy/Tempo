import { MIGRATIONS } from "./migrations";

export type SqlValue = string | number | null;
export interface Statement {
  sql: string;
  params?: SqlValue[];
}

/** Minimal database contract. Two implementations: Tauri (rusqlite) and sql.js (browser dev/test). */
export interface Driver {
  select<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  execute(sql: string, params?: SqlValue[]): Promise<void>;
  /** Runs all statements in one transaction — all succeed or none do. */
  batch(statements: Statement[]): Promise<void>;
}

export const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function tauriDriver(): Promise<Driver> {
  const { invoke } = await import("@tauri-apps/api/core");
  return {
    select: (sql, params = []) => invoke("db_select", { sql, params }),
    execute: async (sql, params = []) => void (await invoke("db_execute", { sql, params })),
    batch: (statements) => invoke("db_batch", { statements: statements.map((s) => ({ sql: s.sql, params: s.params ?? [] })) }),
  };
}

const IDB_NAME = "tempo";
const IDB_STORE = "db";

function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(IDB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(IDB_STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(IDB_STORE, mode);
      const req = fn(tx.objectStore(IDB_STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
    };
  });
}

/**
 * sql.js driver: real SQLite compiled to WebAssembly, persisted to IndexedDB.
 * Used when Tempo runs in a plain browser (development, automated UI tests).
 */
export async function sqljsDriver(opts: { persist: boolean; wasmUrl?: string }): Promise<Driver> {
  const initSqlJs = (await import("sql.js")).default;
  const SQL = await initSqlJs(opts.wasmUrl ? { locateFile: () => opts.wasmUrl! } : undefined);
  const saved = opts.persist ? await idb<Uint8Array | undefined>("readonly", (s) => s.get("main")) : undefined;
  const db = new SQL.Database(saved);
  db.run("PRAGMA foreign_keys = ON");

  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    // sql.js resets pragmas on export, so foreign keys are re-enabled straight away.
    const bytes = db.export();
    db.run("PRAGMA foreign_keys = ON");
    void idb("readwrite", (s) => s.put(bytes, "main"));
  };
  const save = () => {
    if (!opts.persist) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 150);
  };
  if (opts.persist && typeof window !== "undefined") {
    window.addEventListener("pagehide", () => timer && flush());
  }

  const select = <T,>(sql: string, params: SqlValue[] = []): T[] => {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(params);
      const rows: T[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as T);
      return rows;
    } finally {
      stmt.free();
    }
  };
  const run = (sql: string, params: SqlValue[] = []) => {
    if (params.length) db.run(sql, params);
    else db.exec(sql);
  };

  return {
    select: async (sql, params) => select(sql, params),
    execute: async (sql, params) => {
      run(sql, params);
      save();
    },
    batch: async (statements) => {
      db.exec("BEGIN");
      try {
        for (const s of statements) run(s.sql, s.params);
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      save();
    },
  };
}

/** Applies pending migrations, each in its own transaction. Returns the versions applied. */
export async function migrate(driver: Driver): Promise<number[]> {
  await driver.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)");
  const rows = await driver.select<{ version: number }>("SELECT version FROM schema_migrations");
  const done = new Set(rows.map((r) => r.version));
  const applied: number[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.version)) continue;
    await driver.batch([
      { sql: m.sql },
      { sql: "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)", params: [m.version, m.name, Date.now()] },
    ]);
    applied.push(m.version);
  }
  return applied;
}

let current: Driver | null = null;

export async function openDatabase(): Promise<Driver> {
  if (current) return current;
  let driver: Driver;
  if (isTauri()) driver = await tauriDriver();
  else {
    const wasmUrl = (await import("sql.js/dist/sql-wasm.wasm?url")).default;
    driver = await sqljsDriver({ persist: true, wasmUrl });
  }
  await migrate(driver);
  current = driver;
  return driver;
}

export function db(): Driver {
  if (!current) throw new Error("Database is not open yet");
  return current;
}

/** Test hook: install an already-migrated driver. */
export function setDriver(d: Driver | null) {
  current = d;
}
