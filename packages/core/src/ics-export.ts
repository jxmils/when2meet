import { type CalendarEvent, localStamp, utcStamp } from './links.ts';
import type { EpochMs } from './types.ts';
import { offsetMs, zonedParts } from './tz.ts';

export interface IcsEvent extends CalendarEvent {
  uid: string;
  /** Creation time, written as DTSTAMP. */
  now: EpochMs;
  url?: string;
}

const PRODID = '-//when2meet-calendar-sync//EN';

/** A single-event iCalendar file (RFC 5545), with a VTIMEZONE when the event repeats weekly. */
export function buildIcs(event: IcsEvent): string {
  const tz = event.weeklyTimeZone;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${PRODID}`, 'CALSCALE:GREGORIAN'];
  lines.push('METHOD:PUBLISH');
  if (tz) {
    const year = zonedParts(event.start, tz).year;
    lines.push(...buildVTimezone(tz, year, year + 10));
  }
  lines.push('BEGIN:VEVENT', `UID:${event.uid}`, `DTSTAMP:${utcStamp(event.now)}`);
  if (tz) {
    lines.push(`DTSTART;TZID=${tz}:${localStamp(event.start, tz)}`);
    lines.push(`DTEND;TZID=${tz}:${localStamp(event.end, tz)}`);
    lines.push('RRULE:FREQ=WEEKLY');
  } else {
    lines.push(`DTSTART:${utcStamp(event.start)}`, `DTEND:${utcStamp(event.end)}`);
  }
  lines.push(`SUMMARY:${escapeText(event.title)}`);
  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
  if (event.url) lines.push(`URL:${event.url}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

export function escapeText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Folds a content line at 75 octets without splitting UTF-8 characters. */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74; // continuation lines start with a space
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

interface Transition {
  at: EpochMs;
  before: number;
  after: number;
}

/** Offset changes of `timeZone` between Jan 1 of `fromYear` and the end of `toYear`. */
export function zoneTransitions(timeZone: string, fromYear: number, toYear: number): Transition[] {
  const DAY = 86_400_000;
  const from = Date.UTC(fromYear, 0, 1);
  const to = Date.UTC(toYear + 1, 0, 1);
  const out: Transition[] = [];
  let previous = offsetMs(from, timeZone);
  for (let t = from + DAY; t <= to; t += DAY) {
    const current = offsetMs(t, timeZone);
    if (current === previous) continue;
    // Binary search (in whole seconds) for the first instant with the new offset.
    let lo = (t - DAY) / 1000;
    let hi = t / 1000;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (offsetMs(mid * 1000, timeZone) === previous) lo = mid;
      else hi = mid;
    }
    out.push({ at: hi * 1000, before: previous, after: current });
    previous = current;
  }
  return out;
}

/** VTIMEZONE lines with one observance per transition (explicit, no RRULEs). */
export function buildVTimezone(timeZone: string, fromYear: number, toYear: number): string[] {
  const transitions = zoneTransitions(timeZone, fromYear, toYear);
  const initial = offsetMs(Date.UTC(fromYear, 0, 1), timeZone);
  const first = transitions[0];
  const initialKind = first && first.after < first.before ? 'DAYLIGHT' : 'STANDARD';
  const lines = ['BEGIN:VTIMEZONE', `TZID:${timeZone}`];
  lines.push(
    ...observance(initialKind, `${String(fromYear).padStart(4, '0')}0101T000000`, initial, initial),
  );
  for (const t of transitions) {
    const kind = t.after > t.before ? 'DAYLIGHT' : 'STANDARD';
    lines.push(...observance(kind, utcStamp(t.at + t.before).replace('Z', ''), t.before, t.after));
  }
  lines.push('END:VTIMEZONE');
  return lines;
}

function observance(kind: string, start: string, from: number, to: number): string[] {
  return [
    `BEGIN:${kind}`,
    `DTSTART:${start}`,
    `TZOFFSETFROM:${formatOffset(from)}`,
    `TZOFFSETTO:${formatOffset(to)}`,
    `END:${kind}`,
  ];
}

/** `-0500`, `+0545`, `+124500` style UTC offsets. */
export function formatOffset(ms: number): string {
  const sign = ms < 0 ? '-' : '+';
  const total = Math.abs(Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${sign}${pad(h)}${pad(m)}${s ? pad(s) : ''}`;
}
