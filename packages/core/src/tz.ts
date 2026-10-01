import type { EpochMs } from './types.ts';

/** A wall-clock time in some timezone. `month` is 1–12. */
export interface WallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export interface PlainDate {
  year: number;
  month: number;
  day: number;
}

/** How to resolve wall times that occur twice (fall back) or never (spring forward). */
export type Disambiguation = 'compatible' | 'earlier' | 'later' | 'reject';

const DAY_MS = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

export function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** Wall-clock fields of an instant in `timeZone` (second precision). */
export function zonedParts(ms: EpochMs, timeZone: string): WallTime {
  const out: WallTime = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const part of formatter(timeZone).formatToParts(new Date(ms))) {
    if (part.type in out) out[part.type as keyof WallTime] = Number(part.value);
  }
  // Some engines render midnight as 24:00 of the same day.
  if (out.hour === 24) out.hour = 0;
  return out;
}

function wallAsUtc(w: WallTime): number {
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
}

/** UTC offset of `timeZone` at an instant, in milliseconds (e.g. -4h for New York in summer). */
export function offsetMs(ms: EpochMs, timeZone: string): number {
  const floored = Math.floor(ms / 1000) * 1000;
  return wallAsUtc(zonedParts(floored, timeZone)) - floored;
}

/**
 * Every instant whose wall time in `timeZone` equals `w`: one normally, two during a repeated
 * hour, none during a skipped hour. Assumes at most one offset change within a day of `w`.
 */
export function possibleInstants(w: WallTime, timeZone: string): EpochMs[] {
  const naive = wallAsUtc(w);
  const offsets = new Set([offsetMs(naive - DAY_MS, timeZone), offsetMs(naive + DAY_MS, timeZone)]);
  const out: EpochMs[] = [];
  for (const offset of offsets) {
    const instant = naive - offset;
    if (offsetMs(instant, timeZone) === offset) out.push(instant);
  }
  return out.sort((a, b) => a - b);
}

/**
 * Converts a wall time to an instant. Repeated wall times resolve to the earlier occurrence
 * (`compatible`/`earlier`) or the later one (`later`). Skipped wall times move forward by the
 * length of the gap (`compatible`/`later`) or backward (`earlier`). `reject` returns null instead.
 */
export function wallToEpoch(
  w: WallTime,
  timeZone: string,
  disambiguation?: 'compatible' | 'earlier' | 'later',
): EpochMs;
export function wallToEpoch(
  w: WallTime,
  timeZone: string,
  disambiguation: 'reject',
): EpochMs | null;
export function wallToEpoch(
  w: WallTime,
  timeZone: string,
  disambiguation: Disambiguation = 'compatible',
): EpochMs | null {
  const [first, second] = possibleInstants(w, timeZone);
  if (first !== undefined) {
    if (second === undefined) return first;
    if (disambiguation === 'reject') return null;
    return disambiguation === 'later' ? second : first;
  }
  if (disambiguation === 'reject') return null;
  const naive = wallAsUtc(w);
  const offsetBefore = offsetMs(naive - DAY_MS, timeZone);
  const offsetAfter = offsetMs(naive + DAY_MS, timeZone);
  return disambiguation === 'earlier' ? naive - offsetAfter : naive - offsetBefore;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parsePlainDate(date: string): PlainDate {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Invalid date "${date}", expected YYYY-MM-DD`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function formatPlainDate(d: PlainDate): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(d.year, 4)}-${pad(d.month)}-${pad(d.day)}`;
}

export function addDays(date: string, days: number): string {
  const d = parsePlainDate(date);
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
  return formatPlainDate({
    year: t.getUTCFullYear(),
    month: t.getUTCMonth() + 1,
    day: t.getUTCDate(),
  });
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(date: string): number {
  const d = parsePlainDate(date);
  return new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
}

/** The calendar date (`YYYY-MM-DD`) of an instant in `timeZone`. */
export function localDate(ms: EpochMs, timeZone: string): string {
  return formatPlainDate(zonedParts(ms, timeZone));
}

/** First instant of a calendar date in `timeZone` (handles zones where midnight is skipped). */
export function startOfLocalDay(date: string, timeZone: string): EpochMs {
  return wallToEpoch({ ...parsePlainDate(date), hour: 0, minute: 0, second: 0 }, timeZone);
}
