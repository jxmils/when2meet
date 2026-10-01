/** Unix time in whole seconds, the unit When2meet uses for slot starts. */
export type UnixSec = number;

/** Milliseconds since the Unix epoch. */
export type EpochMs = number;

/** Half-open time range `[start, end)` in epoch milliseconds. */
export interface Interval {
  start: EpochMs;
  end: EpochMs;
}

/** How a calendar says the user is occupied during an event. */
export type BusyKind = 'busy' | 'tentative' | 'oof' | 'workingElsewhere' | 'free' | 'unknown';

export interface BusyBlock {
  start: EpochMs;
  end: EpochMs;
  kind: BusyKind;
  /**
   * Set for all-day events. Dates are local calendar dates (`YYYY-MM-DD`, end exclusive) and are
   * placed in the user's timezone, so `start`/`end` are ignored for these blocks.
   */
  allDay?: { startDate: string; endDate: string };
  /** Account or feed the block came from, for diagnostics. */
  source?: string;
}

/**
 * Availability for every slot of a poll, one character per slot in `TimeOfSlot` order:
 * `'1'` available, `'0'` not available, `'?'` unknown (keep whatever When2meet already has).
 */
export type Bits = string;

export type BitChar = '0' | '1';

/** Slot timestamp (as a string key) → bit. Keyed by time so records survive slots being added. */
export type BitMap = Record<string, BitChar>;
