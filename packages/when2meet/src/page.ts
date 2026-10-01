/**
 * Code that runs inside a When2meet page's own JavaScript context (the MAIN world), where the
 * page's global variables and functions are visible.
 */
import { type Bits, bitsForPerson } from '@w2msync/core';
import { decodeEntities, parseEventHtml } from './parse.ts';
import type { DriveRun, SaveDriver } from './save.ts';
import type { Cell, PageState } from './types.ts';
import { parseEventRef } from './url.ts';

/** Globals a When2meet poll page defines with `var`. */
export interface When2meetGlobals {
  TimeOfSlot?: number[];
  AvailableAtSlot?: number[][];
  PeopleNames?: string[];
  PeopleIDs?: number[];
  UserID?: number;
  IsMouseDown?: boolean;
  ChangeToAvailable?: boolean;
  FromCol?: number;
  ToCol?: number;
  FromRow?: number;
  ToRow?: number;
  SelectStop?: () => void;
  ReColorIndividual?: () => void;
  ReColorGroup?: () => void;
  ProcessLogin?: () => void;
}

export type PageWindow = Window & typeof globalThis & When2meetGlobals;

export function readPageState(win: PageWindow): PageState | null {
  const slots = win.TimeOfSlot;
  const availableAt = win.AvailableAtSlot;
  if (!Array.isArray(slots) || !Array.isArray(availableAt) || slots.length === 0) return null;
  const names = win.PeopleNames ?? [];
  const ids = win.PeopleIDs ?? [];
  return {
    ref: parseEventRef(win.location.search),
    name: readEventName(win.document),
    slots: slots.map(Number),
    availableAt: availableAt.map((list) => (Array.isArray(list) ? list.map(Number) : [])),
    people: ids.map((id, i) => ({ id: Number(id), name: decodeEntities(String(names[i] ?? '')) })),
    cells: readCells(win.document),
    timeZone:
      (win.document.getElementById('ParticipantTimeZone') as HTMLSelectElement | null)?.value ||
      null,
    userId: Number(win.UserID) || 0,
  };
}

export function readCells(doc: Document): Cell[] {
  const cells: Cell[] = [];
  for (const el of doc.querySelectorAll<HTMLElement>('[id^="YouTime"]')) {
    const slot = Number(el.dataset.time ?? el.id.slice('YouTime'.length));
    const col = Number(el.dataset.col);
    const row = Number(el.dataset.row);
    if (Number.isFinite(slot) && Number.isFinite(col) && Number.isFinite(row)) {
      cells.push({ slot, col, row });
    }
  }
  return cells;
}

function readEventName(doc: Document): string {
  const div = doc.getElementById('NewEventNameDiv');
  const text = div?.firstChild?.textContent ?? doc.title;
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^When2meet\s*[-–|:]\s*|\s*[-–|:]\s*When2meet$/i, '')
    .trim();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type SignInResult = { ok: true; userId: number } | { ok: false; error: string };

/**
 * Signs in through the page's own form, as a person would. When2meet reports errors such as a
 * wrong password with `alert()`; that is captured and returned instead of shown.
 */
export async function signInOnPage(
  win: PageWindow,
  name: string,
  password: string,
  timeoutMs = 10_000,
): Promise<SignInResult> {
  const doc = win.document;
  const nameInput = doc.getElementById('name') as HTMLInputElement | null;
  const passwordInput = doc.getElementById('password') as HTMLInputElement | null;
  if (!nameInput) return { ok: false, error: 'The sign-in form was not found on this page.' };
  setInputValue(nameInput, name);
  if (passwordInput) setInputValue(passwordInput, password);

  let alerted: string | null = null;
  const originalAlert = win.alert;
  win.alert = (message?: unknown) => {
    alerted = String(message ?? '');
  };
  try {
    if (typeof win.ProcessLogin === 'function') {
      win.ProcessLogin();
    } else {
      const button = findSignInButton(doc);
      if (!button) return { ok: false, error: 'The sign-in button was not found on this page.' };
      button.click();
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const userId = Number(win.UserID) || 0;
      if (userId > 0) return { ok: true, userId };
      if (alerted !== null) return { ok: false, error: alerted || 'Signing in failed.' };
      await sleep(100);
    }
    return { ok: false, error: 'Signing in to When2meet timed out.' };
  } finally {
    win.alert = originalAlert;
  }
}

