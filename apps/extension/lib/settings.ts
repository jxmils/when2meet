import { DEFAULT_RULES, type Rules, type WeekMatch } from '@w2msync/core';
import { browser } from 'wxt/browser';

export interface Settings {
  v: 1;
  /** Name to sign in to polls with. */
  displayName: string;
  /** IANA timezone for working hours and weekday polls; '' = the browser's. */
  timeZone: string;
  /** Which real week a days-of-the-week poll is read from by default. */
  weekdayPollWeek: 'this' | 'next';
  /** How many consecutive weeks a days-of-the-week poll is checked against (e.g. a term). */
  weekdayPollWeeks: number;
  /** With several weeks: free only if free every week (`all`), or in most weeks. */
  weekdayPollMatch: WeekMatch;
  rules: Rules;
  /** Save straight away instead of showing a preview first. */
  skipPreview: boolean;
  /** When reopening a poll you filled, check whether your calendar changed. */
  checkOnOpen: boolean;
  /** Meeting length used for "best times". */
  meetingMinutes: number;
  /** Personal Outlook accounts open outlook.live.com, work/school ones outlook.office.com. */
  outlookAccount: 'work' | 'personal';
  onboarded: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  v: 1,
  displayName: '',
  timeZone: '',
  weekdayPollWeek: 'next',
  weekdayPollWeeks: 1,
  weekdayPollMatch: 'all',
  rules: DEFAULT_RULES,
  skipPreview: false,
  checkOnOpen: true,
  meetingMinutes: 60,
  outlookAccount: 'work',
  onboarded: false,
};

const KEY = 'settings';

export function mergeSettings(stored: Partial<Settings> | undefined): Settings {
  const s = stored ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    rules: {
      ...DEFAULT_RULES,
      ...s.rules,
      treat: { ...DEFAULT_RULES.treat, ...s.rules?.treat },
    },
  };
}

export async function loadSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(KEY);
  return mergeSettings(stored[KEY] as Partial<Settings> | undefined);
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = mergeSettings({ ...(await loadSettings()), ...patch });
  await browser.storage.local.set({ [KEY]: next });
  return next;
}
