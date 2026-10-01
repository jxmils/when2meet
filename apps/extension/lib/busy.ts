/** Background-side glue: read every connected calendar and turn it into slot availability. */
import {
  type BusyBlock,
  blockingIntervals,
  computeTargetBits,
  defaultWeekStart,
  detectPollKind,
  hashOf,
  type Interval,
  mapSlots,
  rulesHash,
  span,
  systemTimeZone,
} from '@w2msync/core';
import {
  type ApiClient,
  DEFAULT_CALENDAR,
  googleBusy,
  IcsParseError,
  icsBusy,
  microsoftBusy,
  ProviderError,
} from '@w2msync/providers';
import { browser } from 'wxt/browser';
import { type Account, loadAccounts, selectedCalendars } from './accounts.ts';
import { getAccessToken } from './auth/index.ts';
import { AppError } from './errors.ts';
import type { ComputeRequest, ComputeResult, SourceProblem } from './messages.ts';
import { getSecret } from './secrets.ts';
import { loadSettings } from './settings.ts';

const BUSY_CACHE_MS = 5 * 60_000;

export async function computeTarget(
  request: ComputeRequest & { fresh?: boolean },
): Promise<ComputeResult> {
  const settings = await loadSettings();
  const timeZone = request.timeZone || settings.timeZone || systemTimeZone();
  const now = Date.now();
  const kind = detectPollKind(request.slots);
  const weekStart =
    kind === 'weekdays'
      ? (request.weekStart ?? defaultWeekStart(now, timeZone, settings.weekdayPollWeek))
      : null;
  const mapped = mapSlots(request.slots, { kind, ...(weekStart ? { weekStart, timeZone } : {}) });
  const accounts = (await loadAccounts()).filter((a) => a.enabled);
  const sourcesHash = hashOf(
    accounts.map((a) => [a.id, a.calendars?.filter((c) => c.enabled).map((c) => c.id) ?? null]),
  );
  const covered = span(mapped);
  const base = {
    kind,
    weekStart,
    timeZone,
    rulesHash: rulesHash(settings.rules),
    sourcesHash,
  };
  if (!covered) {
    return {
      ...base,
      bits: '?'.repeat(request.slots.length),
      range: null,
      problems: [],
      sourcesRead: 0,
    };
  }

  const margin =
    86_400_000 + (settings.rules.bufferBeforeMin + settings.rules.bufferAfterMin) * 60_000;
  const range: Interval = { start: covered.start - margin, end: covered.end + margin };
  const blocks: BusyBlock[] = [];
  const problems: SourceProblem[] = [];
  let sourcesRead = 0;
  await Promise.all(
    accounts.map(async (account) => {
      try {
        blocks.push(...(await busyFor(account, range, timeZone, request)));
        sourcesRead++;
      } catch (error) {
        problems.push(problemFor(account, error));
      }
    }),
  );
  const blocking = blockingIntervals(blocks, settings.rules, timeZone);
  const bits = computeTargetBits({ slots: mapped, blocking, rules: settings.rules, timeZone, now });
  return { ...base, bits, range, problems, sourcesRead };
}

async function busyFor(
  account: Account,
  range: Interval,
  timeZone: string,
  request: { interactive: boolean; fresh?: boolean },
): Promise<BusyBlock[]> {
  const cacheKey = `busy:${account.id}:${hashOf([account.calendars ?? null, range, timeZone])}`;
  if (!request.fresh) {
    const hit = (await browser.storage.session.get(cacheKey))[cacheKey] as
      | { at: number; blocks: BusyBlock[] }
      | undefined;
    if (hit && Date.now() - hit.at < BUSY_CACHE_MS) return hit.blocks;
  }
  const blocks = await readBusy(account, range, timeZone, request.interactive);
  await browser.storage.session.set({ [cacheKey]: { at: Date.now(), blocks } });
  return blocks;
}

async function readBusy(
  account: Account,
  range: Interval,
  timeZone: string,
  interactive: boolean,
): Promise<BusyBlock[]> {
  const client: ApiClient = {
    token: (options) =>
      getAccessToken(account, {
        interactive,
        ...(options?.forceRefresh ? { forceRefresh: true } : {}),
      }),
  };
  if (account.provider === 'google' || account.provider === 'microsoft') {
    const calendars = selectedCalendars(
      account,
      account.provider === 'google' ? 'primary' : DEFAULT_CALENDAR,
    );
    if (calendars.length === 0) return [];
    const result =
      account.provider === 'google'
        ? await googleBusy(client, calendars, range)
        : await microsoftBusy(client, calendars, range);
    if (result.errors.length > 0) {
      const names = result.errors.map(
        (e) => account.calendars?.find((c) => c.id === e.calendar)?.name ?? e.calendar,
      );
      throw new AppError(
        'failed',
        `Could not read ${names.join(', ')} (${result.errors[0]?.reason}).`,
      );
    }
    return result.blocks;
  }
  const secret = await getSecret(account.id);
  const text = account.icsKind === 'file' ? secret?.icsText : await fetchIcs(secret?.icsUrl ?? '');
  if (!text)
    throw new AppError('reconnect', 'This calendar has no data. Add it again in settings.');
  try {
    return icsBusy(text, {
      range,
      timeZone,
      ...(account.email ? { ownerEmails: [account.email] } : {}),
    });
  } catch (error) {
    if (error instanceof IcsParseError) throw new AppError('failed', error.message);
    throw error;
  }
}

/** Accepts webcal:// and https:// links; returns the https URL. */
export function normalizeIcsUrl(input: string): string {
  const trimmed = input.trim().replace(/^webcals?:\/\//i, 'https://');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new AppError('invalid', 'That is not a valid link.');
  }
  if (url.protocol !== 'https:') {
    throw new AppError('invalid', 'Calendar links must start with https:// or webcal://.');
  }
  return url.href;
}

export async function fetchIcs(url: string): Promise<string> {
  if (!url)
    throw new AppError('reconnect', 'This calendar link is missing. Add it again in settings.');
  const parsed = new URL(url);
  const granted = await browser.permissions.contains({ origins: [`${parsed.origin}/*`] });
  if (!granted) {
    throw new AppError(
      'reconnect',
      `Access to ${parsed.host} was removed. Add the calendar again in settings.`,
    );
  }
  let response: Response;
  try {
    response = await fetch(url, { cache: 'no-store', credentials: 'omit', redirect: 'follow' });
  } catch {
    throw new AppError('failed', `Could not reach ${parsed.host}.`);
  }
  if (!response.ok)
    throw new AppError('failed', `${parsed.host} answered HTTP ${response.status}.`);
  const text = await response.text();
  if (!text.includes('BEGIN:VCALENDAR')) {
    throw new AppError('failed', 'That link did not return a calendar (.ics) file.');
  }
  return text;
}

function problemFor(account: Account, error: unknown): SourceProblem {
  const label = account.label;
  if (error instanceof AppError) {
    const code = error.code === 'reconnect' || error.code === 'consent' ? error.code : 'failed';
    return { accountId: account.id, label, message: error.message, code };
  }
  if (error instanceof ProviderError) {
    const reconnect = error.code === 'auth';
    return {
      accountId: account.id,
      label,
      message: reconnect ? `Reconnect ${label} in settings.` : error.message,
      code: reconnect ? 'reconnect' : 'failed',
    };
  }
  return {
    accountId: account.id,
    label,
    message: String((error as Error)?.message ?? error),
    code: 'failed',
  };
}
