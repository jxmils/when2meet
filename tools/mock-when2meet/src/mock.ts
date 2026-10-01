import type { UnixSec } from '@w2msync/core';
import { parseEventRef } from '@w2msync/when2meet';
import { renderEventPage, type SyntheticPoll } from '@w2msync/when2meet/testing';

export interface MockRequest {
  method: string;
  url: string;
  body?: string;
}

export interface MockResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface MockConfig {
  /**
   * What `SaveTimes.php` honours: the full `availability` string, or the `slots` list with
   * `ChangeToAvailable`. The extension must work with either.
   */
  saveSemantics: 'availability' | 'slots';
  /** Answer 200 to the next N saves without storing them (models "accepted but not kept"). */
  dropNextSaves: number;
  /** Answer 500 to the next N saves. */
  failNextSaves: number;
  /** Serve the poll page as it was when first requested (models a stale cache). */
  cachePages: boolean;
  /** Timezone the rendered grid uses (like the viewer's timezone selector). */
  viewerTimeZone: string | null;
  /** Leave these slots without a personal-grid cell. */
  hideCells: UnixSec[];
}

export interface LoggedRequest {
  method: string;
  path: string;
  params: Record<string, string>;
  outcome: string;
}

const DEFAULT_CONFIG: MockConfig = {
  saveSemantics: 'availability',
  dropNextSaves: 0,
  failNextSaves: 0,
  cachePages: false,
  viewerTimeZone: null,
  hideCells: [],
};

const text = (
  status: number,
  body: string,
  headers: Record<string, string> = {},
): MockResponse => ({
  status,
  headers: { 'content-type': 'text/plain; charset=utf-8', ...headers },
  body,
});

/** An in-memory When2meet: poll pages, sign-in and saving, with switchable behaviour. */
export function createMockWhen2meet(polls: SyntheticPoll[], initial: Partial<MockConfig> = {}) {
  const byId = new Map(polls.map((p) => [p.id, p]));
  const cache = new Map<number, string>();
  const log: LoggedRequest[] = [];
  let config: MockConfig = { ...DEFAULT_CONFIG, ...initial };
  let nextPersonId = 900_000_001;
  let session = 0;

  function render(poll: SyntheticPoll): string {
    const cached = config.cachePages ? cache.get(poll.id) : undefined;
    if (cached) return cached;
    const html = renderEventPage(poll, {
      ...(config.viewerTimeZone ? { viewerTimeZone: config.viewerTimeZone } : {}),
      hideCells: new Set(config.hideCells),
    });
    cache.set(poll.id, html);
    return html;
  }

  function processLogin(params: URLSearchParams): MockResponse {
    const poll = byId.get(Number(params.get('id')));
    const name = (params.get('name') ?? '').trim();
    const password = params.get('password') ?? '';
    if (!poll) return text(200, 'Event not found.');
    if (!name) return text(200, 'Please enter your name.');
    let person = poll.people.find((p) => p.name === name);
    if (person?.password && person.password !== password) return text(200, 'Wrong password.');
    if (!person) {
      person = { id: nextPersonId++, name, ...(password ? { password } : {}) };
      poll.people.push(person);
      poll.availability.set(person.id, new Set());
    }
    session++;
    return text(200, String(person.id), { 'set-cookie': `PHPSESSID=mock${session}; path=/` });
  }

  function saveTimes(params: URLSearchParams): MockResponse {
    const poll = byId.get(Number(params.get('event')));
    const personId = Number(params.get('person'));
    const person = poll?.people.find((p) => p.id === personId);
    if (!poll || !person) return text(200, 'Unknown person.');
    if (person.password && person.password !== (params.get('password') ?? '')) {
      return text(200, 'Wrong password.');
    }
    if (config.failNextSaves > 0) {
      config.failNextSaves--;
      return text(500, 'Internal Server Error');
    }
    if (config.dropNextSaves > 0) {
      config.dropNextSaves--;
      return text(200, '');
    }
    const current = poll.availability.get(personId) ?? new Set<UnixSec>();
    if (config.saveSemantics === 'availability') {
      const bits = params.get('availability') ?? '';
      if (bits.length !== poll.slots.length) return text(200, 'Bad availability.');
      poll.availability.set(personId, new Set(poll.slots.filter((_, i) => bits[i] === '1')));
    } else {
      const toAvailable = params.get('ChangeToAvailable') === 'true';
      for (const slot of (params.get('slots') ?? '').split(',').filter(Boolean).map(Number)) {
        if (toAvailable) current.add(slot);
        else current.delete(slot);
      }
      poll.availability.set(personId, current);
    }
    return text(200, '');
  }

  async function handle(request: MockRequest): Promise<MockResponse> {
    const url = new URL(request.url);
    const params = new URLSearchParams(request.body ?? '');
    const record = (outcome: string) =>
      log.push({
        method: request.method,
        path: url.pathname,
        params: Object.fromEntries(params),
        outcome,
      });

    if (url.pathname === '/ProcessLogin.php' && request.method === 'POST') {
      const response = processLogin(params);
      record(response.body);
      return response;
    }
    if (url.pathname === '/SaveTimes.php' && request.method === 'POST') {
      const response = saveTimes(params);
      record(`${response.status} ${response.body}`);
      return response;
    }
    if (url.pathname === '/' && request.method === 'GET') {
      const ref = parseEventRef(url.search);
      const poll = ref && byId.get(ref.id);
      if (!poll || poll.code !== ref.code) return text(404, 'Not found');
      record('page');
      return {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' },
        body: render(poll),
      };
    }
    return text(404, 'Not found');
  }

  return {
    handle,
    log,
    polls: byId,
    get config(): MockConfig {
      return config;
    },
    configure(patch: Partial<MockConfig>) {
      config = { ...config, ...patch };
      cache.clear();
    },
    /** A person's availability as bits, in slot order. */
    bitsFor(pollId: number, personId: number): string {
      const poll = byId.get(pollId);
      const set = poll?.availability.get(personId) ?? new Set<UnixSec>();
      return (poll?.slots ?? []).map((s) => (set.has(s) ? '1' : '0')).join('');
    },
    personByName(pollId: number, name: string) {
      return byId.get(pollId)?.people.find((p) => p.name === name);
    },
  };
}

export type MockWhen2meet = ReturnType<typeof createMockWhen2meet>;
