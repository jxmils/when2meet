/**
 * Microsoft sign-in: authorization code + PKCE against the Entra "common" endpoint, registered
 * as a single-page-application redirect (the extension's identity redirect URL). No secret.
 * Token requests carry the extension's Origin header, which SPA redemption requires, so
 * login.microsoftonline.com must not be listed in host_permissions.
 */
import { MICROSOFT_SCOPES } from '@w2msync/providers';
import { browser } from 'wxt/browser';
import { MICROSOFT_CLIENT_ID } from '../config.ts';
import { AppError } from '../errors.ts';
import { createPkce, decodeJwtClaims, randomToken } from './pkce.ts';
import type { TokenResponse } from './tokens.ts';

const AUTHORITY = 'https://login.microsoftonline.com/common/oauth2/v2.0';

export interface MicrosoftGrant {
  accountKey: string;
  email: string;
  name: string;
  accessToken: string;
  expiresIn: number;
  refreshToken?: string;
}

export async function authorizeMicrosoft(options: {
  loginHint?: string;
  interactive: boolean;
}): Promise<MicrosoftGrant> {
  if (!MICROSOFT_CLIENT_ID) {
    throw new AppError(
      'not-configured',
      'Microsoft sign-in is not set up in this build. Add your calendar with a link instead.',
    );
  }
  const redirectUri = browser.identity.getRedirectURL();
  const { verifier, challenge } = await createPkce();
  const state = randomToken(16);
  const url = new URL(`${AUTHORITY}/authorize`);
  url.search = new URLSearchParams({
    client_id: MICROSOFT_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: MICROSOFT_SCOPES.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: options.interactive ? 'select_account' : 'none',
    ...(options.loginHint ? { login_hint: options.loginHint } : {}),
  }).toString();

  let responseUrl: string | undefined;
  try {
    responseUrl = await browser.identity.launchWebAuthFlow({
      url: url.href,
      interactive: options.interactive,
    });
  } catch {
    throw options.interactive
      ? new AppError('cancelled', 'Microsoft sign-in was closed before it finished.')
      : new AppError('reconnect', 'Sign in to Microsoft again to keep reading your calendar.');
  }
  const params = new URL(responseUrl ?? 'about:blank').searchParams;
  if (params.get('state') !== state) {
    throw new AppError('failed', 'Microsoft sign-in could not be verified. Please try again.');
  }
  const error = params.get('error');
  if (error) throw microsoftError(error, params.get('error_description') ?? '');
  const code = params.get('code');
  if (!code) throw new AppError('failed', 'Microsoft sign-in returned no authorization code.');

  const tokens = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  const claims = decodeJwtClaims(tokens.id_token);
  const grant: MicrosoftGrant = {
    accountKey: String(claims.oid ?? claims.sub ?? claims.preferred_username ?? randomToken(8)),
    email: String(claims.preferred_username ?? claims.email ?? ''),
    name: String(claims.name ?? ''),
    accessToken: tokens.access_token,
    expiresIn: tokens.expires_in,
  };
  if (tokens.refresh_token) grant.refreshToken = tokens.refresh_token;
  return grant;
}

export async function refreshMicrosoft(refreshToken: string) {
  const tokens = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
  return {
    accessToken: tokens.access_token,
    expiresIn: tokens.expires_in,
    refreshToken: tokens.refresh_token,
  };
}

async function tokenRequest(fields: Record<string, string>): Promise<TokenResponse> {
  let response: Response;
  try {
    response = await fetch(`${AUTHORITY}/token`, {
      method: 'POST',
      body: new URLSearchParams({
        client_id: MICROSOFT_CLIENT_ID,
        scope: MICROSOFT_SCOPES.join(' '),
        ...fields,
      }),
    });
  } catch {
    throw new AppError('failed', 'Could not reach Microsoft. Check your connection.');
  }
  const json = (await response.json().catch(() => ({}))) as Partial<TokenResponse>;
  if (!response.ok || json.error || !json.access_token) {
    throw microsoftError(json.error ?? `HTTP ${response.status}`, json.error_description ?? '');
  }
  return json as TokenResponse;
}

/** Maps Entra errors to actionable app errors. */
export function microsoftError(error: string, description: string): AppError {
  if (/AADSTS(65001|90094|90095)\b/.test(description) || error === 'consent_required') {
    return new AppError(
      'consent',
      'Your organization needs an administrator to approve this app before it can read your calendar.',
    );
  }
  if (error === 'access_denied')
    return new AppError('cancelled', 'Microsoft access was not granted.');
  if (['invalid_grant', 'interaction_required', 'login_required'].includes(error)) {
    return new AppError('reconnect', 'Sign in to Microsoft again to keep reading your calendar.');
  }
  const firstLine = description.split(/\r?\n/)[0]?.trim();
  return new AppError('failed', `Microsoft sign-in failed: ${firstLine || error}`);
}
