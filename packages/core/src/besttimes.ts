import { slotLengthSec } from './slots.ts';
import type { UnixSec } from './types.ts';

export interface BestWindow {
  /** First slot index of the window. */
  startIndex: number;
  /** One past the last slot index. */
  endIndex: number;
  /** Raw When2meet times (weekday polls use the 1978 reference week). */
  start: UnixSec;
  end: UnixSec;
  /** Person ids free for the whole window, in `people` order. */
  available: number[];
  missing: number[];
}

export interface BestWindowsInput {
  slots: readonly UnixSec[];
  availableAt: readonly (readonly number[])[];
  people: readonly number[];
  durationMin: number;
  slotSec?: number;
  limit?: number;
}

/**
 * The best non-overlapping meeting windows of `durationMin`, ranked by how many people are free
 * for the entire window (earlier first on ties). Windows never span a gap between slots.
 */
export function findBestWindows(input: BestWindowsInput): BestWindow[] {
  const { slots, availableAt, people, durationMin } = input;
  const slotSec = input.slotSec ?? slotLengthSec(slots);
  const limit = input.limit ?? 3;
  const span = Math.max(1, Math.ceil((durationMin * 60) / slotSec));
  const sets = availableAt.map((ids) => new Set(ids));
  const candidates: BestWindow[] = [];
  for (let i = 0; i + span <= slots.length; i++) {
    if (!isContiguous(slots, i, span, slotSec)) continue;
    let common = people.filter((id) => sets[i]?.has(id));
    for (let j = i + 1; j < i + span && common.length > 0; j++) {
      common = common.filter((id) => sets[j]?.has(id));
    }
    if (common.length === 0) continue;
    const free = new Set(common);
    candidates.push({
      startIndex: i,
      endIndex: i + span,
      start: slots[i] as UnixSec,
      end: (slots[i + span - 1] as UnixSec) + slotSec,
      available: common,
      missing: people.filter((id) => !free.has(id)),
    });
  }
  candidates.sort((a, b) => b.available.length - a.available.length || a.start - b.start);
  const chosen: BestWindow[] = [];
  for (const c of candidates) {
    if (chosen.length >= limit) break;
    if (chosen.some((w) => c.startIndex < w.endIndex && w.startIndex < c.endIndex)) continue;
    chosen.push(c);
  }
  return chosen;
}

function isContiguous(slots: readonly UnixSec[], from: number, span: number, slotSec: number) {
  for (let j = from + 1; j < from + span; j++) {
    if ((slots[j] as UnixSec) - (slots[j - 1] as UnixSec) !== slotSec) return false;
  }
  return true;
}
