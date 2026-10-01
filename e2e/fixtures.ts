import path from 'node:path';
import { type BrowserContext, test as base, chromium, type Page } from '@playwright/test';
import { addDays, formatPlainDate, zonedParts } from '../packages/core/src/index.ts';
import {
  createMockWhen2meet,
  type MockWhen2meet,
  SEED_POLLS,
  seedPolls,
} from '../tools/mock-when2meet/src/index.ts';

export const EXTENSION_DIR = path.resolve(
  import.meta.dirname,
  '../apps/extension/.output/chrome-mv3',
);
export const TZ = 'America/New_York';
export { SEED_POLLS };

interface Fixtures {
  mock: MockWhen2meet;
  context: BrowserContext;
  extensionId: string;
}

/** Chromium with the built extension; every when2meet.com request is answered by the mock. */
export const test = base.extend<Fixtures>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture signature
  mock: async ({}, use) => {
    await use(createMockWhen2meet(seedPolls()));
  },
  context: async ({ mock }, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      timezoneId: TZ,
      args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`],
    });
    await context.route(/^https:\/\/(www\.)?when2meet\.com\//, async (route) => {
      const request = route.request();
      const response = await mock.handle({
        method: request.method(),
        url: request.url(),
        body: request.postData() ?? '',
      });
      await route.fulfill({
        status: response.status,
        headers: response.headers,
        body: response.body,
      });
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(new URL(worker.url()).host);
  },
});

export const expect = test.expect;

/** Options page: set the name and timezone, then import an .ics file. */
export async function setUp(
  page: Page,
  extensionId: string,
  options: { name: string; ics: string },
) {
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  const name = page.getByLabel('Name', { exact: true });
  await name.fill(options.name);
  await name.press('Tab');
  const timezone = page.getByLabel('Timezone');
  await timezone.fill(TZ);
  await timezone.press('Tab');
  await page.getByText('Import an .ics file').click();
  await page.getByLabel('Calendar file').setInputFiles({
    name: 'calendar.ics',
    mimeType: 'text/calendar',
    buffer: Buffer.from(options.ics),
  });
  await expect(page.getByText('calendar.ics imported.')).toBeVisible();
}

export function pollUrl(poll: { id: number; code: string }): string {
  return `https://www.when2meet.com/?${poll.id}-${poll.code}`;
}

/** Local date (in TZ) of a Unix-seconds instant. */
export function localDateOf(unixSec: number): string {
  return formatPlainDate(zonedParts(unixSec * 1000, TZ));
}

export { addDays };

const stamp = (ms: number) =>
  new Date(ms)
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[-:]/g, '');

export interface IcsEventSpec {
  start: number;
  end: number;
  allDayDate?: string;
  summary?: string;
}

/** A small calendar file with timed (UTC) and all-day busy events. */
export function makeIcs(events: IcsEventSpec[]): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//w2msync e2e//EN'];
  events.forEach((e, i) => {
    lines.push('BEGIN:VEVENT', `UID:e2e-${i}@test`, 'DTSTAMP:20260101T000000Z');
    if (e.allDayDate) {
      const d = e.allDayDate.replace(/-/g, '');
      const next = addDays(e.allDayDate, 1).replace(/-/g, '');
      lines.push(`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${next}`, 'TRANSP:OPAQUE');
    } else {
      lines.push(`DTSTART:${stamp(e.start)}`, `DTEND:${stamp(e.end)}`);
    }
    lines.push(`SUMMARY:${e.summary ?? 'Busy'}`, 'END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}
