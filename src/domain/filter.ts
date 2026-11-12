import { addDays, type DateStr } from "./dates";
import { isOverdue } from "./projects";
import { isOpen, type Task, type TaskFilter } from "./types";

export interface FilterContext {
  today: DateStr;
  taskTags: Record<string, string[]>;
  actual: Map<string, number>;
  /** project id → ids of that project and all its subprojects */
  subtree: (projectId: string) => Set<string>;
}

export function matchesFilter(t: Task, f: TaskFilter, c: FilterContext): boolean {
  if (f.text) {
    const n = f.text.toLowerCase();
    if (!t.title.toLowerCase().includes(n) && !t.description.toLowerCase().includes(n) && !t.notes.toLowerCase().includes(n)) return false;
  }
  if (f.project_id === "none" ? t.project_id != null : f.project_id ? !t.project_id || !c.subtree(f.project_id).has(t.project_id) : false) return false;
  if (f.category_id && t.category_id !== f.category_id) return false;
  if (f.tag_id && !c.taskTags[t.id]?.includes(f.tag_id)) return false;
  if (f.priority && t.priority !== f.priority) return false;
  if (f.status === "open" ? !isOpen(t) : f.status ? t.status !== f.status : false) return false;
  if (f.recurring != null && !!t.series_id !== f.recurring) return false;
  if (f.due === "overdue" && !isOverdue(t, c.today)) return false;
  if (f.due === "today" && t.due_date !== c.today) return false;
  if (f.due === "week" && !(t.due_date && t.due_date >= c.today && t.due_date <= addDays(c.today, 7))) return false;
  if (f.due === "none" && t.due_date) return false;
  return true;
}

const cmpNullLast = <T,>(a: T | null, b: T | null, cmp: (a: T, b: T) => number) => (a == null ? (b == null ? 0 : 1) : b == null ? -1 : cmp(a, b));

export function sortTasks(tasks: Task[], sort: TaskFilter["sort"], c: Pick<FilterContext, "actual">): Task[] {
  const out = tasks.slice();
  const str = (a: string, b: string) => a.localeCompare(b);
  const num = (a: number, b: number) => a - b;
  switch (sort) {
    case "due":
      return out.sort((a, b) => cmpNullLast(a.due_date, b.due_date, str) || a.priority - b.priority);
    case "priority":
      return out.sort((a, b) => a.priority - b.priority || cmpNullLast(a.due_date, b.due_date, str));
    case "created":
      return out.sort((a, b) => b.created_at - a.created_at);
    case "estimate":
      return out.sort((a, b) => cmpNullLast(b.estimated_seconds, a.estimated_seconds, num));
    case "actual":
      return out.sort((a, b) => (c.actual.get(b.id) ?? 0) - (c.actual.get(a.id) ?? 0));
    case "title":
      return out.sort((a, b) => str(a.title, b.title));
    default:
      return out.sort((a, b) => a.sort_order - b.sort_order);
  }
}

/** Eisenhower quadrant: urgent = overdue or due within 2 days; important = Critical or High priority. */
export function quadrant(t: Task, today: DateStr): 0 | 1 | 2 | 3 {
  const urgent = !!t.due_date && t.due_date <= addDays(today, 2);
  const important = t.priority <= 2;
  return urgent && important ? 0 : important ? 1 : urgent ? 2 : 3;
}
