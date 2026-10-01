import { describe, expect, it } from 'vitest';
import {
  buildIcs,
  buildVTimezone,
  escapeText,
  foldLine,
  formatOffset,
  zoneTransitions,
} from '../src/ics-export.ts';
import { googleCalendarUrl, outlookCalendarUrl } from '../src/links.ts';

const event = {
  title: 'Project sync, round 2',
  start: Date.parse('2026-10-05T13:00:00Z'),
  end: Date.parse('2026-10-05T14:00:00Z'),
  description: 'Picked on When2meet',
};

describe('calendar links', () => {
  it('builds a Google Calendar template link', () => {
    const url = new URL(googleCalendarUrl(event));
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('text')).toBe('Project sync, round 2');
    expect(url.searchParams.get('dates')).toBe('20261005T130000Z/20261005T140000Z');
    expect(url.searchParams.has('recur')).toBe(false);
  });

  it('repeats weekly in local time for weekday polls', () => {
    const url = new URL(googleCalendarUrl({ ...event, weeklyTimeZone: 'America/New_York' }));
    expect(url.searchParams.get('dates')).toBe('20261005T090000/20261005T100000');
    expect(url.searchParams.get('ctz')).toBe('America/New_York');
    expect(url.searchParams.get('recur')).toBe('RRULE:FREQ=WEEKLY');
  });

  it('builds Outlook links for work and personal accounts', () => {
    const work = new URL(outlookCalendarUrl(event));
    expect(work.host).toBe('outlook.office.com');
    expect(work.searchParams.get('startdt')).toBe('2026-10-05T13:00:00Z');
    expect(work.searchParams.get('subject')).toBe('Project sync, round 2');
    expect(new URL(outlookCalendarUrl(event, 'personal')).host).toBe('outlook.live.com');
  });
});

describe('ics export', () => {
  it('writes a valid single event with CRLF line endings', () => {
    const ics = buildIcs({ ...event, uid: 'abc@test', now: Date.parse('2026-10-01T00:00:00Z') });
    expect(ics.endsWith('\r\n')).toBe(true);
    const lines = ics.split('\r\n');
    expect(lines).toContain('DTSTART:20261005T130000Z');
    expect(lines).toContain('DTEND:20261005T140000Z');
    expect(lines).toContain('SUMMARY:Project sync\\, round 2');
    expect(lines).toContain('DTSTAMP:20261001T000000Z');
    expect(ics).not.toContain('VTIMEZONE');
  });

  it('adds a VTIMEZONE and RRULE for weekly events', () => {
    const ics = buildIcs({
      ...event,
      uid: 'abc@test',
      now: 0,
      weeklyTimeZone: 'America/New_York',
    });
    expect(ics).toContain('DTSTART;TZID=America/New_York:20261005T090000');
    expect(ics).toContain('RRULE:FREQ=WEEKLY');
    expect(ics).toContain('BEGIN:VTIMEZONE');
  });

  it('finds DST transitions', () => {
    expect(
      zoneTransitions('America/New_York', 2026, 2026).map((t) => [
        new Date(t.at).toISOString(),
        t.before / 3_600_000,
        t.after / 3_600_000,
      ]),
    ).toEqual([
      ['2026-03-08T07:00:00.000Z', -5, -4],
      ['2026-11-01T06:00:00.000Z', -4, -5],
    ]);
    expect(zoneTransitions('Asia/Kathmandu', 2026, 2027)).toEqual([]);
  });

  it('writes observances at local transition times', () => {
    const vtz = buildVTimezone('America/New_York', 2026, 2026).join('\n');
    expect(vtz).toContain(
      'BEGIN:DAYLIGHT\nDTSTART:20260308T020000\nTZOFFSETFROM:-0500\nTZOFFSETTO:-0400\nEND:DAYLIGHT',
    );
    expect(vtz).toContain(
      'BEGIN:STANDARD\nDTSTART:20261101T020000\nTZOFFSETFROM:-0400\nTZOFFSETTO:-0500\nEND:STANDARD',
    );
  });

  it('formats offsets', () => {
    expect(formatOffset(-5 * 3_600_000)).toBe('-0500');
    expect(formatOffset(5.75 * 3_600_000)).toBe('+0545');
    expect(formatOffset(0)).toBe('+0000');
  });

  it('escapes and folds text', () => {
    expect(escapeText('a;b,c\\d\ne')).toBe('a\\;b\\,c\\\\d\\ne');
    const folded = foldLine(`DESCRIPTION:${'é'.repeat(60)}`);
    for (const line of folded.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(folded.split('\r\n ').join('')).toBe(`DESCRIPTION:${'é'.repeat(60)}`);
  });
});
