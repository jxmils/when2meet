import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type FillRecord, planFill, recordFill, undoTarget } from '../src/overrides.ts';

const slots = [100, 200, 300, 400, 500, 600];

function record(server: string, calendar: string, mode?: 'replace' | 'add'): FillRecord {
  const plan = planFill({ slots, server, calendar, ...(mode ? { mode } : {}) });
  return recordFill({
    eventId: 1,
    personId: 2,
    slots,
    plan,
    calendar,
    verified: plan.target,
    previous: server,
    rulesHash: 'r1',
    sourcesHash: 's1',
    now: 0,
    expiresAt: 0,
  });
}

describe('first fill', () => {
  it('replaces when nothing is marked yet', () => {
    const plan = planFill({ slots, server: '000000', calendar: '1100?1' });
    expect(plan).toMatchObject({ kind: 'first', mode: 'replace', target: '110001' });
    expect(plan.changes.map((c) => [c.index, c.to, c.reason])).toEqual([
      [0, '1', 'fill'],
      [1, '1', 'fill'],
      [5, '1', 'fill'],
    ]);
  });

  it('adds by default when slots are already marked, keeping them as overrides', () => {
    const plan = planFill({ slots, server: '001100', calendar: '110000' });
    expect(plan).toMatchObject({ mode: 'add', target: '111100', conflicts: [2, 3] });
    expect(plan.overrides).toEqual({ '300': '1', '400': '1' });
  });

  it('replaces on request even when slots are marked', () => {
    const plan = planFill({ slots, server: '001100', calendar: '110000', mode: 'replace' });
    expect(plan.target).toBe('110000');
    expect(plan.conflicts).toEqual([]);
  });
});

describe('revisit', () => {
  it('reports nothing when neither the calendar nor the poll changed', () => {
    const r = record('000000', '110011');
    expect(planFill({ slots, server: '110011', calendar: '110011', record: r }).changes).toEqual(
      [],
    );
  });

  it('applies calendar changes and keeps manual edits', () => {
    const r = record('000000', '110011');
    // The user marked slot 2 by hand; the calendar now frees slot 3 and blocks slot 0.
    const plan = planFill({ slots, server: '111011', calendar: '010111', record: r });
    expect(plan.kind).toBe('revisit');
    expect(plan.target).toBe('011111');
    expect(plan.overrides).toEqual({ '300': '1' });
    expect(plan.changes.map((c) => [c.index, c.to, c.reason])).toEqual([
      [0, '0', 'calendar'],
      [3, '1', 'calendar'],
    ]);
  });

  it('labels changes caused by new settings and new slots', () => {
    const r = record('000000', '110011');
    const settings = planFill({
      slots,
      server: '110011',
      calendar: '110010',
      record: { ...r, calendar: { ...r.calendar, '600': '0' } },
      rulesHash: 'r2',
    });
    expect(settings.changes.map((c) => c.reason)).toEqual(['settings']);

    const moreSlots = [...slots, 700];
    const added = planFill({ slots: moreSlots, server: '1100110', calendar: '1100111', record: r });
    expect(added.changes.map((c) => [c.slot, c.reason])).toEqual([[700, 'new-slot']]);
  });

  it('can reset overrides to follow the calendar exactly', () => {
    const r = record('000000', '110011');
    const plan = planFill({
      slots,
      server: '111011',
      calendar: '110011',
      record: r,
      resetOverrides: true,
    });
    expect(plan.target).toBe('110011');
    expect(plan.overrides).toEqual({});
  });

  it('keeps add-mode conflicts on later visits', () => {
    const r = record('001100', '110000');
    const plan = planFill({ slots, server: '111100', calendar: '100000', record: r });
    expect(plan.target).toBe('101100');
  });
});

describe('undo', () => {
  it('targets the state before the last fill', () => {
    const r = record('001100', '110000', 'replace');
    expect(undoTarget(slots, '110000', r)).toBe('001100');
  });
});

const bit = fc.constantFrom('0', '1');
const bitOrUnknown = fc.constantFrom('0', '1', '?');
const bitsOf = (arb: fc.Arbitrary<string>) =>
  fc.array(arb, { minLength: 6, maxLength: 6 }).map((a) => a.join(''));

describe('properties', () => {
  it('first fill never touches unknown slots and replace mode follows the calendar', () => {
    fc.assert(
      fc.property(bitsOf(bit), bitsOf(bitOrUnknown), (server, calendar) => {
        const plan = planFill({ slots, server, calendar, mode: 'replace' });
        for (let i = 0; i < slots.length; i++) {
          expect(plan.target[i]).toBe(calendar[i] === '?' ? server[i] : calendar[i]);
        }
      }),
    );
  });

  it('is idempotent: planning again right after a save changes nothing', () => {
    fc.assert(
      fc.property(bitsOf(bit), bitsOf(bitOrUnknown), (server, calendar) => {
        const r = record(server, calendar);
        const target = planFill({ slots, server, calendar }).target;
        expect(planFill({ slots, server: target, calendar, record: r }).changes).toEqual([]);
      }),
    );
  });

  it('never overrides a manual edit with the calendar', () => {
    fc.assert(
      fc.property(
        bitsOf(bit),
        bitsOf(bitOrUnknown),
        bitsOf(bit),
        bitsOf(bitOrUnknown),
        (server, calendar, edited, newCalendar) => {
          const r = record(server, calendar);
          const plan = planFill({ slots, server: edited, calendar: newCalendar, record: r });
          slots.forEach((slot, i) => {
            if (edited[i] !== r.applied[String(slot)]) expect(plan.target[i]).toBe(edited[i]);
          });
        },
      ),
    );
  });
});
