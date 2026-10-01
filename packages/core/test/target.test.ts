import { describe, expect, it } from 'vitest';
import { blockingIntervals, DEFAULT_RULES, parseClock, type Rules } from '../src/rules.ts';
import { mapSlots } from '../src/slots.ts';
import { computeTargetBits } from '../src/target.ts';
import type { BusyBlock } from '../src/types.ts';

const TZ = 'America/New_York';
const at = (s: string) => Date.parse(s);
// Monday 2026-10-05, 09:00–10:00 New York time, in 15-minute slots.
const start = at('2026-10-05T13:00:00Z') / 1000;
const slots = mapSlots([start, start + 900, start + 1800, start + 2700]);
const before = at('2026-10-01T00:00:00Z');

function bits(blocks: BusyBlock[], rules: Partial<Rules> = {}, now = before) {
  const r = { ...DEFAULT_RULES, ...rules };
  return computeTargetBits({
    slots,
    blocking: blockingIntervals(blocks, r, TZ),
    rules: r,
    timeZone: TZ,
    now,
  });
}
const block = (from: string, to: string, kind: BusyBlock['kind'] = 'busy'): BusyBlock => ({
  start: at(from),
  end: at(to),
  kind,
});

describe('computeTargetBits', () => {
  it('marks slots free only when nothing overlaps them', () => {
    expect(bits([])).toBe('1111');
    expect(bits([block('2026-10-05T13:15:00Z', '2026-10-05T13:45:00Z')])).toBe('1001');
    // Touching a slot boundary is not an overlap.
    expect(bits([block('2026-10-05T12:00:00Z', '2026-10-05T13:00:00Z')])).toBe('1111');
    // A one-minute meeting still blocks the whole slot.
    expect(bits([block('2026-10-05T13:20:00Z', '2026-10-05T13:21:00Z')])).toBe('1011');
  });

  it('applies buffers around events', () => {
    const meeting = block('2026-10-05T13:15:00Z', '2026-10-05T13:45:00Z');
    expect(bits([meeting], { bufferAfterMin: 15 })).toBe('1000');
    expect(bits([meeting], { bufferBeforeMin: 1 })).toBe('0001');
  });

  it('treats tentative, out-of-office and working-elsewhere events per the rules', () => {
    const t = block('2026-10-05T13:00:00Z', '2026-10-05T13:15:00Z', 'tentative');
    expect(bits([t])).toBe('0111');
    expect(bits([t], { treat: { ...DEFAULT_RULES.treat, tentative: 'free' } })).toBe('1111');
    expect(bits([block('2026-10-05T13:00:00Z', '2026-10-05T14:00:00Z', 'oof')])).toBe('0000');
    expect(bits([block('2026-10-05T13:00:00Z', '2026-10-05T14:00:00Z', 'workingElsewhere')])).toBe(
      '1111',
    );
    expect(bits([block('2026-10-05T13:00:00Z', '2026-10-05T14:00:00Z', 'free')])).toBe('1111');
  });

  it('places all-day events on local dates', () => {
    const allDay = (kind: BusyBlock['kind']): BusyBlock => ({
      start: 0,
      end: 0,
      kind,
      allDay: { startDate: '2026-10-05', endDate: '2026-10-06' },
    });
    expect(bits([allDay('free')])).toBe('1111');
    expect(bits([allDay('busy')])).toBe('0000');
    expect(bits([allDay('free')], { allDay: 'busy' })).toBe('0000');
    expect(bits([allDay('busy')], { allDay: 'free' })).toBe('1111');
    const nextDay: BusyBlock = {
      ...allDay('busy'),
      allDay: { startDate: '2026-10-06', endDate: '2026-10-07' },
    };
    expect(bits([nextDay])).toBe('1111');
  });

  it('limits availability to working hours in the user timezone', () => {
    const workingHours = { days: [1, 2, 3, 4, 5], start: '09:00', end: '09:30' };
    expect(bits([], { workingHours })).toBe('1100');
    expect(bits([], { workingHours: { ...workingHours, days: [2] } })).toBe('0000');
  });

  it('drops free stretches shorter than the minimum', () => {
    const meeting = block('2026-10-05T13:15:00Z', '2026-10-05T13:30:00Z');
    expect(bits([meeting], { minFreeMinutes: 30 })).toBe('0011');
    expect(bits([meeting], { minFreeMinutes: 45 })).toBe('0000');
  });

  it('leaves past and non-existent slots unknown', () => {
    expect(bits([], {}, at('2026-10-05T13:20:00Z'))).toBe('?111');
    expect(
      computeTargetBits({
        slots: [null, ...slots.slice(1)],
        blocking: [],
        rules: DEFAULT_RULES,
        timeZone: TZ,
        now: before,
      }),
    ).toBe('?111');
  });
});

describe('parseClock', () => {
  it('parses HH:MM and rejects nonsense', () => {
    expect(parseClock('09:30')).toBe(570);
    expect(parseClock('24:00')).toBe(1440);
    expect(() => parseClock('24:30')).toThrow();
    expect(() => parseClock('9am')).toThrow();
  });
});
