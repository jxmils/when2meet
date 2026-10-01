/**
 * Regenerates the screenshots in docs/images (README and store listings):
 *   SCREENSHOTS=1 npx playwright test e2e/screenshots.spec.ts
 */
import path from 'node:path';
import {
  addDays,
  expect,
  localDateOf,
  makeIcs,
  pollUrl,
  SEED_POLLS,
  setUp,
  test,
} from './fixtures.ts';

test.skip(!process.env.SCREENSHOTS, 'Set SCREENSHOTS=1 to regenerate docs/images');

const OUT = path.resolve(import.meta.dirname, '../docs/images');

test('panel screenshots', async ({ context, extensionId, mock }) => {
  const slots = mock.polls.get(SEED_POLLS.dates.id)?.slots ?? [];
  const monday = slots[0] as number;
  const ics = makeIcs([
    { start: monday * 1000, end: (monday + 3 * 3600) * 1000 },
    { start: (monday + 5 * 3600) * 1000, end: (monday + 6 * 3600) * 1000 },
    { start: 0, end: 0, allDayDate: addDays(localDateOf(monday), 1) },
    { start: (slots[70] as number) * 1000, end: ((slots[70] as number) + 5400) * 1000 },
  ]);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await setUp(page, extensionId, { name: 'Jordan Lee', ics });
  await page.screenshot({ path: `${OUT}/options.png`, fullPage: true });

  await page.goto(pollUrl(SEED_POLLS.dates));
  await page.screenshot({ path: `${OUT}/pill.png` });
  await page.getByRole('button', { name: 'Fill from my calendar' }).click();
  await expect(page.getByText('now available')).toBeVisible();
  await page.screenshot({ path: `${OUT}/preview.png` });
  await page.getByRole('button', { name: 'Save to When2meet' }).click();
  await expect(page.getByText(/checked against When2meet/)).toBeVisible();
  await page.getByRole('button', { name: 'See best times' }).click();
  await page.screenshot({ path: `${OUT}/saved.png` });
});
