/** Per-poll memory, kept in storage.local (no secrets): who you are on a poll and what was filled. */
import {
  type FillRecord,
  packFillRecord,
  RECORD_RETENTION_MS,
  unpackFillRecord,
} from '@w2msync/core';
import { browser } from 'wxt/browser';

export interface Binding {
  personId: number;
  name: string;
  savedAt: number;
}

const recordKey = (eventId: number, personId: number) => `fill:${eventId}:${personId}`;
const bindingKey = (eventId: number) => `binding:${eventId}`;
const checkKey = (eventId: number) => `check:${eventId}`;

async function read<T>(key: string): Promise<T | null> {
  return ((await browser.storage.local.get(key))[key] as T | undefined) ?? null;
}

/** Records are stored packed (see `packFillRecord`); term-long polls have thousands of slots. */
export async function loadRecord(eventId: number, personId: number): Promise<FillRecord | null> {
  return unpackFillRecord(await read<unknown>(recordKey(eventId, personId)));
}

export async function saveRecord(record: FillRecord): Promise<void> {
  await browser.storage.local.set({
    [recordKey(record.eventId, record.personId)]: packFillRecord(record),
  });
}

export async function deleteRecord(eventId: number, personId: number): Promise<void> {
  await browser.storage.local.remove(recordKey(eventId, personId));
}

export const loadBinding = (eventId: number) => read<Binding>(bindingKey(eventId));

export async function saveBinding(eventId: number, binding: Binding): Promise<void> {
  await browser.storage.local.set({ [bindingKey(eventId)]: binding });
}

/** True at most once per `intervalMs` per poll, so revisits don't hit calendars on every load. */
export async function claimCheck(eventId: number, intervalMs = 10 * 60_000): Promise<boolean> {
  const last = await read<number>(checkKey(eventId));
  if (last && Date.now() - last < intervalMs) return false;
  await browser.storage.local.set({ [checkKey(eventId)]: Date.now() });
  return true;
}

/** Drops records (and their bindings/check marks) for polls that ended long ago. */
export async function pruneRecords(now = Date.now()): Promise<void> {
  const all = await browser.storage.local.get(null);
  const stale: string[] = [];
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith('fill:')) continue;
    const { eventId, expiresAt } = (value ?? {}) as { eventId?: number; expiresAt?: number };
    if (typeof expiresAt === 'number' && now > expiresAt + RECORD_RETENTION_MS) {
      stale.push(key);
      if (typeof eventId === 'number') stale.push(bindingKey(eventId), checkKey(eventId));
    }
  }
  if (stale.length > 0) await browser.storage.local.remove(stale);
}
