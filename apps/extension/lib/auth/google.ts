/**
 * Google sign-in through the project's OAuth broker (apps/web). The broker holds the client
 * secret and is the only redirect URI Google sees; every hop is an HTTP redirect, which is what
 * `identity.launchWebAuthFlow` needs in Chrome, Edge and Firefox alike.
 */
import { GOOGLE_SCOPES } from '@w2msync/providers';
import { browser } from 'wxt/browser';
import { GOOGLE_BROKER_URL } from '../config.ts';
import { AppError } from '../errors.ts';
import { createPkce, decodeJwtClaims, randomToken } from './pkce.ts';
import type { TokenResponse } from './tokens.ts';

export interface Grant {
  email: string;
  accessToken: string;
  expiresIn: number;
  refreshToken?: string;
  scopes: string[];
}

export async function authorizeGoogle(options: {
  loginHint?: string;
  withCalendarList?: boolean;
}): Promise<Grant> {
  if (!GOOGLE_BROKER_URL) {
    throw new AppError(
      'not-configured',
      'Google sign-in is not set up in this build. Add your calendar with a link instead.',
    );
  }
  const redirectUri = browser.identity.getRedirectURL();
  const { verifier, challenge } = await createPkce();
  const state = randomToken(16);
  const scopes = [
    'openid',
    'email',
    GOOGLE_SCOPES.freeBusy,
    ...(options.withCalendarList ? [GOOGLE_SCOPES.calendarList] : []),
  ];
  const start = new URL(`${GOOGLE_BROKER_URL}/oauth/google/start`);
  start.search = new URLSearchParams({
    redirect_uri: redirectUri,
    state,
    code_challenge: challenge,
    scope: scopes.join(' '),
    prompt: 'select_account consent',
    ...(options.loginHint ? { login_hint: options.loginHint } : {}),
  }).toString();

  let responseUrl: string | undefined;
  try {
    responseUrl = await browser.identity.launchWebAuthFlow({ url: start.href, interactive: true });
  } catch {
    throw new AppError('cancelled', 'Google sign-in was closed before it finished.');
  }
  const params = new URL(responseUrl ?? 'about:blank').searchParams;
  if (params.get('state') !== state) {
    throw new AppError('failed', 'Google sign-in could not be verified. Please try again.');
  }
  const error = params.get('error');
  if (error === 'access_denied') throw new AppError('cancelled', 'Google access was not granted.');
  if (error) throw new AppError('failed', `Google sign-in failed (${error}).`);
  const code = params.get('code');
  if (!code) throw new AppError('failed', 'Google sign-in returned no authorization code.');

  const tokens = await brokerPost('/oauth/google/token', { code, code_verifier: verifier });
  const grant: Grant = {
    email: String(decodeJwtClaims(tokens.id_token).email ?? ''),
    accessToken: tokens.access_token,
    expiresIn: tokens.expires_in,
    scopes: (tokens.scope ?? '').split(' ').filter(Boolean),
  };
  if (tokens.refresh_token) grant.refreshToken = tokens.refresh_token;
  return grant;
}

export async function refreshGoogle(refreshToken: string) {
  const tokens = await brokerPost('/oauth/google/refresh', { refresh_token: refreshToken });
  return {
    accessToken: tokens.access_token,
    expiresIn: tokens.expires_in,
    refreshToken: tokens.refresh_token,
  };
}

/** Best effort; revocation needs no client secret. */
export async function revokeGoogle(token: string): Promise<void> {
  await fetch('https://oauth2.googleapis.com/revoke', {
    method: 'POST',
    body: new URLSearchParams({ token }),
  }).catch(() => undefined);
}

async function brokerPost(path: string, body: Record<string, string>): Promise<TokenResponse> {
  let response: Response;
  try {
    response = await fetch(`${GOOGLE_BROKER_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AppError('failed', 'Could not reach the sign-in service. Check your connection.');
  }
  const json = (await response.json().catch(() => ({}))) as Partial<TokenResponse>;
  if (!response.ok || json.error || !json.access_token) {
    const code = json.error ?? `HTTP ${response.status}`;
    throw new AppError(
      code === 'invalid_grant' ? 'reconnect' : 'failed',
      code === 'invalid_grant'
        ? 'Google access has expired or was revoked. Connect Google again.'
        : `Google sign-in failed (${code}).`,
    );
  }
  return json as TokenResponse;
}
