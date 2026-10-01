# Publishing checklist

## Before the first release

- [ ] Run the live checks in [WHEN2MEET_INTERNALS.md](WHEN2MEET_INTERNALS.md#spike-checklist) and record the results.
- [ ] Deploy `apps/web` to your domain; check `/`, `/privacy` and `/terms` load.
- [ ] Put a real contact address in the privacy policy (`apps/web/public/privacy.html` and `docs/PRIVACY.md`).
- [ ] Optional sign-in: [SETUP_GOOGLE.md](SETUP_GOOGLE.md) and [SETUP_MICROSOFT.md](SETUP_MICROSOFT.md).
- [ ] Bump `version` in `apps/extension/package.json` and tag `vX.Y.Z`.

## Chrome Web Store

**Account:** register at the [developer dashboard](https://chrome.google.com/webstore/devconsole). There is a one-time $5 fee.

**Upload:** `calendar-sync-for-when2meet-<version>-chrome.zip`.

**Listing:**
- Name, summary and description, from the README.
- Category: Productivity.
- Icon: `apps/extension/public/icon/128.png`.
- Screenshots: 1280×800, regenerate with `SCREENSHOTS=1 npx playwright test e2e/screenshots.spec.ts`.

**Privacy practices:**
- **Single purpose:** "Fill the user's availability on When2meet polls from the calendars they connect."
- **Permission justifications:**
  - `storage`: settings, connected-calendar list and per-poll fill records, kept in the browser.
  - `identity`: sign in to Google and Microsoft calendars with the browser's OAuth window.
  - Host `www.when2meet.com`: show the fill button on poll pages, and read and save the user's own availability.
  - Host `<your domain>`: complete Google sign-in through the project's OAuth broker.
  - Optional host `https://*/*`: read calendar links (`.ics`) the user adds. Requested for one site at a time.
- **Remote code:** none.
- **Data usage:** describe calendar free/busy data and the user's display name as used only for the single purpose. Certify the Limited Use policy. Link the privacy policy `https://<your domain>/privacy`.

**After the first upload:**
- Put the item's id in Google/Microsoft redirect URIs (`https://<id>.chromiumapp.org/`).
- Optionally set `W2M_EXTENSION_KEY` so dev builds share the id.

## Firefox Add-ons (AMO)

**Account:** register at [addons.mozilla.org/developers](https://addons.mozilla.org/developers/) (free).

**Upload:**
- `…-firefox.zip`.
- When asked for source code, `…-sources.zip`.
- Build instructions for reviewers: "Node 24, `npm ci`, `npm run build -w @w2msync/extension -- -b firefox --mv3`. Output: `apps/extension/.output/firefox-mv3`."

**Data collection:** the manifest declares `data_collection_permissions: { required: ["none"] }`. Calendar data never reaches the developer; availability goes to When2meet only when the user saves.

**Redirect URL:** Firefox's is `https://<hash>.extensions.allizom.org/` (settings → Advanced). Add it to `ALLOWED_REDIRECTS` and to the Entra app.

## Edge Add-ons

**Account:** register in [Partner Center](https://partner.microsoft.com/dashboard/microsoftedge) (free).

**First submission:** manual, with `…-edge.zip`. Edge assigns its own extension id; add its redirect URL as above.

## Automated releases

`.github/workflows/release.yml` runs on `v*` tags. It builds and zips every browser and attaches the zips to a GitHub Release. It then submits to the stores whose secrets are configured.

**Repository variables:**

| Variable | Value |
|---|---|
| `WXT_GOOGLE_BROKER_URL` | broker URL from SETUP_GOOGLE.md |
| `WXT_MICROSOFT_CLIENT_ID` | Entra application id |

**Repository secrets:**

| Store | Secrets |
|---|---|
| Chrome (Web Store API v2) | `CHROME_EXTENSION_ID`, `CHROME_PUBLISHER_ID`, `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN` |
| Firefox | `FIREFOX_EXTENSION_ID`, `FIREFOX_JWT_ISSUER`, `FIREFOX_JWT_SECRET` |
| Edge | `EDGE_PRODUCT_ID`, `EDGE_CLIENT_ID`, `EDGE_API_KEY` |

Generate the values with `npx wxt submit init`.

`.github/workflows/deploy-web.yml` deploys `apps/web` when it changes on `main`. It needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
