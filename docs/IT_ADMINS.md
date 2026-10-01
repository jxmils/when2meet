# For IT administrators

Calendar Sync for When2meet is a free, open-source browser extension ([source](https://github.com/jxmils/when2meet)). It fills a user's availability on When2meet polls from their calendar, when the user asks it to.

## What it accesses

| Provider | Permission | Used for |
|---|---|---|
| Microsoft Graph | `Calendars.ReadBasic` (delegated) | event start/end times and "show as" status; Microsoft defines this permission as excluding bodies and attachments |
| Microsoft Graph | `openid`, `profile`, `offline_access` | showing which account is connected and keeping it connected |
| Google Calendar | `calendar.freebusy` | busy time ranges only, with no event details |
| Google Calendar | `calendar.calendarlist.readonly` (optional) | calendar names, so users can pick calendars |
| Google | `openid`, `email` | showing which account is connected |

Calendar data is processed in the user's browser and is not sent to the project's servers. Only availability slots the user chooses to save, and their chosen display name, are sent to When2meet. Full details: [privacy policy](PRIVACY.md).

## Microsoft 365: grant admin consent

If users see "Need admin approval", a Global Administrator, Cloud Application Administrator or Application Administrator can approve the app for the whole organization:

- **Consent link.** Open `https://login.microsoftonline.com/<your-tenant-id-or-domain>/adminconsent?client_id=<application-id>`.
  - The application (client) id is shown in the extension's settings under **Advanced**.
  - Review the permissions and accept.
- **Or in the Entra admin center.** After a user has tried to sign in, go to **Enterprise applications** → the app → **Permissions** → **Grant admin consent**.

To review or revoke access later, use **Enterprise applications** → the app → **Properties** and **Permissions**.

## Google Workspace: allow the app

Go to **Admin console → Security → Access and data control → API controls → Manage Third-Party App Access → Configure new app**. Search for the OAuth client ID, then set the access level (for example *Trusted*, or *Limited* to specific groups).

## Without approving the app

Users can share a busy-only calendar link instead. In Outlook on the web, that is **Settings → Calendar → Shared calendars → Publish a calendar → Can view when I'm busy**. This only works if your organization allows calendar publishing. See [CALENDAR_LINKS.md](CALENDAR_LINKS.md).

## Running your own copy

Organizations can build the extension with their own Google and Microsoft app registrations and distribute it internally. See [SELF_HOSTING.md](SELF_HOSTING.md).
