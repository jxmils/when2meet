# Privacy policy

_Last updated: 1 October 2026. The same policy is published at `https://<project site>/privacy`._

Calendar Sync for When2meet ("the extension") is a free, open-source browser extension that fills your availability on When2meet polls from your calendars. The [source code](https://github.com/jxmils/when2meet) is public, so every statement below can be checked.

## Summary

- Your calendar is read by the extension in your browser. We run no servers that receive calendar data.
- Only free/busy times are used. Event titles, descriptions, attendees and locations are not requested from Google or Microsoft.
- When you click **Save**, the extension sends When2meet your availability for that poll and the name you chose. This is the same information you would send by filling the poll by hand.
- No selling, sharing, analytics or ads.

## Data the extension accesses

### Google Calendar (if you connect it)

- `calendar.freebusy`: busy time ranges of your calendars, without event details.
- `calendar.calendarlist.readonly`: calendar names, so you can choose which ones count. Requested only if you choose calendars.
- `openid` and `email`: your email address, to label the account.

### Microsoft 365 / Outlook (if you connect it)

- `Calendars.ReadBasic`: start and end times and "show as" status of events. Microsoft defines this permission as excluding bodies and attachments.
- `openid`, `profile`, `offline_access`: your sign-in name, and staying connected.

### Calendar links and files (if you add them)

The extension reads them in your browser. It uses only event times and free/busy status and discards the rest.

### When2meet pages

The poll's time slots and the publicly visible availability of participants. These are used to preview changes and suggest the best times.

## How data is used

Calendar information is used only to work out which poll slots you are free in, at your request, and to show what would change.

## Where data is stored

- **In your browser:**
  - settings and the list of connected calendars;
  - sign-in tokens and calendar links;
  - a record of what was filled on each poll, so later updates keep your manual edits. Records are deleted about 90 days after a poll's last date.
- **Busy times:** in browser memory for up to 5 minutes.
- **On our servers:** nothing.

## What leaves your browser

- **To Google or Microsoft:** the requests needed to read your free/busy times.
- **To When2meet, when you save:** your availability for that poll, your chosen name, and the poll password if you set one.
- **To the sign-in service:** during Google sign-in only, see below.

## Sign-in service

Google requires a web server to complete sign-in for this kind of app. The project's small open-source sign-in service (`/oauth/` on the project website):

- forwards Google's one-time sign-in code to your extension;
- adds the app's credentials when the extension exchanges or refreshes its access.

Codes and tokens pass through it in memory only. It does not store or log them, and it never reads your calendar. Microsoft sign-in does not use it.

## Google API Services User Data Policy

The extension's use and transfer of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

Google user data is:

- used only to provide the feature described above;
- not transferred to anyone except as needed to provide it (When2meet receives your availability when you save);
- not used for advertising;
- not read by humans.

## Your choices

- Disconnect any calendar in settings. Disconnecting a Google account revokes its access.
- Use **Disconnect everything and erase data** in settings. Uninstalling the extension also deletes its data.
- Revoke access at any time from your [Google account](https://myaccount.google.com/permissions) or [Microsoft account](https://myapps.microsoft.com/).
- Availability you saved stays on When2meet. Remove it there, or use **Undo** right after saving.

## Children

The extension is not directed to children under 13.

## Changes

Changes are published here and on the project website, with the date updated.

## Contact

Open an issue at [github.com/jxmils/when2meet/issues](https://github.com/jxmils/when2meet/issues).
