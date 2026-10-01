import { describe, expect, it } from 'vitest';
import { findBestWindows } from '../src/besttimes.ts';

const day1 = [0, 900, 1800, 2700];
const day2 = [86_400, 87_300, 88_200, 89_100];
const slots = [...day1, ...day2];
const people = [1, 2, 3];

describe('findBestWindows', () => {
  it('ranks windows by how many people are free for all of it', () => {
    const availableAt = [[1], [1, 2], [1, 2, 3], [1, 2, 3], [3], [2, 3], [2, 3], []];
    const windows = findBestWindows({ slots, availableAt, people, durationMin: 30, limit: 3 });
    expect(windows.map((w) => [w.start, w.end, w.available, w.missing])).toEqual([
      [1800, 3600, [1, 2, 3], []],
      [87_300, 89_100, [2, 3], [1]],
      [0, 1800, [1], [2, 3]],
    ]);
  });

  it('never spans the gap between days or overlaps another window', () => {
    const availableAt = [[], [], [], [1], [1], [], [], []];
    const windows = findBestWindows({ slots, availableAt, people, durationMin: 30 });
    expect(windows).toEqual([]);
  });

  it('skips windows nobody can make', () => {
    const availableAt = slots.map(() => [] as number[]);
    expect(findBestWindows({ slots, availableAt, people, durationMin: 15 })).toEqual([]);
  });
});
