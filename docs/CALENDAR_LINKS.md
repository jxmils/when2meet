# Adding a calendar by link

Any calendar that can give you an iCalendar link (`webcal://…` or `https://…ics`) works. In the extension's settings choose **Add a calendar link**, paste it, and allow access to that one site when your browser asks.

A calendar link works like a password: anyone who has it can see what the link shares. The extension keeps it only in your browser. If a link leaks, reset or unpublish it at your provider.

Prefer a **free/busy-only** link when your provider offers one; the extension needs nothing more.

## Google Calendar

1. Open [Google Calendar settings](https://calendar.google.com/calendar/r/settings).
2. Under **Settings for my calendars**, pick the calendar.
3. In **Integrate calendar**, copy **Secret address in iCal format**.

This link includes event details. Prefer **Connect Google Calendar** (free/busy only) when it's available. Some Google Workspace organizations hide the secret address.

## Outlook / Microsoft 365 (busy-only link)

1. In Outlook on the web (outlook.office.com or outlook.com), open **Settings → Calendar → Shared calendars**.
2. Under **Publish a calendar**, choose the calendar and **Can view when I'm busy**, then **Publish**.
3. Copy the **ICS** link.

This shares only free/busy times, which makes it a good choice when your organization blocks app sign-in. Some organizations turn publishing off. Published calendars can take a while to reflect changes.

## Apple iCloud

1. In Calendar on Mac, Control-click the calendar and choose **Share Calendar…**, then tick **Public Calendar**. On iCloud.com, open Calendar, click the share icon next to the calendar, and turn on **Public Calendar**.
2. Copy the link (it starts with `webcal://`).

A public iCloud calendar shows event details to anyone with the link.

## Other providers

Look for **Share**, **Publish**, **Subscribe** or **iCal / ICS link** in the calendar's settings:

- **Proton Calendar:** calendar settings → **Share with anyone** → create a link (choose the limited, busy-only view if offered).
- **Fastmail:** Settings → Calendars → the calendar → **Sharing** → publish an iCalendar link (free/busy only if offered).
- **Nextcloud:** Calendar app → the calendar's **⋯** menu → **Share link** → copy the subscription link.

## One-time import

If your calendar can only export a file, use **Import an .ics file**. It's a snapshot: import again when your calendar changes.
