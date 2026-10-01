import type { UnixSec } from '@w2msync/core';

/** Identifies a poll: `https://www.when2meet.com/?<id>-<code>`. */
export interface EventRef {
  id: number;
  code: string;
}

export interface Person {
  id: number;
  name: string;
}

/** One cell of the personal ("Your Availability") grid. */
export interface Cell {
  slot: UnixSec;
  col: number;
  row: number;
}

export interface Poll {
  ref: EventRef | null;
  name: string;
  /** `TimeOfSlot`: slot start times in grid order. */
  slots: UnixSec[];
  /** `AvailableAtSlot`: ids of the people available in each slot. */
  availableAt: number[][];
  people: Person[];
  /** Personal-grid cells, when the page includes them. */
  cells: Cell[];
  /** Timezone the page states (creator's zone in raw HTML, viewer's zone in a live page). */
  timeZone: string | null;
}

export interface PageState extends Poll {
  /** Person signed in on this page; 0 when nobody is. */
  userId: number;
}
