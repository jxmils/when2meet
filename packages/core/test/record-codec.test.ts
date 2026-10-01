import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { FillRecord } from '../src/overrides.ts';
import {
  decodeSlotRuns,
  encodeSlotRuns,
  packFillRecord,
  unpackFillRecord,
} from '../src/record-codec.ts';
import type { BitMap } from '../src/types.ts';

const ascending = fc
  .uniqueArray(fc.integer({ min: 1_700_000_000, max: 1_900_000_000 }), { maxLength: 60 })
  .map((a) => a.sort((x, y) => x - y));

describe('slot runs', () => {
  it('round-trips any ascending list', () => {
    fc.assert(
      fc.property(ascending, (slots) => {
        expect(decodeSlotRuns(encodeSlotRuns(slots))).toEqual(slots);
      }),
    );
  });

  it('turns each day of a poll into one run', () => {
    const day = (start: number) => Array.from({ length: 32 }, (_, i) => start + i * 900);
    const slots = [...day(1_791_190_800), ...day(1_791_277_200)];
    expect(encodeSlotRuns(slots)).toEqual([
      [1_791_190_800, 900, 32],
      [1_791_277_200, 900, 32],
    ]);
    expect(encodeSlotRuns([5])).toEqual([[5, 0, 1]]);
    expect(encodeSlotRuns([])).toEqual([]);
  });
});

describe('packFillRecord', () => {
  const bitMap = (keys: number[]) =>
    fc
      .array(fc.constantFrom('0', '1', undefined), {
        minLength: keys.length,
        maxLength: keys.length,
      })
      .map((bits) => {
        const map: BitMap = {};
        keys.forEach((k, i) => {
          const bit = bits[i];
          if (bit) map[String(k)] = bit as '0' | '1';
        });
        return map;
      });

  it('round-trips records', () => {
    fc.assert(
      fc.property(
        ascending.chain((keys) =>
          fc.tuple(fc.constant(keys), bitMap(keys), bitMap(keys), bitMap(keys), bitMap(keys)),
        ),
        ([, applied, calendar, overrides, previous]) => {
          const record: FillRecord = {
            v: 1,
            eventId: 7,
            personId: 9,
            applied,
            calendar,
            overrides,
            previous,
            mode: 'add',
            rulesHash: 'r',
            sourcesHash: 's',
            weekStart: '2026-10-04',
            timeZone: 'Europe/London',
            savedAt: 1,
            expiresAt: 2,
          };
          expect(unpackFillRecord(JSON.parse(JSON.stringify(packFillRecord(record))))).toEqual(
            record,
          );
        },
      ),
    );
  });

  it('still reads the original format and ignores junk', () => {
    const legacy = { v: 1, eventId: 1, personId: 2, applied: { '100': '1' } };
    expect(unpackFillRecord(legacy)).toBe(legacy);
    expect(unpackFillRecord(null)).toBeNull();
    expect(unpackFillRecord({ v: 3 })).toBeNull();
    expect(unpackFillRecord('nope')).toBeNull();
  });
});
