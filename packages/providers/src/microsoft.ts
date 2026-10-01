import type { BusyBlock, BusyKind, Interval } from '@w2msync/core';
import { type ApiClient, fetchJson, ProviderError } from './http.ts';
import type { BusyResult, CalendarError, CalendarInfo } from './types.ts';

/** `Calendars.ReadBasic` excludes event bodies and attachments. */
export const MICROSOFT_SCOPES = [
  'openid',
  'profile',
  'offline_access',
  'https://graph.microsoft.com/Calendars.ReadBasic',
] as const;

const GRAPH = 'https://graph.microsoft.com/v1.0';
export const DEFAULT_CALENDAR = 'default';

interface GraphDateTime {
  dateTime: string;
  timeZone?: string;
}

interface GraphEvent {
  showAs?: string;
  isAllDay?: boolean;
  isCancelled?: boolean;
  responseStatus?: { response?: string };
  start?: GraphDateTime;
  end?: GraphDateTime;
}

interface GraphPage<T> {
  value?: T[];
  '@odata.nextLink'?: string;
}

const SHOW_AS: Record<string, BusyKind> = {
  free: 'free',
  tentative: 'tentative',
  busy: 'busy',
  oof: 'oof',
  workingelsewhere: 'workingElsewhere',
  unknown: 'unknown',
};

/** Graph returns UTC wall times without a zone suffix, sometimes with 7 fractional digits. */
export function parseGraphUtc(value: string): number {
  const trimmed = value.replace(/(\.\d{3})\d+/, '$1');
  const withZone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(trimmed) ? trimmed : `${trimmed}Z`;
  const ms = Date.parse(withZone);
  if (!Number.isFinite(ms)) throw new ProviderError('bad-response', `Unreadable time "${value}".`);
  return ms;
}

export function graphEventToBlock(event: GraphEvent, source: string): BusyBlock | null {
  if (event.isCancelled || event.responseStatus?.response === 'declined') return null;
  if (!event.start?.dateTime || !event.end?.dateTime) return null;
  const kind = SHOW_AS[(event.showAs ?? 'busy').toLowerCase()] ?? 'unknown';
  if (event.isAllDay) {
    return {
      start: 0,
      end: 0,
      kind,
      allDay: {
        startDate: event.start.dateTime.slice(0, 10),
        endDate: event.end.dateTime.slice(0, 10),
      },
      source,
    };
  }
  return {
    start: parseGraphUtc(event.start.dateTime),
    end: parseGraphUtc(event.end.dateTime),
    kind,
    source,
  };
}

/** Busy times from Microsoft Graph `calendarView` (personal and work/school accounts). */
export async function microsoftBusy(
  client: ApiClient,
  calendarIds: readonly string[],
  range: Interval,
): Promise<BusyResult> {
  const blocks: BusyBlock[] = [];
  const errors: CalendarError[] = [];
  for (const id of calendarIds) {
    const base =
      id === DEFAULT_CALENDAR
        ? `${GRAPH}/me/calendarView`
        : `${GRAPH}/me/calendars/${encodeURIComponent(id)}/calendarView`;
    const params = new URLSearchParams({
      startDateTime: new Date(range.start).toISOString(),
      endDateTime: new Date(range.end).toISOString(),
      $select: 'showAs,isAllDay,isCancelled,responseStatus,start,end',
      $top: '250',
    });
    let url: string | undefined = `${base}?${params}`;
    try {
      while (url) {
        const page: GraphPage<GraphEvent> = await fetchJson<GraphPage<GraphEvent>>(client, url, {
          headers: { Prefer: 'outlook.timezone="UTC"' },
        });
        for (const event of page.value ?? []) {
          const block = graphEventToBlock(event, `microsoft:${id}`);
          if (block) blocks.push(block);
        }
        url = page['@odata.nextLink'];
      }
    } catch (error) {
      if (!(error instanceof ProviderError) || error.code === 'auth') throw error;
      errors.push({ calendar: id, reason: error.message });
    }
  }
  return { blocks, errors };
}

interface GraphCalendar {
  id: string;
  name?: string;
  isDefaultCalendar?: boolean;
  hexColor?: string;
}

export async function microsoftCalendars(client: ApiClient): Promise<CalendarInfo[]> {
  const calendars: CalendarInfo[] = [];
  let url: string | undefined =
    `${GRAPH}/me/calendars?$select=id,name,isDefaultCalendar,hexColor&$top=100`;
  while (url) {
    const page: GraphPage<GraphCalendar> = await fetchJson<GraphPage<GraphCalendar>>(client, url);
    for (const c of page.value ?? []) {
      const info: CalendarInfo = {
        id: c.id,
        name: c.name ?? c.id,
        primary: c.isDefaultCalendar === true,
      };
      if (c.hexColor) info.color = c.hexColor;
      calendars.push(info);
    }
    url = page['@odata.nextLink'];
  }
  return calendars;
}
