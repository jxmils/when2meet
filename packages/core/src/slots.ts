import type { EpochMs, Interval, UnixSec } from './types.ts';
import {
  addDays,
  dayOfWeek,
  localDate,
  parsePlainDate,
  possibleInstants,
  type WallTime,
  wallToEpoch,
} from './tz.ts';

/**
 * "Days of the week" polls store clock times in a fixed reference week that starts on
 * Sunday 1978-11-12 00:00 UTC. Weekday `d` (0 = Sunday) at `s` seconds into the day is stored
 * as `WEEKDAY_REFERENCE_SUNDAY + d * 86400 + s`.
 */
export const WEEKDAY_REFERENCE_SUNDAY: UnixSec = 279_676_800;
export const DAY_SEC = 86_400;
export const WEEK_SEC = 7 * DAY_SEC;
export const DEFAULT_SLOT_SEC = 900;

/** `dates`: specific calendar dates (real instants). `weekdays`: generic days of the week. */
export type PollKind = 'dates' | 'weekdays';

/** Slot length: the smallest positive gap between slot starts (normally 900 s). */
export function slotLengthSec(slots: readonly UnixSec[]): number {
  const sorted = [...new Set(slots)].sort((a, b) => a - b);
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < sorted.length; i++) {
    const gap = (sorted[i] as number) - (sorted[i - 1] as number);
    if (gap > 0 && gap < best) best = gap;
  }
  return Number.isFinite(best) ? best : DEFAULT_SLOT_SEC;
}

export function detectPollKind(slots: readonly UnixSec[]): PollKind {
  if (slots.length === 0) return 'dates';
  const end = WEEKDAY_REFERENCE_SUNDAY + WEEK_SEC;
  return slots.every((ts) => ts >= WEEKDAY_REFERENCE_SUNDAY && ts < end) ? 'weekdays' : 'dates';
}

/** Day of week (0 = Sunday) and clock time of a weekday-poll slot. */
export function weekdaySlotParts(ts: UnixSec): { day: number; secondOfDay: number } {
  const offset = ts - WEEKDAY_REFERENCE_SUNDAY;
  const day = Math.floor(offset / DAY_SEC);
  return { day, secondOfDay: offset - day * DAY_SEC };
}

/** The Sunday on or before `date`. */
export function sundayOf(date: string): string {
  return addDays(date, -dayOfWeek(date));
}

/** Sunday of the current (`this`) or following (`next`) week, as seen in `timeZone`. */
export function defaultWeekStart(
  now: EpochMs,
  timeZone: string,
  which: 'this' | 'next' = 'next',
): string {
  const thisSunday = sundayOf(localDate(now, timeZone));
  return which === 'this' ? thisSunday : addDays(thisSunday, 7);
}

export interface MapOptions {
  kind?: PollKind;
  slotSec?: number;
  /** Weekday polls only: any date in the real week to use (normalised to its Sunday). */
  weekStart?: string;
  /** Weekday polls only: timezone the clock times are read in. */
  timeZone?: string;
}

/**
 * Maps every slot to the real time range it stands for. Specific-date slots are already
 * instants. Weekday slots are placed in the chosen week and timezone; a slot whose start falls
 * in a skipped hour maps to null, and one inside a repeated hour covers both occurrences.
 */
export function mapSlots(slots: readonly UnixSec[], options: MapOptions = {}): (Interval | null)[] {
  const kind = options.kind ?? detectPollKind(slots);
  const slotSec = options.slotSec ?? slotLengthSec(slots);
  if (kind === 'dates') {
    return slots.map((ts) => ({ start: ts * 1000, end: (ts + slotSec) * 1000 }));
  }
  const { weekStart, timeZone } = options;
  if (!weekStart || !timeZone) {
    throw new Error('weekStart and timeZone are required to map a days-of-the-week poll');
  }
  const sunday = sundayOf(weekStart);
  return slots.map((ts) => {
    const { day, secondOfDay } = weekdaySlotParts(ts);
    const start = possibleInstants(wallAt(sunday, day, secondOfDay), timeZone)[0];
    if (start === undefined) return null;
    const end = wallToEpoch(wallAt(sunday, day, secondOfDay + slotSec), timeZone, 'later');
    return end > start ? { start, end } : null;
  });
}

function wallAt(sunday: string, day: number, secondOfDay: number): WallTime {
  const extraDays = Math.floor(secondOfDay / DAY_SEC);
  const sec = secondOfDay - extraDays * DAY_SEC;
  return {
    ...parsePlainDate(addDays(sunday, day + extraDays)),
    hour: Math.floor(sec / 3600),
    minute: Math.floor((sec % 3600) / 60),
    second: sec % 60,
  };
}
