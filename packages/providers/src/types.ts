import type { BusyBlock } from '@w2msync/core';

export type ProviderId = 'google' | 'microsoft' | 'ics';

export interface CalendarInfo {
  id: string;
  name: string;
  primary: boolean;
  color?: string;
}

export interface CalendarError {
  calendar: string;
  reason: string;
}

export interface BusyResult {
  blocks: BusyBlock[];
  /** Calendars that could not be read; the caller decides whether to continue without them. */
  errors: CalendarError[];
}
