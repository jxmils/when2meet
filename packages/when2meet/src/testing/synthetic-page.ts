/**
 * Synthetic When2meet-like poll pages for tests, the mock server and end-to-end runs.
 *
 * The markup and script below are written from scratch. They reproduce only the interface the
 * extension relies on (global variable names, element ids, handler names and request fields), not
 * When2meet's own code. Never commit real When2meet HTML or JavaScript to this repository.
 */
import {
  addDays,
  dayOfWeek,
  detectPollKind,
  localDate,
  parseClock,
  parsePlainDate,
  possibleInstants,
  type UnixSec,
  WEEKDAY_REFERENCE_SUNDAY,
  weekdaySlotParts,
  zonedParts,
} from '@w2msync/core';
import type { Cell } from '../types.ts';

export interface SyntheticPerson {
  id: number;
  name: string;
  password?: string;
}

export interface SyntheticPoll {
  id: number;
  code: string;
  name: string;
  slots: UnixSec[];
  people: SyntheticPerson[];
  /** Person id → slots they marked available. */
  availability: Map<number, Set<UnixSec>>;
  /** Timezone the poll was created in (only meaningful for specific-date polls). */
  timeZone: string;
}

interface PollBasics {
  id: number;
  code: string;
  name: string;
  from: string;
  to: string;
  slotMinutes?: number;
}

/**
 * A specific-dates poll over `days` consecutive dates from `startDate` (optionally only on some
 * weekdays, e.g. a term of Monday–Friday), `from`–`to` local time.
 */
export function makeDatesPoll(
  options: PollBasics & {
    startDate: string;
    days: number;
    timeZone: string;
    daysOfWeek?: number[];
  },
): SyntheticPoll {
  const slotSec = (options.slotMinutes ?? 15) * 60;
  const fromSec = parseClock(options.from) * 60;
  const toSec = parseClock(options.to) * 60;
  const slots: UnixSec[] = [];
  for (let d = 0; d < options.days; d++) {
    const day = addDays(options.startDate, d);
    if (options.daysOfWeek && !options.daysOfWeek.includes(dayOfWeek(day))) continue;
    const date = parsePlainDate(day);
    for (let s = fromSec; s < toSec; s += slotSec) {
      const wall = {
        ...date,
        hour: Math.floor(s / 3600),
        minute: Math.floor((s % 3600) / 60),
        second: 0,
      };
      const instant = possibleInstants(wall, options.timeZone)[0];
      if (instant !== undefined) slots.push(instant / 1000);
    }
  }
  return basePoll(
    options,
    [...new Set(slots)].sort((a, b) => a - b),
    options.timeZone,
  );
}

/** A days-of-the-week poll (0 = Sunday), `from`–`to` on each day. */
export function makeWeekdayPoll(options: PollBasics & { days: number[] }): SyntheticPoll {
  const slotSec = (options.slotMinutes ?? 15) * 60;
  const fromSec = parseClock(options.from) * 60;
  const toSec = parseClock(options.to) * 60;
  const slots: UnixSec[] = [];
  for (const day of [...options.days].sort((a, b) => a - b)) {
    for (let s = fromSec; s < toSec; s += slotSec) {
      slots.push(WEEKDAY_REFERENCE_SUNDAY + day * 86_400 + s);
    }
  }
  return basePoll(options, slots, 'UTC');
}

function basePoll(options: PollBasics, slots: UnixSec[], timeZone: string): SyntheticPoll {
  return {
    id: options.id,
    code: options.code,
    name: options.name,
    slots,
    people: [],
    availability: new Map(),
    timeZone,
  };
}

/**
 * Personal-grid layout: one column per day, one row per clock time, aligned across columns.
 * Days lacking a clock time (for example after a timezone shift) get blank cells.
 */
