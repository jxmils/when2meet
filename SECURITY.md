# Security policy

Please report vulnerabilities privately through GitHub: **Security → Report a vulnerability** on this repository. Don't open a public issue. We aim to reply within a week.

Especially important:

- Leaking OAuth tokens, calendar links or calendar data out of the extension's background context (to web pages, When2meet, or anywhere else).
- Ways for a web page to drive the extension (e.g. through the page-script channel) into saving availability the user didn't approve, or under someone else's name.
- The OAuth broker (`apps/web/worker`):
  - open redirects;
  - state forgery;
  - token leakage;
  - abuse of the token endpoints.
- Supply-chain issues in build or release workflows.

Supported versions: the latest release.
