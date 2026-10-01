import type { BitChar, BitMap, Bits, UnixSec } from './types.ts';

/** A person's availability as bits, from When2meet's per-slot lists of available person ids. */
export function bitsForPerson(availableAt: readonly (readonly number[])[], personId: number): Bits {
  return availableAt.map((ids) => (ids.includes(personId) ? '1' : '0')).join('');
}

/** Replaces every `?` in `target` with the matching character of `current`. */
export function resolveUnknown(target: Bits, current: Bits): Bits {
  assertSameLength(target, current);
  let out = '';
  for (let i = 0; i < target.length; i++) out += target[i] === '?' ? current[i] : target[i];
  return out;
}

export interface BitDiff {
  /** Indices that go from 0 to 1. */
  toAvailable: number[];
  /** Indices that go from 1 to 0. */
  toUnavailable: number[];
}

/** Slots that differ between `from` and `to`; a `?` in `to` means "leave as is". */
export function diffBits(from: Bits, to: Bits): BitDiff {
  assertSameLength(from, to);
  const toAvailable: number[] = [];
  const toUnavailable: number[] = [];
  for (let i = 0; i < to.length; i++) {
    if (to[i] === '1' && from[i] !== '1') toAvailable.push(i);
    else if (to[i] === '0' && from[i] === '1') toUnavailable.push(i);
  }
  return { toAvailable, toUnavailable };
}

export function countAvailable(bits: Bits): number {
  let n = 0;
  for (const ch of bits) if (ch === '1') n++;
  return n;
}

/** Bits keyed by slot timestamp; `?` entries are left out. */
export function bitsToMap(slots: readonly UnixSec[], bits: Bits): BitMap {
  assertSameLength(slots, bits);
  const map: BitMap = {};
  slots.forEach((ts, i) => {
    const ch = bits[i];
    if (ch === '0' || ch === '1') map[String(ts)] = ch;
  });
  return map;
}

/** Bits for `slots` from a map, using `fallback` for slots the map doesn't mention. */
export function bitsFromMap(slots: readonly UnixSec[], map: BitMap, fallback: Bits): Bits {
  assertSameLength(slots, fallback);
  return slots.map((ts, i) => map[String(ts)] ?? (fallback[i] as BitChar)).join('');
}

export function isBits(value: unknown, length?: number): value is Bits {
  return (
    typeof value === 'string' &&
    /^[01?]*$/.test(value) &&
    (length === undefined || value.length === length)
  );
}

function assertSameLength(a: { length: number }, b: { length: number }): void {
  if (a.length !== b.length) {
    throw new Error(`Length mismatch: ${a.length} vs ${b.length}`);
  }
}
