import { bitsForPerson } from '@w2msync/core';
import { parseEventHtml } from '@w2msync/when2meet';
import { describe, expect, it } from 'vitest';
import { createMockWhen2meet } from '../src/mock.ts';
import { SEED_POLLS, seedPolls } from '../src/seed.ts';

const ORIGIN = 'https://www.when2meet.com';
const { id, code } = SEED_POLLS.dates;
const form = (fields: Record<string, string | number | boolean>) =>
  new URLSearchParams(Object.entries(fields).map(([k, v]) => [k, String(v)])).toString();

function setup(config = {}) {
  const mock = createMockWhen2meet(seedPolls(Date.parse('2026-10-01T12:00:00Z')), config);
  const login = async (name: string, password = '') =>
    (
      await mock.handle({
        method: 'POST',
        url: `${ORIGIN}/ProcessLogin.php`,
        body: form({ id, name, password }),
      })
    ).body;
  const save = (
    person: number,
    slots: number[],
    availability: string,
    toAvailable: boolean,
    password = '',
  ) =>
    mock.handle({
      method: 'POST',
      url: `${ORIGIN}/SaveTimes.php`,
      body: form({
        person,
        event: id,
        slots: slots.join(','),
        availability,
        password,
        ChangeToAvailable: toAvailable,
      }),
    });
  const page = async () =>
    parseEventHtml((await mock.handle({ method: 'GET', url: `${ORIGIN}/?${id}-${code}` })).body);
  return { mock, login, save, page };
}

describe('mock When2meet', () => {
  it('serves the seeded polls', async () => {
    const { page } = setup();
    const poll = await page();
    expect(poll.slots).toHaveLength(96);
    expect(poll.people.map((p) => p.name)).toEqual(['Riley', 'Sam "the organiser" Ito']);
  });

  it('signs people in, creating them on first use and checking passwords', async () => {
    const { login, page } = setup();
    const first = await login('Jordan', 'secret');
    expect(Number(first)).toBeGreaterThan(0);
    expect(await login('Jordan', 'secret')).toBe(first);
    expect(await login('Jordan', 'nope')).toBe('Wrong password.');
    expect((await page()).people.map((p) => p.name)).toContain('Jordan');
  });

  it('saves using the full availability string by default', async () => {
    const { login, save, page } = setup();
    const person = Number(await login('Jordan'));
    const bits = `11${'0'.repeat(94)}`;
    await save(person, [1], bits, true);
    expect(bitsForPerson((await page()).availableAt, person)).toBe(bits);
  });

  it('can honour the slot list instead', async () => {
    const { mock, login, save, page } = setup({ saveSemantics: 'slots' });
    const person = Number(await login('Jordan'));
    const slots = mock.polls.get(id)?.slots ?? [];
    await save(person, [slots[5] as number], 'ignored', true);
    expect(bitsForPerson((await page()).availableAt, person).indexOf('1')).toBe(5);
  });

  it('can drop or fail saves', async () => {
    const { mock, login, save } = setup({ dropNextSaves: 1, failNextSaves: 0 });
    const person = Number(await login('Jordan'));
    const bits = `1${'0'.repeat(95)}`;
    expect((await save(person, [1], bits, true)).status).toBe(200);
    expect(mock.bitsFor(id, person)).toBe('0'.repeat(96));
    mock.configure({ failNextSaves: 1 });
    expect((await save(person, [1], bits, true)).status).toBe(500);
    await save(person, [1], bits, true);
    expect(mock.bitsFor(id, person)).toBe(bits);
  });
});
