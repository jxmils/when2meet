# When2meet internals

When2meet has no API. This page records what the extension relies on and how it was confirmed. Everything below was verified on 1 October 2026 against two maintainer-owned throwaway polls (see [Live verification](#live-verification)).

**Do not copy When2meet's HTML or JavaScript into this repository.** Tests use synthetic pages written from scratch (`packages/when2meet/src/testing/synthetic-page.ts`) that reproduce only the interface below.

## Poll page (`GET https://www.when2meet.com/?<id>-<code>`)

An inline script declares these globals with `var`. They're visible only in the page's own JS world, which is why the extension injects a page script.

| Variable | Meaning |
|---|---|
| `TimeOfSlot[i]` | slot start, Unix seconds, in grid order |
| `AvailableAtSlot[i]` | array of person ids available in slot *i* (`AvailableAtSlot[i].push(id)` lines) |
| `PeopleNames[i]`, `PeopleIDs[i]` | participants; names are HTML-escaped inside single-quoted JS strings, e.g. `'A \&quot;B\&quot; C'` |
| `UserID` | signed-in person id, `0` when signed out |
| `IsMouseDown`, `ChangeToAvailable`, `FromCol`, `ToCol`, `FromRow`, `ToRow` | drag state used by `SelectStop()`; the column and row values are `-1` when idle |

Functions: `ProcessLogin`, `SelectFromHere`, `SelectToHere`, `SelectStop` (also `document.onmouseup`), `ReColorIndividual`, `ReColorGroup`, `LoadAvailabilityGrids`, plus touch variants.

**Slots and ids**
- There is no slot-length variable. It's the smallest gap between slots, 900 s.
- The event id and code are not globals. Take them from `location.search`.

**Grid**
- The personal grid is `#YouGrid` → `#YouGridSlots`, hidden until sign-in. Each cell looks like `<div id="YouTime<ts>" data-col data-row data-time onmousedown="SelectFromHere(event);" onmouseover="SelectToHere(event);">`.
- Group cells are `GroupTime<ts>`.

**Caching:** poll GETs are not cached. They return `Cache-Control: no-store, no-cache, must-revalidate` and CloudFront `X-Cache: Miss`.

### Multi-week polls (e.g. a whole term)

- A specific-dates poll can span any number of dates. The create form has no limit, and dates picked across calendar pages accumulate.
- Every date is a column of one wide grid. There is no paging by week.
- **Example:** a 10-week weekday term, 9–5, is 50 columns × 32 rows, i.e. 1,600 slots and 1,600 `YouTime` cells.
- **Slot gaps:**
  - 900 s within a day;
  - overnight gaps;
  - weekend gaps;
  - one gap an hour longer where the clocks change.
- **Each date keeps its local 9–5.** In UTC the slots shift by an hour after a clock change.
- **Viewer in another timezone** (e.g. New York viewing a London term poll): When2meet redraws the grid with rows by the viewer's local time. The London–New York offset changes twice during an autumn term, so the redrawn grid gains rows with blank filler cells. Every slot still has its `YouTime` cell (verified: 1,600 of 1,600).
- **The extension handles all of this without special cases.** Slot times come from `TimeOfSlot` and cell positions from the DOM.
- **Fill records are stored compactly:** slot times as runs plus bit strings, about 4 bytes per slot. A 15-week, 8:00–22:00, every-day poll needs about 20 KB.

### Timezones

- **Specific dates:** slot values are real instants. The page renders in the creator's zone. When the viewer's zone differs, it reloads the grid HTML from `AvailabilityGrids.php`.
  - `TimeOfSlot` does not change; only `data-col`/`data-row` and the labels do.
  - Some views have blank cells without ids (e.g. Asia/Tokyo).
  - The extension uses `TimeOfSlot` for times and the live DOM only for cell positions.
- **Days of the week:** the timezone list offers only UTC. Slots are clock times in a reference week:
  - Sunday 1978-11-12 00:00 UTC = `279676800`.
  - Monday 09:00 = `279795600`.
  - A Mon–Fri 9–5 poll has 160 slots.

## Sign-in (`POST /ProcessLogin.php`)

**Request:** form fields `id`, `name`, `password`.

**Response:** the person id as text, or an error message that the page shows with `alert()`. Signing in again with the same name returns the same id.

**After sign-in:**
- The page sets `UserID`, shows `#YouGrid`, and adds the person to `PeopleIDs`/`PeopleNames` if new.
- It sets no cookie.

The extension drives the page's own form and captures `alert()` messages instead of showing them.

## Saving (`POST /SaveTimes.php`)

`SelectStop()` sends this request once per drag, with fields in this order:

| Field | Value |
|---|---|
| `person` | person id |
| `event` | numeric event id |
| `slots` | comma-joined slot timestamps of the dragged rectangle |
| `availability` | `0`/`1` per slot after the drag (see below) |
| `password` | the participant's password field |
| `ChangeToAvailable` | `true` / `false` |

**Verified behaviour:**

- **The server applies the full `availability` string.**
  - It ignores `slots` and `ChangeToAvailable`. A request listing a slot in `slots` without changing the string leaves it unchanged.
  - A request with empty `slots` but a changed string applies the change.
  - The response is `200` with an empty body.
- **No session is needed.**
  - A request from the page persists, and so does a plain server-side request with no cookies.
  - Only `person`, `event`, `availability` and, for protected participants, `password` matter.
  - This is When2meet's design: a participant without a password can be edited by anyone who knows their id.
- **`SelectStop()` builds `availability` only from slots that have a grid cell.**
  - In views with blank cells, When2meet's own string is shorter than the slot list and the server would misalign it.
  - The extension never replays drags on an incomplete grid.
  - Its direct requests always send the full-length string in `TimeOfSlot` order.

**How the extension saves:**

1. **Direct, then verify.** At most two direct requests, additions then removals, each with the correct full string. Then an uncached reload to verify; on the live site one request would suffice.
2. **Fallback.** If verification fails on a complete grid, replay vertical drags through `SelectStop()`.
3. **Resync afterwards.** The page's in-memory state is resynced so a later manual drag can't send a stale string.

## Live verification

Polls (throwaway, public, safe to reuse for testing):

- Specific dates, Oct 5–7 2026, 9–5 America/New_York: https://www.when2meet.com/?38989176-ac4P8
- Days of the week, Mon–Fri 9–5: https://www.when2meet.com/?38989243-bYl5e
- 10-week term, weekdays Oct 5 – Dec 11 2026, 9–5 Europe/London (spans the UK and US clock changes): https://www.when2meet.com/?38989819-AIwLK

Results, 1 October 2026:

| Check | Result |
|---|---|
| Globals, functions, cell markup | as documented above |
| Direct request from the page | kept |
| `slots`/`ChangeToAvailable` vs `availability` | only `availability` is applied |
| Direct request from a server, no cookies | kept |
| `ProcessLogin.php` cookie | none set |
| Drag replay through `SelectStop()` | kept; only the dragged cells changed; drag state reset to `-1` |
| GET caching | `no-store`, CloudFront miss |
| Viewer timezone ≠ creator timezone (London viewing a New York poll) | grid re-rendered; fill correct |
| Full extension run (`e2e/live.spec.ts`) on all three polls | server state equals the calendar-derived target |
| 10-week term poll viewed from New York, with a weekly meeting across both clock changes | 1,600 of 1,600 cells after the redraw; saved exactly; about 10 s end to end |

To re-run the extension against them:

```bash
npm run build
LIVE_POLLS="https://www.when2meet.com/?38989176-ac4P8,https://www.when2meet.com/?38989243-bYl5e,https://www.when2meet.com/?38989819-AIwLK" npx playwright test e2e/live.spec.ts
```

## Canary

`tools/canary` runs weekly in CI. It sends GET requests only, to the polls above or the `CANARY_POLLS` repository variable, and checks that each poll:

- still parses, with 900 s slots and personal-grid cells;
- still references `SelectStop`, `SaveTimes.php`, `ProcessLogin.php` and the globals above.

It also fingerprints each poll's page script with per-poll data removed, and opens an issue when anything changes. After reviewing a change, accept it with:

```bash
CANARY_POLLS=… npm run canary -- --update
```

## Sources

- [shaharsu/when2meet-outlook-autofill RECON.md](https://github.com/shaharsu/when2meet-outlook-autofill/blob/main/RECON.md) (MIT)
- [Thespaceblade/when2meet-mcp](https://github.com/Thespaceblade/when2meet-mcp), [LOGIC-10/when2meet-mcp](https://github.com/LOGIC-10/when2meet-mcp)
- [Ben-Peters/iCal-when2meet](https://github.com/Ben-Peters/iCal-when2meet), [aculich/when2meet-extractor](https://github.com/aculich/when2meet-extractor)