export function gridLayout(poll: SyntheticPoll, viewerTimeZone = poll.timeZone): Cell[] {
  const weekdays = detectPollKind(poll.slots) === 'weekdays';
  const placed = poll.slots.map((slot) => {
    if (weekdays) {
      const { day, secondOfDay } = weekdaySlotParts(slot);
      return { slot, day: String(day), time: secondOfDay };
    }
    const p = zonedParts(slot * 1000, viewerTimeZone);
    return {
      slot,
      day: localDate(slot * 1000, viewerTimeZone),
      time: p.hour * 3600 + p.minute * 60 + p.second,
    };
  });
  const days = [...new Set(placed.map((p) => p.day))].sort();
  const times = [...new Set(placed.map((p) => p.time))].sort((a, b) => a - b);
  return placed.map((p) => ({
    slot: p.slot,
    col: days.indexOf(p.day),
    row: times.indexOf(p.time),
  }));
}

export interface RenderOptions {
  viewerTimeZone?: string;
  /** Leave these slots without a personal-grid cell. */
  hideCells?: ReadonlySet<UnixSec>;
}

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string,
  );

/** Name as a single-quoted JS string literal, HTML-escaped the way poll pages write names. */
const jsName = (name: string) => `'${escapeHtml(name).replace(/&/g, '\\&')}'`;

