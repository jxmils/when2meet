import {
  dayOfWeek,
  defaultWeekStart,
  formatPlainDate,
  localDate,
  mapSlots,
  zonedParts,
} from '../packages/core/src/index.ts';
import {
  addDays,
  expect,
  type IcsEventSpec,
  localDateOf,
  makeIcs,
  openMoreSettings,
  pollUrl,
  SEED_POLLS,
  setUp,
  TZ,
  test,
} from './fixtures.ts';

const { dates, weekdays } = SEED_POLLS;
const LONDON = 'Europe/London';

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
  await expect(page.getByText('Calendar removed.')).toBeVisible();
  await page.getByRole('button', { name: /Apple & others/ }).click();
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

test('fills a 10-week term poll across clock changes, viewed from another timezone', async ({
  context,
  extensionId,
  mock,
}) => {
  const term = SEED_POLLS.term;
  const slots = mock.polls.get(term.id)?.slots ?? [];
  expect(slots.length).toBe(50 * 32);
  // When2meet redraws the grid in the viewer's timezone; the rows shift with each clock change.
  mock.configure({ viewerTimeZone: TZ });
  // A class every Monday and Wednesday, 10:00–12:00 London time, all term.
  const firstMonday = localDate((slots[0] as number) * 1000, LONDON).replace(/-/g, '');
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//w2msync e2e//EN',
    'BEGIN:VEVENT',
    'UID:term-class@test',
    'DTSTAMP:20260101T000000Z',
    `DTSTART;TZID=Europe/London:${firstMonday}T100000`,
    `DTEND;TZID=Europe/London:${firstMonday}T120000`,
    'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=20',
    'SUMMARY:Seminar',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const page = await context.newPage();
  await setUp(page, extensionId, { name: 'Jordan Lee', ics, timeZone: LONDON });

  await page.goto(pollUrl(term));
  await expect(page.locator('[id^="YouTime"]')).toHaveCount(slots.length);
  await page.getByRole('button', { name: 'Fill from my calendar' }).click();
  await expect(page.getByText(/This poll covers .* · 10 weeks\./)).toBeVisible();
  await expect(page.locator('.stat.add strong')).toHaveText(`+${slots.length - 10 * 2 * 8}`);
  await page.getByRole('button', { name: 'Save to When2meet' }).click();
  await expect(page.getByText(/checked against When2meet\./)).toBeVisible();

  const expected = slots
    .map((ts) => {
      const p = zonedParts(ts * 1000, LONDON);
      const weekday = dayOfWeek(formatPlainDate(p));
      return (weekday === 1 || weekday === 3) && p.hour >= 10 && p.hour < 12 ? '0' : '1';
    })
    .join('');
  const person = mock.personByName(term.id, 'Jordan Lee');
  expect(mock.bitsFor(term.id, person?.id ?? 0)).toBe(expected);
  expect(mock.log.filter((l) => l.path === '/SaveTimes.php').length).toBeLessThanOrEqual(2);

  // The fill record is stored compactly.
  const worker = context.serviceWorkers()[0];
  const stored = await worker?.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    return Object.entries(all)
      .filter(([key]) => key.startsWith('fill:'))
      .map(([, value]) => JSON.stringify(value).length);
  });
  expect(stored).toHaveLength(1);
  expect(stored?.[0]).toBeLessThan(12_000);
});

