/**
 * Request/response calls between the content script (isolated world) and the page script
 * (the When2meet page's own JavaScript world), over DOM CustomEvents. Payloads are JSON strings
 * so they cross Firefox's Xray boundary unchanged. Only availability bits and names travel
 * here, never calendar data or tokens.
 */
import type { Bits, UnixSec } from '@w2msync/core';
import type { PageState, Person, SaveOptions, SaveOutcome } from '@w2msync/when2meet';
import type { SignInResult } from '@w2msync/when2meet/page';

export interface ServerState {
  slots: UnixSec[];
  bits: Bits;
  availableAt: number[][];
  people: Person[];
}

export interface PageProtocol {
  read: [undefined, PageState | null];
  signIn: [{ name: string; password: string }, SignInResult];
  serverState: [{ personId: number }, ServerState];
  save: [SaveOptions, SaveOutcome];
  resync: [{ personId: number; bits: Bits }, boolean];
}

export type PageOp = keyof PageProtocol;

const eventName = (channel: string, kind: 'req' | 'res') => `w2msync:${channel}:${kind}`;

interface RequestMessage {
  id: number;
  op: PageOp;
  data: unknown;
}

type ResponseMessage =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string };

export function createPageClient(channel: string, timeoutMs = 120_000) {
  let nextId = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  document.addEventListener(eventName(channel, 'res'), (event) => {
    const message = JSON.parse((event as CustomEvent<string>).detail) as ResponseMessage;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.ok) waiter.resolve(message.value);
    else waiter.reject(new Error(message.error));
  });
  return {
    call<K extends PageOp>(
      op: K,
      data: PageProtocol[K][0],
      callTimeoutMs = timeoutMs,
    ): Promise<PageProtocol[K][1]> {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('The When2meet page stopped responding. Reload it and try again.'));
        }, callTimeoutMs);
        pending.set(id, {
          resolve: (v) => {
            clearTimeout(timer);
            resolve(v as PageProtocol[K][1]);
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
        });
        const detail = JSON.stringify({ id, op, data } satisfies RequestMessage);
        document.dispatchEvent(new CustomEvent(eventName(channel, 'req'), { detail }));
      });
    },
  };
}

export type PageClient = ReturnType<typeof createPageClient>;

export function servePage(
  channel: string,
  handlers: {
    [K in PageOp]: (data: PageProtocol[K][0]) => Promise<PageProtocol[K][1]> | PageProtocol[K][1];
  },
): void {
  document.addEventListener(eventName(channel, 'req'), (event) => {
    const message = JSON.parse((event as CustomEvent<string>).detail) as RequestMessage;
    const handler = handlers[message.op] as ((data: unknown) => unknown) | undefined;
    const respond = (response: ResponseMessage) =>
      document.dispatchEvent(
        new CustomEvent(eventName(channel, 'res'), { detail: JSON.stringify(response) }),
      );
    if (!handler) {
      respond({ id: message.id, ok: false, error: `Unknown operation ${message.op}` });
      return;
    }
    Promise.resolve()
      .then(() => handler(message.data))
      .then(
        (value) => respond({ id: message.id, ok: true, value: value ?? null }),
        (error: unknown) =>
          respond({
            id: message.id,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }),
      );
  });
}
