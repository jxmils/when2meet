import { browser } from 'wxt/browser';

/** Access tokens live only in session storage (memory; cleared when the browser closes). */
interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

const key = (accountId: string) => `token:${accountId}`;

export async function cachedToken(accountId: string): Promise<string | null> {
  const stored = (await browser.storage.session.get(key(accountId)))[key(accountId)] as
    | CachedToken
    | undefined;
  return stored && stored.expiresAt - 60_000 > Date.now() ? stored.accessToken : null;
}

export async function cacheToken(accountId: string, accessToken: string, expiresInSec: number) {
  const value: CachedToken = { accessToken, expiresAt: Date.now() + expiresInSec * 1000 };
  await browser.storage.session.set({ [key(accountId)]: value });
}

export async function forgetToken(accountId: string): Promise<void> {
  await browser.storage.session.remove(key(accountId));
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}
