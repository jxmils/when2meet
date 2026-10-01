import { describe, expect, it } from 'vitest';
import {
  addDays,
  dayOfWeek,
  localDate,
  offsetMs,
  possibleInstants,
  startOfLocalDay,
  type WallTime,
  wallToEpoch,
  zonedParts,
} from '../src/tz.ts';

const H = 3_600_000;
const wall = (s: string): WallTime => {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(s);
  if (!m) throw new Error(s);
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
    second: 0,
  };
};
const iso = (ms: number | null | undefined) =>
  ms == null ? ms : new Date(ms).toISOString().replace('.000', '');

describe('offsetMs', () => {
  it.each([
    ['America/New_York', '2026-01-15T12:00:00Z', -5 * H],
    ['America/New_York', '2026-07-15T12:00:00Z', -4 * H],
    ['Europe/London', '2026-07-15T12:00:00Z', 1 * H],
    ['Asia/Kathmandu', '2026-07-15T12:00:00Z', 5.75 * H],
    ['Australia/Lord_Howe', '2026-07-15T12:00:00Z', 10.5 * H],
    ['Australia/Lord_Howe', '2026-12-15T12:00:00Z', 11 * H],
    ['Pacific/Chatham', '2026-07-15T12:00:00Z', 12.75 * H],
    ['Pacific/Chatham', '2026-12-15T12:00:00Z', 13.75 * H],
    ['UTC', '2026-07-15T12:00:00Z', 0],
  ])('%s at %s', (tz, at, expected) => {
    expect(offsetMs(Date.parse(at), tz)).toBe(expected);
  });
});

describe('possibleInstants', () => {
  it('finds exactly one instant for a normal wall time', () => {
    expect(possibleInstants(wall('2026-10-05 09:00'), 'America/New_York').map(iso)).toEqual([
      '2026-10-05T13:00:00Z',
    ]);
  });

  it('finds none inside a spring-forward gap', () => {
    expect(possibleInstants(wall('2026-03-08 02:30'), 'America/New_York')).toEqual([]);
    expect(possibleInstants(wall('2026-03-29 01:30'), 'Europe/London')).toEqual([]);
    // Lord Howe moves forward by only 30 minutes.
    expect(possibleInstants(wall('2026-10-04 02:15'), 'Australia/Lord_Howe')).toEqual([]);
    expect(possibleInstants(wall('2026-09-27 03:00'), 'Pacific/Chatham')).toEqual([]);
  });

  it('finds both occurrences of a repeated hour', () => {
    expect(possibleInstants(wall('2026-11-01 01:30'), 'America/New_York').map(iso)).toEqual([
      '2026-11-01T05:30:00Z',
      '2026-11-01T06:30:00Z',
    ]);
  });
});

describe('wallToEpoch', () => {
  it('moves skipped times forward (compatible/later) or backward (earlier)', () => {
    const w = wall('2026-03-08 02:30');
    expect(iso(wallToEpoch(w, 'America/New_York'))).toBe('2026-03-08T07:30:00Z');
    expect(iso(wallToEpoch(w, 'America/New_York', 'later'))).toBe('2026-03-08T07:30:00Z');
    expect(iso(wallToEpoch(w, 'America/New_York', 'earlier'))).toBe('2026-03-08T06:30:00Z');
    expect(wallToEpoch(w, 'America/New_York', 'reject')).toBeNull();
  });

  it('picks the requested occurrence of a repeated time', () => {
    const w = wall('2026-11-01 01:30');
    expect(iso(wallToEpoch(w, 'America/New_York'))).toBe('2026-11-01T05:30:00Z');
    expect(iso(wallToEpoch(w, 'America/New_York', 'later'))).toBe('2026-11-01T06:30:00Z');
    expect(wallToEpoch(w, 'America/New_York', 'reject')).toBeNull();
  });

  it('round-trips through zonedParts', () => {
    const at = Date.parse('2026-12-15T23:59:00Z');
    for (const tz of ['Asia/Kathmandu', 'Pacific/Chatham', 'America/Los_Angeles']) {
      expect(wallToEpoch(zonedParts(at, tz), tz)).toBe(at);
    }
  });
});

describe('plain dates', () => {
  it('adds days across months and years', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('knows the day of the week', () => {
    expect(dayOfWeek('2026-10-04')).toBe(0);
    expect(dayOfWeek('2026-10-01')).toBe(4);
  });

  it('gives the local date and the start of a local day', () => {
    expect(localDate(Date.parse('2026-10-02T02:00:00Z'), 'America/New_York')).toBe('2026-10-01');
    expect(iso(startOfLocalDay('2026-10-05', 'America/New_York'))).toBe('2026-10-05T04:00:00Z');
    expect(iso(startOfLocalDay('2026-10-05', 'Asia/Kathmandu'))).toBe('2026-10-04T18:15:00Z');
  });
});
