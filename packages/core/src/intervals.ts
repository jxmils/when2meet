import type { Interval } from './types.ts';

/** Sorts intervals and merges any that overlap or touch. Empty intervals are dropped. */
export function normalize(intervals: readonly Interval[]): Interval[] {
  const sorted = intervals
    .filter((i) => i.end > i.start)
    .map((i) => ({ start: i.start, end: i.end }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Interval[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && cur.start <= last.end) last.end = Math.max(last.end, cur.end);
    else out.push(cur);
  }
  return out;
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Whether `query` overlaps any interval of a `normalize`d list (binary search). */
export function anyOverlap(normalized: readonly Interval[], query: Interval): boolean {
  let lo = 0;
  let hi = normalized.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((normalized[mid] as Interval).end <= query.start) lo = mid + 1;
    else hi = mid;
  }
  const candidate = normalized[lo];
  return candidate !== undefined && candidate.start < query.end;
}

/** Smallest interval covering every non-null input, or null if there are none. */
export function span(intervals: readonly (Interval | null)[]): Interval | null {
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const i of intervals) {
    if (!i) continue;
    if (i.start < start) start = i.start;
    if (i.end > end) end = i.end;
  }
  return Number.isFinite(start) ? { start, end } : null;
}
