import {
  type BusyBlock,
  type BusyKind,
  type Interval,
  isValidTimeZone,
  wallToEpoch,
} from '@w2msync/core';
import ICAL from 'ical.js';
import { WINDOWS_TO_IANA } from './windows-zones.generated.ts';

type IcalComponent = InstanceType<typeof ICAL.Component>;
type IcalEvent = InstanceType<typeof ICAL.Event>;
type IcalTime = InstanceType<typeof ICAL.Time>;

export interface IcsOptions {
  /** Only occurrences overlapping this range are returned. */
  range: Interval;
  /** Timezone for floating times and unknown TZIDs (normally the user's). */
  timeZone: string;
  /** Addresses that identify the calendar owner, to skip invitations they declined. */
  ownerEmails?: readonly string[];
  /** Safety cap on recurrence expansion per event. */
  maxOccurrences?: number;
}

export class IcsParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IcsParseError';
  }
}

const CDO_STATUS: Record<string, BusyKind> = {
  FREE: 'free',
  TENTATIVE: 'tentative',
  BUSY: 'busy',
  OOF: 'oof',
  WORKINGELSEWHERE: 'workingElsewhere',
};

/** Maps a TZID to an IANA zone: IANA names pass through, Windows names are translated. */
export function resolveTzid(tzid: string | null | undefined): string | null {
  if (!tzid) return null;
  const cleaned = tzid.replace(/^\/+/, '').replace(/^"|"$/g, '');
  if (isValidTimeZone(cleaned)) return cleaned;
  return WINDOWS_TO_IANA[cleaned] ?? null;
}

/** Busy blocks from an iCalendar feed, with recurrences, exceptions and timezones expanded. */
export function icsBusy(text: string, options: IcsOptions): BusyBlock[] {
  let root: IcalComponent;
  try {
    root = new ICAL.Component(ICAL.parse(text));
  } catch (error) {
    throw new IcsParseError(`Not a valid calendar file: ${(error as Error).message}`);
  }
  if (root.name !== 'vcalendar') throw new IcsParseError('Not a calendar (no VCALENDAR).');

  const owners = new Set(
    [...(options.ownerEmails ?? []), String(root.getFirstPropertyValue('x-wr-calname') ?? '')]
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes('@')),
  );

  const masters: IcalComponent[] = [];
  const exceptions = new Map<string, IcalComponent[]>();
  for (const vevent of root.getAllSubcomponents('vevent')) {
    if (vevent.hasProperty('recurrence-id')) {
      const uid = String(vevent.getFirstPropertyValue('uid') ?? '');
      exceptions.set(uid, [...(exceptions.get(uid) ?? []), vevent]);
    } else {
      masters.push(vevent);
    }
  }

  const blocks: BusyBlock[] = [];
  const seenUids = new Set<string>();
  for (const master of masters) {
    const event = new ICAL.Event(master);
    seenUids.add(event.uid);
    for (const exception of exceptions.get(event.uid) ?? []) {
      event.relateException(new ICAL.Event(exception));
    }
    expandEvent(event, options, owners, blocks);
  }
  // Exceptions whose master is missing are treated as standalone events.
  for (const [uid, list] of exceptions) {
    if (seenUids.has(uid)) continue;
    for (const component of list) expandEvent(new ICAL.Event(component), options, owners, blocks);
  }
  return blocks;
}

function expandEvent(
  event: IcalEvent,
  options: IcsOptions,
  owners: Set<string>,
  out: BusyBlock[],
): void {
  const startTzid = tzidOf(event.component, 'dtstart');
  const endTzid = tzidOf(event.component, 'dtend') ?? startTzid;
  const push = (item: IcalEvent, start: IcalTime, end: IcalTime) => {
    const block = toBlock(item, start, end, options, owners, startTzid, endTzid);
    if (block && overlapsRange(block, options)) out.push(block);
  };

  if (!event.isRecurring()) {
    push(event, event.startDate, event.endDate);
    return;
  }
  const iterator = event.iterator();
  const max = options.maxOccurrences ?? 20_000;
  const rangeEnd = options.range.end;
  for (let count = 0; count < max; count++) {
    const next = iterator.next();
    if (!next) break;
    const details = event.getOccurrenceDetails(next);
    const startMs = toEpoch(details.startDate, startTzid, options.timeZone);
    if (startMs >= rangeEnd + 86_400_000) break;
    push(details.item, details.startDate, details.endDate);
  }
}

