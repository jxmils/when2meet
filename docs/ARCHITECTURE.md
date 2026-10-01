# Architecture

## Goals

- Fill a When2meet poll from any mix of calendars in one click, for anyone, in Chrome, Edge and Firefox.
- Keep calendar data on the user's device; ask for the least access each provider allows.
- Never write availability for the wrong person, and never report success without checking the server.
- Keep working when When2meet changes, or fail loudly (canary) instead of silently.

## Components

```
apps/extension
├─ entrypoints/background      sign-in, calendar providers, availability computation, storage
├─ entrypoints/when2meet.content  panel UI (shadow DOM), planning, records, grid preview
├─ entrypoints/page-script     runs in the page's own JS world: read globals, sign in, save
└─ entrypoints/options         settings and onboarding

packages/core        pure TypeScript, no browser APIs (unit tested, property tested)
packages/when2meet   parse/save/verify (DOM-free parsing usable in workers and tests)
packages/providers   Google / Microsoft / ICS adapters with injected auth and fetch
apps/web             Cloudflare Worker: OAuth broker + static website
```

### Data flow for one fill

1. The **content script** finds a poll URL (`/?<id>-<code>`), injects the **page script**, and asks it for the page state (`TimeOfSlot`, `AvailableAtSlot`, people, `UserID`, grid cells).
2. Clicking **Fill from my calendar**:
   1. **Sign-in guard.** If nobody is signed in, the page's own sign-in form is used with the saved name. If that name already belongs to a participant we've never been bound to, the user must confirm it's them.
   2. **Compute.** The background maps slots to real time ranges, reads busy blocks from every enabled source (cached for 5 minutes), applies the rules and returns one character per slot: `1` free, `0` busy, `?` unknown (past slots, nonexistent DST times). Busy blocks never leave the background.
   3. **Plan.** The content script reads the person's current availability with a fresh GET and calls `planFill` with the calendar bits and the stored record for this poll.
   4. **Preview.** Changed cells are highlighted on the grid.
   5. **Save.** The page script runs `executeSave` (below), then the content script stores a record of what was applied and tells other tabs on the same poll to reload.

### Message boundaries

| Between | Transport | What crosses |
|---|---|---|
| Content/options ⇄ background | `runtime.sendMessage` with typed envelopes (`lib/messages.ts`) | requests, computed bits, account metadata |
| Content ⇄ page script | DOM `CustomEvent`s on a random per-page channel, JSON strings (`lib/page-bridge.ts`) | page state, bits, names, save outcomes |
| Background → content | `tabs.sendMessage` | "poll changed in another tab" |

Tokens, calendar links and busy blocks stay in the background; the page (When2meet's JS world) only ever sees availability bits and names.

### Storage

| Where | What |
|---|---|
| `storage.local` | settings, connected-account metadata, per-poll fill records and person bindings (no secrets) |
| `storage.session` | access tokens, 5-minute busy-time cache |
| Extension IndexedDB | refresh tokens, calendar links, imported `.ics` text (not readable by content scripts) |

Fill records are stored packed (`packages/core/src/record-codec.ts`): slot times as runs and bits as strings. This keeps term-long polls with thousands of slots to a few KB each. Records are deleted 90 days after a poll's last slot.

## Key algorithms

### Slot mapping (`packages/core/src/slots.ts`)

- Slot length is the smallest gap between `TimeOfSlot` values (normally 900 s).
- Specific-date polls store real instants: slot *i* covers `[t, t + length)`.
- Days-of-the-week polls store clock times in a reference week beginning Sunday 1978-11-12 00:00 UTC (`279676800`). Each slot is placed on the same weekday and clock time of the chosen real week in the user's timezone. A slot whose start falls in a skipped DST hour is unknown (`?`); one inside a repeated hour covers both occurrences, so it is free only if both are.

### Busy → availability (`rules.ts`, `target.ts`)

Blocks are classified (`busy`, `tentative`, `oof`, `workingElsewhere`, `free`, `unknown`), filtered by the rules, padded with buffers, merged, and intersected with each slot. A slot is free only if nothing blocking overlaps it at all; working hours and a minimum free stretch can narrow it further.

### Fill planning and manual edits (`overrides.ts`)

Each fill stores, per poll and person: `applied` (verified server state after saving), `calendar` (the calendar target used), `overrides` (manual edits) and `previous` (for undo).

- **First fill:** if nothing is marked yet, follow the calendar (`replace`). Otherwise default to `add`: keep existing marks (recorded as overrides) and highlight conflicts, with a one-click "remove them too".
- **Revisit:** any slot whose server value differs from `applied` was edited by hand (or elsewhere) and becomes an override. The target is the fresh calendar target with overrides applied; unknown slots keep their server value. Changes are labelled as calendar, settings or new-slot changes.

Property tests check that planning is idempotent and that calendar changes never override a manual edit.

### Saving (`packages/when2meet/src/save.ts`)

Verified live: When2meet applies the full `availability` string of a `SaveTimes.php` request (see [WHEN2MEET_INTERNALS.md](WHEN2MEET_INTERNALS.md#saving-post-savetimesphp)).

1. Read the baseline with a fresh GET. If it differs from what the preview was computed from, stop (`stale`) and re-plan.
2. **Direct:** at most two `SaveTimes.php` requests, additions first (with the intermediate full availability string) then removals (with the final string). This is correct whether When2meet applies the `availability` string or the `slots` + `ChangeToAvailable` pair.
3. **Verify** with another fresh GET.
4. **Fallback:** if the server didn't keep the change, resync the page's in-memory state to the server, then replay vertical drag runs per grid column through the page's own `SelectStop()`, waiting for each request to finish. This is skipped when the grid is missing cells, because the page would then send a shortened availability string.
5. Resync the page's state and colours so a later manual drag can't send a stale string.

## Sign-in

| Provider | Flow | Scopes / permissions | Refresh |
|---|---|---|---|
| Google | `identity.launchWebAuthFlow` → broker `/oauth/google/start` → Google (code + PKCE) → broker `/callback` → extension; token exchange through the broker, which adds the client secret | `openid email calendar.freebusy` (+ `calendar.calendarlist.readonly` when choosing calendars) | refresh token via broker |
| Microsoft | `launchWebAuthFlow` against `login.microsoftonline.com/common`, code + PKCE, SPA redirect = extension redirect URL; tokens redeemed directly (no secret) | `openid profile offline_access Calendars.ReadBasic` | 24 h SPA refresh token, then silent `prompt=none`, then a reconnect prompt |
| ICS | per-site optional host permission requested when the link is added | — | fetched fresh on each fill |

Why a broker for Google: Google only verifies apps whose redirect URIs are on a domain the publisher owns; Firefox only lets an extension start an auth flow whose `redirect_uri` is its own; and refresh tokens for a web client need the client secret. The broker (`apps/web/worker/oauth.ts`) is stateless: it signs the state with HMAC, only redirects to allow-listed extension redirect URLs, rate-limits by IP, and never stores or logs codes or tokens.

## Testing

- **Unit:** core engine (incl. DST tables for New York, London, Lord Howe, Kathmandu, Chatham and fast-check properties), When2meet parser and save strategies (with a fake page/server that switches save semantics and drops requests), providers (fake fetch), broker.
- **End to end:** Playwright loads the built extension into Chromium and routes `www.when2meet.com` to the mock (`tools/mock-when2meet`), covering: fill with verification, fallback when direct saves are dropped, slot-list semantics, weekday polls, the duplicate-name guard, revisit with manual edits, and undo.
- **Canary:** a weekly read-only check of maintainer-owned live polls.
