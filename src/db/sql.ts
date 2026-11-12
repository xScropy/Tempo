import type { SqlValue, Statement } from "./driver";

/** Columns stored as JSON text, parsed on read and serialised on write. */
const JSON_COLUMNS: Record<string, string[]> = {
  recurrence_rules: ["weekdays", "monthdays"],
  task_series: ["tag_ids"],
  tasks: ["links"],
  habits: ["weekdays"],
  smart_views: ["filter"],
};

const toSql = (table: string, col: string, v: unknown): SqlValue => {
  if (v === undefined || v === null) return null;
  if (JSON_COLUMNS[table]?.includes(col)) return JSON.stringify(v);
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number" || typeof v === "string") return v;
  return JSON.stringify(v);
};

export function insertStmt(table: string, row: object, orIgnore = false): Statement {
  const cols = Object.keys(row);
  return {
    sql: `INSERT ${orIgnore ? "OR IGNORE " : ""}INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    params: cols.map((c) => toSql(table, c, (row as Record<string, unknown>)[c])),
  };
}

export function updateStmt(table: string, id: string, patch: object, idCol = "id"): Statement {
  const cols = Object.keys(patch);
  return {
    sql: `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE ${idCol} = ?`,
    params: [...cols.map((c) => toSql(table, c, (patch as Record<string, unknown>)[c])), id],
  };
}

export const deleteStmt = (table: string, id: string): Statement => ({ sql: `DELETE FROM ${table} WHERE id = ?`, params: [id] });

export function parseRows<T>(table: string, rows: unknown[]): T[] {
  const cols = JSON_COLUMNS[table];
  if (!cols) return rows as T[];
  return rows.map((r) => {
    const row = { ...(r as Record<string, unknown>) };
    for (const c of cols) {
      if (typeof row[c] === "string") {
        try {
          row[c] = JSON.parse(row[c] as string);
        } catch {
          row[c] = [];
        }
      }
    }
    return row as T;
  });
}

export function newId(): string {
  return crypto.randomUUID();
}
