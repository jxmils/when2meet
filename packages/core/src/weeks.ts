import { mapSlots, sundayOf } from './slots.ts';
import type { Bits, Interval, UnixSec } from './types.ts';
import { addDays } from './tz.ts';

/**
 * How a days-of-the-week poll slot is decided when several real weeks are checked:
 * `all` = free only if free in every week; `most` = free if free in more weeks than not.
 */
export type WeekMatch = 'all' | 'most';

export const MAX_WEEKS = 26;

/** Maps a days-of-the-week poll onto `weeks` consecutive real weeks starting at `weekStart`. */
export function mapWeekdayPollWeeks(
  slots: readonly UnixSec[],
  weekStart: string,
  weeks: number,
  timeZone: string,
): (Interval | null)[][] {
  const count = Math.min(MAX_WEEKS, Math.max(1, Math.floor(weeks)));
  const sunday = sundayOf(weekStart);
  return Array.from({ length: count }, (_, w) =>
    mapSlots(slots, { kind: 'weekdays', weekStart: addDays(sunday, 7 * w), timeZone }),
  );
}

/**
 * Combines one availability string per week into one for the poll. Weeks where a slot is unknown
 * (`?`, e.g. already past) don't count; a slot unknown in every week stays unknown. Ties in `most`
 * mode count as busy.
 */
export function combineWeeks(perWeek: readonly Bits[], match: WeekMatch): Bits {
  const first = perWeek[0];
  if (first === undefined) throw new Error('combineWeeks needs at least one week');
  let out = '';
  for (let i = 0; i < first.length; i++) {
    let free = 0;
    let busy = 0;
    for (const bits of perWeek) {
      const ch = bits[i];
      if (ch === '1') free++;
      else if (ch === '0') busy++;
    }
    if (free + busy === 0) out += '?';
    else if (match === 'all') out += busy === 0 ? '1' : '0';
    else out += free > busy ? '1' : '0';
  }
  return out;
}
