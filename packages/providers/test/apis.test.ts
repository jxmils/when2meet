import { describe, expect, it } from 'vitest';
import { chunkRange, GOOGLE_MAX_RANGE_MS, googleBusy, googleCalendars } from '../src/google.ts';
import { type ApiClient, ProviderError } from '../src/http.ts';
import { microsoftBusy, microsoftCalendars, parseGraphUtc } from '../src/microsoft.ts';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function fakeClient(responder: (call: Call, index: number) => Response) {
  const calls: Call[] = [];
  const tokens: boolean[] = [];
  const client: ApiClient = {
    retryDelayMs: 1,
    token: async (options) => {
      tokens.push(options?.forceRefresh === true);
      return options?.forceRefresh ? 'fresh-token' : 'token';
    },
    fetch: async (url, init) => {
      const call: Call = {
        url,
        method: init?.method ?? 'GET',
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);
      return responder(call, calls.length - 1);
    },
  };
  return { client, calls, tokens };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
const range = {
  start: Date.parse('2026-10-01T00:00:00Z'),
  end: Date.parse('2026-12-31T00:00:00Z'),
};

describe('googleBusy', () => {
  it('queries free/busy in chunks and collects per-calendar errors', async () => {
    const { client, calls } = fakeClient((call) =>
      json({
        calendars: {
          primary: {
            busy: [
              { start: (call.body as { timeMin: string }).timeMin, end: '2026-10-01T01:00:00Z' },
            ],
          },
          'team@example.com': { errors: [{ domain: 'global', reason: 'notFound' }] },
        },
      }),
    );
    const result = await googleBusy(client, ['primary', 'team@example.com'], range);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      url: 'https://www.googleapis.com/calendar/v3/freeBusy',
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      body: {
        timeMin: '2026-10-01T00:00:00.000Z',
        timeMax: '2026-11-30T00:00:00.000Z',
        items: [{ id: 'primary' }, { id: 'team@example.com' }],
      },
    });
    expect(result.blocks[0]).toEqual({
      start: Date.parse('2026-10-01T00:00:00Z'),
      end: Date.parse('2026-10-01T01:00:00Z'),
      kind: 'busy',
      source: 'google:primary',
    });
    expect(result.errors).toEqual([{ calendar: 'team@example.com', reason: 'notFound' }]);
  });

  it('refreshes the token once after a 401', async () => {
    const { client, tokens } = fakeClient((call) =>
      call.headers.authorization === 'Bearer token'
        ? json({}, 401)
        : json({ calendars: { primary: { busy: [] } } }),
    );
    await googleBusy(client, ['primary'], { start: range.start, end: range.start + 3_600_000 });
    expect(tokens).toEqual([false, true]);
  });

  it('retries rate limits and then gives up with a typed error', async () => {
    const { client, calls } = fakeClient(() =>
      json({ error: { message: 'slow down' } }, 429, { 'Retry-After': '0' }),
    );
    await expect(
      googleBusy(client, ['primary'], { start: range.start, end: range.start + 1 }),
    ).rejects.toMatchObject({
      code: 'rate-limited',
    });
    expect(calls).toHaveLength(3);
  });

  it('maps Google 403 rate-limit reasons', async () => {
    const { client } = fakeClient(() =>
      json({ error: { message: 'quota', errors: [{ reason: 'userRateLimitExceeded' }] } }, 403),
    );
    const error = await googleBusy(client, ['primary'], { start: 0, end: 1 }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ code: 'rate-limited', status: 403 });
  });

  it('splits ranges into chunks', () => {
    expect(
      chunkRange({ start: 0, end: GOOGLE_MAX_RANGE_MS * 2 + 5 }, GOOGLE_MAX_RANGE_MS),
    ).toHaveLength(3);
  });
});

