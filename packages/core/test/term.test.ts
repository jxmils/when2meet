import { describe, expect, it } from 'vitest';
import {
  addDays,
  type BusyBlock,
  blockingIntervals,
  computeTargetBits,
  DEFAULT_RULES,
  dayOfWeek,
  mapSlots,
  packFillRecord,
  parsePlainDate,
  planFill,
  recordFill,
  slotLengthSec,
  unpackFillRecord,
  wallToEpoch,
  zonedParts,
} from '../src/index.ts';

const LONDON = 'Europe/London';
const NEW_YORK = 'America/New_York';
const iso = (ms: number) => new Date(ms).toISOString().replace('.000', '');

/** Slots of a specific-dates poll the way When2meet builds them: local wall times per date. */
function termSlots(options: {
  start: string;
  days: number;
  weekdays: number[];
  from: number;
  to: number;
  timeZone: string;
}): number[] {
  const slots: number[] = [];
  for (let d = 0; d < options.days; d++) {
    const date = addDays(options.start, d);
    if (!options.weekdays.includes(dayOfWeek(date))) continue;
    for (let minute = options.from * 60; minute < options.to * 60; minute += 15) {
      const wall = {
        ...parsePlainDate(date),
        hour: Math.floor(minute / 60),
        minute: minute % 60,
        second: 0,
      };
      slots.push(wallToEpoch(wall, options.timeZone) / 1000);
    }
  }
  return slots;
}

/** A weekly class on the given weekdays at a local clock time, for every date in the term. */
function weeklyClass(
  start: string,
  days: number,
  weekdays: number[],
  from: number,
  to: number,
  tz: string,
) {
  const blocks: BusyBlock[] = [];
  for (let d = 0; d < days; d++) {
    const date = addDays(start, d);
    if (!weekdays.includes(dayOfWeek(date))) continue;
    const at = (hour: number) =>
      wallToEpoch({ ...parsePlainDate(date), hour, minute: 0, second: 0 }, tz);
    blocks.push({ start: at(from), end: at(to), kind: 'busy' });
  }
  return blocks;
}

// Autumn term 2026: weekdays Oct 5 – Dec 11, 9:00–17:00 London. The UK clocks go back on Oct 25,
// the US clocks on Nov 1, so the London–New York difference is 4 h for one week of the term.
const TERM = {
  start: '2026-10-05',
  days: 68,
  weekdays: [1, 2, 3, 4, 5],
  from: 9,
  to: 17,
  timeZone: LONDON,
};
const slots = termSlots(TERM);
const mapped = mapSlots(slots);
const NOW = Date.parse('2026-10-01T00:00:00Z');

