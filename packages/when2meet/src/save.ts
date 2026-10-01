import { type Bits, diffBits, resolveUnknown, type UnixSec } from '@w2msync/core';
import type { Cell } from './types.ts';

/** One `SaveTimes.php` request, in the shape When2meet's own page sends. */
export interface SaveTimesRequest {
  slots: UnixSec[];
  /** Full availability string for every slot, as it should be after this request. */
  availability: Bits;
  changeToAvailable: boolean;
}

export interface SaveContext {
  personId: number;
  eventId: number;
  /** The participant's When2meet password for this poll ('' if none). */
  password: string;
}

/**
 * At most two requests that take the server from `baseline` to `target`: first the slots that
 * become available, then the ones that become unavailable. Each carries the full availability
 * string for the state after it, so the result is right whether When2meet applies the
 * `availability` string or the `slots` + `ChangeToAvailable` pair.
 */
export function buildDirectRequests(
  slots: readonly UnixSec[],
  baseline: Bits,
  target: Bits,
): SaveTimesRequest[] {
  const resolved = resolveUnknown(target, baseline);
  const { toAvailable, toUnavailable } = diffBits(baseline, resolved);
  const requests: SaveTimesRequest[] = [];
  if (toAvailable.length > 0) {
    const intermediate = [...baseline];
    for (const i of toAvailable) intermediate[i] = '1';
    requests.push({
      slots: toAvailable.map((i) => slots[i] as UnixSec),
      availability: intermediate.join(''),
      changeToAvailable: true,
    });
  }
  if (toUnavailable.length > 0) {
    requests.push({
      slots: toUnavailable.map((i) => slots[i] as UnixSec),
      availability: resolved,
      changeToAvailable: false,
    });
  }
  return requests;
}

/** Form body for `SaveTimes.php`, fields in the order When2meet's page sends them. */
export function encodeSaveTimes(request: SaveTimesRequest, context: SaveContext): URLSearchParams {
  const params = new URLSearchParams();
  params.append('person', String(context.personId));
  params.append('event', String(context.eventId));
  params.append('slots', request.slots.join(','));
  params.append('availability', request.availability);
  params.append('password', context.password);
  params.append('ChangeToAvailable', String(request.changeToAvailable));
  return params;
}

/** A vertical drag within one grid column, replayed through the page's own handler. */
export interface DriveRun {
  col: number;
  fromRow: number;
  toRow: number;
  toAvailable: boolean;
  slots: UnixSec[];
}

/**
 * Groups the cells that must change into vertical runs per column. A run only spans cells that
 * should all end with the same value, so cells that already have it are safe to include.
 * Slots that need a change but have no cell on the page are returned as `unreachable`.
 */
export function planDriveRuns(
  slots: readonly UnixSec[],
  cells: readonly Cell[],
  current: Bits,
  target: Bits,
): { runs: DriveRun[]; unreachable: UnixSec[] } {
  const desired = resolveUnknown(target, current);
  const indexOf = new Map(slots.map((ts, i) => [ts, i]));
  const hasCell = new Set<number>();
  const byColumn = new Map<number, { row: number; index: number; slot: UnixSec }[]>();
  for (const cell of cells) {
    const index = indexOf.get(cell.slot);
    if (index === undefined) continue;
    hasCell.add(index);
    const list = byColumn.get(cell.col) ?? [];
    list.push({ row: cell.row, index, slot: cell.slot });
    byColumn.set(cell.col, list);
  }

  const unreachable = slots.filter((_, i) => desired[i] !== current[i] && !hasCell.has(i));
  const runs: DriveRun[] = [];
  for (const [col, list] of [...byColumn].sort((a, b) => a[0] - b[0])) {
    list.sort((a, b) => a.row - b.row);
    let group: typeof list = [];
    const flush = () => {
      const changed = group.filter((c) => desired[c.index] !== current[c.index]);
      const first = changed[0];
      const last = changed[changed.length - 1];
      if (first && last) {
        const span = group.slice(group.indexOf(first), group.indexOf(last) + 1);
        runs.push({
          col,
          fromRow: first.row,
          toRow: last.row,
          toAvailable: desired[first.index] === '1',
          slots: span.map((c) => c.slot),
        });
      }
      group = [];
    };
    for (const cell of list) {
      const previous = group[group.length - 1];
      if (previous && desired[previous.index] !== desired[cell.index]) flush();
      group.push(cell);
    }
    flush();
  }
  return { runs, unreachable };
}

