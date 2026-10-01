/**
 * Runs the built extension against real When2meet polls the maintainers own.
 * Skipped unless LIVE_POLLS is set (comma-separated poll URLs):
 *
 *   LIVE_POLLS="https://www.when2meet.com/?123-abc,https://www.when2meet.com/?456-def" \
 *     npx playwright test e2e/live.spec.ts
 *
 * Each poll gets (or reuses) a participant named "calendar-sync live test". Set LIVE_WEEKS=10 to
 * check days-of-the-week polls against 10 weeks instead of one.
 */
import { type BrowserContext, test as base, chromium } from '@playwright/test';
import {
  bitsForPerson,
  blockingIntervals,
  combineWeeks,
  computeTargetBits,
  DEFAULT_RULES,
  defaultWeekStart,
  detectPollKind,
  localStamp,
  mapSlots,
  mapWeekdayPollWeeks,
  resolveUnknown,
} from '../packages/core/src/index.ts';
import { icsBusy } from '../packages/providers/src/index.ts';
import { parseEventHtml, parseEventRef } from '../packages/when2meet/src/index.ts';
import { EXTENSION_DIR, expect, makeIcs, setUp, TZ } from './fixtures.ts';

const POLLS = (process.env.LIVE_POLLS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const NAME = 'calendar-sync live test';
const WEEKS = Number(process.env.LIVE_WEEKS ?? 1);

const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture signature
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      timezoneId: TZ,
      args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(new URL(worker.url()).host);
  },
});

test.skip(POLLS.length === 0, 'Set LIVE_POLLS to run against real When2meet polls');
test.setTimeout(120_000);

async function fetchPoll(url: string) {
  const response = await fetch(url, { cache: 'no-store' });
  return parseEventHtml(await response.text(), parseEventRef(url));
}

for (const url of POLLS) {
  test(`fills ${url} and When2meet keeps it`, async ({ context, extensionId }) => {
    const poll = await fetchPoll(url);
    const kind = detectPollKind(poll.slots);
    const weekStart = defaultWeekStart(Date.now(), TZ, 'next');
    const mapped = mapSlots(
      poll.slots,
      kind === 'weekdays' ? { kind, weekStart, timeZone: TZ } : { kind },
    );
    const first = mapped.find(Boolean);
    if (!first) throw new Error('Poll has no slots');
    // Busy for the first two hours of the first day, 4 hours later for one hour, and a weekly
    // one-hour meeting at a local time (it moves with clock changes) for 15 weeks.
    const weekly = [
      'BEGIN:VEVENT',
      'UID:live-weekly@test',
      'DTSTAMP:20260101T000000Z',
      `DTSTART;TZID=${TZ}:${localStamp(first.start + 5 * 3_600_000, TZ)}`,
      `DTEND;TZID=${TZ}:${localStamp(first.start + 6 * 3_600_000, TZ)}`,
      'RRULE:FREQ=WEEKLY;COUNT=15',
      'SUMMARY:Live weekly',
      'END:VEVENT',
    ].join('\r\n');
    const ics = makeIcs([
      { start: first.start, end: first.start + 2 * 3_600_000, summary: 'Live test A' },
      {
        start: first.start + 4 * 3_600_000,
        end: first.start + 5 * 3_600_000,
        summary: 'Live test B',
      },
      // Only in week 3: counts for multi-week checks of days-of-the-week polls.
      {
        start: first.start + 14 * 86_400_000 + 3 * 3_600_000,
        end: first.start + 14 * 86_400_000 + 4 * 3_600_000,
        summary: 'Live test C (week 3)',
      },
    ]).replace('END:VCALENDAR', `${weekly}\r\nEND:VCALENDAR`);
    const blocks = icsBusy(ics, {
      range: { start: first.start - 86_400_000, end: Number.MAX_SAFE_INTEGER },
      timeZone: TZ,
    });
    const blocking = blockingIntervals(blocks, DEFAULT_RULES, TZ);
    const target = (slots: typeof mapped) =>
      computeTargetBits({ slots, blocking, rules: DEFAULT_RULES, timeZone: TZ, now: Date.now() });
    // Days-of-the-week polls checked over several weeks (LIVE_WEEKS): free only if free every week.
    const calendar =
      kind === 'weekdays' && WEEKS > 1
        ? combineWeeks(mapWeekdayPollWeeks(poll.slots, weekStart, WEEKS, TZ).map(target), 'all')
        : target(mapped);

    const page = await context.newPage();
    await setUp(page, extensionId, { name: NAME, ics });
    if (WEEKS > 1) {
      const weeksInput = page.getByLabel(/check this many weeks/);
      await weeksInput.fill(String(WEEKS));
      await weeksInput.press('Tab');
    }
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    const grid = await page.evaluate(() => ({
      slots: (window as unknown as { TimeOfSlot: number[] }).TimeOfSlot.length,
      cells: document.querySelectorAll('[id^="YouTime"]').length,
    }));
    test
      .info()
      .annotations.push({ type: 'grid', description: `${grid.cells} cells, ${grid.slots} slots` });
    console.log(`${url}: ${grid.cells} grid cells for ${grid.slots} slots`);
    await page
      .getByRole('button', { name: /Fill from my calendar|Calendar changed/ })
      .dispatchEvent('click');

    const confirm = page.getByRole('button', { name: "Yes, that's me" });
    const save = page.getByRole('button', { name: 'Save to When2meet' });
    const upToDate = page.getByText('already matches your calendar');
    // A participant left over from an earlier run already has availability, so the first fill in
    // this fresh profile defaults to "add only"; "Remove them too" makes it follow the calendar.
    const removeConflicts = page.getByRole('button', { name: 'Remove them too' });
    const settled = save.or(upToDate).or(removeConflicts);
    await expect(confirm.or(settled)).toBeVisible({ timeout: 30_000 });
    if (await confirm.isVisible()) {
      await confirm.dispatchEvent('click');
      await expect(settled).toBeVisible({ timeout: 30_000 });
    }
    if (await removeConflicts.isVisible()) {
      await removeConflicts.dispatchEvent('click');
      await expect(removeConflicts).toBeHidden({ timeout: 30_000 });
      await expect(save.or(upToDate)).toBeVisible({ timeout: 30_000 });
    }
    if (await save.isVisible()) {
      await save.dispatchEvent('click');
      await expect(page.getByText(/checked against When2meet/)).toBeVisible({ timeout: 30_000 });
    }

    const after = await fetchPoll(url);
    const person = after.people.find((p) => p.name === NAME);
    expect(person).toBeDefined();
    const server = bitsForPerson(after.availableAt, person?.id ?? 0);
    // Unknown slots (none for future polls) keep whatever the server had.
    expect(server).toBe(resolveUnknown(calendar, server));
  });
}