describe('a 10-week term poll', () => {
  it('has the shape When2meet gives it', () => {
    expect(slots).toHaveLength(50 * 32);
    expect(slotLengthSec(slots)).toBe(900);
    expect(iso((slots[0] as number) * 1000)).toBe('2026-10-05T08:00:00Z'); // 09:00 BST
    expect(iso((slots[slots.length - 1] as number) * 1000)).toBe('2026-12-11T16:45:00Z'); // 16:45 GMT
  });

  it('blocks a weekly class at the same local time on both sides of the clock change', () => {
    const blocks = weeklyClass(TERM.start, TERM.days, [1, 3], 10, 12, LONDON);
    const bits = computeTargetBits({
      slots: mapped,
      blocking: blockingIntervals(blocks, DEFAULT_RULES, LONDON),
      rules: DEFAULT_RULES,
      timeZone: LONDON,
      now: NOW,
    });
    const bitAt = (utc: string) => bits[slots.indexOf(Date.parse(utc) / 1000)];
    expect(bitAt('2026-10-19T09:00:00Z')).toBe('0'); // Mon 10:00 BST
    expect(bitAt('2026-10-19T08:45:00Z')).toBe('1'); // Mon 09:45 BST
    expect(bitAt('2026-10-26T10:00:00Z')).toBe('0'); // Mon 10:00 GMT, after the change
    expect(bitAt('2026-10-26T09:00:00Z')).toBe('1'); // Mon 09:00 GMT
    expect(bitAt('2026-12-09T11:45:00Z')).toBe('0'); // last Wednesday, 11:45 GMT
    expect(bitAt('2026-12-09T12:00:00Z')).toBe('1'); // 12:00 GMT
    // Every week: 2 days × 8 busy slots.
    expect([...bits].filter((b) => b === '0')).toHaveLength(10 * 2 * 8);
  });

  it('applies working hours in the viewer timezone even when the offset changes mid-term', () => {
    const rules = {
      ...DEFAULT_RULES,
      workingHours: { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' },
    };
    const bits = computeTargetBits({
      slots: mapped,
      blocking: [],
      rules,
      timeZone: NEW_YORK,
      now: NOW,
    });
    const freeHoursOn = (date: string) =>
      slots
        .map((ts, i) => [ts, bits[i]] as const)
        .filter(([ts, bit]) => bit === '1' && iso(ts * 1000).startsWith(date))
        .map(([ts]) => zonedParts(ts * 1000, LONDON).hour)
        .filter((h, i, all) => all.indexOf(h) === i);
    // London 14:00–17:00 is New York 09:00–12:00 most weeks…
    expect(freeHoursOn('2026-10-19')).toEqual([14, 15, 16]);
    // …but 13:00–17:00 in the week the UK has changed and the US hasn't.
    expect(freeHoursOn('2026-10-27')).toEqual([13, 14, 15, 16]);
    expect(freeHoursOn('2026-11-03')).toEqual([14, 15, 16]);
  });

  it('plans, saves and revisits the whole term, and stores it compactly', () => {
    const blocks = weeklyClass(TERM.start, TERM.days, [2, 4], 13, 15, LONDON);
    const calendar = computeTargetBits({
      slots: mapped,
      blocking: blockingIntervals(blocks, DEFAULT_RULES, LONDON),
      rules: DEFAULT_RULES,
      timeZone: LONDON,
      now: NOW,
    });
    const server = '0'.repeat(slots.length);
    const plan = planFill({ slots, server, calendar });
    expect(plan.changes).toHaveLength(slots.length - 10 * 2 * 8);
    const record = recordFill({
      eventId: 1,
      personId: 2,
      slots,
      plan,
      calendar,
      verified: plan.target,
      previous: server,
      rulesHash: 'r',
      sourcesHash: 's',
      now: NOW,
      expiresAt: (slots[slots.length - 1] as number) * 1000,
    });
    const packed = packFillRecord(record);
    expect(unpackFillRecord(JSON.parse(JSON.stringify(packed)))).toEqual(record);
    expect(JSON.stringify(packed).length).toBeLessThan(JSON.stringify(record).length / 10);
    // One run per day.
    expect(packed.slots).toHaveLength(50);
    // Revisiting with the same calendar changes nothing.
    expect(planFill({ slots, server: plan.target, calendar, record }).changes).toEqual([]);
  });

  it('stays fast on a 15-week, every-day, 8:00–22:00 poll', () => {
    const big = termSlots({
      start: '2026-09-07',
      days: 105,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      from: 8,
      to: 22,
      timeZone: LONDON,
    });
    expect(big).toHaveLength(105 * 56);
    const blocks = weeklyClass('2026-09-07', 105, [1, 2, 3, 4, 5], 10, 11, LONDON).concat(
      weeklyClass('2026-09-07', 105, [1, 3, 5], 14, 16, LONDON),
    );
    const rules = {
      ...DEFAULT_RULES,
      bufferAfterMin: 15,
      minFreeMinutes: 30,
      workingHours: { days: [1, 2, 3, 4, 5], start: '08:30', end: '18:00' },
    };
    const started = performance.now();
    const bits = computeTargetBits({
      slots: mapSlots(big),
      blocking: blockingIntervals(blocks, rules, LONDON),
      rules,
      timeZone: LONDON,
      now: Date.parse('2026-09-01T00:00:00Z'),
    });
    const plan = planFill({ slots: big, server: '0'.repeat(big.length), calendar: bits });
    expect(performance.now() - started).toBeLessThan(1500);
    expect(plan.target).toHaveLength(big.length);
  });
});
