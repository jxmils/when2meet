# Contributing

Thanks for helping! Bug reports, fixes, provider support and translations are all welcome.

## Setup

```bash
nvm use            # Node 24 (see .nvmrc)
npm install
npm test           # unit tests
npm run e2e        # builds the extension and runs Playwright end-to-end tests
npm run lint       # Biome (format + lint); `npm run format` fixes most issues
npm run typecheck
```

`npm run dev` opens Chrome with the extension loaded. `npm run mock` starts a local mock When2meet. Build with `W2M_DEV_HOSTS=1` so the extension also runs on `http://localhost`.

## Where things go

- **Pure logic** goes in `packages/core`, with unit tests. This covers time math, rules and planning.
- **When2meet specifics** go in `packages/when2meet`. Keep `parse.ts` DOM-free.
- **Calendar providers** go in `packages/providers`, tested with a fake `fetch`.
- **UI and browser APIs** go in `apps/extension`.

## Rules of the road

- **Privacy first.**
  - Don't add scopes, permissions or network destinations without an issue discussing why.
  - Calendar data must not leave the background script, except as availability bits.
- **Don't commit When2meet's code or pages.** Tests use the synthetic pages in `packages/when2meet/src/testing`. If When2meet's behaviour changes, update `docs/WHEN2MEET_INTERNALS.md` and the synthetic page together.
- **Be gentle with When2meet.** No background polling, and at most two save requests per fill on the normal path.
- **Tests:**
  - Add a test with every fix.
  - Time-related changes need DST and weekday-poll cases.
  - Planning changes must keep the property tests in `packages/core/test/overrides.test.ts` passing.
- **Small PRs** with a clear description are easiest to review.