function toBlock(
  item: IcalEvent,
  start: IcalTime,
  end: IcalTime | null,
  options: IcsOptions,
  owners: Set<string>,
  startTzid: string | null,
  endTzid: string | null,
): BusyBlock | null {
  const component = item.component;
  if (declinedByOwner(component, owners)) return null;
  const allDay = start.isDate;
  const stated = kindOf(component);
  if (stated === null) return null;
  const kind = stated ?? (allDay ? 'free' : 'busy');
  if (allDay) {
    const startDate = dateString(start);
    let endDate = end?.isDate ? dateString(end) : null;
    if (!endDate || endDate <= startDate) {
      const next = start.clone();
      next.adjust(1, 0, 0, 0);
      endDate = dateString(next);
    }
    return { start: 0, end: 0, kind, allDay: { startDate, endDate }, source: 'ics' };
  }
  const startMs = toEpoch(start, startTzid, options.timeZone);
  const endMs = end ? toEpoch(end, endTzid, options.timeZone) : startMs;
  if (!(endMs > startMs)) return null;
  return { start: startMs, end: endMs, kind, source: 'ics' };
}

function kindOf(component: IcalComponent): BusyKind | null | undefined {
  const status = String(component.getFirstPropertyValue('status') ?? '').toUpperCase();
  if (status === 'CANCELLED') return null;
  const cdo = String(
    component.getFirstPropertyValue('x-microsoft-cdo-busystatus') ?? '',
  ).toUpperCase();
  if (cdo) return CDO_STATUS[cdo] ?? 'unknown';
  const transp = String(component.getFirstPropertyValue('transp') ?? '').toUpperCase();
  if (transp === 'TRANSPARENT') return 'free';
  if (status === 'TENTATIVE') return 'tentative';
  if (transp === 'OPAQUE') return 'busy';
  return undefined;
}

function declinedByOwner(component: IcalComponent, owners: Set<string>): boolean {
  if (owners.size === 0) return false;
  for (const attendee of component.getAllProperties('attendee')) {
    const address = String(attendee.getFirstValue() ?? '')
      .replace(/^mailto:/i, '')
      .toLowerCase();
    const partstat = String(attendee.getParameter('partstat') ?? '').toUpperCase();
    if (owners.has(address) && partstat === 'DECLINED') return true;
  }
  return false;
}

function tzidOf(component: IcalComponent, name: string): string | null {
  const value = component.getFirstProperty(name)?.getParameter('tzid');
  return typeof value === 'string' ? value : null;
}

/** Instant of an ical.js time; floating times and unknown TZIDs are resolved with Intl. */
export function toEpoch(time: IcalTime, tzid: string | null, fallbackZone: string): number {
  const zoneId = time.zone?.tzid;
  if (zoneId && zoneId !== 'floating') return time.toUnixTime() * 1000;
  const zone = resolveTzid(tzid) ?? fallbackZone;
  return wallToEpoch(
    {
      year: time.year,
      month: time.month,
      day: time.day,
      hour: time.hour,
      minute: time.minute,
      second: time.second,
    },
    zone,
  );
}

function dateString(time: IcalTime): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(time.year, 4)}-${pad(time.month)}-${pad(time.day)}`;
}

function overlapsRange(block: BusyBlock, options: IcsOptions): boolean {
  if (block.allDay) {
    // All-day blocks are placed later in the user's zone; keep any that could touch the range.
    const day = 86_400_000;
    const start = Date.parse(`${block.allDay.startDate}T00:00:00Z`) - day;
    const end = Date.parse(`${block.allDay.endDate}T00:00:00Z`) + day;
    return start < options.range.end && end > options.range.start;
  }
  return block.start < options.range.end && block.end > options.range.start;
}
