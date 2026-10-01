import { describe, expect, it } from 'vitest';
import {
  buildDirectRequests,
  type DriveRun,
  encodeSaveTimes,
  executeSave,
  planDriveRuns,
  type SaveDriver,
} from '../src/save.ts';
import type { Cell } from '../src/types.ts';

const slots = [100, 200, 300, 400, 500, 600, 700, 800];
// Two columns of four rows.
const cells: Cell[] = slots.map((slot, i) => ({ slot, col: Math.floor(i / 4), row: i % 4 }));

describe('buildDirectRequests', () => {
  it('sends additions first with the intermediate state, then removals with the final state', () => {
    expect(buildDirectRequests(slots, '11000000', '01110000')).toEqual([
      { slots: [300, 400], availability: '11110000', changeToAvailable: true },
      { slots: [100], availability: '01110000', changeToAvailable: false },
    ]);
  });

  it('leaves unknown slots alone and skips empty requests', () => {
    expect(buildDirectRequests(slots, '10000000', '1?100000')).toEqual([
      { slots: [300], availability: '10100000', changeToAvailable: true },
    ]);
    expect(buildDirectRequests(slots, '10000000', '1???????')).toEqual([]);
  });

  it('encodes fields in the order the page sends them', () => {
    const body = encodeSaveTimes(
      { slots: [300, 400], availability: '0011', changeToAvailable: true },
      { personId: 7, eventId: 99, password: '' },
    );
    expect(body.toString()).toBe(
      'person=7&event=99&slots=300%2C400&availability=0011&password=&ChangeToAvailable=true',
    );
  });
});

describe('planDriveRuns', () => {
  it('groups changes into vertical runs per column', () => {
    const { runs, unreachable } = planDriveRuns(slots, cells, '00000000', '01101111');
    expect(runs.map((r) => [r.col, r.fromRow, r.toRow, r.toAvailable])).toEqual([
      [0, 1, 2, true],
      [1, 0, 3, true],
    ]);
    expect(unreachable).toEqual([]);
  });

  it('splits runs where the desired value changes and trims unchanged ends', () => {
    const { runs } = planDriveRuns(slots, cells, '01010000', '10110000');
    expect(runs.map((r) => [r.col, r.fromRow, r.toRow, r.toAvailable])).toEqual([
      [0, 0, 0, true],
      [0, 1, 1, false],
      [0, 2, 2, true],
    ]);
  });

  it('spans cells that already have the desired value', () => {
    const { runs } = planDriveRuns(slots, cells, '01000000', '11100000');
    expect(runs).toEqual([
      { col: 0, fromRow: 0, toRow: 2, toAvailable: true, slots: [100, 200, 300] },
    ]);
  });

  it('reports slots without cells as unreachable', () => {
    const { runs, unreachable } = planDriveRuns(slots, cells.slice(1), '00000000', '11000000');
    expect(unreachable).toEqual([100]);
    expect(runs.map((r) => r.slots)).toEqual([[200]]);
  });
});

type Semantics = 'availability' | 'slots';

/** A fake page + server. `ignoreDirect` drops hand-built requests but keeps page-driven ones. */
function fakeEnvironment(
  initial: string,
  semantics: Semantics,
  ignoreDirect = false,
  layout = cells,
) {
  let server = initial;
  let local = initial;
  const log: { kind: 'direct' | 'drive'; body: string }[] = [];
  const apply = (params: URLSearchParams) => {
    if (semantics === 'availability') {
      server = params.get('availability') ?? server;
      return;
    }
    const changed = new Set((params.get('slots') ?? '').split(',').filter(Boolean).map(Number));
    const bit = params.get('ChangeToAvailable') === 'true' ? '1' : '0';
    server = [...server].map((ch, i) => (changed.has(slots[i] as number) ? bit : ch)).join('');
  };
  const driver: SaveDriver = {
    serverBits: async () => server,
    postSaveTimes: async (params) => {
      log.push({ kind: 'direct', body: params.toString() });
      if (!ignoreDirect) apply(params);
      return { ok: true, status: 200 };
    },
    cells: () => layout,
    driveRun: async (run: DriveRun) => {
      const next = [...local];
      const toggled: number[] = [];
      for (const c of layout) {
        if (c.col === run.col && c.row >= run.fromRow && c.row <= run.toRow) {
          next[slots.indexOf(c.slot)] = run.toAvailable ? '1' : '0';
          toggled.push(c.slot);
        }
      }
      local = next.join('');
      const params = encodeSaveTimes(
        { slots: toggled, availability: local, changeToAvailable: run.toAvailable },
        { personId: 1, eventId: 1, password: '' },
      );
      log.push({ kind: 'drive', body: params.toString() });
      apply(params);
    },
    resync: async (bits) => {
      local = bits;
      return true;
    },
  };
  return { driver, log, server: () => server };
}

const base = { slots, personId: 1, eventId: 1, password: '' };

describe('executeSave', () => {
  it.each(['availability', 'slots'] as const)(
    'saves directly in at most two requests (%s semantics)',
    async (semantics) => {
      const env = fakeEnvironment('11000000', semantics);
      const outcome = await executeSave(env.driver, { ...base, target: '01110011' });
      expect(outcome).toMatchObject({ status: 'saved', via: 'direct', verified: '01110011' });
      expect(env.log.map((l) => l.kind)).toEqual(['direct', 'direct']);
    },
  );

  it('falls back to driving the page when direct requests do not stick', async () => {
    const env = fakeEnvironment('11000000', 'availability', true);
    const outcome = await executeSave(env.driver, { ...base, target: '01110011' });
    expect(outcome).toMatchObject({ status: 'saved', via: 'drive', verified: '01110011' });
    expect(env.server()).toBe('01110011');
  });

  it('can be forced to drive or to go direct only', async () => {
    const drive = fakeEnvironment('00000000', 'slots');
    expect(
      await executeSave(drive.driver, { ...base, target: '11110000', strategy: 'drive' }),
    ).toMatchObject({
      status: 'saved',
      via: 'drive',
    });
    expect(drive.log.every((l) => l.kind === 'drive')).toBe(true);

    const direct = fakeEnvironment('00000000', 'slots', true);
    expect(
      await executeSave(direct.driver, { ...base, target: '11110000', strategy: 'direct' }),
    ).toMatchObject({ status: 'failed', error: 'When2meet did not keep the change.' });
  });

  it('does nothing when the server already matches', async () => {
    const env = fakeEnvironment('10100000', 'slots');
    const outcome = await executeSave(env.driver, { ...base, target: '1?1?????' });
    expect(outcome).toMatchObject({ status: 'saved', via: 'none' });
    expect(env.log).toEqual([]);
  });

  it('refuses to save over changes made since the preview', async () => {
    const env = fakeEnvironment('10000000', 'slots');
    const outcome = await executeSave(env.driver, {
      ...base,
      target: '11000000',
      expectedBaseline: '00000000',
    });
    expect(outcome).toEqual({ status: 'stale', baseline: '10000000' });
    expect(env.log).toEqual([]);
  });

  it('reports slots it cannot reach on the page', async () => {
    const env = fakeEnvironment('00000000', 'availability', true, cells.slice(1));
    const outcome = await executeSave(env.driver, { ...base, target: '11000000' });
    expect(outcome).toMatchObject({ status: 'saved', via: 'drive', unreachable: [100] });
    expect(env.server()).toBe('01000000');
  });
});
