import { googleCalendars, icsBusy, microsoftCalendars } from '@w2msync/providers';
import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import {
  type Account,
  type CalendarChoice,
  loadAccounts,
  patchAccount,
  removeAccount,
  upsertAccount,
} from '../../lib/accounts.ts';
import { revokeGoogle } from '../../lib/auth/google.ts';
import { connectAccount, getAccessToken } from '../../lib/auth/index.ts';
import { randomToken } from '../../lib/auth/pkce.ts';
import { forgetToken } from '../../lib/auth/tokens.ts';
import { computeTarget, fetchIcs, normalizeIcsUrl } from '../../lib/busy.ts';
import { features } from '../../lib/config.ts';
import { AppError } from '../../lib/errors.ts';
import { type PollChangedEvent, serve } from '../../lib/messages.ts';
import { clearSecrets, deleteSecret, getSecret, setSecret } from '../../lib/secrets.ts';
import { loadSettings } from '../../lib/settings.ts';

const POLL_TAB_PATTERNS = ['https://www.when2meet.com/*', 'https://when2meet.com/*'];

export default defineBackground(() => {
  serve({
    async getStatus() {
      return {
        accounts: await loadAccounts(),
        settings: await loadSettings(),
        features,
        redirectUrl: browser.identity.getRedirectURL(),
      };
    },

    connect: ({ provider, accountId, withCalendarList }) =>
      connectAccount(provider, {
        ...(accountId ? { accountId } : {}),
        ...(withCalendarList ? { withCalendarList } : {}),
      }),

    async disconnect({ accountId }) {
      const secret = await getSecret(accountId);
      if (accountId.startsWith('google:') && secret?.refreshToken) {
        await revokeGoogle(secret.refreshToken);
      }
      await Promise.all([
        deleteSecret(accountId),
        forgetToken(accountId),
        removeAccount(accountId),
      ]);
      return null;
    },

    async setAccount({ accountId, enabled, calendars }) {
      const account = await patchAccount(accountId, {
        ...(enabled === undefined ? {} : { enabled }),
        ...(calendars ? { calendars } : {}),
      });
      if (!account) throw new AppError('invalid', 'That calendar is no longer connected.');
      return account;
    },

    async listCalendars({ accountId }) {
      const account = (await loadAccounts()).find((a) => a.id === accountId);
      if (!account || account.provider === 'ics') {
        throw new AppError('invalid', 'That calendar is no longer connected.');
      }
      if (account.provider === 'google' && !account.canListCalendars) {
        throw new AppError(
          'needs-scope',
          'Allow access to your calendar list to choose calendars.',
        );
      }
      const client = {
        token: (o?: { forceRefresh?: boolean }) =>
          getAccessToken(account, { interactive: true, ...o }),
      };
      const list =
        account.provider === 'google'
          ? await googleCalendars(client)
          : await microsoftCalendars(client);
      const chosen = new Map(account.calendars?.map((c) => [c.id, c.enabled]));
      return list.map(
        (c): CalendarChoice => ({
          id: c.id,
          name: c.name,
          primary: c.primary,
          enabled: chosen.get(c.id) ?? (account.calendars ? false : c.primary),
        }),
      );
    },

    async addIcs({ url, text, label }) {
      const id = `ics:${randomToken(9)}`;
      const now = Date.now();
      const probe = { range: { start: now, end: now + 86_400_000 }, timeZone: 'UTC' };
      let account: Account;
      if (url) {
        const href = normalizeIcsUrl(url);
        const body = await fetchIcs(href);
        validateIcs(body, probe);
        await setSecret(id, { icsUrl: href });
        const { host, origin } = new URL(href);
        account = {
          id,
          provider: 'ics',
          label: label || host,
          enabled: true,
          addedAt: now,
          icsKind: 'url',
          icsOrigin: origin,
        };
      } else if (text) {
        validateIcs(text, probe);
        await setSecret(id, { icsText: text });
        account = {
          id,
          provider: 'ics',
          label: label || 'Calendar file',
          enabled: true,
          addedAt: now,
          icsKind: 'file',
        };
      } else {
        throw new AppError('invalid', 'Paste a calendar link or choose an .ics file.');
      }
      await upsertAccount(account);
      return account;
    },

    computeTarget: (request) => computeTarget(request),

    async pollSaved({ eventKey }, sender) {
      const tabs = await browser.tabs.query({ url: POLL_TAB_PATTERNS });
      const event: PollChangedEvent = { w2msyncEvent: 'pollChanged', eventKey };
      for (const tab of tabs) {
        if (tab.id === undefined || tab.id === sender.tabId) continue;
        if (!tab.url?.includes(`?${eventKey}`)) continue;
        browser.tabs.sendMessage(tab.id, event).catch(() => undefined);
      }
      return null;
    },

    async openOptions(input) {
      await openOptionsPage(input?.hash);
      return null;
    },

    async resetAll() {
      for (const account of await loadAccounts()) {
        const secret = await getSecret(account.id);
        if (account.provider === 'google' && secret?.refreshToken)
          await revokeGoogle(secret.refreshToken);
      }
      await Promise.all([
        browser.storage.local.clear(),
        browser.storage.session.clear(),
        clearSecrets(),
      ]);
      return null;
    },
  });

  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'install') void openOptionsPage('welcome');
  });
  browser.action.onClicked.addListener(() => void openOptionsPage());
});

function validateIcs(text: string, probe: Parameters<typeof icsBusy>[1]) {
  try {
    icsBusy(text, probe);
  } catch (error) {
    throw new AppError('invalid', (error as Error).message);
  }
}

async function openOptionsPage(hash?: string) {
  await browser.tabs.create({
    url: browser.runtime.getURL(`/options.html${hash ? `#${hash}` : ''}`),
  });
}
