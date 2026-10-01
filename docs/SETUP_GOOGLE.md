# Set up Google sign-in

One-click Google sign-in needs three things you control: a domain, the OAuth broker Worker on that domain, and a Google Cloud OAuth app. Until Google verifies the app, at most 100 people can use it, and they see an "unverified app" warning. Calendar links work meanwhile.

## 1. Domain and Worker

You need a domain you can add DNS records to (Google verifies ownership), and a free Cloudflare account.

```bash
cd apps/web
npx wrangler login
npx wrangler deploy
```

In the Cloudflare dashboard: **Workers & Pages → when2meet-calendar-sync → Settings → Domains & Routes → Add → Custom domain**, e.g. `calendar-sync.example.org`. Check that `https://calendar-sync.example.org/privacy` loads.

Set the two secrets:

```bash
npx wrangler secret put STATE_SECRET           # paste the output of: openssl rand -base64 32
npx wrangler secret put GOOGLE_CLIENT_SECRET   # from step 2
```

## 2. Google Cloud project

1. Create a project at [console.cloud.google.com](https://console.cloud.google.com).
2. **APIs & Services → Library**: enable **Google Calendar API**.
3. **Google Auth Platform → Branding**:
   - App name, user support email and logo.
   - Home page `https://<your domain>/`, privacy policy `https://<your domain>/privacy`, terms `https://<your domain>/terms`.
   - Authorized domain: `<your domain>`.
4. **Audience**: External. While testing, add test users (up to 100).
5. **Data Access**: add these scopes:
   - `openid`
   - `.../auth/userinfo.email`
   - `https://www.googleapis.com/auth/calendar.freebusy`
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
6. **Clients → Create client → Web application**. Add the authorized redirect URI `https://<your domain>/oauth/google/callback`. Copy the client ID and secret.
7. Verify the domain in [Google Search Console](https://search.google.com/search-console) as a **Domain** property (DNS TXT record).

## 3. Connect the pieces

1. In `apps/web/wrangler.jsonc`, set `GOOGLE_CLIENT_ID` to the client ID. Set the client secret with `wrangler secret put` (step 1).
2. In `apps/extension/.env`, set `WXT_GOOGLE_BROKER_URL=https://<your domain>`, then build: `npm run build:all`.
3. Load the extension. Open its settings → **Advanced** and copy the **Redirect URL** (e.g. `https://<id>.chromiumapp.org/`).
4. Add it to `ALLOWED_REDIRECTS` in `wrangler.jsonc` (comma-separated) and `npx wrangler deploy` again.

Each browser store assigns its own extension id, so add one redirect URL per store: Chrome Web Store, Edge Add-ons and Firefox (`https://<hash>.extensions.allizom.org/`). Unpacked development builds get yet another id unless you pin it with `W2M_EXTENSION_KEY` (the public key from the Chrome Web Store item).

## 4. Test, then request verification

1. With a test user, click **Connect Google Calendar** in the extension settings and fill a poll.
2. **Audience → Publish app**. Then submit for verification under **Verification Center**. You will need:
   - a justification for each sensitive scope, e.g. "Free/busy times are used only to mark the user available in When2meet polls they choose to fill; no event details are read";
   - an unlisted YouTube video showing the consent screen (with the client ID visible in the address bar) and the extension filling a poll;
   - the verified domain, home page and privacy policy from above.

Google typically takes a few business days for sensitive scopes; it can take longer if they ask questions.

## Troubleshooting

- **"This copy of the extension is not registered"**: the extension's redirect URL isn't in `ALLOWED_REDIRECTS`.
- **`redirect_uri_mismatch` from Google**: the Web client's redirect URI must be exactly `https://<your domain>/oauth/google/callback`.
- **`not_configured` (HTTP 503)**: a Worker variable or secret is missing.
