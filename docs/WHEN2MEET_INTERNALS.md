# When2meet internals

When2meet has no API. This page records exactly what the extension relies on, how it was learned, and what is still unverified. Only GET requests were used to learn it; the live save behaviour is to be confirmed with maintainer-owned test polls (see the checklist below).

**Do not copy When2meet's HTML or JavaScript into this repository.** Tests use synthetic pages written from scratch (`packages/when2meet/src/testing/synthetic-page.ts`) that reproduce only the interface below.

## Poll page (`GET https://www.when2meet.com/?<id>-<code>`)

Global variables declared with `var` in an inline script (visible only in the page's own JS world, which is why the extension injects a page script):

| Variable | Meaning |
|---|---|
| `TimeOfSlot[i]` | slot start, Unix seconds, in grid order |
| `AvailableAtSlot[i]` | array of person ids available in slot *i* (`AvailableAtSlot[i].push(id)` lines) |
| `PeopleNames[i]`, `PeopleIDs[i]` | participants; names are HTML-escaped inside single-quoted JS strings, e.g. `'A \&quot;B\&quot; C'` |
| `UserID` | signed-in person id, `0` when signed out |
| `IsMouseDown`, `ChangeToAvailable`, `FromCol`, `ToCol`, `FromRow`, `ToRow` | drag state used by `SelectStop()` |

- There is no slot-length variable: it's the smallest gap (900 s). Days can have different slot counts across DST changes.
- The event id and code are not globals; take them from `location.search`.
- The personal grid is `#YouGrid` → `#YouGridSlots`, hidden until sign-in. Cells: `<div id="YouTime<ts>" data-col data-row data-time onmousedown="SelectFromHere(event)" onmouseover="SelectToHere(event)">`. Group cells are `GroupTime<ts>`.
- Cells appear row by row in the HTML; don't use their order as slot order.

### Timezones

- **Specific dates:** slot values are real instants. The page renders in the creator's zone, then (if the viewer's zone differs) reloads the grid HTML from `AvailabilityGrids.php`. `TimeOfSlot` does not change; only `data-col`/`data-row` and labels do, and some views contain blank cells without ids (e.g. Asia/Tokyo). The extension therefore uses `TimeOfSlot` for times and the live DOM for cell positions.
- **Days of the week:** the timezone list only offers UTC; slots are clock times in a reference week, Sunday 1978-11-12 00:00 UTC = `279676800`. Monday 09:00 is `279795600`.

## Sign-in (`POST /ProcessLogin.php`)

Form fields `id`, `name`, `password`. The response body is the person id, or an error message (e.g. "Wrong password."), which the page shows with `alert()`. A new name creates a participant. The extension drives the page's own form and captures `alert()` messages instead of showing them.

## Saving (`POST /SaveTimes.php`)

Sent by `SelectStop()` (bound to `document.onmouseup`) once per drag. Fields, in this order:

| Field | Value |
|---|---|
| `person` | person id |
| `event` | numeric event id |
| `slots` | comma-joined slot timestamps of the dragged rectangle only |
| `availability` | `0`/`1` for **every** slot, reflecting the state after the drag |
| `password` | the participant's password field |
| `ChangeToAvailable` | `true` / `false` |

### Unverified

- Third-party reports disagree on whether a hand-built `SaveTimes.php` request persists (one saw 200 responses that were not stored; another reports success). A session cookie set by `ProcessLogin.php` may matter.
- Which field the server honours (`availability` vs `slots` + `ChangeToAvailable`), and whether it checks `password` on save.
- CloudFront caching of GET responses.

The extension is built to be correct under every combination: its direct strategy is valid for either field, every save is verified with an uncached GET, and it falls back to replaying drags through the page's own handler.

## Spike checklist

Run once with two throwaway polls the maintainers create (one specific-dates, one days-of-week), named e.g. "calendar-sync test — please ignore". Record results here.

1. **Capture.** In a normal browser, sign in and drag once. In DevTools → Network, "Copy as fetch" both POSTs. Note headers, cookies (is `PHPSESSID` set?), field order, CORS/CSP headers, and `X-Cache`/`Age` on the GET.
2. **Replay from the page console.** Send the captured request; the two-request scheme from `buildDirectRequests`; `slots` only; `availability` only; contradictory values; a wrong-length string; a wrong password. Check each result from a cookieless client (`curl`) twice, 10 s apart.
3. **Replay from Node** (decides the no-install web app's server relay): repeat with and without the session cookie, `Referer`, `Origin`, and `www` vs apex host.
4. **Timezone view.** Switch the viewer timezone to Asia/Tokyo and fill; confirm cells and unreachable-slot reporting.
5. Record the outcome below, set the default strategy in `executeSave` accordingly, and add the polls to the `CANARY_POLLS` repository variable.

### Results

_Not run yet._

## Canary

`tools/canary` (weekly in CI, GET only) checks that the configured polls still parse, have 900 s slots and personal-grid cells, and still reference `SelectStop`, `SaveTimes.php`, `ProcessLogin.php` and the globals above. It also fingerprints the page script with per-poll data removed; a change opens an issue. After reviewing a change, accept it with `npm run canary -- --update`.

## Sources

- [shaharsu/when2meet-outlook-autofill RECON.md](https://github.com/shaharsu/when2meet-outlook-autofill/blob/main/RECON.md) (MIT)
- [Thespaceblade/when2meet-mcp](https://github.com/Thespaceblade/when2meet-mcp), [LOGIC-10/when2meet-mcp](https://github.com/LOGIC-10/when2meet-mcp)
- [Ben-Peters/iCal-when2meet](https://github.com/Ben-Peters/iCal-when2meet), [aculich/when2meet-extractor](https://github.com/aculich/when2meet-extractor)
