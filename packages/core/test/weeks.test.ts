import { describe, expect, it } from 'vitest';
import {
  addDays,
  type BusyBlock,
  blockingIntervals,
  combineWeeks,
  computeTargetBits,
  DEFAULT_RULES,
  mapWeekdayPollWeeks,
  parsePlainDate,
  WEEKDAY_REFERENCE_SUNDAY,
  wallToEpoch,
} from '../src/index.ts';

const LONDON = 'Europe/London';
const iso = (ms: number | undefined) =>
  ms === undefined ? ms : new Date(ms).toISOString().replace('.000', '');
const slot = (day: number, hour: number, minute = 0) =>
  WEEKDAY_REFERENCE_SUNDAY + day * 86_400 + hour * 3600 + minute * 60;
const at = (date: string, hour: number) =>
  wallToEpoch({ ...parsePlainDate(date), hour, minute: 0, second: 0 }, LONDON);

describe('combineWeeks', () => {
  it('requires every week to be free in "all" mode', () => {
    expect(combineWeeks(['1101', '1111', '1100'], 'all')).toBe('1100');
  });

  it('takes the majority in "most" mode, ties counting as busy', () => {
    expect(combineWeeks(['1101', '1111', '1100'], 'most')).toBe('1101');
    expect(combineWeeks(['10', '01'], 'most')).toBe('00');
  });

  it('ignores unknown weeks and keeps slots unknown in every week', () => {
    expect(combineWeeks(['?1?', '?0?', '?1?'], 'all')).toBe('?0?');
    expect(combineWeeks(['?1', '?0', '?1'], 'most')).toBe('?1');
    expect(() => combineWeeks([], 'all')).toThrow();
  });
});

describe('mapWeekdayPollWeeks', () => {
  it('places the same clock time in each real week, across a clock change', () => {
    const weeks = mapWeekdayPollWeeks([slot(1, 10)], '2026-10-07', 4, LONDON);
    expect(weeks.map((w) => iso(w[0]?.start))).toEqual([
      '2026-10-05T09:00:00Z', // BST
      '2026-10-12T09:00:00Z',
      '2026-10-19T09:00:00Z',
      '2026-10-26T10:00:00Z', // GMT
    ]);
    expect(mapWeekdayPollWeeks([slot(1, 10)], '2026-10-07', 99, LONDON)).toHaveLength(26);
    expect(mapWeekdayPollWeeks([slot(1, 10)], '2026-10-07', 0, LONDON)).toHaveLength(1);
  });
});

describe('a weekly poll checked over a 10-week term', () => {
  // Monday and Tuesday, 9:00–12:00, in 15-minute slots.
  const slots = [1, 2].flatMap((day) => Array.from({ length: 12 }, (_, i) => slot(day, 9, i * 15)));
  const weeks = mapWeekdayPollWeeks(slots, '2026-10-05', 10, LONDON);
  const blocks: BusyBlock[] = [];
  // A class on Mondays 10:00–11:00 for the first 8 weeks.
  for (let w = 0; w < 8; w++) {
    const monday = addDays('2026-10-05', 7 * w);
    blocks.push({ start: at(monday, 10), end: at(monday, 11), kind: 'busy' });
  }
  // A one-off on Tuesday of week 3, 9:00–10:00.
  blocks.push({ start: at('2026-10-20', 9), end: at('2026-10-20', 10), kind: 'busy' });
  const blocking = blockingIntervals(blocks, DEFAULT_RULES, LONDON);
  const perWeek = weeks.map((mapped) =>
    computeTargetBits({
      slots: mapped,
      blocking,
      rules: DEFAULT_RULES,
      timeZone: LONDON,
      now: Date.parse('2026-10-01T00:00:00Z'),
    }),
  );

  it('marks a time busy if it is busy in any week ("all")', () => {
    const bits = combineWeeks(perWeek, 'all');
    expect(bits.slice(0, 12)).toBe('111100001111'); // Monday: the class (8 of 10 weeks)
    expect(bits.slice(12)).toBe('000011111111'); // Tuesday: the one-off in week 3
  });

  it('only counts recurring commitments in "most" mode', () => {
    const bits = combineWeeks(perWeek, 'most');
    expect(bits.slice(0, 12)).toBe('111100001111'); // busy in 8 of 10 weeks
    expect(bits.slice(12)).toBe('111111111111'); // busy in only 1 of 10 weeks
  });
});
