import { anyOverlap } from './intervals.ts';
import { parseClock, type Rules, type WorkingHours } from './rules.ts';
import type { Bits, EpochMs, Interval } from './types.ts';
import { dayOfWeek, formatPlainDate, zonedParts } from './tz.ts';

export interface TargetInput {
  /** Real time range of each slot (from `mapSlots`), null for slots that don't exist. */
  slots: readonly (Interval | null)[];
  /** Merged unavailable ranges (from `blockingIntervals`). */
  blocking: readonly Interval[];
  rules: Rules;
  /** Timezone used for working hours. */
  timeZone: string;
  now: EpochMs;
}

/**
 * Calendar-derived availability: `1` when a slot is entirely free, `0` when any blocking event
 * overlaps it or it falls outside working hours, `?` for past or non-existent slots (those are
 * left as they are on When2meet).
 */
export function computeTargetBits(input: TargetInput): Bits {
  const { slots, blocking, rules, timeZone, now } = input;
  const working = rules.workingHours ? compileWorkingHours(rules.workingHours) : null;
  const bits = slots.map((slot) => {
    if (!slot || slot.end <= now) return '?';
    if (anyOverlap(blocking, slot)) return '0';
    if (working && !working(slot, timeZone)) return '0';
    return '1';
  });
  if (rules.minFreeMinutes > 0) dropShortFreeRuns(bits, slots, rules.minFreeMinutes * 60_000);
  return bits.join('');
}

function compileWorkingHours(hours: WorkingHours): (slot: Interval, timeZone: string) => boolean {
  const startMin = parseClock(hours.start);
  const endMin = parseClock(hours.end);
  const days = new Set(hours.days);
  return (slot, timeZone) => {
    const s = zonedParts(slot.start, timeZone);
    const e = zonedParts(slot.end - 1, timeZone);
    const date = formatPlainDate(s);
    if (date !== formatPlainDate(e) || !days.has(dayOfWeek(date))) return false;
    const from = s.hour * 60 + s.minute;
    const to = e.hour * 60 + e.minute + 1;
    return from >= startMin && to <= endMin;
  };
}

/** Turns runs of back-to-back free slots shorter than `minMs` into busy slots. */
function dropShortFreeRuns(bits: string[], slots: readonly (Interval | null)[], minMs: number) {
  let runStart = -1;
  const flush = (endExclusive: number) => {
    if (runStart < 0) return;
    const first = slots[runStart] as Interval;
    const last = slots[endExclusive - 1] as Interval;
    if (last.end - first.start < minMs) bits.fill('0', runStart, endExclusive);
    runStart = -1;
  };
  for (let i = 0; i < bits.length; i++) {
    const slot = slots[i];
    if (bits[i] === '1' && slot) {
      if (runStart >= 0 && slots[i - 1]?.end !== slot.start) flush(i);
      if (runStart < 0) runStart = i;
    } else {
      flush(i);
    }
  }
  flush(bits.length);
}
