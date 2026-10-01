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

export function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState<{
    kind: 'ok' | 'error';
    text: string;
    code?: string;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const welcome = location.hash === '#welcome';

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

  return (
    <main class="page">
      <header>
        <img src="/icon/48.png" alt="" width="40" height="40" />
        <div>
          <h1>{PRODUCT_NAME}</h1>
          <p class="muted">Unofficial helper. Not affiliated with When2meet.</p>
        </div>
      </header>

      {(welcome || accounts.length === 0) && (
        <section class="welcome">
          <h2>Welcome! Three steps and you're set</h2>
          <ol>
            <li>Tell us the name you use on polls.</li>
            <li>Connect your calendars below (as many as you like).</li>
            <li>
              Open any When2meet poll and click <strong>Fill from my calendar</strong>.
            </li>
          </ol>
          <p class="muted">
            Your calendar is read in your browser, and only free/busy times are used. Nothing is
            sent to us.{' '}
            <a href={DOCS.privacy} target="_blank" rel="noreferrer">
              Privacy details
            </a>
          </p>
        </section>
      )}

      <div role="status" aria-live="polite">
        {message && (
          <p class={message.kind === 'ok' ? 'banner ok' : 'banner error'}>
            {message.text}
            {message.code === 'consent' && (
              <>
                {' '}
                <a href={DOCS.itAdmins} target="_blank" rel="noreferrer">
                  What to send your IT team
                </a>{' '}
                · or add your calendar as a link below.
              </>
            )}
          </p>
        )}
        {busy && <p class="banner">{busy}…</p>}
      </div>

      <section>
        <h2>Your name on polls</h2>
        <label>
          Name
          <input
            value={settings.displayName}
            placeholder="e.g. Alex Kim"
            onChange={(e) =>
              void update({ displayName: (e.target as HTMLInputElement).value.trim() })
            }
          />
        </label>
        <p class="muted">Used to sign in to polls for you. You can change it on any poll.</p>
      </section>

      <section>
        <h2>Calendars</h2>
        <div class="row">
          <button
            type="button"
            class="primary"
            disabled={!features.google || busy !== null}
            onClick={() =>
              void run(
                'Waiting for Google',
                () => send('connect', { provider: 'google' }),
                'Google Calendar connected.',
              )
            }
          >
            Connect Google Calendar
          </button>
          <button
            type="button"
            class="primary"
            disabled={!features.microsoft || busy !== null}
            onClick={() =>
              void run(
                'Waiting for Microsoft',
                () => send('connect', { provider: 'microsoft' }),
                'Outlook connected.',
              )
            }
          >
            Connect Outlook / Microsoft 365
          </button>
        </div>
        {(!features.google || !features.microsoft) && (
          <p class="muted">
            One-click sign-in for{' '}
            {[!features.google && 'Google', !features.microsoft && 'Microsoft']
              .filter(Boolean)
              .join(' and ')}{' '}
            isn't set up in this build. Calendar links below work with every provider.
          </p>
        )}
        <AddCalendarLink onAdded={reload} run={run} />
        <ImportFile run={run} />
        {accounts.length > 0 && (
          <ul class="accounts">
            {accounts.map((account) => (
              <AccountRow key={account.id} account={account} run={run} />
            ))}
          </ul>
        )}
      </section>

      <RulesSection rules={settings.rules} update={(rules) => void update({ rules })} />

      <section>
        <h2>Polls</h2>
        <div class="grid2">
          <label>
            Days-of-the-week polls start from
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
              <option value="most">in most of those weeks (ignores one-off events)</option>
            </select>
          </label>
        ) : (
          <p class="muted">
            Picking a weekly time for a whole term? Check 10 or more weeks so you're only marked
            free when you're free every week.
          </p>
        )}
        <label>
          Timezone
          <input
            list="timezones"
            value={settings.timeZone}
            placeholder={`Automatic (${systemTimeZone()})`}
            onChange={(e) => {
              const timeZone = (e.target as HTMLInputElement).value.trim();
              if (timeZone && !isValidTimeZone(timeZone)) {
                setMessage({
                  kind: 'error',
                  text: `"${timeZone}" is not a timezone. Pick one from the list.`,
                });
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
          Meeting length for "best times" (minutes)
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
            <option value="work">Outlook for work or school (outlook.office.com)</option>
            <option value="personal">Outlook.com (outlook.live.com)</option>
          </select>
        </label>
        <Check
          label="When I reopen a poll I filled, tell me if my calendar changed"
          checked={settings.checkOnOpen}
          onChange={(checkOnOpen) => void update({ checkOnOpen })}
        />
        <Check
          label="Save right away, without a preview (true one-click)"
          checked={settings.skipPreview}
          onChange={(skipPreview) => void update({ skipPreview })}
        />
      </section>

      <section>
        <h2>Privacy and data</h2>
        <p class="muted">
          Calendar events are read by this extension in your browser and turned into free/busy
          slots. Only those slots, and your name, are sent to When2meet. Tokens and calendar links
          stay in this browser. Google sign-in passes through our small open-source sign-in service,
          which stores nothing.
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

      <details>
        <summary>Advanced</summary>
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
          </a>
        </p>
      </details>
    </main>
  );
}

type Run = (label: string, task: () => Promise<unknown>, done?: string) => Promise<void>;

function AddCalendarLink({ run }: { onAdded: () => void; run: Run }) {
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  async function add() {
    const href = url.trim().replace(/^webcals?:\/\//i, 'https://');
    let origin: string;
    try {
      origin = new URL(href).origin;
    } catch {
      await run('Checking', () => Promise.reject(new Error('That is not a valid link.')));
      return;
    }
    // Must be requested directly from the click, before any await.
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
      'Reading the calendar',
      () => send('addIcs', { url: href, label: label.trim() }),
      'Calendar added.',
    );
    setUrl('');
    setLabel('');
  }
  return (
    <details class="add">
      <summary>Add a calendar link (Apple iCloud, Outlook, Google, Proton, Fastmail…)</summary>
      <label>
        Calendar link (https:// or webcal://)
        <input
          value={url}
          onInput={(e) => setUrl((e.target as HTMLInputElement).value)}
          placeholder="webcal://…"
        />
      </label>
      <label>
        Name (optional)
        <input
          value={label}
          onInput={(e) => setLabel((e.target as HTMLInputElement).value)}
          placeholder="Work calendar"
        />
      </label>
      <button type="button" class="secondary" disabled={!url.trim()} onClick={() => void add()}>
        Add calendar
      </button>
      <p class="muted">
        Where to find the link:{' '}
        <a href={DOCS.calendarLinks} target="_blank" rel="noreferrer">
          step-by-step for each provider
        </a>
        . Outlook's "Can view when I'm busy" link shares only free/busy times. Treat these links
        like passwords; they stay in this browser.
      </p>
    </details>
  );
}

function ImportFile({ run }: { run: Run }) {
  return (
    <details class="add">
      <summary>Import an .ics file (one-time snapshot)</summary>
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
        }}
      />
    </details>
  );
}

