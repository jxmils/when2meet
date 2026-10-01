import { bitsFromMap, bitsToMap } from './bits.ts';
import type { BitChar, BitMap, Bits, EpochMs, UnixSec } from './types.ts';

/**
 * `replace`: When2meet ends up matching the calendar.
 * `add`: only adds free slots; slots already marked available stay (as manual overrides).
 */
export type FillMode = 'replace' | 'add';

export type ChangeReason = 'fill' | 'calendar' | 'settings' | 'new-slot';

/** What we remember after filling one person's availability on one poll. */
export interface FillRecord {
  v: 1;
  eventId: number;
  personId: number;
  /** Server state right after our last verified save. */
  applied: BitMap;
  /** Calendar-derived target at that time (unknown slots left out). */
  calendar: BitMap;
  /** Slots the user set by hand; these win over the calendar on later updates. */
  overrides: BitMap;
  /** Server state before our last save, for undo. */
  previous: BitMap;
  mode: FillMode;
  rulesHash: string;
  sourcesHash: string;
  weekStart?: string;
  timeZone?: string;
  savedAt: EpochMs;
  /** End of the poll's last slot; records are pruned some time after this. */
  expiresAt: EpochMs;
}

export interface PlannedChange {
  index: number;
  slot: UnixSec;
  to: BitChar;
  reason: ChangeReason;
}

export interface FillPlan {
  kind: 'first' | 'revisit';
  mode: FillMode;
  /** Desired server state (`0`/`1` only). */
  target: Bits;
  changes: PlannedChange[];
  /** First fill in `add` mode: slots marked available that the calendar says are busy. */
  conflicts: number[];
  overrides: BitMap;
}

export interface PlanInput {
  slots: readonly UnixSec[];
  /** Current server state for this person. */
  server: Bits;
  /** Calendar-derived target (may contain `?`). */
  calendar: Bits;
  /** Previous fill by this person on this poll, if any. */
  record?: FillRecord | null;
  /** First fill only. Defaults to `replace` when nothing is marked yet, otherwise `add`. */
  mode?: FillMode;
  /** Forget manual overrides and follow the calendar exactly. */
  resetOverrides?: boolean;
  rulesHash?: string;
}

export function planFill(input: PlanInput): FillPlan {
  const { slots, server, calendar } = input;
  if (server.length !== slots.length || calendar.length !== slots.length) {
    throw new Error('server, calendar and slots must have the same length');
  }
  return input.record ? planRevisit(input, input.record) : planFirstFill(input);
}

function planFirstFill({ slots, server, calendar, mode: requested }: PlanInput): FillPlan {
  const mode: FillMode = requested ?? (server.includes('1') ? 'add' : 'replace');
  const overrides: BitMap = {};
  const conflicts: number[] = [];
  const changes: PlannedChange[] = [];
  let target = '';
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i] as UnixSec;
    const s = server[i] as BitChar;
    const c = calendar[i];
    let t: BitChar;
    if (c !== '0' && c !== '1') t = s;
    else if (mode === 'replace') t = c;
    else {
      t = s === '1' || c === '1' ? '1' : '0';
      if (s === '1' && c === '0') {
        conflicts.push(i);
        overrides[String(slot)] = '1';
      }
    }
    target += t;
    if (t !== s) changes.push({ index: i, slot, to: t, reason: 'fill' });
  }
  return { kind: 'first', mode, target, changes, conflicts, overrides };
}

function planRevisit(input: PlanInput, record: FillRecord): FillPlan {
  const { slots, server, calendar, resetOverrides, rulesHash } = input;
  const present = new Set(slots.map(String));
  const overrides: BitMap = {};
  if (!resetOverrides) {
    for (const [key, bit] of Object.entries(record.overrides)) {
      if (present.has(key)) overrides[key] = bit;
    }
    // Anything that differs from what we last saved was changed by hand (or on another device).
    slots.forEach((slot, i) => {
      const key = String(slot);
      const applied = record.applied[key];
      const s = server[i] as BitChar;
      if (applied !== undefined && s !== applied) overrides[key] = s;
    });
  }
  const changes: PlannedChange[] = [];
  let target = '';
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i] as UnixSec;
    const key = String(slot);
    const s = server[i] as BitChar;
    const c = calendar[i];
    const t: BitChar = overrides[key] ?? (c === '0' || c === '1' ? c : s);
    target += t;
    if (t !== s) {
      changes.push({ index: i, slot, to: t, reason: changeReason(key, c, record, rulesHash) });
    }
  }
  return { kind: 'revisit', mode: record.mode, target, changes, conflicts: [], overrides };
}

function changeReason(
  key: string,
  calendarBit: string | undefined,
  record: FillRecord,
  rulesHash: string | undefined,
): ChangeReason {
  if (record.applied[key] === undefined && record.calendar[key] === undefined) return 'new-slot';
  if (record.calendar[key] !== calendarBit) return 'calendar';
  if (rulesHash !== undefined && rulesHash !== record.rulesHash) return 'settings';
  return 'calendar';
}

export interface RecordInput {
  eventId: number;
  personId: number;
  slots: readonly UnixSec[];
  plan: FillPlan;
  /** Calendar-derived target used for the plan. */
  calendar: Bits;
  /** Server state read back after saving. */
  verified: Bits;
  /** Server state before saving. */
  previous: Bits;
  rulesHash: string;
  sourcesHash: string;
  weekStart?: string;
  timeZone?: string;
  now: EpochMs;
  expiresAt: EpochMs;
}

export function recordFill(input: RecordInput): FillRecord {
  const { slots } = input;
  const record: FillRecord = {
    v: 1,
    eventId: input.eventId,
    personId: input.personId,
    applied: bitsToMap(slots, input.verified),
    calendar: bitsToMap(slots, input.calendar),
    overrides: { ...input.plan.overrides },
    previous: bitsToMap(slots, input.previous),
    mode: input.plan.mode,
    rulesHash: input.rulesHash,
    sourcesHash: input.sourcesHash,
    savedAt: input.now,
    expiresAt: input.expiresAt,
  };
  if (input.weekStart) record.weekStart = input.weekStart;
  if (input.timeZone) record.timeZone = input.timeZone;
  return record;
}

/** Target for undoing the last fill: the server state from before it. */
export function undoTarget(slots: readonly UnixSec[], server: Bits, record: FillRecord): Bits {
  return bitsFromMap(slots, record.previous, server);
}

export const RECORD_RETENTION_MS = 90 * 86_400_000;

export function isRecordExpired(record: FillRecord, now: EpochMs): boolean {
  return now > record.expiresAt + RECORD_RETENTION_MS;
}
