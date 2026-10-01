# Self-hosting and forks

Anyone can run their own copy, for example a university that wants its own Microsoft app pre-approved for its tenant, or a fork with different branding.

## 1. Identity and branding

- Change the product name in `apps/extension/lib/config.ts` (`PRODUCT_NAME`) and `apps/extension/wxt.config.ts` (`name`, `short_name`, `description`, `homepage_url`).
- Give Firefox builds your own add-on id (`browser_specific_settings.gecko.id` in `wxt.config.ts`).
- Keep the "not affiliated with When2meet" disclaimer.

## 2. Sign-in apps (optional)

- **Google:** deploy `apps/web` to a domain you own and register a Google OAuth app. See [SETUP_GOOGLE.md](SETUP_GOOGLE.md).
- **Microsoft:** register an Entra app, which needs no server. See [SETUP_MICROSOFT.md](SETUP_MICROSOFT.md). A single-tenant registration (your organization only) can be consented once by your admins.

Leave either one out and the build still works with calendar links and `.ics` files.

## 3. Build

```bash
cp apps/extension/.env.example apps/extension/.env   # fill in what you set up
npm ci
npm run build:all        # Chrome, Edge, Firefox builds in apps/extension/.output/
npm run zip              # store-ready zips (and the Firefox sources zip)
```

After the first install, add each build's redirect URL (settings → **Advanced**) to:

- the Worker's `ALLOWED_REDIRECTS`;
- the Entra app's SPA redirect URIs.

## 4. Distribute

- **Chrome / Edge in an organization:** publish as an unlisted or private item in the Chrome Web Store or Edge Add-ons, or force-install with enterprise policy (`ExtensionInstallForcelist`).
- **Firefox:** sign an unlisted version on [addons.mozilla.org](https://addons.mozilla.org/developers/) and host the `.xpi` yourself, or deploy it with enterprise policies.
- **Public stores:** follow [PUBLISHING.md](PUBLISHING.md).
