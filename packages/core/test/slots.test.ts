import { describe, expect, it } from 'vitest';
import {
  defaultWeekStart,
  detectPollKind,
  mapSlots,
  slotLengthSec,
  sundayOf,
  WEEKDAY_REFERENCE_SUNDAY,
  weekdaySlotParts,
} from '../src/slots.ts';

const iso = (ms: number) => new Date(ms).toISOString().replace('.000', '');
const REF = WEEKDAY_REFERENCE_SUNDAY;
const weekdaySlot = (day: number, hh: number, mm = 0) => REF + day * 86_400 + hh * 3600 + mm * 60;

describe('slotLengthSec', () => {
  it('uses the smallest gap between slot starts', () => {
    expect(slotLengthSec([0, 900, 1800, 86_400, 87_300])).toBe(900);
    expect(slotLengthSec([1800, 0, 3600])).toBe(1800);
  });

  it('falls back to 15 minutes for a single slot', () => {
    expect(slotLengthSec([1_800_000_000])).toBe(900);
  });
});

describe('weekday polls', () => {
  it('decodes the 1978 reference week', () => {
    // From a real poll: 279795600 is labelled "Monday 09:00:00 AM".
    expect(weekdaySlotParts(279_795_600)).toEqual({ day: 1, secondOfDay: 9 * 3600 });
    expect(new Date(REF * 1000).toISOString()).toBe('1978-11-12T00:00:00.000Z');
  });

  it('detects the poll kind', () => {
    expect(detectPollKind([weekdaySlot(1, 9), weekdaySlot(5, 16, 45)])).toBe('weekdays');
    expect(detectPollKind([1_791_000_000, 1_791_000_900])).toBe('dates');
    expect(detectPollKind([])).toBe('dates');
  });

  it('maps clock times onto the chosen week and timezone', () => {
    const slots = [weekdaySlot(1, 9), weekdaySlot(1, 9, 15), weekdaySlot(5, 16, 45)];
    const mapped = mapSlots(slots, { weekStart: '2026-10-07', timeZone: 'America/New_York' });
    expect(mapped.map((m) => m && [iso(m.start), iso(m.end)])).toEqual([
      ['2026-10-05T13:00:00Z', '2026-10-05T13:15:00Z'],
      ['2026-10-05T13:15:00Z', '2026-10-05T13:30:00Z'],
      ['2026-10-09T20:45:00Z', '2026-10-09T21:00:00Z'],
    ]);
  });

  it('covers both occurrences of a repeated hour', () => {
    const [slot] = mapSlots([weekdaySlot(0, 1, 30)], {
      weekStart: '2026-11-01',
      timeZone: 'America/New_York',
      slotSec: 900,
    });
    expect(slot && [iso(slot.start), iso(slot.end)]).toEqual([
      '2026-11-01T05:30:00Z',
      '2026-11-01T06:45:00Z',
    ]);
  });

  it('drops slots that start in a skipped hour and trims ones that end in it', () => {
    const mapped = mapSlots([weekdaySlot(0, 1, 45), weekdaySlot(0, 2, 30)], {
      weekStart: '2027-03-14',
      timeZone: 'America/New_York',
      slotSec: 900,
    });
    expect(mapped[0] && [iso(mapped[0].start), iso(mapped[0].end)]).toEqual([
      '2027-03-14T06:45:00Z',
      '2027-03-14T07:00:00Z',
    ]);
    expect(mapped[1]).toBeNull();
  });

  it('handles a slot that ends at midnight', () => {
    const [slot] = mapSlots([weekdaySlot(6, 23, 45)], {
      weekStart: '2026-10-04',
      timeZone: 'UTC',
      slotSec: 900,
    });
    expect(slot && [iso(slot.start), iso(slot.end)]).toEqual([
      '2026-10-10T23:45:00Z',
      '2026-10-11T00:00:00Z',
    ]);
  });

  it('requires a week and timezone', () => {
    expect(() => mapSlots([weekdaySlot(1, 9)])).toThrow(/weekStart/);
  });
});

describe('specific-date polls', () => {
  it('maps slots to [start, start + slot length)', () => {
    const t = Date.parse('2026-10-05T13:00:00Z') / 1000;
    expect(mapSlots([t, t + 900])).toEqual([
      { start: t * 1000, end: (t + 900) * 1000 },
      { start: (t + 900) * 1000, end: (t + 1800) * 1000 },
    ]);
  });
});

describe('week selection', () => {
  it('finds this and next Sunday in the user timezone', () => {
    const now = Date.parse('2026-10-01T12:00:00Z'); // Thursday
    expect(defaultWeekStart(now, 'America/New_York', 'this')).toBe('2026-09-27');
    expect(defaultWeekStart(now, 'America/New_York')).toBe('2026-10-04');
    expect(sundayOf('2026-10-04')).toBe('2026-10-04');
  });
});
