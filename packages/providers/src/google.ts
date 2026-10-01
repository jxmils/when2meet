import type { BusyBlock, Interval } from '@w2msync/core';
import { type ApiClient, fetchJson, ProviderError } from './http.ts';
import type { BusyResult, CalendarError, CalendarInfo } from './types.ts';

/** Least-privilege scopes: free/busy only, plus the calendar list when the user picks calendars. */
export const GOOGLE_SCOPES = {
  freeBusy: 'https://www.googleapis.com/auth/calendar.freebusy',
  calendarList: 'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
} as const;

const API = 'https://www.googleapis.com/calendar/v3';
/** Google rejects long free/busy ranges (`timeRangeTooLong`), so ask in chunks. */
export const GOOGLE_MAX_RANGE_MS = 60 * 86_400_000;
const MAX_CALENDARS_PER_QUERY = 50;

interface FreeBusyResponse {
  calendars?: Record<
    string,
    { busy?: { start: string; end: string }[]; errors?: { domain?: string; reason?: string }[] }
  >;
}

/** Busy times from Google Calendar's free/busy API. Every block it returns is plainly busy. */
export async function googleBusy(
  client: ApiClient,
  calendarIds: readonly string[],
  range: Interval,
): Promise<BusyResult> {
  const blocks: BusyBlock[] = [];
  const errors = new Map<string, CalendarError>();
  for (const window of chunkRange(range, GOOGLE_MAX_RANGE_MS)) {
    for (let i = 0; i < calendarIds.length; i += MAX_CALENDARS_PER_QUERY) {
      const ids = calendarIds.slice(i, i + MAX_CALENDARS_PER_QUERY);
      const response = await fetchJson<FreeBusyResponse>(client, `${API}/freeBusy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeMin: new Date(window.start).toISOString(),
          timeMax: new Date(window.end).toISOString(),
          items: ids.map((id) => ({ id })),
        }),
      });
      for (const id of ids) {
        const calendar = response.calendars?.[id];
        if (!calendar) {
          errors.set(id, { calendar: id, reason: 'missing' });
          continue;
        }
        if (calendar.errors?.length) {
          errors.set(id, { calendar: id, reason: calendar.errors[0]?.reason ?? 'unknown' });
          continue;
        }
        for (const busy of calendar.busy ?? []) {
          const start = Date.parse(busy.start);
          const end = Date.parse(busy.end);
          if (!Number.isFinite(start) || !Number.isFinite(end)) {
            throw new ProviderError('bad-response', 'Google sent an unreadable busy time.');
          }
          blocks.push({ start, end, kind: 'busy', source: `google:${id}` });
        }
      }
    }
  }
  return { blocks, errors: [...errors.values()] };
}

interface CalendarListResponse {
  items?: {
    id: string;
    summary?: string;
    summaryOverride?: string;
    primary?: boolean;
    backgroundColor?: string;
    hidden?: boolean;
  }[];
  nextPageToken?: string;
}

/** The user's calendars (needs the `calendarList` scope). */
export async function googleCalendars(client: ApiClient): Promise<CalendarInfo[]> {
  const calendars: CalendarInfo[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ minAccessRole: 'freeBusyReader', maxResults: '250' });
    if (pageToken) params.set('pageToken', pageToken);
    const page = await fetchJson<CalendarListResponse>(
      client,
      `${API}/users/me/calendarList?${params}`,
    );
    for (const item of page.items ?? []) {
      if (item.hidden) continue;
      const info: CalendarInfo = {
        id: item.id,
        name: item.summaryOverride ?? item.summary ?? item.id,
        primary: item.primary === true,
      };
      if (item.backgroundColor) info.color = item.backgroundColor;
      calendars.push(info);
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return calendars;
}

export function chunkRange(range: Interval, maxMs: number): Interval[] {
  const out: Interval[] = [];
  for (let start = range.start; start < range.end; start += maxMs) {
    out.push({ start, end: Math.min(range.end, start + maxMs) });
  }
  return out;
}
