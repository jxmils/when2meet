import type { UnixSec } from '@w2msync/core';
import type { Cell, EventRef, Person, Poll } from './types.ts';

export class NotAPollError extends Error {
  constructor(message = 'This page has no When2meet time grid.') {
    super(message);
    this.name = 'NotAPollError';
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** A person name as written in the page source: JS string escapes first, then HTML entities. */
export function decodeName(raw: string): string {
  return decodeEntities(raw.replace(/\\(.)/g, '$1'));
}

/**
 * Parses a poll page's HTML without a DOM, so it works in content scripts, workers and tests.
 * Throws `NotAPollError` if the page has no time grid.
 */
export function parseEventHtml(html: string, ref: EventRef | null = null): Poll {
  const slots: UnixSec[] = [];
  for (const m of html.matchAll(/TimeOfSlot\[(\d+)\]\s*=\s*(-?\d+)\s*;/g)) {
    slots[Number(m[1])] = Number(m[2]);
  }
  for (let i = 0; i < slots.length; i++) {
    if (slots[i] === undefined) throw new NotAPollError(`Slot ${i} is missing from the page.`);
  }
  if (slots.length === 0) throw new NotAPollError();

  const availableAt: number[][] = slots.map(() => []);
  for (const m of html.matchAll(/AvailableAtSlot\[(\d+)\]\.push\((\d+)\)/g)) {
    availableAt[Number(m[1])]?.push(Number(m[2]));
  }

  const names: string[] = [];
  const ids: number[] = [];
  for (const m of html.matchAll(/PeopleNames\[(\d+)\]\s*=\s*'((?:[^'\\]|\\.)*)'/g)) {
    names[Number(m[1])] = decodeName(m[2] as string);
  }
  for (const m of html.matchAll(/PeopleIDs\[(\d+)\]\s*=\s*(\d+)/g)) {
    ids[Number(m[1])] = Number(m[2]);
  }
  const people: Person[] = [];
  ids.forEach((id, i) => {
    people.push({ id, name: names[i] ?? '' });
  });

  return {
    ref: ref ?? findRef(html),
    name: findName(html),
    slots,
    availableAt,
    people,
    cells: parseCells(html),
    timeZone: findTimeZone(html),
  };
}

function parseCells(html: string): Cell[] {
  const cells: Cell[] = [];
  for (const m of html.matchAll(/<div\b[^>]*\bid\s*=\s*(["'])YouTime(\d+)\1[^>]*>/gi)) {
    const tag = m[0];
    const col = /\bdata-col\s*=\s*["']?(\d+)/i.exec(tag);
    const row = /\bdata-row\s*=\s*["']?(\d+)/i.exec(tag);
    if (col && row) cells.push({ slot: Number(m[2]), col: Number(col[1]), row: Number(row[1]) });
  }
  return cells;
}

function findName(html: string): string {
  const div =
    /<div\b[^>]*\bid\s*=\s*["']?NewEventNameDiv["']?[^>]*>([\s\S]*?)<(?:br|\/div)\b/i.exec(html);
  const title = /<title>([\s\S]*?)<\/title>/i.exec(html);
  const raw = div?.[1] ?? title?.[1] ?? '';
  return decodeEntities(raw.replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^When2meet\s*[-–|:]\s*|\s*[-–|:]\s*When2meet$/i, '')
    .trim();
}

function findRef(html: string): EventRef | null {
  const m = /[?"'/\s](\d{4,})-([A-Za-z0-9]{3,})(?=["'&\s<]|$)/.exec(html);
  return m ? { id: Number(m[1]), code: m[2] as string } : null;
}

function findTimeZone(html: string): string | null {
  const m = /select\.value\s*!=\s*["']([A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*)["']/.exec(html);
  return m?.[1] ?? null;
}
