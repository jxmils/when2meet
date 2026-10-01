# Set up Microsoft sign-in

Microsoft sign-in needs no server: the extension uses authorization code + PKCE as a single-page application, with no client secret.

## 1. Register the app

1. Open the [Microsoft Entra admin center](https://entra.microsoft.com) → **Identity → Applications → App registrations → New registration**.
2. Fill in the registration:
   - **Name:** e.g. "Calendar Sync for When2meet".
   - **Supported account types:** *Accounts in any organizational directory and personal Microsoft accounts*.
   - **Redirect URI:** platform **Single-page application (SPA)**, value = the extension's redirect URL. Find it in the extension's settings → **Advanced**, e.g. `https://<id>.chromiumapp.org/`.
3. **Authentication**: add one SPA redirect URI per browser store and dev build:
   - Chrome Web Store: `https://<chrome-id>.chromiumapp.org/`
   - Edge Add-ons: `https://<edge-id>.chromiumapp.org/`
   - Firefox: `https://<hash>.extensions.allizom.org/`
4. **API permissions → Add a permission → Microsoft Graph → Delegated**: add `Calendars.ReadBasic`, `offline_access`, `openid` and `profile`. Remove `User.Read` if it was added by default; it isn't used.
5. **Branding & properties**: set the home page, terms (`https://<your domain>/terms`) and privacy statement (`https://<your domain>/privacy`) URLs and a logo.
6. Do **not** create a client secret.

Copy the **Application (client) ID** into `apps/extension/.env`:

```
WXT_MICROSOFT_CLIENT_ID=00000000-0000-0000-0000-000000000000
```

Then rebuild (`npm run build:all`).

## 2. Organizations and consent

Personal accounts (outlook.com, hotmail.com) can connect straight away. Many work and school tenants don't let users approve calendar permissions for third-party apps; those users see "needs admin approval". Options:

- **Publisher verification.** Link the app to a verified Microsoft AI Cloud Partner Program account (Branding & properties → Publisher verification). Verified apps are trusted more by default consent policies, but some tenants still require admin approval for calendar access.
- **Admin consent per organization.** Send IT [IT_ADMINS.md](IT_ADMINS.md).
- **No approval needed.** Users can add a busy-only published Outlook calendar link instead ([CALENDAR_LINKS.md](CALENDAR_LINKS.md#outlook--microsoft-365-busy-only-link)).

## Notes

- Refresh tokens issued to single-page apps last 24 hours. After that, the extension tries a silent sign-in, then asks the user to reconnect.
- `login.microsoftonline.com` must not be added to the extension's `host_permissions`. Token requests need the `Origin` header that only cross-origin requests carry.
