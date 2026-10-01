import {
  addDays,
  type Bits,
  bitsForPerson,
  countAvailable,
  detectPollKind,
  type FillMode,
  type FillPlan,
  type FillRecord,
  planFill,
  recordFill,
  slotLengthSec,
  systemTimeZone,
  undoTarget,
} from '@w2msync/core';
import { type EventRef, eventKey, type PageState, type SaveOutcome } from '@w2msync/when2meet';
import { useEffect, useRef, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { DOCS, PRODUCT_NAME } from '../../lib/config.ts';
import { formatCoverage, formatWeek, formatWeeks, plural } from '../../lib/format.ts';
import {
  type ComputeResult,
  type PollChangedEvent,
  type SourceProblem,
  type Status,
  send,
} from '../../lib/messages.ts';
import type { PageClient } from '../../lib/page-bridge.ts';
import {
  claimCheck,
  deleteRecord,
  loadBinding,
  loadRecord,
  saveBinding,
  saveRecord,
} from '../../lib/records.ts';
import { saveSettings } from '../../lib/settings.ts';
import { BestTimes } from './BestTimes.tsx';
import { clearPreview, scrollGridIntoView, showPreview } from './overlay.ts';

interface Props {
  page: PageClient;
  pollRef: EventRef;
  initial: PageState;
}

interface Preview {
  personId: number;
  baseline: Bits;
  compute: ComputeResult;
  plan: FillPlan;
  record: FillRecord | null;
}

type Saved = Extract<SaveOutcome, { status: 'saved' | 'partial' }>;

type View =
  | { name: 'idle'; note?: string }
  | { name: 'working'; label: string }
  | { name: 'confirm-name'; personName: string; marked: number }
  | { name: 'problems'; problems: SourceProblem[]; proceed: () => void }
  | { name: 'preview'; preview: Preview }
  | { name: 'done'; outcome: Saved; record: FillRecord; personId: number; changed: number }
  | { name: 'up-to-date' }
  | { name: 'error'; message: string; code?: string };

type Banner = { kind: 'changed'; count: number } | { kind: 'reconnect' } | { kind: 'other-tab' };

interface FillOptions {
  mode?: FillMode;
  resetOverrides?: boolean;
  ignoreProblems?: boolean;
  fresh?: boolean;
  week?: string;
}

export function Panel({ page, pollRef, initial }: Props) {
  const [poll, setPoll] = useState(initial);
  const [status, setStatus] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>({ name: 'idle' });
  const [banner, setBanner] = useState<Banner | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [week, setWeek] = useState<string | null>(null);
  const [showBest, setShowBest] = useState(false);
  const confirmedName = useRef<string | null>(null);
  const key = eventKey(pollRef);
  const weekdays = detectPollKind(poll.slots) === 'weekdays';
  const signedInAs = poll.userId ? poll.people.find((p) => p.id === poll.userId) : undefined;
  const timeZone = status?.settings.timeZone || systemTimeZone();
  const firstSlot = poll.slots[0];
  const lastSlot = poll.slots[poll.slots.length - 1];
  const coverage =
    weekdays || firstSlot === undefined || lastSlot === undefined
      ? null
      : formatCoverage(firstSlot * 1000, (lastSlot + slotLengthSec(poll.slots)) * 1000, timeZone);

  useEffect(() => {
    const loadStatus = () =>
      send('getStatus')
        .then((s) => {
          setStatus(s);
          setName((current) => current || s.settings.displayName);
        })
        .catch((e: Error) => setView({ name: 'error', message: e.message }));
    void loadStatus();
    const onMessage = (message: unknown) => {
      const event = message as Partial<PollChangedEvent> | null;
      if (event?.w2msyncEvent === 'pollChanged' && event.eventKey === key)
        setBanner({ kind: 'other-tab' });
    };
    // Calendars or settings changed in the settings tab: pick them up without a reload.
    const onStorage = (changes: Record<string, unknown>, area: string) => {
      if (area === 'local' && ('accounts' in changes || 'settings' in changes)) void loadStatus();
    };
    browser.runtime.onMessage.addListener(onMessage);
    browser.storage.onChanged.addListener(onStorage);
    return () => {
      browser.runtime.onMessage.removeListener(onMessage);
      browser.storage.onChanged.removeListener(onStorage);
    };
  }, [key]);

  useEffect(() => {
    if (status) void checkForChanges(status);
  }, [status !== null]);

  useEffect(() => () => clearPreview(), []);

  async function refreshPoll(): Promise<PageState> {
    const fresh = await page.call('read', undefined);
    if (fresh) setPoll(fresh);
    return fresh ?? poll;
  }

  async function checkForChanges(s: Status) {
    if (!s.settings.checkOnOpen || s.accounts.length === 0) return;
    const binding = await loadBinding(pollRef.id);
    const record = binding && (await loadRecord(pollRef.id, binding.personId));
    if (!binding || !record || !(await claimCheck(pollRef.id))) return;
    try {
      const compute = await send('computeTarget', {
        slots: poll.slots,
        interactive: false,
        ...(record.weekStart ? { weekStart: record.weekStart } : {}),
      });
      if (compute.problems.some((p) => p.code === 'reconnect')) {
        setBanner({ kind: 'reconnect' });
        return;
      }
      if (compute.problems.length > 0) return;
      const plan = planFill({
        slots: poll.slots,
        server: bitsForPerson(poll.availableAt, binding.personId),
        calendar: compute.bits,
        record,
        rulesHash: compute.rulesHash,
      });
      if (plan.changes.length > 0) setBanner({ kind: 'changed', count: plan.changes.length });
    } catch {
      // A background check never interrupts; the user can still fill by hand.
    }
  }

  /** Signs in on the poll if needed; returns the person id, or null if waiting on the user. */
  async function ensureSignedIn(): Promise<number | null> {
    const current = await refreshPoll();
    if (current.userId) {
      const person = current.people.find((p) => p.id === current.userId);
      await saveBinding(pollRef.id, {
        personId: current.userId,
        name: person?.name ?? name,
        savedAt: Date.now(),
      });
      return current.userId;
    }
    const wanted = name.trim();
    if (!wanted) {
      setView({ name: 'error', message: 'Enter the name you want to appear on this poll.' });
      return null;
    }
    const binding = await loadBinding(pollRef.id);
    const existing = current.people.find(
      (p) => p.name.trim().toLowerCase() === wanted.toLowerCase(),
    );
    if (existing && binding?.personId !== existing.id && confirmedName.current !== existing.name) {
      setView({
        name: 'confirm-name',
        personName: existing.name,
        marked: countAvailable(bitsForPerson(current.availableAt, existing.id)),
      });
      return null;
    }
    setView({ name: 'working', label: 'Signing in to the poll…' });
    const result = await page.call('signIn', { name: existing?.name ?? wanted, password });
    if (!result.ok) {
      setView({ name: 'error', message: `When2meet: ${result.error}` });
      return null;
    }
    await saveBinding(pollRef.id, { personId: result.userId, name: wanted, savedAt: Date.now() });
    if (!status?.settings.displayName) {
      const settings = await saveSettings({ displayName: wanted });
      setStatus((s) => (s ? { ...s, settings } : s));
    }
    await refreshPoll();
    return result.userId;
  }

  async function fill(options: FillOptions = {}) {
    setOpen(true);
    setBanner(null);
    clearPreview();
    try {
      if (!status || status.accounts.length === 0) {
        setView({ name: 'idle' });
        return;
      }
      const personId = await ensureSignedIn();
      if (!personId) return;

      setView({ name: 'working', label: 'Reading your calendars…' });
      const record = await loadRecord(pollRef.id, personId);
      const chosenWeek = options.week ?? week ?? undefined;
      const compute = await send('computeTarget', {
        slots: poll.slots,
        interactive: true,
        ...(chosenWeek ? { weekStart: chosenWeek } : {}),
        ...(options.fresh ? { fresh: true } : {}),
      });
      if (compute.weekStart) setWeek(compute.weekStart);
      if (compute.sourcesRead === 0 && compute.problems.length === 0) {
        setView({
          name: 'error',
          message: 'Turn on at least one calendar in settings.',
          code: 'settings',
        });
        return;
      }
      if (compute.problems.length > 0 && !options.ignoreProblems) {
        setView({
          name: 'problems',
          problems: compute.problems,
          proceed: () => void fill({ ...options, ignoreProblems: true }),
        });
        return;
      }

      setView({ name: 'working', label: 'Comparing with When2meet…' });
      const server = await page.call('serverState', { personId });
      if (
        server.slots.length !== poll.slots.length ||
        server.slots.some((s, i) => s !== poll.slots[i])
      ) {
        setView({
          name: 'error',
          message: 'This poll was changed by its organizer. Reload the page, then try again.',
        });
        return;
      }
      const plan = planFill({
        slots: poll.slots,
        server: server.bits,
        calendar: compute.bits,
        record,
        rulesHash: compute.rulesHash,
        ...(options.mode ? { mode: options.mode } : {}),
        ...(options.resetOverrides ? { resetOverrides: true } : {}),
      });
      if (plan.changes.length === 0 && plan.conflicts.length === 0) {
        setView({ name: 'up-to-date' });
        return;
      }
      const preview: Preview = { personId, baseline: server.bits, compute, plan, record };
      // With nothing to save but slots marked that the calendar says are busy, show the preview
      // so the user can choose to remove them.
      if (status.settings.skipPreview && plan.changes.length > 0) {
        await save(preview);
        return;
      }
      showPreview(
        plan.changes,
        plan.conflicts.map((i) => poll.slots[i] as number),
      );
      scrollGridIntoView();
      setView({ name: 'preview', preview });
    } catch (error) {
      clearPreview();
      setView({
        name: 'error',
        message: (error as Error).message,
        code: (error as { code?: string }).code ?? '',
      });
    }
  }

  async function save(preview: Preview) {
    const { personId, baseline, compute, plan } = preview;
    setView({ name: 'working', label: 'Saving to When2meet…' });
    try {
      const outcome = await page.call('save', {
        slots: poll.slots,
        personId,
        eventId: pollRef.id,
        password: readPagePassword() ?? password,
        target: plan.target,
        expectedBaseline: baseline,
      });
      clearPreview();
      if (outcome.status === 'stale') {
        await fill({ ...(compute.weekStart ? { week: compute.weekStart } : {}) });
        return;
      }
      if (outcome.status === 'failed') {
        setView({ name: 'error', message: outcome.error });
        return;
      }
      const record = recordFill({
        eventId: pollRef.id,
        personId,
        slots: poll.slots,
        plan,
        calendar: compute.bits,
        verified: outcome.verified,
        previous: outcome.baseline,
        rulesHash: compute.rulesHash,
        sourcesHash: compute.sourcesHash,
        ...(compute.weekStart ? { weekStart: compute.weekStart } : {}),
        timeZone: compute.timeZone,
        now: Date.now(),
        expiresAt: lastSlotEnd(compute),
      });
      await saveRecord(record);
      await send('pollSaved', { eventKey: key });
      await refreshPoll();
      setView({ name: 'done', outcome, record, personId, changed: plan.changes.length });
    } catch (error) {
      clearPreview();
      setView({ name: 'error', message: (error as Error).message });
    }
  }

  async function undo(record: FillRecord, personId: number) {
    setView({ name: 'working', label: 'Restoring your previous availability…' });
    try {
      const server = await page.call('serverState', { personId });
      const outcome = await page.call('save', {
        slots: poll.slots,
        personId,
        eventId: pollRef.id,
        password: readPagePassword() ?? password,
        target: undoTarget(poll.slots, server.bits, record),
        expectedBaseline: server.bits,
      });
      if (outcome.status !== 'saved' && outcome.status !== 'partial') {
        setView({
          name: 'error',
          message: outcome.status === 'failed' ? outcome.error : 'The poll changed; try again.',
        });
        return;
      }
      await deleteRecord(pollRef.id, personId);
      await send('pollSaved', { eventKey: key });
      await refreshPoll();
      setView({ name: 'idle', note: 'Restored your previous availability.' });
    } catch (error) {
      setView({ name: 'error', message: (error as Error).message });
    }
  }

  function cancelPreview() {
    clearPreview();
    setView({ name: 'idle' });
  }

  const openSettings = (hash?: string) => void send('openOptions', hash ? { hash } : undefined);

  if (!open) {
    const label =
      banner?.kind === 'changed'
        ? `Calendar changed · ${plural(banner.count, 'slot')}`
        : banner?.kind === 'reconnect'
          ? 'Reconnect your calendar'
          : 'Fill from my calendar';
    return (
      <div class="w2m">
        <button
          type="button"
          class="pill"
          title={PRODUCT_NAME}
          onClick={() => {
            const ready = status && status.accounts.length > 0 && (poll.userId || name.trim());
            if (banner?.kind === 'reconnect') openSettings();
            else if (ready) void fill();
            else setOpen(true);
          }}
        >
          {banner ? <span class="dot" aria-hidden="true" /> : <CalendarIcon />}
          {label}
        </button>
      </div>
    );
  }

  return (
    <div class="w2m">
      <section class="card" aria-label={PRODUCT_NAME}>
        <div class="head">
          <CalendarIcon />
          <h2>{PRODUCT_NAME}</h2>
          <button
            type="button"
            class="icon"
            title="Settings"
            aria-label="Settings"
            onClick={() => openSettings()}
          >
            ⚙
          </button>
          <button
            type="button"
            class="icon"
            title="Close"
            aria-label="Close"
            onClick={() => {
              cancelPreview();
              setOpen(false);
            }}
          >
            ×
          </button>
        </div>
        <div class="body" aria-live="polite">
          {banner?.kind === 'other-tab' && (
            <div class="note">
              This poll was updated in another tab.{' '}
              <button type="button" class="link" onClick={() => location.reload()}>
                Reload
              </button>
            </div>
          )}
          {renderBody()}
        </div>
        {showBest && status && (
          <div class="body">
            <BestTimes
              poll={poll}
              pollRef={pollRef}
              weekStart={week}
              timeZone={timeZone}
              minutes={status.settings.meetingMinutes}
              outlookAccount={status.settings.outlookAccount}
            />
          </div>
        )}
        <div class="foot">
          <button type="button" class="link" onClick={() => setShowBest(!showBest)}>
            {showBest ? 'Hide best times' : 'Best times for the group'}
          </button>
          <a href={DOCS.privacy} target="_blank" rel="noreferrer" class="muted">
            Privacy
          </a>
        </div>
      </section>
    </div>
  );

  function renderBody() {
    if (!status) return <Working label="Loading…" />;
    if (status.accounts.length === 0) {
      return (
        <>
          <p>
            Connect Google Calendar, Outlook or any calendar link once, then fill polls in one
            click.
          </p>
          <button type="button" class="primary" onClick={() => openSettings('welcome')}>
            Connect a calendar
          </button>
        </>
      );
    }
    switch (view.name) {
      case 'working':
        return <Working label={view.label} />;
      case 'confirm-name':
        return (
          <>
            <p>
              Someone named <strong>{view.personName}</strong> is already on this poll
              {view.marked ? ` (${plural(view.marked, 'slot')} marked)` : ''}. Is that you?
            </p>
            <div class="row">
              <button
                type="button"
                class="primary"
                onClick={() => {
                  confirmedName.current = view.personName;
                  void fill();
                }}
              >
                Yes, that's me
              </button>
              <button
                type="button"
                class="secondary"
                onClick={() => setView({ name: 'idle', note: 'Pick a different name.' })}
              >
                Use another name
              </button>
            </div>
          </>
        );
      case 'problems':
        return (
          <>
            <p>Some calendars couldn't be read, so their events would be missing:</p>
            <ul class="muted">
              {view.problems.map((p) => (
                <li key={p.accountId}>
                  <strong>{p.label}</strong>: {p.message}
                </li>
              ))}
            </ul>
            <div class="row">
              <button type="button" class="primary" onClick={() => openSettings()}>
                Open settings
              </button>
              <button type="button" class="secondary" onClick={view.proceed}>
                Continue without them
              </button>
            </div>
          </>
        );
      case 'preview':
        return renderPreview(view.preview);
      case 'done':
        return renderDone(view);
      case 'up-to-date':
        return (
          <>
            <p class="ok">✓ Your availability already matches your calendar.</p>
            <div class="row">
              <button type="button" class="secondary" onClick={() => void fill({ fresh: true })}>
                Check again
              </button>
            </div>
          </>
        );
      case 'error':
        return (
          <>
            <p class="error">{view.message}</p>
            {view.code === 'consent' && (
              <p class="muted">
                Ask your IT team to approve the app (
                <a href={DOCS.itAdmins} target="_blank" rel="noreferrer">
                  instructions
                </a>
                ), or{' '}
                <a href={DOCS.calendarLinks} target="_blank" rel="noreferrer">
                  add your calendar as a link
                </a>{' '}
                instead.
              </p>
            )}
            <div class="row">
              <button type="button" class="primary" onClick={() => void fill()}>
                Try again
              </button>
              {(view.code === 'reconnect' ||
                view.code === 'settings' ||
                view.code === 'not-configured') && (
                <button type="button" class="secondary" onClick={() => openSettings()}>
                  Open settings
                </button>
              )}
            </div>
          </>
        );
      default:
        return renderIdle(view.name === 'idle' ? view.note : undefined);
    }
  }

  function renderIdle(note: string | undefined) {
    return (
      <>
        {note && <p class="muted">{note}</p>}
        {banner?.kind === 'changed' && (
          <div class="note">
            Your calendar changed since you filled this poll ({plural(banner.count, 'slot')}).
          </div>
        )}
        {signedInAs ? (
          <p class="muted">
            Signed in on this poll as <strong>{signedInAs.name}</strong>.
          </p>
        ) : (
          <>
            <label>
              Your name on this poll
              <input value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
            </label>
            <label>
              Password <span class="muted">(only if you set one for this poll)</span>
              <input
                type="password"
                value={password}
                onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
              />
            </label>
          </>
        )}
        {weekdays && renderWeekPicker()}
        <button type="button" class="primary" onClick={() => void fill()}>
          {banner?.kind === 'changed' ? 'Review changes' : 'Fill from my calendar'}
        </button>
        <p class="muted">
          Reads {plural(status?.accounts.filter((a) => a.enabled).length ?? 0, 'calendar')}. You'll
          see the changes on the grid before anything is saved.
        </p>
      </>
    );
  }

  function weekLabel(shown: string | null): string {
    const weeks = status?.settings.weekdayPollWeeks ?? 1;
    if (weeks > 1) {
      return shown
        ? `Checking your weeks of ${formatWeeks(shown, weeks)} (${weeks} weeks)`
        : `Checks ${weeks} weeks of your calendar, starting ${status?.settings.weekdayPollWeek === 'this' ? 'this' : 'next'} week`;
    }
    return shown
      ? `Using your week of ${formatWeek(shown)}`
      : `Uses ${status?.settings.weekdayPollWeek === 'this' ? 'this' : 'next'} week from your calendar`;
  }

  function renderWeekPicker() {
    const shown = week;
    const shift = (days: number) => {
      if (!shown) return;
      const next = addDays(shown, days);
      setWeek(next);
      if (view.name === 'preview') void fill({ week: next });
    };
    return (
      <div class="week">
        <button
          type="button"
          class="icon"
          aria-label="Previous week"
          onClick={() => shift(-7)}
          disabled={!shown}
        >
          ‹
        </button>
        <span>{weekLabel(shown)}</span>
        <button
          type="button"
          class="icon"
          aria-label="Next week"
          onClick={() => shift(7)}
          disabled={!shown}
        >
          ›
        </button>
      </div>
    );
  }

  function renderPreview(preview: Preview) {
    const { plan } = preview;
    const adds = plan.changes.filter((c) => c.to === '1').length;
    const removes = plan.changes.length - adds;
    const reasons = new Set(plan.changes.map((c) => c.reason));
    return (
      <>
        <p>
          {plan.kind === 'revisit'
            ? 'Your calendar changed since your last fill. Your manual edits are kept.'
            : plan.changes.length === 0
              ? 'Every time your calendar shows as free is already marked on this poll.'
              : 'Here is what your calendar says. Changes are highlighted on your grid.'}
        </p>
        {coverage && <p class="muted">This poll covers {coverage}.</p>}
        {weekdays && preview.compute.weeks > 1 && (
          <p class="muted">
            You're marked free only at times you're free in{' '}
            {preview.compute.match === 'all' ? 'every one' : 'most'} of those{' '}
            {preview.compute.weeks} weeks.
          </p>
        )}
        <div class="stats">
          <div class="stat add">
            <strong>{adds > 0 ? `+${adds}` : '0'}</strong>
            <span class="muted">now available</span>
          </div>
          <div class="stat remove">
            <strong>{removes > 0 ? `−${removes}` : '0'}</strong>
            <span class="muted">now unavailable</span>
          </div>
        </div>
        {reasons.has('settings') && (
          <p class="muted">Some changes come from your updated settings.</p>
        )}
        {reasons.has('new-slot') && (
          <p class="muted">The organizer added times since your last fill.</p>
        )}
        {plan.conflicts.length > 0 && (
          <div class="note">
            {plural(plan.conflicts.length, 'slot')} you already marked{' '}
            {plan.conflicts.length === 1 ? 'is' : 'are'} busy in your calendar. They're kept.{' '}
            <button type="button" class="link" onClick={() => void fill({ mode: 'replace' })}>
              Remove them too
            </button>
          </div>
        )}
        {weekdays && renderWeekPicker()}
        <div class="row">
          {plan.changes.length > 0 && (
            <button type="button" class="primary" onClick={() => void save(preview)}>
              Save to When2meet
            </button>
          )}
          <button type="button" class="secondary" onClick={cancelPreview}>
            {plan.changes.length > 0 ? 'Cancel' : 'Close'}
          </button>
        </div>
        {plan.kind === 'revisit' && Object.keys(plan.overrides).length > 0 && (
          <button type="button" class="link" onClick={() => void fill({ resetOverrides: true })}>
            Ignore my manual edits and follow the calendar exactly
          </button>
        )}
      </>
    );
  }

  function renderDone(props: {
    outcome: Saved;
    record: FillRecord;
    personId: number;
    changed: number;
  }) {
    const { outcome } = props;
    return (
      <>
        <p class="ok">
          ✓ Saved {plural(props.changed, 'change')} — checked against When2meet
          {outcome.via === 'drive' ? ' (using the grid)' : ''}.
        </p>
        {outcome.status === 'partial' && (
          <div class="note">
            {plural(outcome.mismatched.length, 'slot')} didn't stick. Reload the page and try again.
          </div>
        )}
        {outcome.unreachable.length > 0 && (
          <div class="note">
            {plural(outcome.unreachable.length, 'slot')} aren't shown in your timezone view, so they
            were left as they were.
          </div>
        )}
        <div class="row">
          <button
            type="button"
            class="secondary"
            onClick={() => void undo(props.record, props.personId)}
          >
            Undo
          </button>
          <button type="button" class="secondary" onClick={() => setShowBest(true)}>
            See best times
          </button>
        </div>
      </>
    );
  }
}

function Working({ label }: { label: string }) {
  return (
    <div class="row" role="status">
      <span class="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <path d="M4.75 0a.75.75 0 0 1 .75.75V2h5V.75a.75.75 0 0 1 1.5 0V2h1.25c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 13.25 16H2.75A1.75 1.75 0 0 1 1 14.25V3.75C1 2.784 1.784 2 2.75 2H4V.75A.75.75 0 0 1 4.75 0ZM2.5 7.5v6.75c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V7.5Zm10.75-4H2.75a.25.25 0 0 0-.25.25V6h11V3.75a.25.25 0 0 0-.25-.25Z" />
    </svg>
  );
}

/** The poll password typed into When2meet's own sign-in form, if any. */
function readPagePassword(): string | null {
  const input = document.getElementById('password') as HTMLInputElement | null;
  return input ? input.value : null;
}

function lastSlotEnd(compute: ComputeResult): number {
  return compute.range?.end ?? Date.now();
}