function AccountRow({ account, run }: { account: Account; run: Run }) {
  const [calendars, setCalendars] = useState<CalendarChoice[] | null>(null);
  const provider =
    account.provider === 'google'
      ? 'Google'
      : account.provider === 'microsoft'
        ? 'Microsoft'
        : account.icsKind === 'file'
          ? 'File'
          : 'Link';
  const chosen = account.calendars?.filter((c) => c.enabled).length;

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
          <div class="muted">
            {account.provider === 'ics'
              ? account.icsKind === 'file'
                ? 'Imported file; re-import to update.'
                : 'Read fresh each time you fill.'
              : chosen === undefined
                ? 'Main calendar'
                : `${chosen} calendar${chosen === 1 ? '' : 's'}`}
          </div>
        </div>
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
      </div>
      <div class="row">
        {account.provider !== 'ics' && (
          <>
            <button type="button" class="link" onClick={() => void chooseCalendars()}>
              Choose calendars
            </button>
            {account.needsReconnect && (
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
          </>
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

function RulesSection({ rules, update }: { rules: Rules; update: (rules: Rules) => void }) {
  const set = (patch: Partial<Rules>) => update({ ...rules, ...patch });
  const treat = (key: keyof Rules['treat'], value: string) =>
    set({ treat: { ...rules.treat, [key]: value as 'busy' | 'free' } });
  const hours = rules.workingHours;
  return (
    <section>
      <h2>How your calendar becomes availability</h2>
      <div class="grid2">
        <label>
          Buffer before events (min)
          <input
            type="number"
            min={0}
            step={5}
            value={rules.bufferBeforeMin}
            onChange={(e) =>
              set({
                bufferBeforeMin: Math.max(0, Number((e.target as HTMLInputElement).value) || 0),
              })
            }
          />
        </label>
        <label>
          Buffer after events (min)
          <input
            type="number"
            min={0}
            step={5}
            value={rules.bufferAfterMin}
            onChange={(e) =>
              set({
                bufferAfterMin: Math.max(0, Number((e.target as HTMLInputElement).value) || 0),
              })
            }
          />
        </label>
        <label>
          Ignore free gaps shorter than (min)
          <input
            type="number"
            min={0}
            step={15}
            value={rules.minFreeMinutes}
            onChange={(e) =>
              set({
                minFreeMinutes: Math.max(0, Number((e.target as HTMLInputElement).value) || 0),
              })
            }
          />
        </label>
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
            <option value="auto">Follow each event's free/busy setting</option>
            <option value="busy">Always busy</option>
            <option value="free">Always free</option>
          </select>
        </label>
      </div>
      <Check
        label="Only mark me available during working hours"
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
