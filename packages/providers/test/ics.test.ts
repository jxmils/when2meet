import { readFileSync } from 'node:fs';
import type { BusyBlock } from '@w2msync/core';
import { describe, expect, it } from 'vitest';
import { IcsParseError, icsBusy, resolveTzid } from '../src/ics.ts';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const range = (from: string, to: string) => ({ start: Date.parse(from), end: Date.parse(to) });
const iso = (ms: number) => new Date(ms).toISOString().replace('.000', '');
const describeBlock = (b: BusyBlock) =>
  b.allDay
    ? [b.kind, `${b.allDay.startDate}..${b.allDay.endDate}`]
    : [b.kind, `${iso(b.start)}..${iso(b.end)}`];

describe('icsBusy: Google-style feed', () => {
  const blocks = icsBusy(fixture('google-style.ics'), {
    range: range('2026-10-04T00:00:00Z', '2026-10-27T00:00:00Z'),
    timeZone: 'America/New_York',
  });
  const sorted = [...blocks].sort(
    (a, b) =>
      (a.allDay ? Date.parse(a.allDay.startDate) : a.start) -
      (b.allDay ? Date.parse(b.allDay.startDate) : b.start),
  );

  it('expands weekly events with EXDATE and moved occurrences, in the VTIMEZONE zone', () => {
    const standups = sorted.filter((b) => !b.allDay && b.kind === 'busy').map(describeBlock);
    expect(standups).toEqual([
      ['busy', '2026-10-05T14:00:00Z..2026-10-05T15:00:00Z'],
      ['busy', '2026-10-19T19:00:00Z..2026-10-19T20:00:00Z'],
      ['busy', '2026-10-26T14:00:00Z..2026-10-26T15:00:00Z'],
    ]);
  });

  it('keeps free, tentative and all-day events with their kinds', () => {
    expect(sorted.filter((b) => b.allDay).map(describeBlock)).toEqual([
      ['free', '2026-10-14..2026-10-15'],
      ['busy', '2026-10-15..2026-10-17'],
    ]);
    expect(sorted.filter((b) => !b.allDay && b.kind !== 'busy').map(describeBlock)).toEqual([
      ['free', '2026-10-13T18:00:00Z..2026-10-13T19:00:00Z'],
      ['tentative', '2026-10-21T13:00:00Z..2026-10-21T13:30:00Z'],
    ]);
  });

  it('drops cancelled events and invitations the owner declined', () => {
    const times = blocks.filter((b) => !b.allDay).map((b) => iso(b.start));
    expect(times).not.toContain('2026-10-13T20:00:00Z');
    expect(times).not.toContain('2026-10-14T14:00:00Z');
  });
});

describe('icsBusy: Outlook busy-only feed', () => {
  it('reads Windows-named VTIMEZONEs and Outlook busy statuses', () => {
    const blocks = icsBusy(fixture('outlook-busy.ics'), {
      range: range('2026-10-12T00:00:00Z', '2026-10-19T00:00:00Z'),
      timeZone: 'UTC',
    });
    expect(blocks.map(describeBlock)).toEqual([
      ['busy', '2026-10-13T16:00:00Z..2026-10-13T17:00:00Z'],
      ['tentative', '2026-10-13T20:00:00Z..2026-10-13T20:30:00Z'],
      ['oof', '2026-10-16..2026-10-17'],
    ]);
  });
});