describe('googleCalendars', () => {
  it('pages through the calendar list and skips hidden calendars', async () => {
    const { client, calls } = fakeClient((_, i) =>
      i === 0
        ? json({ items: [{ id: 'primary@x', summary: 'Me', primary: true }], nextPageToken: 'p2' })
        : json({
            items: [
              { id: 'h', summary: 'Hidden', hidden: true },
              {
                id: 'c2',
                summary: 'Classes',
                summaryOverride: 'My classes',
                backgroundColor: '#123456',
              },
            ],
          }),
    );
    expect(await googleCalendars(client)).toEqual([
      { id: 'primary@x', name: 'Me', primary: true },
      { id: 'c2', name: 'My classes', primary: false, color: '#123456' },
    ]);
    expect(calls[1]?.url).toContain('pageToken=p2');
  });
});

describe('microsoftBusy', () => {
  it('pages through calendarView in UTC and maps showAs', async () => {
    const { client, calls } = fakeClient((call, i) => {
      if (call.url.includes('/calendars/bad/')) return json({ error: { message: 'gone' } }, 404);
      if (i === 0) {
        return json({
          value: [
            {
              showAs: 'busy',
              start: { dateTime: '2026-10-05T13:00:00.0000000', timeZone: 'UTC' },
              end: { dateTime: '2026-10-05T14:00:00.0000000', timeZone: 'UTC' },
            },
            {
              showAs: 'tentative',
              start: { dateTime: '2026-10-05T15:00:00.0000000' },
              end: { dateTime: '2026-10-05T15:30:00.0000000' },
            },
            {
              showAs: 'busy',
              isCancelled: true,
              start: { dateTime: '2026-10-05T16:00:00' },
              end: { dateTime: '2026-10-05T17:00:00' },
            },
          ],
          '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/calendarView?$skiptoken=abc',
        });
      }
      return json({
        value: [
          {
            showAs: 'busy',
            responseStatus: { response: 'declined' },
            start: { dateTime: '2026-10-06T13:00:00' },
            end: { dateTime: '2026-10-06T14:00:00' },
          },
          {
            showAs: 'oof',
            isAllDay: true,
            start: { dateTime: '2026-10-07T00:00:00.0000000' },
            end: { dateTime: '2026-10-09T00:00:00.0000000' },
          },
          {
            showAs: 'workingElsewhere',
            start: { dateTime: '2026-10-08T13:00:00' },
            end: { dateTime: '2026-10-08T21:00:00' },
          },
        ],
      });
    });
    const result = await microsoftBusy(client, ['default', 'bad'], range);
    expect(calls[0]?.url).toMatch(
      /^https:\/\/graph\.microsoft\.com\/v1\.0\/me\/calendarView\?startDateTime=/,
    );
    expect(calls[0]?.headers.prefer).toBe('outlook.timezone="UTC"');
    expect(calls[1]?.url).toContain('$skiptoken=abc');
    expect(result.blocks.map((b) => [b.kind, b.allDay ?? new Date(b.start).toISOString()])).toEqual(
      [
        ['busy', '2026-10-05T13:00:00.000Z'],
        ['tentative', '2026-10-05T15:00:00.000Z'],
        ['oof', { startDate: '2026-10-07', endDate: '2026-10-09' }],
        ['workingElsewhere', '2026-10-08T13:00:00.000Z'],
      ],
    );
    expect(result.errors).toEqual([{ calendar: 'bad', reason: 'gone' }]);
  });

  it('lists calendars', async () => {
    const { client } = fakeClient(() =>
      json({
        value: [
          { id: 'a', name: 'Calendar', isDefaultCalendar: true, hexColor: '#ff0000' },
          { id: 'b', name: 'Birthdays' },
        ],
      }),
    );
    expect(await microsoftCalendars(client)).toEqual([
      { id: 'a', name: 'Calendar', primary: true, color: '#ff0000' },
      { id: 'b', name: 'Birthdays', primary: false },
    ]);
  });

  it('parses Graph times', () => {
    expect(parseGraphUtc('2026-10-05T13:00:00.1234567')).toBe(
      Date.parse('2026-10-05T13:00:00.123Z'),
    );
    expect(parseGraphUtc('2026-10-05T13:00:00Z')).toBe(Date.parse('2026-10-05T13:00:00Z'));
    expect(() => parseGraphUtc('soon')).toThrow(ProviderError);
  });
});