/** What `executeSave` needs from the environment (the live page, or a test double). */
export interface SaveDriver {
  /** This person's availability as the server has it right now (fresh, uncached GET). */
  serverBits(): Promise<Bits>;
  postSaveTimes(params: URLSearchParams): Promise<{ ok: boolean; status: number }>;
  /** Personal-grid cells currently on the page. */
  cells(): Cell[];
  /** Replays one drag through the page's handler; resolves once its request has finished. */
  driveRun(run: DriveRun): Promise<void>;
  /** Makes the page's in-memory state match `bits`; true if the grid was redrawn too. */
  resync(bits: Bits): Promise<boolean>;
}

export type SaveStrategy = 'auto' | 'direct' | 'drive';

export interface SaveOptions extends SaveContext {
  slots: readonly UnixSec[];
  /** Desired availability (`?` = leave as is). */
  target: Bits;
  /** Server state the preview was based on. If the server changed since, nothing is saved. */
  expectedBaseline?: Bits;
  strategy?: SaveStrategy;
}

export type SaveOutcome =
  | {
      status: 'saved';
      via: 'direct' | 'drive' | 'none';
      baseline: Bits;
      verified: Bits;
      unreachable: UnixSec[];
      pageUpdated: boolean;
    }
  | {
      status: 'partial';
      via: 'drive';
      baseline: Bits;
      verified: Bits;
      unreachable: UnixSec[];
      mismatched: UnixSec[];
      pageUpdated: boolean;
    }
  | { status: 'stale'; baseline: Bits }
  | { status: 'failed'; baseline: Bits; verified?: Bits; error: string };

/**
 * Saves `target` and checks the result against the server. Tries at most two direct requests
 * first (unless `strategy` is `drive`), then falls back to replaying drags through the page's
 * own handler, which is how a person would do it.
 */
export async function executeSave(driver: SaveDriver, options: SaveOptions): Promise<SaveOutcome> {
  const { slots, strategy = 'auto' } = options;
  const baseline = await driver.serverBits();
  if (options.expectedBaseline !== undefined && options.expectedBaseline !== baseline) {
    return { status: 'stale', baseline };
  }
  const target = resolveUnknown(options.target, baseline);
  if (target === baseline) {
    const pageUpdated = await driver.resync(baseline);
    return {
      status: 'saved',
      via: 'none',
      baseline,
      verified: baseline,
      unreachable: [],
      pageUpdated,
    };
  }

  if (strategy !== 'drive') {
    let accepted = true;
    for (const request of buildDirectRequests(slots, baseline, target)) {
      const response = await driver.postSaveTimes(encodeSaveTimes(request, options));
      if (!response.ok) {
        accepted = false;
        break;
      }
    }
    const verified = await driver.serverBits();
    if (accepted && verified === target) {
      const pageUpdated = await driver.resync(verified);
      return { status: 'saved', via: 'direct', baseline, verified, unreachable: [], pageUpdated };
    }
    if (strategy === 'direct') {
      await driver.resync(verified);
      return {
        status: 'failed',
        baseline,
        verified,
        error: accepted ? 'When2meet did not keep the change.' : 'When2meet rejected the save.',
      };
    }
  }

  // When2meet's own SelectStop() builds the availability string from the grid cells on the page.
  // With cells missing (some timezone views), that string is shorter than the slot list and the
  // server would misread it, so never replay drags on an incomplete grid.
  const cells = driver.cells();
  if (cells.length < slots.length) {
    const verified = await driver.serverBits();
    await driver.resync(verified);
    return {
      status: 'failed',
      baseline,
      verified,
      error:
        "When2meet didn't keep the change, and this timezone view hides part of the grid. Switch the poll's timezone at the top of the page and try again.",
    };
  }

  // Replay drags from the server's current state, so the page sends correct full strings.
  const current = await driver.serverBits();
  await driver.resync(current);
  const { runs, unreachable } = planDriveRuns(slots, cells, current, target);
  for (const run of runs) await driver.driveRun(run);
  const verified = await driver.serverBits();
  const skip = new Set(unreachable);
  const mismatched = slots.filter((ts, i) => verified[i] !== target[i] && !skip.has(ts));
  const pageUpdated = await driver.resync(verified);
  if (mismatched.length === 0) {
    return { status: 'saved', via: 'drive', baseline, verified, unreachable, pageUpdated };
  }
  return {
    status: 'partial',
    via: 'drive',
    baseline,
    verified,
    unreachable,
    mismatched,
    pageUpdated,
  };
}
