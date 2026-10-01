import { describe, expect, it } from 'vitest';
import { decodeEntities, decodeName, NotAPollError, parseEventHtml } from '../src/parse.ts';
import {
  makeDatesPoll,
  makeWeekdayPoll,
  renderEventPage,
  type SyntheticPoll,
} from '../src/testing/index.ts';

function withPeople(poll: SyntheticPoll): SyntheticPoll {
  poll.people = [
    { id: 101, name: 'Alice' },
    { id: 102, name: `Chris "CJ" O'Neil & Co <3` },
  ];
  poll.availability.set(101, new Set(poll.slots.slice(0, 3)));
  poll.availability.set(102, new Set([poll.slots[1] as number]));
  return poll;
}

describe('parseEventHtml', () => {
  const poll = withPeople(
    makeDatesPoll({
      id: 11591331,
      code: 'ySlfG',
      name: 'Team sync & planning',
      startDate: '2026-10-05',
      days: 3,
      from: '09:00',
      to: '17:00',
      timeZone: 'Europe/Vienna',
    }),
  );

  it('reads slots, people and availability', () => {
    const parsed = parseEventHtml(renderEventPage(poll));
    expect(parsed.slots).toEqual(poll.slots);
    expect(parsed.slots).toHaveLength(3 * 32);
    expect(parsed.people).toEqual([
      { id: 101, name: 'Alice' },
      { id: 102, name: `Chris "CJ" O'Neil & Co <3` },
    ]);
    expect(parsed.availableAt.slice(0, 4)).toEqual([[101], [101, 102], [101], []]);
    expect(parsed.name).toBe('Team sync & planning');
    expect(parsed.timeZone).toBe('Europe/Vienna');
    expect(parsed.ref).toEqual({ id: 11591331, code: 'ySlfG' });
  });

  it('reads the personal grid cells', () => {
    const parsed = parseEventHtml(renderEventPage(poll));
    expect(parsed.cells).toHaveLength(poll.slots.length);
    expect(parsed.cells.find((c) => c.slot === poll.slots[33])).toEqual({
      slot: poll.slots[33],
      col: 1,
      row: 1,
    });
  });

  it('skips cells the page leaves blank', () => {
    const hidden = new Set(poll.slots.slice(0, 5));
    const parsed = parseEventHtml(renderEventPage(poll, { hideCells: hidden }));
    expect(parsed.cells).toHaveLength(poll.slots.length - 5);
  });

  it('lays out a shifted timezone view with blank cells', () => {
    const parsed = parseEventHtml(renderEventPage(poll, { viewerTimeZone: 'Asia/Tokyo' }));
    // 09:00–17:00 Vienna is 16:00–24:00 Tokyo: still one column per day, rows by Tokyo time.
    expect(new Set(parsed.cells.map((c) => c.col)).size).toBe(3);
    expect(parsed.cells).toHaveLength(poll.slots.length);
  });

  it('reads days-of-the-week polls', () => {
    const weekly = makeWeekdayPoll({
      id: 24892637,
      code: 'Evxyx',
      name: 'Weekly',
      days: [1, 2, 3, 4, 5],
      from: '09:00',
      to: '17:00',
    });
    const parsed = parseEventHtml(renderEventPage(weekly));
    expect(parsed.slots[0]).toBe(279_795_600);
    expect(parsed.slots).toHaveLength(160);
    expect(parsed.people).toEqual([]);
  });

  it('uses the reference passed in', () => {
    const parsed = parseEventHtml(renderEventPage(poll), { id: 1, code: 'abc' });
    expect(parsed.ref).toEqual({ id: 1, code: 'abc' });
  });

  it('rejects pages without a grid', () => {
    expect(() => parseEventHtml('<html><body>Create a new event</body></html>')).toThrow(
      NotAPollError,
    );
  });
});

describe('decoding', () => {
  it('decodes HTML entities', () => {
    expect(decodeEntities('a &amp; b &quot;c&quot; &#39;d&#39; &#x263A; &bogus;')).toBe(
      `a & b "c" 'd' ☺ &bogus;`,
    );
  });

  it('decodes names as written in page source', () => {
    expect(decodeName('Christopher \\&quot;1480c1\\&quot; Degawa')).toBe(
      'Christopher "1480c1" Degawa',
    );
    expect(decodeName("O\\'Neil")).toBe("O'Neil");
  });
});
