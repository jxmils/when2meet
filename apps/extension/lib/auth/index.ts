import { GOOGLE_SCOPES } from '@w2msync/providers';
import { type Account, loadAccounts, patchAccount, upsertAccount } from '../accounts.ts';
import { AppError } from '../errors.ts';
import { getSecret, setSecret } from '../secrets.ts';
import { authorizeGoogle, refreshGoogle } from './google.ts';
import { authorizeMicrosoft, refreshMicrosoft } from './microsoft.ts';
import { cachedToken, cacheToken } from './tokens.ts';

/** Signs in (interactive) and stores the account. Reconnecting keeps the calendar choices. */
export async function connectAccount(
  provider: 'google' | 'microsoft',
  options: { accountId?: string; withCalendarList?: boolean } = {},
): Promise<Account> {
  const existing = options.accountId
    ? (await loadAccounts()).find((a) => a.id === options.accountId)
    : undefined;
  const loginHint = existing?.email;

  if (provider === 'google') {
    const grant = await authorizeGoogle({
      ...(loginHint ? { loginHint } : {}),
      withCalendarList: options.withCalendarList || existing?.canListCalendars === true,
    });
    const id = `google:${grant.email.toLowerCase() || 'account'}`;
    const account = await store(
      id,
      existing,
      grant.refreshToken,
      grant.accessToken,
      grant.expiresIn,
      {
        provider: 'google',
        label: grant.email || 'Google Calendar',
        email: grant.email,
        canListCalendars: grant.scopes.includes(GOOGLE_SCOPES.calendarList),
      },
    );
    return account;
  }

  const grant = await authorizeMicrosoft({
    ...(loginHint ? { loginHint } : {}),
    interactive: true,
  });
  return store(
    `microsoft:${grant.accountKey}`,
    existing,
    grant.refreshToken,
    grant.accessToken,
    grant.expiresIn,
    {
      provider: 'microsoft',
      label: grant.email || grant.name || 'Microsoft account',
      email: grant.email,
      canListCalendars: true,
    },
  );
}

async function store(
  id: string,
  existing: Account | undefined,
  refreshToken: string | undefined,
  accessToken: string,
  expiresIn: number,
  fields: Pick<Account, 'provider' | 'label' | 'email' | 'canListCalendars'>,
): Promise<Account> {
  const previous = existing?.id === id ? existing : (await loadAccounts()).find((a) => a.id === id);
  const account: Account = {
    id,
    enabled: true,
    addedAt: previous?.addedAt ?? Date.now(),
    needsReconnect: false,
    ...fields,
    ...(previous?.calendars ? { calendars: previous.calendars } : {}),
  };
  const secret = (await getSecret(id)) ?? {};
  if (refreshToken) await setSecret(id, { ...secret, refreshToken });
  await cacheToken(id, accessToken, expiresIn);
  await upsertAccount(account);
  return account;
}

/**
 * A valid access token for an OAuth account: cached, else refreshed. Microsoft refresh tokens
 * for browser apps expire after a day, so a silent sign-in is tried before giving up. With
 * `interactive` false this never opens a window and throws `reconnect` instead.
 */
export async function getAccessToken(
  account: Account,
  options: { interactive: boolean; forceRefresh?: boolean },
): Promise<string> {
  if (!options.forceRefresh) {
    const cached = await cachedToken(account.id);
    if (cached) return cached;
  }
  const secret = await getSecret(account.id);
  try {
    if (!secret?.refreshToken) throw new AppError('reconnect', `Reconnect ${account.label}.`);
    const refreshed =
      account.provider === 'google'
        ? await refreshGoogle(secret.refreshToken)
        : await refreshMicrosoft(secret.refreshToken);
    if (refreshed.refreshToken && refreshed.refreshToken !== secret.refreshToken) {
      await setSecret(account.id, { ...secret, refreshToken: refreshed.refreshToken });
    }
    await cacheToken(account.id, refreshed.accessToken, refreshed.expiresIn);
    if (account.needsReconnect) await patchAccount(account.id, { needsReconnect: false });
    return refreshed.accessToken;
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== 'reconnect') throw error;
    if (account.provider === 'microsoft') {
      const silent = await authorizeMicrosoft({
        ...(account.email ? { loginHint: account.email } : {}),
        interactive: false,
      }).catch(() => null);
      if (silent) {
        if (silent.refreshToken)
          await setSecret(account.id, { ...secret, refreshToken: silent.refreshToken });
        await cacheToken(account.id, silent.accessToken, silent.expiresIn);
        return silent.accessToken;
      }
    }
    if (
      options.interactive &&
      (account.provider === 'google' || account.provider === 'microsoft')
    ) {
      await connectAccount(account.provider, { accountId: account.id });
      const token = await cachedToken(account.id);
      if (token) return token;
    }
    await patchAccount(account.id, { needsReconnect: true });
    throw new AppError('reconnect', `Reconnect ${account.label} in settings to keep reading it.`);
  }
}