export function renderEventPage(poll: SyntheticPoll, options: RenderOptions = {}): string {
  const viewerTimeZone = options.viewerTimeZone ?? poll.timeZone;
  const cells = gridLayout(poll, viewerTimeZone).filter((c) => !options.hideCells?.has(c.slot));
  const cols = Math.max(0, ...cells.map((c) => c.col + 1));
  const rows = Math.max(0, ...cells.map((c) => c.row + 1));
  const at = new Map(cells.map((c) => [`${c.col}:${c.row}`, c]));

  const grid = (prefix: 'YouTime' | 'GroupTime') => {
    const out: string[] = [];
    for (let r = 0; r < rows; r++) {
      out.push('<div class="row">');
      for (let c = 0; c < cols; c++) {
        const cell = at.get(`${c}:${r}`);
        if (!cell) {
          out.push('<div class="cell blank"></div>');
        } else if (prefix === 'YouTime') {
          out.push(
            `<div id='YouTime${cell.slot}' class='cell' data-col="${c}" data-row="${r}" data-time="${cell.slot}" onmousedown='SelectFromHere(event);' onmouseover='SelectToHere(event);'></div>`,
          );
        } else {
          out.push(
            `<div id='GroupTime${cell.slot}' class='cell' data-col="${c}" data-row="${r}"></div>`,
          );
        }
      }
      out.push('</div>');
    }
    return out.join('\n');
  };

  const data: string[] = [
    'var PeopleNames = new Array(); var PeopleIDs = new Array(); var UserID = 0;',
    'var TimeOfSlot = new Array(); var AvailableAtSlot = new Array();',
  ];
  poll.slots.forEach((ts, i) => {
    data.push(`TimeOfSlot[${i}]=${ts};`, `AvailableAtSlot[${i}]=new Array();`);
  });
  poll.people.forEach((p, i) => {
    data.push(`PeopleNames[${i}] = ${jsName(p.name)};PeopleIDs[${i}] = ${p.id};`);
  });
  poll.slots.forEach((ts, i) => {
    for (const p of poll.people) {
      if (poll.availability.get(p.id)?.has(ts)) data.push(`AvailableAtSlot[${i}].push(${p.id});`);
    }
  });

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(poll.name)} - When2meet</title>
<style>
body { font-family: sans-serif; }
.row { display: flex; }
.cell { width: 44px; height: 10px; border: 1px solid #bbb; background: #ffdede; }
.cell.blank { background: transparent; border-color: transparent; }
#GroupGrid .cell { background: #fff; }
</style>
</head>
<body>
<div id="NewEventNameDiv">${escapeHtml(poll.name)}<br><span>Synthetic test poll ${poll.id}-${poll.code}</span></div>
<div id="SignIn">
  <label>Name <input id="name" name="name" type="text"></label>
  <label>Password (optional) <input id="password" name="password" type="password"></label>
  <input type="button" value="Sign In" onclick="ProcessLogin();">
</div>
<select id="ParticipantTimeZone"><option value="${escapeHtml(viewerTimeZone)}" selected>${escapeHtml(viewerTimeZone)}</option></select>
<div id="YouGrid" style="display:none"><h3>Your Availability</h3><div id="YouGridSlots">
${grid('YouTime')}
</div></div>
<div id="GroupGrid"><h3>Group's Availability</h3><div id="GroupGridSlots">
${grid('GroupTime')}
</div></div>
<script type="text/javascript">
${data.join('\n')}
var IsMouseDown = false; var ChangeToAvailable = true;
var FromCol = 0, ToCol = 0, FromRow = 0, ToRow = 0;
var select = document.getElementById("ParticipantTimeZone");
if (select.value != "${escapeHtml(poll.timeZone)}") { /* a real page would redraw the grid here */ }
function ProcessLogin() {
  var params = new URLSearchParams();
  params.append('id', '${poll.id}');
  params.append('name', document.getElementById('name').value);
  params.append('password', document.getElementById('password').value);
  fetch("ProcessLogin.php", { method: "POST", body: params })
    .then(function (r) { return r.text(); })
    .then(function (text) {
      var personId = parseInt(text);
      if (personId) {
        UserID = personId;
        if (PeopleIDs.indexOf(personId) == -1) {
          PeopleIDs.push(personId);
          PeopleNames.push(document.getElementById('name').value);
        }
        document.getElementById('SignIn').style.display = 'none';
        document.getElementById('YouGrid').style.display = '';
        ReColorIndividual();
      } else {
        alert(text);
      }
    });
}
function cellOf(event) { var el = event.target; return el && el.dataset && el.dataset.time ? el : null; }
function SelectFromHere(event) {
  var el = cellOf(event); if (!el || !UserID) return;
  IsMouseDown = true;
  FromCol = ToCol = +el.dataset.col; FromRow = ToRow = +el.dataset.row;
  var i = TimeOfSlot.indexOf(+el.dataset.time);
  ChangeToAvailable = AvailableAtSlot[i].indexOf(UserID) == -1;
}
function SelectToHere(event) {
  var el = cellOf(event); if (!el || !IsMouseDown) return;
  ToCol = +el.dataset.col; ToRow = +el.dataset.row;
}
function SelectStop() {
  if (!IsMouseDown) return;
  IsMouseDown = false;
  var minC = Math.min(FromCol, ToCol), maxC = Math.max(FromCol, ToCol);
  var minR = Math.min(FromRow, ToRow), maxR = Math.max(FromRow, ToRow);
  var toggled = [];
  document.querySelectorAll('#YouGridSlots [data-time]').forEach(function (c) {
    var col = +c.dataset.col, row = +c.dataset.row;
    if (col < minC || col > maxC || row < minR || row > maxR) return;
    var ts = +c.dataset.time, i = TimeOfSlot.indexOf(ts), k = AvailableAtSlot[i].indexOf(UserID);
    if (ChangeToAvailable && k == -1) AvailableAtSlot[i].push(UserID);
    if (!ChangeToAvailable && k != -1) AvailableAtSlot[i].splice(k, 1);
    toggled.push(ts);
  });
  var binary = '';
  for (var i = 0; i < TimeOfSlot.length; i++) binary += AvailableAtSlot[i].indexOf(UserID) != -1 ? '1' : '0';
  var params = new URLSearchParams();
  params.append('person', UserID);
  params.append('event', ${poll.id});
  params.append('slots', toggled.join(','));
  params.append('availability', binary);
  params.append('password', document.getElementById('password').value);
  params.append('ChangeToAvailable', ChangeToAvailable);
  fetch('SaveTimes.php', { method: 'POST', body: params })
    .then(function (r) { return r.text(); })
    .then(function (d) { console.log(d); });
  ReColorIndividual();
  ReColorGroup();
}
document.onmouseup = SelectStop;
function ReColorIndividual() {
  document.querySelectorAll('#YouGridSlots [data-time]').forEach(function (c) {
    var i = TimeOfSlot.indexOf(+c.dataset.time);
    c.style.background = AvailableAtSlot[i].indexOf(UserID) != -1 ? '#339900' : '#ffdede';
  });
}
function ReColorGroup() {
  var most = Math.max(1, PeopleIDs.length);
  document.querySelectorAll('#GroupGridSlots [id^=GroupTime]').forEach(function (c) {
    var i = TimeOfSlot.indexOf(+c.id.slice(9));
    c.style.background = 'rgba(51,153,0,' + (AvailableAtSlot[i].length / most) + ')';
  });
}
ReColorGroup();
</script>
</body>
</html>
`;
}
