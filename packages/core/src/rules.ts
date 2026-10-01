import { hashOf } from './hash.ts';
import { normalize } from './intervals.ts';
import type { BusyBlock, Interval } from './types.ts';
import { startOfLocalDay } from './tz.ts';

export type Treatment = 'busy' | 'free';

export interface WorkingHours {
  /** Days of the week to allow, 0 = Sunday. */
  days: number[];
  /** Local clock times, `HH:MM`; `end` may be `24:00`. */
  start: string;
  end: string;
}

export interface Rules {
  /** Minutes of padding added before and after every blocking event. */
  bufferBeforeMin: number;
  bufferAfterMin: number;
  /** Only mark slots available inside these hours (null = any time the poll offers). */
  workingHours: WorkingHours | null;
  /** Drop free stretches shorter than this many minutes (0 = keep all). */
  minFreeMinutes: number;
  /** How to treat events that are neither plainly busy nor free. */
  treat: {
    tentative: Treatment;
    oof: Treatment;
    workingElsewhere: Treatment;
    unknown: Treatment;
  };
  /** All-day events: follow their own free/busy flag (`auto`), or force busy/free. */
  allDay: 'auto' | Treatment;
}

export const DEFAULT_RULES: Rules = {
  bufferBeforeMin: 0,
  bufferAfterMin: 0,
  workingHours: null,
  minFreeMinutes: 0,
  treat: { tentative: 'busy', oof: 'busy', workingElsewhere: 'free', unknown: 'busy' },
  allDay: 'auto',
};

/** Whether a calendar block makes the user unavailable under `rules`. */
export function isBlocking(block: BusyBlock, rules: Rules): boolean {
  if (block.allDay && rules.allDay !== 'auto') return rules.allDay === 'busy';
  switch (block.kind) {
    case 'busy':
      return true;
    case 'free':
      return false;
    default:
      return rules.treat[block.kind] === 'busy';
  }
}

/**
 * The merged time ranges in which the user is unavailable. All-day blocks cover their local
 * dates in `timeZone`; buffers are added around timed blocks only.
 */
export function blockingIntervals(
  blocks: readonly BusyBlock[],
  rules: Rules,
  timeZone: string,
): Interval[] {
  const before = rules.bufferBeforeMin * 60_000;
  const after = rules.bufferAfterMin * 60_000;
  const out: Interval[] = [];
  for (const block of blocks) {
    if (!isBlocking(block, rules)) continue;
    if (block.allDay) {
      out.push({
        start: startOfLocalDay(block.allDay.startDate, timeZone),
        end: startOfLocalDay(block.allDay.endDate, timeZone),
      });
    } else if (block.end > block.start) {
      out.push({ start: block.start - before, end: block.end + after });
    }
  }
  return normalize(out);
}

const CLOCK_RE = /^(\d{1,2}):(\d{2})$/;

/** Minutes after midnight for an `HH:MM` clock time (`24:00` allowed). */
export function parseClock(hhmm: string): number {
  const m = CLOCK_RE.exec(hhmm.trim());
  const hours = Number(m?.[1]);
  const minutes = Number(m?.[2]);
  if (!m || hours > 24 || minutes > 59 || (hours === 24 && minutes !== 0)) {
    throw new Error(`Invalid clock time "${hhmm}", expected HH:MM`);
  }
  return hours * 60 + minutes;
}

export function rulesHash(rules: Rules): string {
  return hashOf(rules);
}