test('offers to clear marked slots that clash with the calendar, even with nothing else to add', async ({
  context,
  extensionId,
  mock,
}) => {
  const slots = mock.polls.get(dates.id)?.slots ?? [];
  const { ics, expected } = datesCalendar(slots);
  // Jordan already marked every slot by hand.
  const poll = mock.polls.get(dates.id);
  poll?.people.push({ id: 777, name: 'Jordan Lee' });
  poll?.availability.set(777, new Set(slots));
  const busy = [...expected].filter((b) => b === '0').length;

  const page = await context.newPage();
  await setUp(page, extensionId, { name: 'Jordan Lee', ics });
  await page.goto(pollUrl(dates));
  await page.getByRole('button', { name: 'Fill from my calendar' }).click();
  await page.getByRole('button', { name: "Yes, that's me" }).click();
  await expect(
    page.getByText('Every time your calendar shows as free is already marked'),
  ).toBeVisible();
  await expect(page.getByText(`${busy} slots you already marked are busy`)).toBeVisible();
  await expect(page.locator('[data-w2msync="conflict"]')).toHaveCount(busy);
  await expect(page.getByRole('button', { name: 'Save to When2meet' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Remove them too' }).click();
  await page.getByRole('button', { name: 'Save to When2meet' }).click();
  await expect(page.getByText(/checked against When2meet/)).toBeVisible();
  expect(mock.bitsFor(dates.id, 777)).toBe(expected);
});

test('checks a days-of-the-week poll against a whole term of weeks', async ({
  context,
  extensionId,
  mock,
}) => {
  // The seeded weekly poll is Monday–Friday, 10:00–16:00: 24 slots a day, Monday first.
  const slots = mock.polls.get(weekdays.id)?.slots ?? [];
  expect(slots).toHaveLength(5 * 24);
  const firstMonday = addDays(defaultWeekStart(Date.now(), LONDON, 'next'), 1);
  const stamp = (date: string, hhmm: string) => `${date.replace(/-/g, '')}T${hhmm}00`;
  const tuesdayWeek3 = addDays(firstMonday, 15);
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//w2msync e2e//EN',
    // A class on Mondays 10:00–11:00 for 8 of the 10 weeks.
    'BEGIN:VEVENT',
    'UID:class@test',
    'DTSTAMP:20260101T000000Z',
    `DTSTART;TZID=Europe/London:${stamp(firstMonday, '1000')}`,
    `DTEND;TZID=Europe/London:${stamp(firstMonday, '1100')}`,
    'RRULE:FREQ=WEEKLY;COUNT=8',
    'END:VEVENT',
    // A one-off on the third Tuesday, 10:00–12:00.
    'BEGIN:VEVENT',
    'UID:one-off@test',
    'DTSTAMP:20260101T000000Z',
    `DTSTART;TZID=Europe/London:${stamp(tuesdayWeek3, '1000')}`,
    `DTEND;TZID=Europe/London:${stamp(tuesdayWeek3, '1200')}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const page = await context.newPage();
  await setUp(page, extensionId, { name: 'Jordan Lee', ics, timeZone: LONDON });
  const weeksInput = page.getByLabel(/check this many weeks/);
  await weeksInput.fill('10');
  await weeksInput.press('Tab');
  await expect(page.getByLabel(/Count a weekday time as free/)).toHaveValue('all');

  const busyAt = (ranges: [number, number][]) =>
    slots.map((_, i) => (ranges.some(([from, to]) => i >= from && i < to) ? '0' : '1')).join('');
  const mondayClass: [number, number] = [0, 4];
  const tuesdayOneOff: [number, number] = [24, 32];

  await page.goto(pollUrl(weekdays));
  await page.getByRole('button', { name: /Fill from my calendar|Calendar changed/ }).click();
  await expect(page.getByText(/Checking your weeks of .* \(10 weeks\)/)).toBeVisible();
  await expect(page.getByText(/free in every one of those 10 weeks/)).toBeVisible();
  await page.getByRole('button', { name: 'Save to When2meet' }).click();
  await expect(page.getByText(/checked against When2meet/)).toBeVisible();
  const personId = mock.personByName(weekdays.id, 'Jordan Lee')?.id ?? 0;
  expect(mock.bitsFor(weekdays.id, personId)).toBe(busyAt([mondayClass, tuesdayOneOff]));

  // "Most weeks" ignores the one-off but still respects the class (8 of 10 weeks).
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await openMoreSettings(page);
  await page.getByLabel(/Count a weekday time as free/).selectOption('most');
  await page.goto(pollUrl(weekdays));
  await page.getByRole('button', { name: /Fill from my calendar|Calendar changed/ }).click();
  await expect(page.getByText(/free in most of those 10 weeks/)).toBeVisible();
  await expect(page.getByText('Some changes come from your updated settings.')).toBeVisible();
  await page.getByRole('button', { name: 'Save to When2meet' }).click();
  await expect(page.getByText(/checked against When2meet/)).toBeVisible();
  expect(mock.bitsFor(weekdays.id, personId)).toBe(busyAt([mondayClass]));
});
