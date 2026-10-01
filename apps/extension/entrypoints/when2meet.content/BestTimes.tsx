import {
  buildIcs,
  type CalendarEvent,
  detectPollKind,
  findBestWindows,
  googleCalendarUrl,
  mapSlots,
  outlookCalendarUrl,
} from '@w2msync/core';
import { type EventRef, eventUrl, type PageState } from '@w2msync/when2meet';
import { formatRange } from '../../lib/format.ts';

interface Props {
  poll: PageState;
  pollRef: EventRef;
  weekStart: string | null;
  timeZone: string;
  minutes: number;
  outlookAccount: 'work' | 'personal';
}

/** The group's best meeting windows, with links to add one to a calendar. */
export function BestTimes({ poll, pollRef, weekStart, timeZone, minutes, outlookAccount }: Props) {
  const people = poll.people.map((p) => p.id);
  if (people.length === 0) return <p class="muted">Nobody has responded yet.</p>;
  const weekly = detectPollKind(poll.slots) === 'weekdays';
  if (weekly && !weekStart) {
    return (
      <p class="muted">Fill from your calendar first to place this weekly poll on real dates.</p>
    );
  }
  const windows = findBestWindows({
    slots: poll.slots,
    availableAt: poll.availableAt,
    people,
    durationMin: minutes,
    limit: 3,
  });
  if (windows.length === 0) {
    return <p class="muted">No {minutes}-minute window works for anyone yet.</p>;
  }
  const mapped = mapSlots(
    poll.slots,
    weekly && weekStart ? { kind: 'weekdays', weekStart, timeZone } : { kind: 'dates' },
  );
  const nameOf = (id: number) => poll.people.find((p) => p.id === id)?.name ?? 'someone';
  const title = poll.name || 'Meeting';

  return (
    <>
      <p class="muted">
        Best {minutes}-minute windows ({people.length} {people.length === 1 ? 'person' : 'people'}{' '}
        responded):
      </p>
      <ul class="best">
        {windows.map((w) => {
          const start = mapped[w.startIndex]?.start;
          const end = mapped[w.endIndex - 1]?.end;
          if (start === undefined || end === undefined) return null;
          const event: CalendarEvent = {
            title,
            start,
            end,
            description: `Picked on When2meet: ${eventUrl(pollRef)}`,
            ...(weekly ? { weeklyTimeZone: timeZone } : {}),
          };
          return (
            <li key={w.startIndex}>
              <strong>{formatRange(start, end, timeZone, weekly)}</strong>
              <div class="muted">
                {w.available.length}/{people.length} free
                {w.missing.length > 0 && w.missing.length <= 3
                  ? ` · missing ${w.missing.map(nameOf).join(', ')}`
                  : ''}
              </div>
              <div class="links">
                <a href={googleCalendarUrl(event)} target="_blank" rel="noreferrer">
                  Add to Google
                </a>
                {!weekly && (
                  <a
                    href={outlookCalendarUrl(event, outlookAccount)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Add to Outlook
                  </a>
                )}
                <button type="button" class="link" onClick={() => downloadIcs(event, pollRef)}>
                  Download .ics
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function downloadIcs(event: CalendarEvent, pollRef: EventRef) {
  const ics = buildIcs({
    ...event,
    uid: `${pollRef.id}-${event.start}@when2meet-calendar-sync`,
    now: Date.now(),
    url: eventUrl(pollRef),
  });
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(event.title || 'meeting').replace(/[^\w-]+/g, '-').slice(0, 40)}.ics`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
