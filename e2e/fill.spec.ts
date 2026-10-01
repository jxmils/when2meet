import { mapSlots } from '../packages/core/src/index.ts';
import {
  addDays,
  expect,
  type IcsEventSpec,
  localDateOf,
  makeIcs,
  pollUrl,
  SEED_POLLS,
  setUp,
  TZ,
  test,
} from './fixtures.ts';

const { dates, weekdays } = SEED_POLLS;

/** Busy Monday 9:00–12:00 and all of Tuesday, on the seeded specific-dates poll. */
function datesCalendar(slots: number[]): { ics: string; expected: string } {
  const monday = slots[0] as number; // Monday 09:00 in New York
  const busy: IcsEventSpec[] = [
    { start: monday * 1000, end: (monday + 3 * 3600) * 1000, summary: 'Lab' },
    { start: 0, end: 0, allDayDate: addDays(localDateOf(monday), 1), summary: 'Conference' },
  ];
  const tuesday = addDays(localDateOf(monday), 1);
  const expected = slots
    .map((ts) => {
      if (localDateOf(ts) === tuesday) return '0';
      return ts >= monday && ts < monday + 3 * 3600 ? '0' : '1';
    })
    .join('');
  return { ics: makeIcs(busy), expected };
}

test('fills a specific-dates poll from an .ics file, verified against the server', async ({
  context,
  extensionId,
  mock,
}) => {
  const slots = mock.polls.get(dates.id)?.slots ?? [];
  const { ics, expected } = datesCalendar(slots);
  const page = await context.newPage();
  await setUp(page, extensionId, { name: 'Jordan Lee', ics });

  await page.goto(pollUrl(dates));
  await page.getByRole('button', { name: 'Fill from my calendar' }).click();
  await expect(page.getByText('now available')).toBeVisible();
  await expect(page.locator('[data-w2msync]').first()).toBeAttached();
  await page.getByRole('button', { name: 'Save to When2meet' }).click();
  await expect(page.getByText(/Saved \d+ changes — checked against When2meet\./)).toBeVisible();

  const person = mock.personByName(dates.id, 'Jordan Lee');
  expect(person).toBeDefined();
  expect(mock.bitsFor(dates.id, person?.id ?? 0)).toBe(expected);
  const saves = mock.log.filter((l) => l.path === '/SaveTimes.php');
  expect(saves.length).toBeLessThanOrEqual(2);
  await expect(page.locator('[data-w2msync]')).toHaveCount(0);
});

test('falls back to the grid when direct saves are not kept', async ({
  context,
  extensionId,
  mock,
}) => {
  const slots = mock.polls.get(dates.id)?.slots ?? [];
  const { ics, expected } = datesCalendar(slots);
  const page = await context.newPage();
  await setUp(page, extensionId, { name: 'Jordan Lee', ics });
  mock.configure({ dropNextSaves: 2 });

  await page.goto(pollUrl(dates));
  await page.getByRole('button', { name: 'Fill from my calendar' }).click();
  await page.getByRole('button', { name: 'Save to When2meet' }).click();
  await expect(page.getByText(/\(using the grid\)/)).toBeVisible();
  const person = mock.personByName(dates.id, 'Jordan Lee');
  expect(mock.bitsFor(dates.id, person?.id ?? 0)).toBe(expected);
});

test('works when When2meet applies the slot list instead of the full string', async ({
  context,
  extensionId,
  mock,
}) => {
  const slots = mock.polls.get(dates.id)?.slots ?? [];
  const { ics, expected } = datesCalendar(slots);
  mock.configure({ saveSemantics: 'slots' });
  const page = await context.newPage();
  await setUp(page, extensionId, { name: 'Jordan Lee', ics });

  await page.goto(pollUrl(dates));
  await page.getByRole('button', { name: 'Fill from my calendar' }).click();
  await page.getByRole('button', { name: 'Save to When2meet' }).click();
  await expect(page.getByText(/checked against When2meet/)).toBeVisible();
  const person = mock.personByName(dates.id, 'Jordan Lee');
  expect(mock.bitsFor(dates.id, person?.id ?? 0)).toBe(expected);
});

