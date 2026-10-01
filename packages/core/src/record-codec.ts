import type { FillRecord } from './overrides.ts';
import type { BitChar, BitMap, UnixSec } from './types.ts';

/**
 * Compact storage form of a `FillRecord`. Term-long polls have thousands of slots; storing four
 * timestamp-keyed maps costs ~50 bytes per slot, this costs ~4 (slot times as arithmetic runs,
 * bits as strings aligned to them).
 */
export interface PackedFillRecord {
  v: 2;
  eventId: number;
  personId: number;
  mode: FillRecord['mode'];
  rulesHash: string;
  sourcesHash: string;
  weekStart?: string;
  timeZone?: string;
  savedAt: number;
  expiresAt: number;
  /** `[first slot, step in seconds, count]` runs listing every slot mentioned below. */
  slots: [UnixSec, number, number][];
  /** One character per slot: `0`, `1`, or `-` when the map has no entry. */
  applied: string;
  calendar: string;
  overrides: string;
  previous: string;
}

/** Encodes ascending slot times as runs of equal steps (each day of a poll becomes one run). */
export function encodeSlotRuns(slots: readonly UnixSec[]): [UnixSec, number, number][] {
  const runs: [UnixSec, number, number][] = [];
  let i = 0;
  while (i < slots.length) {
    const start = slots[i] as UnixSec;
    const next = slots[i + 1];
    if (next === undefined) {
      runs.push([start, 0, 1]);
      break;
    }
    const step = next - start;
    let count = 2;
    while (
      i + count < slots.length &&
      (slots[i + count] as UnixSec) - (slots[i + count - 1] as UnixSec) === step
    ) {
      count++;
    }
    runs.push([start, step, count]);
    i += count;
  }
  return runs;
}

export function decodeSlotRuns(runs: readonly (readonly [number, number, number])[]): UnixSec[] {
  const out: UnixSec[] = [];
  for (const [start, step, count] of runs) {
    for (let k = 0; k < count; k++) out.push(start + k * step);
  }
  return out;
}

const MAPS = ['applied', 'calendar', 'overrides', 'previous'] as const;

export function packFillRecord(record: FillRecord): PackedFillRecord {
  const keys = new Set<string>();
  for (const name of MAPS) for (const key of Object.keys(record[name])) keys.add(key);
  const slots = [...keys].map(Number).sort((a, b) => a - b);
  const align = (map: BitMap) => slots.map((ts) => map[String(ts)] ?? '-').join('');
  const packed: PackedFillRecord = {
    v: 2,
    eventId: record.eventId,
    personId: record.personId,
    mode: record.mode,
    rulesHash: record.rulesHash,
    sourcesHash: record.sourcesHash,
    savedAt: record.savedAt,
    expiresAt: record.expiresAt,
    slots: encodeSlotRuns(slots),
    applied: align(record.applied),
    calendar: align(record.calendar),
    overrides: align(record.overrides),
    previous: align(record.previous),
  };
  if (record.weekStart) packed.weekStart = record.weekStart;
  if (record.timeZone) packed.timeZone = record.timeZone;
  return packed;
}

/** Reads a stored record in either form; returns null for anything unrecognised. */
export function unpackFillRecord(stored: unknown): FillRecord | null {
  if (!stored || typeof stored !== 'object') return null;
  const value = stored as Omit<Partial<PackedFillRecord>, 'v'> & { v?: number };
  if (value.v === 1) return stored as FillRecord;
  if (value.v !== 2 || !Array.isArray(value.slots)) return null;
  const slots = decodeSlotRuns(value.slots);
  const toMap = (bits: string | undefined): BitMap => {
    const map: BitMap = {};
    if (typeof bits !== 'string' || bits.length !== slots.length) return map;
    slots.forEach((ts, i) => {
      const ch = bits[i];
      if (ch === '0' || ch === '1') map[String(ts)] = ch as BitChar;
    });
    return map;
  };
  const record: FillRecord = {
    v: 1,
    eventId: value.eventId ?? 0,
    personId: value.personId ?? 0,
    applied: toMap(value.applied),
    calendar: toMap(value.calendar),
    overrides: toMap(value.overrides),
    previous: toMap(value.previous),
    mode: value.mode === 'add' ? 'add' : 'replace',
    rulesHash: value.rulesHash ?? '',
    sourcesHash: value.sourcesHash ?? '',
    savedAt: value.savedAt ?? 0,
    expiresAt: value.expiresAt ?? 0,
  };
  if (value.weekStart) record.weekStart = value.weekStart;
  if (value.timeZone) record.timeZone = value.timeZone;
  return record;
}
