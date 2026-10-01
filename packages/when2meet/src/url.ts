import type { EventRef } from './types.ts';

export const WHEN2MEET_ORIGIN = 'https://www.when2meet.com';

const REF_RE = /^\??(\d+)-([A-Za-z0-9]+)(?:[&#]|$)/;

export function isWhen2meetHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'when2meet.com' || host === 'www.when2meet.com';
}

/**
 * Reads a poll reference from a full When2meet URL, a query string (`?123-abc`) or a bare
 * `123-abc`. Full URLs on other hosts are rejected unless `anyHost` is set (used by the web app,
 * whose links mirror When2meet's).
 */
export function parseEventRef(input: string, options: { anyHost?: boolean } = {}): EventRef | null {
  let text = input.trim();
  if (/^(?:www\.)?when2meet\.com\//i.test(text)) text = `https://${text}`;
  if (/^https?:\/\//i.test(text)) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return null;
    }
    if (!options.anyHost && !isWhen2meetHost(url.hostname)) return null;
    text = url.search;
  }
  const match = REF_RE.exec(text);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? { id, code: match[2] as string } : null;
}

export function eventKey(ref: EventRef): string {
  return `${ref.id}-${ref.code}`;
}

export function eventUrl(ref: EventRef, origin = WHEN2MEET_ORIGIN): string {
  return `${origin}/?${eventKey(ref)}`;
}
