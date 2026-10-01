import { addDays, defaultWeekStart } from '@w2msync/core';
import { makeDatesPoll, makeWeekdayPoll, type SyntheticPoll } from '@w2msync/when2meet/testing';

export const SEED_POLLS = {
  dates: { id: 1_000_001, code: 'DATES' },
  weekdays: { id: 1_000_002, code: 'WEEKS' },
  term: { id: 1_000_003, code: 'TERMS' },
} as const;

/**
 * Three polls, each with two other participants:
 * - specific dates: Monday–Wednesday of next week, 9:00–17:00 New York time;
 * - days of the week: Monday–Friday, 10:00–16:00;
 * - a 10-week term: weekdays from next Monday, 9:00–17:00 London time (all dates in one grid).
 */
export function seedPolls(now = Date.now()): SyntheticPoll[] {
  const monday = addDays(defaultWeekStart(now, 'America/New_York'), 1);
  const dates = makeDatesPoll({
    ...SEED_POLLS.dates,
    name: 'Project kickoff',
    startDate: monday,
    days: 3,
    from: '09:00',
    to: '17:00',
    timeZone: 'America/New_York',
  });
  const weekdays = makeWeekdayPoll({
    ...SEED_POLLS.weekdays,
    name: 'Weekly reading group',
    days: [1, 2, 3, 4, 5],
    from: '10:00',
    to: '16:00',
  });
  const term = makeDatesPoll({
    ...SEED_POLLS.term,
    name: 'Autumn term reading group',
    startDate: monday,
    days: 9 * 7 + 5,
    daysOfWeek: [1, 2, 3, 4, 5],
    from: '09:00',
    to: '17:00',
    timeZone: 'Europe/London',
  });
  for (const poll of [dates, weekdays, term]) {
    poll.people.push({ id: 501, name: 'Riley' }, { id: 502, name: 'Sam "the organiser" Ito' });
    poll.availability.set(501, new Set(poll.slots.filter((_, i) => i % 3 !== 0)));
    poll.availability.set(502, new Set(poll.slots.filter((_, i) => i % 2 === 0)));
  }
  return [dates, weekdays, term];
}
