/**
 * Typed request/response messages between extension pages, content scripts and the background.
 * Uses `sendResponse` + `return true`, which every target browser supports.
 */
import type { Bits, Interval, PollKind, UnixSec, WeekMatch } from '@w2msync/core';
import { browser } from 'wxt/browser';
import type { Account, CalendarChoice } from './accounts.ts';
import { AppError, reviveError, type SerializedError, serializeError } from './errors.ts';
import type { Settings } from './settings.ts';

export interface Status {
  accounts: Account[];
  settings: Settings;
  features: { google: boolean; microsoft: boolean };
  redirectUrl: string;
}

export interface ComputeRequest {
  slots: UnixSec[];
  /** Weekday polls: Sunday of the week to use (default from settings). */
  weekStart?: string;
  /** Override the settings/browser timezone. */
  timeZone?: string;
  /** Whether sign-in windows may open to refresh access. */
  interactive: boolean;
  /** Skip the short-lived busy-time cache. */
  fresh?: boolean;
}

export interface SourceProblem {
  accountId: string;
  label: string;
  message: string;
  code: 'reconnect' | 'consent' | 'failed';
}

export interface ComputeResult {
  /** Calendar-derived availability, one character per slot (`?` = unknown). */
  bits: Bits;
  kind: PollKind;
  /** Days-of-the-week polls: Sunday of the first real week checked. */
  weekStart: string | null;
  /** How many consecutive weeks were checked (1 for specific-date polls). */
  weeks: number;
  match: WeekMatch;
  timeZone: string;
  rulesHash: string;
  sourcesHash: string;
  range: Interval | null;
  /** Sources that could not be read; their events are missing from `bits`. */
  problems: SourceProblem[];
  /** How many sources were read successfully. */
  sourcesRead: number;
}

export interface Protocol {
  getStatus: [undefined, Status];
  connect: [
    { provider: 'google' | 'microsoft'; accountId?: string; withCalendarList?: boolean },
    Account,
  ];
  disconnect: [{ accountId: string }, null];
  setAccount: [{ accountId: string; enabled?: boolean; calendars?: CalendarChoice[] }, Account];
  listCalendars: [{ accountId: string }, CalendarChoice[]];
  addIcs: [{ url?: string; text?: string; label: string }, Account];
  computeTarget: [ComputeRequest, ComputeResult];
  pollSaved: [{ eventKey: string }, null];
  openOptions: [{ hash?: string } | undefined, null];
  resetAll: [undefined, null];
}

export type MessageType = keyof Protocol;
type RequestOf<K extends MessageType> = Protocol[K][0];
type ResponseOf<K extends MessageType> = Protocol[K][1];

interface Envelope {
  w2msync: 1;
  type: MessageType;
  data: unknown;
}

type Reply = { ok: true; value: unknown } | { ok: false; error: SerializedError };

export async function send<K extends MessageType>(
  type: K,
  ...[data]: RequestOf<K> extends undefined ? [data?: undefined] : [data: RequestOf<K>]
): Promise<ResponseOf<K>> {
  const envelope: Envelope = { w2msync: 1, type, data };
  const reply = (await browser.runtime.sendMessage(envelope)) as Reply | undefined;
  if (!reply)
    throw new AppError('failed', 'The extension did not respond. Reload the page and try again.');
  if (!reply.ok) throw reviveError(reply.error);
  return reply.value as ResponseOf<K>;
}

export type Handlers = {
  [K in MessageType]: (
    data: RequestOf<K>,
    sender: { tabId?: number },
  ) => Promise<ResponseOf<K>> | ResponseOf<K>;
};

export function serve(handlers: Handlers): void {
  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    const envelope = message as Partial<Envelope> | null;
    if (envelope?.w2msync !== 1 || !envelope.type || !(envelope.type in handlers)) return undefined;
    const handler = handlers[envelope.type] as (data: unknown, s: { tabId?: number }) => unknown;
    const tabId = sender.tab?.id;
    Promise.resolve()
      .then(() => handler(envelope.data, tabId === undefined ? {} : { tabId }))
      .then(
        (value) => sendResponse({ ok: true, value: value ?? null } satisfies Reply),
        (error: unknown) => {
          console.warn(`[w2msync] ${envelope.type} failed`, error);
          sendResponse({ ok: false, error: serializeError(error) } satisfies Reply);
        },
      );
    return true;
  });
}

/** Background → content script notifications. */
export interface PollChangedEvent {
  w2msyncEvent: 'pollChanged';
  eventKey: string;
}
