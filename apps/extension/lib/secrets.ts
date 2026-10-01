/**
 * Secrets in the extension's own IndexedDB. Unlike `storage.local`, content scripts (which run
 * inside web pages) can't read it. Only the background and extension pages use this module.
 */
import { clear, createStore, del, get, set } from 'idb-keyval';

export interface Secret {
  refreshToken?: string;
  icsUrl?: string;
  icsText?: string;
}

const store = createStore('w2msync', 'secrets');

export const getSecret = (accountId: string) => get<Secret>(accountId, store);
export const setSecret = (accountId: string, secret: Secret) => set(accountId, secret, store);
export const deleteSecret = (accountId: string) => del(accountId, store);
export const clearSecrets = () => clear(store);
