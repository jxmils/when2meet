import { browser } from 'wxt/browser';

export type ProviderKind = 'google' | 'microsoft' | 'ics';

export interface CalendarChoice {
  id: string;
  name: string;
  enabled: boolean;
  primary?: boolean;
}

/** A connected calendar source. Secrets (tokens, feed URLs) live in IndexedDB, not here. */
export interface Account {
  id: string;
  provider: ProviderKind;
  label: string;
  enabled: boolean;
  addedAt: number;
  needsReconnect?: boolean;
  /** OAuth accounts: the signed-in address. */
  email?: string;
  /** OAuth accounts: chosen calendars; undefined means the main calendar only. */
  calendars?: CalendarChoice[];
  /** Google: whether the calendar-list permission was granted. */
  canListCalendars?: boolean;
  /** ICS sources. */
  icsKind?: 'url' | 'file';
  icsOrigin?: string;
}

const KEY = 'accounts';

export async function loadAccounts(): Promise<Account[]> {
  const stored = await browser.storage.local.get(KEY);
  return (stored[KEY] as Account[] | undefined) ?? [];
}

export async function saveAccounts(accounts: Account[]): Promise<void> {
  await browser.storage.local.set({ [KEY]: accounts });
}

export async function upsertAccount(account: Account): Promise<void> {
  const accounts = await loadAccounts();
  const at = accounts.findIndex((a) => a.id === account.id);
  if (at === -1) accounts.push(account);
  else accounts[at] = { ...accounts[at], ...account };
  await saveAccounts(accounts);
}

export async function patchAccount(id: string, patch: Partial<Account>): Promise<Account | null> {
  const accounts = await loadAccounts();
  const account = accounts.find((a) => a.id === id);
  if (!account) return null;
  Object.assign(account, patch);
  await saveAccounts(accounts);
  return account;
}

export async function removeAccount(id: string): Promise<void> {
  await saveAccounts((await loadAccounts()).filter((a) => a.id !== id));
}

/** Calendar ids to read for an OAuth account. */
export function selectedCalendars(account: Account, fallback: string): string[] {
  if (!account.calendars) return [fallback];
  return account.calendars.filter((c) => c.enabled).map((c) => c.id);
}