function setInputValue(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function findSignInButton(doc: Document): HTMLElement | null {
  const byHandler = doc.querySelector<HTMLElement>('[onclick*="ProcessLogin"]');
  if (byHandler) return byHandler;
  const candidates = doc.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
    'input[type=button], input[type=submit], button',
  );
  return (
    [...candidates].find((el) => /sign\s*in|log\s*in/i.test(el.value || el.textContent || '')) ??
    null
  );
}

/** Watches for the page's next `SaveTimes.php` request and resolves when it completes. */
function watchSaveTimes(win: PageWindow, timeoutMs: number) {
  const originalFetch = win.fetch;
  const xhr = win.XMLHttpRequest.prototype;
  const originalOpen = xhr.open;
  const originalSend = xhr.send;
  const urls = new WeakMap<XMLHttpRequest, string>();
  let settle: (error?: Error) => void = () => {};
  const done = new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(
      () => settle(new Error('When2meet did not respond in time.')),
      timeoutMs,
    );
    settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      win.fetch = originalFetch;
      xhr.open = originalOpen;
      xhr.send = originalSend;
      if (error) reject(error);
      else resolve();
    };
  });
  win.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const response = originalFetch.call(win, input, init);
    if (url.includes('SaveTimes.php')) {
      response.then(
        (r) =>
          r
            .clone()
            .text()
            .then(() => settle(r.ok ? undefined : new Error(`HTTP ${r.status}`))),
        (e: unknown) => settle(e instanceof Error ? e : new Error(String(e))),
      );
    }
    return response;
  }) as typeof win.fetch;
  xhr.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    urls.set(this, String(url));
    return (originalOpen as (...args: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof xhr.open;
  xhr.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    if (urls.get(this)?.includes('SaveTimes.php')) {
      this.addEventListener('loadend', () => settle());
    }
    return originalSend.call(this, body);
  };
  return { done, cancel: (error: Error) => settle(error) };
}

/** A `SaveDriver` backed by the live page. */
export function createPageDriver(win: PageWindow, personId: number): SaveDriver {
  const pollUrl = win.location.pathname + win.location.search;
  return {
    async serverBits(): Promise<Bits> {
      const response = await win.fetch(pollUrl, { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error(`Reloading the poll failed (HTTP ${response.status}).`);
      const poll = parseEventHtml(await response.text());
      const local = win.TimeOfSlot ?? [];
      if (
        poll.slots.length !== local.length ||
        poll.slots.some((ts, i) => ts !== Number(local[i]))
      ) {
        throw new Error('This poll was changed on When2meet. Reload the page and try again.');
      }
      return bitsForPerson(poll.availableAt, personId);
    },

    async postSaveTimes(params) {
      const response = await win.fetch('SaveTimes.php', {
        method: 'POST',
        body: params,
        credentials: 'same-origin',
      });
      await response.text().catch(() => '');
      return { ok: response.ok, status: response.status };
    },

    cells: () => readCells(win.document),

    async driveRun(run: DriveRun) {
      if (typeof win.SelectStop !== 'function') {
        throw new Error('When2meet’s grid code was not found on this page.');
      }
      const watcher = watchSaveTimes(win, 10_000);
      try {
        win.IsMouseDown = true;
        win.ChangeToAvailable = run.toAvailable;
        win.FromCol = run.col;
        win.ToCol = run.col;
        win.FromRow = run.fromRow;
        win.ToRow = run.toRow;
        win.SelectStop();
      } catch (error) {
        watcher.cancel(error instanceof Error ? error : new Error(String(error)));
      }
      await watcher.done;
    },

    async resync(bits: Bits) {
      const slots = win.TimeOfSlot ?? [];
      const availableAt = win.AvailableAtSlot ?? [];
      slots.forEach((_, i) => {
        let list = availableAt[i];
        if (!list) {
          list = [];
          availableAt[i] = list;
        }
        const at = list.findIndex((id) => Number(id) === personId);
        if (bits[i] === '1' && at === -1) list.push(personId);
        if (bits[i] === '0' && at !== -1) list.splice(at, 1);
      });
      let redrawn = false;
      if (typeof win.ReColorIndividual === 'function') {
        win.ReColorIndividual();
        redrawn = true;
      }
      if (typeof win.ReColorGroup === 'function') win.ReColorGroup();
      return redrawn;
    },
  };
}
