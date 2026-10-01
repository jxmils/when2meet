/**
 * Read-only contract check against live When2meet polls (GET requests only, nothing is saved).
 *
 *   CANARY_POLLS="https://www.when2meet.com/?123-abc,https://www.when2meet.com/?456-def" npm run canary
 *   npm run canary -- --update   # accept the current page script as the new baseline
 *
 * Use polls the maintainers created for this purpose (see docs/WHEN2MEET_INTERNALS.md).
 * Exits non-zero when something the extension relies on is missing or has changed.
 */
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { fnv1a, slotLengthSec } from '@w2msync/core';
import { parseEventHtml, parseEventRef } from '@w2msync/when2meet';

const EXPECTED_FILE = new URL('../expected.json', import.meta.url);
const REQUIRED = [
  'TimeOfSlot',
  'AvailableAtSlot',
  'PeopleNames',
  'PeopleIDs',
  'UserID',
  'SelectStop',
  'SelectFromHere',
  'SaveTimes.php',
  'ProcessLogin.php',
  'ChangeToAvailable',
];

interface Result {
  url: string;
  ok: boolean;
  notes: string[];
  scriptHash?: string;
}

/** The page's own script with per-poll data removed, so the hash only changes with code. */
export function scriptFingerprint(html: string): string {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(
    (m) => m[1] ?? '',
  );
  const code = scripts
    .join('\n')
    .replace(/(TimeOfSlot|AvailableAtSlot|PeopleNames|PeopleIDs)\[\d+\][^;\n]*;/g, '')
    .replace(/\/\/ ?hexAvailability[^\n]*/g, '')
    .replace(/'[^'\n]*'|"[^"\n]*"/g, '""')
    .replace(/\d+/g, '0')
    .replace(/\s+/g, ' ');
  return fnv1a(code);
}

async function check(url: string): Promise<Result> {
  const notes: string[] = [];
  const ref = parseEventRef(url, { anyHost: true });
  if (!ref) return { url, ok: false, notes: ['Not a When2meet poll URL.'] };
  const response = await fetch(url, {
    headers: {
      'user-agent': 'when2meet-calendar-sync canary (+https://github.com/jxmils/when2meet)',
    },
  });
  if (!response.ok) return { url, ok: false, notes: [`HTTP ${response.status}`] };
  const html = await response.text();
  let ok = true;
  try {
    const poll = parseEventHtml(html, ref);
    const slotSec = slotLengthSec(poll.slots);
    const people = `${poll.people.length} ${poll.people.length === 1 ? 'person' : 'people'}`;
    notes.push(
      `${poll.slots.length} slots of ${slotSec / 60} min, ${people}, ${poll.cells.length} grid cells`,
    );
    if (slotSec !== 900) notes.push(`Unexpected slot length ${slotSec}s.`);
    if (poll.cells.length < poll.slots.length * 0.9) {
      ok = false;
      notes.push('Most personal-grid cells (YouTime…) are missing.');
    }
  } catch (error) {
    ok = false;
    notes.push(`Parsing failed: ${(error as Error).message}`);
  }
  const missing = REQUIRED.filter((name) => !html.includes(name));
  if (missing.length > 0) {
    ok = false;
    notes.push(`Missing from the page: ${missing.join(', ')}`);
  }
  return { url, ok, notes, scriptHash: scriptFingerprint(html) };
}

const urls = (process.env.CANARY_POLLS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (urls.length === 0) {
  console.log('CANARY_POLLS is not set; nothing to check.');
  process.exit(0);
}

const expected = JSON.parse(await readFile(EXPECTED_FILE, 'utf8')) as {
  scriptHashes?: Record<string, string>;
};
const results = await Promise.all(urls.map(check));
let failed = results.some((r) => !r.ok);

if (process.argv.includes('--update')) {
  const scriptHashes = Object.fromEntries(
    results.filter((r) => r.scriptHash).map((r) => [r.url, r.scriptHash as string]),
  );
  await writeFile(EXPECTED_FILE, `${JSON.stringify({ scriptHashes }, null, 2)}\n`);
  console.log(`Baseline updated for ${Object.keys(scriptHashes).length} poll(s).`);
} else {
  for (const r of results) {
    const want = expected.scriptHashes?.[r.url];
    if (want && r.scriptHash !== want) {
      failed = true;
      r.ok = false;
      r.notes.push(`Page script changed (fingerprint ${r.scriptHash}, expected ${want}).`);
    }
  }
}

const lines = [
  `## When2meet canary: ${failed ? '❌ needs attention' : '✅ all good'}`,
  '',
  ...results.map(
    (r) => `- ${r.ok ? '✅' : '❌'} ${r.url}\n${r.notes.map((n) => `  - ${n}`).join('\n')}`,
  ),
  '',
  failed
    ? 'If When2meet changed, update packages/when2meet and docs/WHEN2MEET_INTERNALS.md, then run `npm run canary -- --update`.'
    : '',
];
console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY)
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
process.exit(failed ? 1 : 0);