describe('icsBusy: zones without VTIMEZONE', () => {
  const blocks = icsBusy(fixture('zones.ics'), {
    range: range('2026-10-13T00:00:00Z', '2026-10-14T00:00:00Z'),
    timeZone: 'America/Chicago',
  });

  it('resolves IANA and Windows TZIDs, floating times and missing end times', () => {
    const timed = blocks
      .filter((b) => !b.allDay)
      .sort((a, b) => a.start - b.start || a.end - b.end)
      .map(describeBlock);
    expect(timed).toEqual([
      ['busy', '2026-10-13T07:00:00Z..2026-10-13T07:15:00Z'], // daily, UTC
      ['busy', '2026-10-13T07:00:00Z..2026-10-13T07:30:00Z'], // W. Europe Standard Time → Berlin
      ['busy', '2026-10-13T08:00:00Z..2026-10-13T09:00:00Z'], // Europe/London without VTIMEZONE
      ['busy', '2026-10-13T14:00:00Z..2026-10-13T14:45:00Z'], // floating → America/Chicago
    ]);
    expect(blocks.filter((b) => b.allDay).map(describeBlock)).toEqual([
      ['free', '2026-10-13..2026-10-14'],
    ]);
  });

  const isDaily = (b: BusyBlock) => !b.allDay && b.end - b.start === 15 * 60_000;

  it('expands long-running daily events only within the range', () => {
    expect(blocks.filter(isDaily).map(describeBlock)).toEqual([
      ['busy', '2026-10-13T07:00:00Z..2026-10-13T07:15:00Z'],
    ]);
  });

  it('caps runaway recurrences', () => {
    const capped = icsBusy(fixture('zones.ics'), {
      range: range('2026-10-13T00:00:00Z', '2026-10-14T00:00:00Z'),
      timeZone: 'America/Chicago',
      maxOccurrences: 10,
    });
    expect(capped.filter(isDaily)).toEqual([]);
  });
});

describe('errors and helpers', () => {
  it('rejects text that is not a calendar', () => {
    expect(() =>
      icsBusy('hello', { range: range('2026-01-01', '2026-01-02'), timeZone: 'UTC' }),
    ).toThrow(IcsParseError);
  });

  it('maps TZIDs to IANA zones', () => {
    expect(resolveTzid('Europe/London')).toBe('Europe/London');
    expect(resolveTzid('Eastern Standard Time')).toBe('America/New_York');
    expect(resolveTzid('/Europe/Paris')).toBe('Europe/Paris');
    expect(resolveTzid('Nowhere Standard Time')).toBeNull();
    expect(resolveTzid(null)).toBeNull();
  });
});

describe('icsBusy: recurring events across a whole term', () => {
  const termRange = range('2026-10-01T00:00:00Z', '2026-12-31T00:00:00Z');

  it('keeps weekly classes at the same local time across the clock change (TZID without VTIMEZONE)', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//test//EN',
      'BEGIN:VEVENT',
      'UID:class@test',
      'DTSTAMP:20260901T000000Z',
      'DTSTART;TZID=Europe/London:20261005T100000',
      'DTEND;TZID=Europe/London:20261005T120000',
      'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261211T235959Z',
      'EXDATE;TZID=Europe/London:20261104T100000',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const starts = icsBusy(ics, { range: termRange, timeZone: 'UTC' }).map((b) => iso(b.start));
    expect(starts).toHaveLength(10 * 2 - 1);
    expect(starts).toContain('2026-10-21T09:00:00Z'); // Wed 10:00 BST
    expect(starts).toContain('2026-10-26T10:00:00Z'); // Mon 10:00 GMT
    expect(starts).not.toContain('2026-11-04T10:00:00Z'); // cancelled (EXDATE)
    expect(starts.at(-1)).toBe('2026-12-09T10:00:00Z');
  });

  it('follows the VTIMEZONE across the US change too', () => {
    const blocks = icsBusy(fixture('google-style.ics'), {
      range: range('2026-10-25T00:00:00Z', '2026-11-10T00:00:00Z'),
      timeZone: 'UTC',
    });
    const standups = blocks.filter((b) => !b.allDay && b.kind === 'busy').map((b) => iso(b.start));
    expect(standups).toEqual([
      '2026-10-26T14:00:00Z',
      '2026-11-02T15:00:00Z',
      '2026-11-09T15:00:00Z',
    ]);
  });
});