test('fills a days-of-the-week poll using next week', async ({ context, extensionId, mock }) => {
  const poll = mock.polls.get(weekdays.id);
  const slots = poll?.slots ?? [];
  // Next week's Wednesday, 10:00–13:00 New York time, is busy.
  const page = await context.newPage();
  const firstDates = mock.polls.get(dates.id)?.slots[0] as number; // Monday 09:00 next week
  const wednesday = addDays(localDateOf(firstDates), 2);
  const mapped = mapSlots(slots, { weekStart: addDays(localDateOf(firstDates), -1), timeZone: TZ });
  const busyStart =
    mapped.find((m, i) => m && localDateOf(m.start / 1000) === wednesday && i >= 0)?.start ?? 0;
  const ics = makeIcs([{ start: busyStart, end: busyStart + 3 * 3_600_000 }]);
  await setUp(page, extensionId, { name: 'Jordan Lee', ics });

  await page.goto(pollUrl(weekdays));
  await page.getByRole('button', { name: 'Fill from my calendar' }).click();
  await expect(page.getByText(/Using your week of/)).toBeVisible();
  await page.getByRole('button', { name: 'Save to When2meet' }).click();
  await expect(page.getByText(/checked against When2meet/)).toBeVisible();

  const expected = mapped
    .map((m) => (m && m.start >= busyStart && m.start < busyStart + 3 * 3_600_000 ? '0' : '1'))
    .join('');
  const person = mock.personByName(weekdays.id, 'Jordan Lee');
  expect(mock.bitsFor(weekdays.id, person?.id ?? 0)).toBe(expected);
});

test('asks before signing in as someone already on the poll', async ({
  context,
  extensionId,
  mock,
}) => {
  const slots = mock.polls.get(dates.id)?.slots ?? [];
  const page = await context.newPage();
  await setUp(page, extensionId, { name: 'Riley', ics: datesCalendar(slots).ics });

  await page.goto(pollUrl(dates));
  await page.getByRole('button', { name: 'Fill from my calendar' }).click();
  await expect(page.getByText(/Someone named/)).toBeVisible();
  await page.getByRole('button', { name: 'Use another name' }).click();
  expect(mock.log.filter((l) => l.path === '/ProcessLogin.php')).toHaveLength(0);
});

test('on a later visit, applies calendar changes but keeps manual edits; undo restores', async ({
  context,
  extensionId,
  mock,
}) => {
  const slots = mock.polls.get(dates.id)?.slots ?? [];
  const { ics, expected } = datesCalendar(slots);
  const page = await context.newPage();
  await setUp(page, extensionId, { name: 'Jordan Lee', ics });
  await page.goto(pollUrl(dates));
  await page.getByRole('button', { name: 'Fill from my calendar' }).click();
  await page.getByRole('button', { name: 'Save to When2meet' }).click();
  await expect(page.getByText(/checked against When2meet/)).toBeVisible();
  const personId = mock.personByName(dates.id, 'Jordan Lee')?.id ?? 0;

  // A manual edit elsewhere: mark the (busy) first Monday slot as available.
  const poll = mock.polls.get(dates.id);
  poll?.availability.get(personId)?.add(slots[0] as number);
  // The calendar changes: Wednesday 09:00–10:00 becomes busy too.
  const wednesdayStart = slots[64] as number;
  const changed = makeIcs([
    { start: (slots[0] as number) * 1000, end: ((slots[0] as number) + 3 * 3600) * 1000 },
    { start: 0, end: 0, allDayDate: addDays(localDateOf(slots[0] as number), 1) },
    { start: wednesdayStart * 1000, end: (wednesdayStart + 3600) * 1000 },
  ]);
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.getByRole('button', { name: 'Remove' }).click();
  await page.getByText('Import an .ics file').click();
  await page.getByLabel('Calendar file').setInputFiles({
    name: 'calendar.ics',
    mimeType: 'text/calendar',
    buffer: Buffer.from(changed),
  });
  await expect(page.getByText('calendar.ics imported.')).toBeVisible();

  await page.goto(pollUrl(dates));
  await page.getByRole('button', { name: 'Fill from my calendar' }).click();
  await expect(page.getByText(/Your manual edits are kept/)).toBeVisible();
  await expect(page.locator('.stat.remove strong')).toHaveText('−4');
  await page.getByRole('button', { name: 'Save to When2meet' }).click();
  await expect(page.getByText(/checked against When2meet/)).toBeVisible();

  const after = mock.bitsFor(dates.id, personId);
  expect(after[0]).toBe('1'); // manual edit kept
  expect(after.slice(64, 68)).toBe('0000'); // new busy hour applied
  expect(after.slice(1)).toBe(`${expected.slice(1, 64)}0000${expected.slice(68)}`);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Restored your previous availability.')).toBeVisible();
  expect(mock.bitsFor(dates.id, personId)).toBe(`1${expected.slice(1)}`);
});
