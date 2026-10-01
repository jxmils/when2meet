import { addDays, type EpochMs, parsePlainDate } from '@w2msync/core';

const cache = new Map<string, Intl.DateTimeFormat>();

function fmt(timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${timeZone}|${JSON.stringify(options)}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(undefined, { timeZone, ...options });
    cache.set(key, f);
  }
  return f;
}

/** "Mon, Oct 5, 9:00 – 10:00 AM" (or "Mondays, 9:00 – 10:00 AM" when weekly). */
export function formatRange(
  start: EpochMs,
  end: EpochMs,
  timeZone: string,
  weekly = false,
): string {
  const day = weekly
    ? `${fmt(timeZone, { weekday: 'long' }).format(start)}s`
    : fmt(timeZone, { weekday: 'short', month: 'short', day: 'numeric' }).format(start);
  const time = fmt(timeZone, { hour: 'numeric', minute: '2-digit' }).formatRange(start, end);
  return `${day}, ${time}`;
}

/** "Oct 4 – 10" for the week starting on a Sunday date. */
export function formatWeek(sunday: string): string {
  const toUtc = (date: string) => {
    const d = parsePlainDate(date);
    return Date.UTC(d.year, d.month - 1, d.day, 12);
  };
  return fmt('UTC', { month: 'short', day: 'numeric' }).formatRange(
    toUtc(addDays(sunday, 1)),
    toUtc(addDays(sunday, 5)),
  );
}

/** "Oct 5 – Dec 11" for `weeks` weeks starting on a Sunday date (Monday to Friday of the last). */
export function formatWeeks(sunday: string, weeks: number): string {
  if (weeks <= 1) return formatWeek(sunday);
  const toUtc = (date: string) => {
    const d = parsePlainDate(date);
    return Date.UTC(d.year, d.month - 1, d.day, 12);
  };
  return fmt('UTC', { month: 'short', day: 'numeric' }).formatRange(
    toUtc(addDays(sunday, 1)),
    toUtc(addDays(sunday, 7 * (weeks - 1) + 5)),
  );
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Oct 5 – Dec 11 · 10 weeks" for polls spanning more than a week, otherwise null. */
export function formatCoverage(start: EpochMs, end: EpochMs, timeZone: string): string | null {
  const days = (end - start) / 86_400_000;
  if (!(days > 7)) return null;
  const dates = fmt(timeZone, { month: 'short', day: 'numeric' }).formatRange(start, end - 1);
  return `${dates} · ${Math.ceil(days / 7)} weeks`;
}
