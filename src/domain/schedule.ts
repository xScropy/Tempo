import { overlaps, type Interval } from "./time";

export interface Block extends Interval {
  id: string;
  title: string;
}

/** Blocks that intersect `candidate` (ignoring itself). */
export function conflictsFor(candidate: Block, others: Block[]): Block[] {
  return others.filter((o) => o.id !== candidate.id && overlaps(candidate, o));
}

/** Ids of every block that overlaps at least one other block. */
export function conflictingIds(blocks: Block[]): Set<string> {
  const sorted = blocks.slice().sort((a, b) => a.start - b.start);
  const out = new Set<string>();
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length && sorted[j]!.start < sorted[i]!.end; j++) {
      out.add(sorted[i]!.id);
      out.add(sorted[j]!.id);
    }
  }
  return out;
}

/** Assigns side-by-side columns to overlapping blocks for calendar layout. */
export function layoutColumns<T extends Block>(blocks: T[]): Array<T & { col: number; cols: number }> {
  const sorted = blocks.slice().sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Array<T & { col: number; cols: number }> = [];
  let cluster: Array<T & { col: number; cols: number }> = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    const cols = Math.max(0, ...cluster.map((c) => c.col)) + 1;
    for (const c of cluster) c.cols = cols;
    out.push(...cluster);
    cluster = [];
  };
  for (const b of sorted) {
    if (b.start >= clusterEnd && cluster.length) flush();
    const used = new Set(cluster.filter((c) => c.end > b.start).map((c) => c.col));
    let col = 0;
    while (used.has(col)) col++;
    cluster.push({ ...b, col, cols: 1 });
    clusterEnd = Math.max(clusterEnd === -Infinity ? b.end : clusterEnd, b.end);
  }
  if (cluster.length) flush();
  return out;
}
