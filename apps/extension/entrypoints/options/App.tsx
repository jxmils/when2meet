import { isValidTimeZone, MAX_WEEKS, type Rules, systemTimeZone } from '@w2msync/core';
import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import type { Account, CalendarChoice } from '../../lib/accounts.ts';
import {
  DOCS,
  GOOGLE_BROKER_URL,
  MICROSOFT_CLIENT_ID,
  PRODUCT_NAME,
  REPO_URL,
} from '../../lib/config.ts';
import type { AppError } from '../../lib/errors.ts';
import { type Status, send } from '../../lib/messages.ts';
import { type Settings, saveSettings } from '../../lib/settings.ts';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Provider = 'outlook' | 'google' | 'other';
type Run = (label: string, task: () => Promise<unknown>, done?: string) => Promise<void>;

export function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState<{
    kind: 'ok' | 'error';
    text: string;
    code?: string;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState<Provider | null>(null);

  const reload = () => send('getStatus').then(setStatus);
  useEffect(() => {
    void reload();
  }, []);

  async function run(label: string, task: () => Promise<unknown>, done?: string) {
    setBusy(label);
    setMessage(null);
    try {
      await task();
      await reload();
      if (done) setMessage({ kind: 'ok', text: done });
    } catch (error) {
      const e = error as AppError;
      if (e.code !== 'cancelled') setMessage({ kind: 'error', text: e.message, code: e.code });
    } finally {
      setBusy(null);
    }
  }

  async function update(patch: Partial<Settings>) {
    const settings = await saveSettings(patch);
    setStatus((s) => (s ? { ...s, settings } : s));
  }

  if (!status) return <main class="page">Loading…</main>;
  const { settings, accounts, features } = status;
  const hasName = settings.displayName !== '';
  const hasCalendar = accounts.some((a) => a.enabled);

  /** Sign in when that's available; otherwise show the 3-step "paste a link" guide. */
  function pick(provider: Provider) {
    if (provider === 'outlook' && features.microsoft) {
      void run(
        'Signing in to Microsoft',
        () => send('connect', { provider: 'microsoft' }),
        'Outlook connected.',
      );
      setAdding(null);
    } else if (provider === 'google' && features.google) {
      void run(
        'Signing in to Google',
        () => send('connect', { provider: 'google' }),
        'Google Calendar connected.',
      );
      setAdding(null);
    } else {
      setAdding(adding === provider ? null : provider);
    }
  }

  const added = async () => {
    setAdding(null);
    await reload();
  };

  return (
    <main class="page">
      <header>
        <img src="/icon/48.png" alt="" width="36" height="36" />
        <h1>{PRODUCT_NAME}</h1>
      </header>

      <div role="status" aria-live="polite">
        {message && (
          <p class={message.kind === 'ok' ? 'banner ok' : 'banner error'}>
            {message.text}
            {message.code === 'consent' && (
              <>
                {' '}
                <a href={DOCS.itAdmins} target="_blank" rel="noreferrer">
                  What to send your IT team
                </a>
                , or add Outlook with a link instead.
              </>
            )}
          </p>
        )}
        {busy && <p class="banner">{busy}…</p>}
      </div>

      <section class="step">
        <h2>
          <span class={hasName ? 'num done' : 'num'}>{hasName ? '✓' : '1'}</span> Your name on polls
        </h2>
        <input
          aria-label="Name"
          value={settings.displayName}
          placeholder="e.g. Alex Kim"
          onChange={(e) =>
            void update({ displayName: (e.target as HTMLInputElement).value.trim() })
          }
        />
      </section>

      <section class="step">
        <h2>
          <span class={hasCalendar ? 'num done' : 'num'}>{hasCalendar ? '✓' : '2'}</span> Your
          calendar
        </h2>
        {accounts.length > 0 && (
          <ul class="accounts">
            {accounts.map((account) => (
              <AccountRow key={account.id} account={account} run={run} />
            ))}
          </ul>
        )}
        <div class="tiles">
          {(
            [
              ['outlook', 'Outlook'],
              ['google', 'Google'],
              ['other', 'Apple & others'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              class={adding === id ? 'tile active' : 'tile'}
              aria-expanded={adding === id}
              disabled={busy !== null}
              onClick={() => pick(id)}
            >
              {accounts.length ? `+ ${label}` : label}
            </button>
          ))}
        </div>
        {adding && <LinkGuide provider={adding} run={run} onAdded={added} />}
      </section>

      <section class="step">
        <h2>
          <span class="num">3</span> Fill a poll
        </h2>
        <p>
          Open any When2meet poll and click <strong>Fill from my calendar</strong>.
        </p>
      </section>

      <details class="more">
        <summary>More settings</summary>
        <RulesSection rules={settings.rules} update={(rules) => void update({ rules })} />
        <PollsSection
          settings={settings}
          update={update}
          onError={(text) => setMessage({ kind: 'error', text })}
        />
        <section>
          <h3>Privacy</h3>
          <p class="muted">
            Your calendar is read in this browser. Only your free times and name go to When2meet.{' '}
            <a href={DOCS.privacy} target="_blank" rel="noreferrer">
              Privacy policy
            </a>
          </p>
          <button
            type="button"
            class="danger"
            onClick={() => {
              if (confirm('Disconnect all calendars and erase everything this extension stored?')) {
                void run('Erasing', () => send('resetAll'), 'Everything was erased.');
              }
            }}
          >
            Disconnect everything and erase data
          </button>
        </section>
        <section>
          <h3>Advanced</h3>
          <p class="muted">
            Redirect URL for self-hosted OAuth apps: <code>{status.redirectUrl}</code>
          </p>
          {MICROSOFT_CLIENT_ID && (
            <p class="muted">
              Microsoft application (client) id, for IT admins: <code>{MICROSOFT_CLIENT_ID}</code>
            </p>
          )}
          {GOOGLE_BROKER_URL && (
            <p class="muted">
              Google sign-in service: <code>{GOOGLE_BROKER_URL}</code>
            </p>
          )}
          <p class="muted">
            Version {browser.runtime.getManifest().version} ·{' '}
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              Source code
            </a>{' '}
            ·{' '}
            <a href={DOCS.issues} target="_blank" rel="noreferrer">
              Report a problem
            </a>{' '}
            · Unofficial; not affiliated with When2meet.
          </p>
        </section>
      </details>
    </main>
  );
}

const GUIDES: Record<Provider, { open?: [string, string]; steps: preact.ComponentChildren[] }> = {
  outlook: {
    open: ['Open Outlook', 'https://outlook.office.com/calendar/'],
    steps: [
      <>
        Go to <strong>⚙ Settings → Calendar → Shared calendars</strong>.
      </>,
      <>
        Under <strong>Publish a calendar</strong>, pick your calendar and{' '}
        <strong>Can view when I'm busy</strong>, then <strong>Publish</strong>.
      </>,
      <>
        Copy the <strong>ICS</strong> link and paste it below.
      </>,
    ],
  },
  google: {
    open: ['Open Google Calendar settings', 'https://calendar.google.com/calendar/r/settings'],
    steps: [
      <>Click your calendar on the left.</>,
      <>
        Copy <strong>Secret address in iCal format</strong> and paste it below.
      </>,
    ],
  },
  other: {
    steps: [
      <>
        Copy your calendar's subscribe link (starts with <code>webcal://</code> or{' '}
        <code>https://</code>).{' '}
        <a href={DOCS.calendarLinks} target="_blank" rel="noreferrer">
          Where to find it
        </a>
      </>,
    ],
  },
};

/** The short "paste a link" flow, for providers without sign-in and for everything else. */
function LinkGuide({
  provider,
  run,
  onAdded,
}: {
  provider: Provider;
  run: Run;
  onAdded: () => void;
}) {
  const [url, setUrl] = useState('');
  const guide = GUIDES[provider];
  const label = provider === 'outlook' ? 'Outlook' : provider === 'google' ? 'Google Calendar' : '';

  async function add() {
    const href = url.trim().replace(/^webcals?:\/\//i, 'https://');
    let origin: string;
    try {
      origin = new URL(href).origin;
    } catch {
      await run('Checking', () => Promise.reject(new Error("That doesn't look like a link.")));
      return;
    }
    // Must be requested directly from the click, before any other await.
    const granted = await browser.permissions.request({ origins: [`${origin}/*`] });
    if (!granted) {
      await run('Checking', () =>
        Promise.reject(
          new Error(`Allow access to ${new URL(href).host} so the calendar can be read.`),
        ),
      );
      return;
    }
    await run(
      'Reading your calendar',
      () => send('addIcs', { url: href, label }),
      'Calendar added.',
    );
    setUrl('');
    onAdded();
  }

  return (
    <div class="guide">
      <ol>
        {guide.open && (
          <li>
            <a class="button-link" href={guide.open[1]} target="_blank" rel="noreferrer">
              {guide.open[0]} ↗
            </a>
          </li>
        )}
        {guide.steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
      <div class="paste">
        <input
          aria-label="Calendar link"
          value={url}
          placeholder="Paste the link here"
          onInput={(e) => setUrl((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && url.trim()) void add();
          }}
        />
        <button type="button" class="primary" disabled={!url.trim()} onClick={() => void add()}>
          Add
        </button>
      </div>
      <p class="muted small">
        This link updates by itself; you only add it once. It stays in this browser.
      </p>
      {provider === 'other' && (
        <label class="file">
          No link? Import an .ics file instead (a one-time snapshot):
          <input
            type="file"
            accept=".ics,text/calendar"
            aria-label="Calendar file"
            onChange={async (e) => {
              const input = e.target as HTMLInputElement;
              const file = input.files?.[0];
              if (!file) return;
              const text = await file.text();
              await run(
                'Reading the file',
                () => send('addIcs', { text, label: file.name }),
                `${file.name} imported.`,
              );
              input.value = '';
              onAdded();
            }}
          />
        </label>
      )}
    </div>
  );
}

function AccountRow({ account, run }: { account: Account; run: Run }) {
  const [calendars, setCalendars] = useState<CalendarChoice[] | null>(null);
  const provider =
    account.provider === 'google'
      ? 'Google'
      : account.provider === 'microsoft'
        ? 'Outlook'
        : account.icsKind === 'file'
          ? 'File'
          : 'Link';
  const note =
    account.provider === 'ics' && account.icsKind === 'file'
      ? 'Snapshot. Import again to update.'
      : 'Updates automatically.';

  async function chooseCalendars() {
    await run('Loading calendars', async () => {
      try {
        setCalendars(await send('listCalendars', { accountId: account.id }));
      } catch (error) {
        if ((error as AppError).code !== 'needs-scope') throw error;
        await send('connect', {
          provider: 'google',
          accountId: account.id,
          withCalendarList: true,
        });
        setCalendars(await send('listCalendars', { accountId: account.id }));
      }
    });
  }

  return (
    <li class={account.enabled ? '' : 'off'}>
      <div class="row spread">
        <div>
          <span class="badge">{provider}</span> <strong>{account.label}</strong>
          {account.needsReconnect && <span class="badge warn">Needs reconnect</span>}
          <div class="muted small">{note}</div>
        </div>
        <div class="row">
          <label class="switch">
            <input
              type="checkbox"
              checked={account.enabled}
              onChange={(e) =>
                void run('Saving', () =>
                  send('setAccount', {
                    accountId: account.id,
                    enabled: (e.target as HTMLInputElement).checked,
                  }),
                )
              }
            />
            Use
          </label>
          {account.provider !== 'ics' && (
            <button type="button" class="link" onClick={() => void chooseCalendars()}>
              Calendars
            </button>
          )}
          {account.needsReconnect && account.provider !== 'ics' && (
            <button
              type="button"
              class="link"
              onClick={() =>
                void run('Reconnecting', () =>
                  send('connect', {
                    provider: account.provider as 'google' | 'microsoft',
                    accountId: account.id,
                  }),
                )
              }
            >
              Reconnect
            </button>
          )}
          <button
            type="button"
            class="link danger-link"
            onClick={() =>
              void run(
                'Removing',
                () => send('disconnect', { accountId: account.id }),
                'Calendar removed.',
              )
            }
          >
            Remove
          </button>
        </div>
      </div>
      {calendars && (
        <fieldset>
          <legend>Calendars to read</legend>
          {calendars.map((c, i) => (
            <Check
              key={c.id}
              label={`${c.name}${c.primary ? ' (main)' : ''}`}
              checked={c.enabled}
              onChange={(enabled) =>
                setCalendars(calendars.map((x, j) => (j === i ? { ...x, enabled } : x)))
              }
            />
          ))}
          <div class="row">
            <button
              type="button"
              class="secondary"
              onClick={() =>
                void run(
                  'Saving',
                  async () => {
                    await send('setAccount', { accountId: account.id, calendars });
                    setCalendars(null);
                  },
                  'Calendar choice saved.',
                )
              }
            >
              Save
            </button>
            <button type="button" class="link" onClick={() => setCalendars(null)}>
              Cancel
            </button>
          </div>
        </fieldset>
      )}
    </li>
  );
}

function PollsSection({
  settings,
  update,
  onError,
}: {
  settings: Settings;
  update: (patch: Partial<Settings>) => Promise<void>;
  onError: (text: string) => void;
}) {
  return (
    <section>
      <h3>Weekly polls (days of the week, no dates)</h3>
      <div class="grid2">
        <label>
          Start from
          <select
            value={settings.weekdayPollWeek}
            onChange={(e) =>
              void update({
                weekdayPollWeek: (e.target as HTMLSelectElement).value as 'this' | 'next',
              })
            }
          >
            <option value="next">next week</option>
            <option value="this">this week</option>
          </select>
        </label>
        <label>
          …and check this many weeks
          <input
            type="number"
            min={1}
            max={MAX_WEEKS}
            value={settings.weekdayPollWeeks}
            onChange={(e) => {
              const weeks = Math.round(Number((e.target as HTMLInputElement).value) || 1);
              void update({ weekdayPollWeeks: Math.min(MAX_WEEKS, Math.max(1, weeks)) });
            }}
          />
        </label>
      </div>
      {settings.weekdayPollWeeks > 1 ? (
        <label>
          Count a weekday time as free when I'm free
          <select
            value={settings.weekdayPollMatch}
            onChange={(e) =>
              void update({
                weekdayPollMatch: (e.target as HTMLSelectElement).value as 'all' | 'most',
              })
            }
          >
            <option value="all">in every one of those weeks</option>
            <option value="most">in most of those weeks (ignores one-offs)</option>
          </select>
        </label>
      ) : (
        <p class="muted small">Tip: for a weekly meeting all term, check 10 or more weeks.</p>
      )}

      <h3>Other</h3>
      <div class="grid2">
        <label>
          Timezone
          <input
            list="timezones"
            value={settings.timeZone}
            placeholder={`Automatic (${systemTimeZone()})`}
            onChange={(e) => {
              const timeZone = (e.target as HTMLInputElement).value.trim();
              if (timeZone && !isValidTimeZone(timeZone)) {
                onError(`"${timeZone}" is not a timezone. Pick one from the list.`);
                return;
              }
              void update({ timeZone });
            }}
          />
          <datalist id="timezones">
            {Intl.supportedValuesOf('timeZone').map((tz) => (
              <option key={tz} value={tz} />
            ))}
          </datalist>
        </label>
        <label>
          Meeting length for "best times" (min)
          <input
            type="number"
            min={15}
            step={15}
            value={settings.meetingMinutes}
            onChange={(e) =>
              void update({
                meetingMinutes: Math.max(15, Number((e.target as HTMLInputElement).value) || 60),
              })
            }
          />
        </label>
        <label>
          "Add to Outlook" opens
          <select
            value={settings.outlookAccount}
            onChange={(e) =>
              void update({
                outlookAccount: (e.target as HTMLSelectElement).value as 'work' | 'personal',
              })
            }
          >
            <option value="work">Outlook for work or school</option>
            <option value="personal">Outlook.com</option>
          </select>
        </label>
      </div>
      <Check
        label="Tell me when my calendar changes after I fill a poll"
        checked={settings.checkOnOpen}
        onChange={(checkOnOpen) => void update({ checkOnOpen })}
      />
      <Check
        label="Save straight away, without a preview"
        checked={settings.skipPreview}
        onChange={(skipPreview) => void update({ skipPreview })}
      />
    </section>
  );
}

function RulesSection({ rules, update }: { rules: Rules; update: (rules: Rules) => void }) {
  const set = (patch: Partial<Rules>) => update({ ...rules, ...patch });
  const treat = (key: keyof Rules['treat'], value: string) =>
    set({ treat: { ...rules.treat, [key]: value as 'busy' | 'free' } });
  const hours = rules.workingHours;
  const minutes = (
    key: 'bufferBeforeMin' | 'bufferAfterMin' | 'minFreeMinutes',
    label: string,
    step: number,
  ) => (
    <label>
      {label}
      <input
        type="number"
        min={0}
        step={step}
        value={rules[key]}
        onChange={(e) =>
          set({ [key]: Math.max(0, Number((e.target as HTMLInputElement).value) || 0) })
        }
      />
    </label>
  );
  return (
    <section>
      <h3>When am I free?</h3>
      <div class="grid2">
        {minutes('bufferBeforeMin', 'Buffer before events (min)', 5)}
        {minutes('bufferAfterMin', 'Buffer after events (min)', 5)}
        {minutes('minFreeMinutes', 'Ignore free gaps shorter than (min)', 15)}
        <TreatSelect
          label="Tentative / maybe"
          value={rules.treat.tentative}
          onChange={(v) => treat('tentative', v)}
        />
        <TreatSelect
          label="Out of office"
          value={rules.treat.oof}
          onChange={(v) => treat('oof', v)}
        />
        <TreatSelect
          label="Working elsewhere"
          value={rules.treat.workingElsewhere}
          onChange={(v) => treat('workingElsewhere', v)}
        />
        <label>
          All-day events
          <select
            value={rules.allDay}
            onChange={(e) =>
              set({ allDay: (e.target as HTMLSelectElement).value as Rules['allDay'] })
            }
          >
            <option value="auto">Follow each event's setting</option>
            <option value="busy">Always busy</option>
            <option value="free">Always free</option>
          </select>
        </label>
      </div>
      <Check
        label="Only mark me free during working hours"
        checked={hours !== null}
        onChange={(on) =>
          set({ workingHours: on ? { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' } : null })
        }
      />
      {hours && (
        <div class="hours">
          <div class="row">
            {DAYS.map((day, i) => (
              <Check
                key={day}
                label={day}
                checked={hours.days.includes(i)}
                onChange={(on) =>
                  set({
                    workingHours: {
                      ...hours,
                      days: on ? [...hours.days, i].sort() : hours.days.filter((d) => d !== i),
                    },
                  })
                }
              />
            ))}
          </div>
          <div class="row">
            <label>
              From
              <input
                type="time"
                value={hours.start}
                onChange={(e) =>
                  set({ workingHours: { ...hours, start: (e.target as HTMLInputElement).value } })
                }
              />
            </label>
            <label>
              To
              <input
                type="time"
                value={hours.end}
                onChange={(e) =>
                  set({ workingHours: { ...hours, end: (e.target as HTMLInputElement).value } })
                }
              />
            </label>
          </div>
        </div>
      )}
    </section>
  );
}

function TreatSelect(props: {
  label: string;
  value: 'busy' | 'free';
  onChange: (v: 'busy' | 'free') => void;
}) {
  return (
    <label>
      {props.label}
      <select
        value={props.value}
        onChange={(e) => props.onChange((e.target as HTMLSelectElement).value as 'busy' | 'free')}
      >
        <option value="busy">Counts as busy</option>
        <option value="free">Counts as free</option>
      </select>
    </label>
  );
}

function Check(props: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label class="check">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange((e.target as HTMLInputElement).checked)}
      />
      {props.label}
    </label>
  );
}
