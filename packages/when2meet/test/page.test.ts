// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { createPageDriver, type PageWindow, readCells, readPageState } from '../src/page.ts';
import { makeDatesPoll, renderEventPage } from '../src/testing/index.ts';

const poll = makeDatesPoll({
  id: 42,
  code: 'abc',
  name: 'Lab meeting',
  startDate: '2026-10-05',
  days: 2,
  from: '09:00',
  to: '10:00',
  timeZone: 'UTC',
});
poll.people = [{ id: 7, name: 'Alice &amp; Bob' }];
poll.availability.set(7, new Set([poll.slots[0] as number]));

const win = window as unknown as PageWindow;

beforeEach(() => {
  document.body.innerHTML = `
    <div id="NewEventNameDiv">Lab meeting<br>details</div>
    <div id="YouGridSlots">
      ${poll.slots
        .map(
          (ts, i) =>
            `<div id="YouTime${ts}" data-col="${Math.floor(i / 4)}" data-row="${i % 4}" data-time="${ts}"></div>`,
        )
        .join('')}
      <div class="blank"></div>
    </div>`;
  Object.assign(win, {
    TimeOfSlot: [...poll.slots],
    AvailableAtSlot: poll.slots.map((ts) => (ts === poll.slots[0] ? [7] : [])),
    PeopleNames: ['Alice &amp; Bob'],
    PeopleIDs: [7],
    UserID: 7,
  });
  history.replaceState(null, '', '/?42-abc');
});

describe('readPageState', () => {
  it('reads the page globals and grid', () => {
    const state = readPageState(win);
    expect(state).toMatchObject({
      ref: { id: 42, code: 'abc' },
      name: 'Lab meeting',
      slots: poll.slots,
      people: [{ id: 7, name: 'Alice & Bob' }],
      userId: 7,
    });
    expect(state?.cells).toHaveLength(8);
    expect(readCells(document)[5]).toEqual({ slot: poll.slots[5], col: 1, row: 1 });
  });

  it('returns null on pages without a grid', () => {
    Object.assign(win, { TimeOfSlot: undefined });
    expect(readPageState(win)).toBeNull();
  });
});

describe('createPageDriver', () => {
  it('reads the server state with a fresh request and checks the slots match', async () => {
    const requests: string[] = [];
    win.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(`${String(input)} ${init?.cache}`);
      return new Response(renderEventPage(poll));
    }) as typeof fetch;
    const driver = createPageDriver(win, 7);
    expect(await driver.serverBits()).toBe('10000000');
    expect(requests).toEqual(['/?42-abc no-store']);

    win.TimeOfSlot = poll.slots.slice(1);
    await expect(driver.serverBits()).rejects.toThrow(/changed on When2meet/);
  });

  it('resyncs the page state and redraws when it can', async () => {
    let redraws = 0;
    Object.assign(win, { ReColorIndividual: () => redraws++, ReColorGroup: () => {} });
    const driver = createPageDriver(win, 7);
    expect(await driver.resync('01100000')).toBe(true);
    expect(win.AvailableAtSlot?.slice(0, 3)).toEqual([[], [7], [7]]);
    expect(redraws).toBe(1);
  });

  it('replays a drag through SelectStop and waits for its request', async () => {
    const seen: unknown[] = [];
    win.fetch = (async () => new Response('ok')) as typeof fetch;
    win.SelectStop = () => {
      seen.push([
        win.IsMouseDown,
        win.ChangeToAvailable,
        win.FromCol,
        win.ToCol,
        win.FromRow,
        win.ToRow,
      ]);
      void win.fetch('SaveTimes.php', { method: 'POST', body: 'x' });
    };
    const driver = createPageDriver(win, 7);
    await driver.driveRun({ col: 1, fromRow: 0, toRow: 2, toAvailable: true, slots: [] });
    expect(seen).toEqual([[true, true, 1, 1, 0, 2]]);
  });
});
