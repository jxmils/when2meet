import type { EpochMs } from './types.ts';
import { zonedParts } from './tz.ts';

export interface CalendarEvent {
  title: string;
  start: EpochMs;
  end: EpochMs;
  description?: string;
  location?: string;
  /** Repeat weekly at the same local time in this timezone (used for weekday polls). */
  weeklyTimeZone?: string;
}

/** `20261001T140000Z` */
export function utcStamp(ms: EpochMs): string {
  return new Date(ms)
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[-:]/g, '');
}

/** `20261001T100000` (wall time in `timeZone`, no zone suffix) */
export function localStamp(ms: EpochMs, timeZone: string): string {
  const p = zonedParts(ms, timeZone);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(p.year, 4)}${pad(p.month)}${pad(p.day)}T${pad(p.hour)}${pad(p.minute)}${pad(p.second)}`;
}

function isoUtc(ms: EpochMs): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function query(params: Record<string, string | undefined>): string {
  return Object.entries(params)
    .filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

/** "Add to Google Calendar" link (opens a pre-filled event; needs no API access). */
export function googleCalendarUrl(event: CalendarEvent): string {
  const tz = event.weeklyTimeZone;
  const dates = tz
    ? `${localStamp(event.start, tz)}/${localStamp(event.end, tz)}`
    : `${utcStamp(event.start)}/${utcStamp(event.end)}`;
  return `https://calendar.google.com/calendar/render?${query({
    action: 'TEMPLATE',
    text: event.title,
    dates,
    ctz: tz,
    recur: tz ? 'RRULE:FREQ=WEEKLY' : undefined,
    details: event.description,
    location: event.location,
  })}`;
}

/**
 * "Add to Outlook" link. Work/school accounts use outlook.office.com, personal accounts
 * outlook.live.com. Outlook deeplinks can't express recurrence; use the .ics file for that.
 */
export function outlookCalendarUrl(
  event: CalendarEvent,
  account: 'work' | 'personal' = 'work',
): string {
  const host = account === 'work' ? 'outlook.office.com' : 'outlook.live.com';
  return `https://${host}/calendar/action/compose?${query({
    rru: 'addevent',
    subject: event.title,
    startdt: isoUtc(event.start),
    enddt: isoUtc(event.end),
    body: event.description,
    location: event.location,
  })}`;
}
