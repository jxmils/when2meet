import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../worker/index.ts';
import { signState, verifyState } from '../worker/oauth.ts';

const ORIGIN = 'https://sync.example.org';
const EXTENSION = 'https://abcdefghijklmnop.chromiumapp.org/';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

const env: Env = {
  GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'shh',
  STATE_SECRET: 'state-secret',
  ALLOWED_REDIRECTS: `${EXTENSION}, https://xyz.extensions.allizom.org/`,
  ASSETS: { fetch: async () => new Response('asset', { status: 200 }) },
};

const call = (path: string, init?: RequestInit, e: Env = env) =>
  worker.fetch(new Request(`${ORIGIN}${path}`, init), e);

function startUrl(overrides: Record<string, string> = {}) {
  return `/oauth/google/start?${new URLSearchParams({
    redirect_uri: EXTENSION,
    state: 'ext-state',
    code_challenge: CHALLENGE,
    scope: 'openid email https://www.googleapis.com/auth/calendar.freebusy',
    prompt: 'select_account consent',
    ...overrides,
  })}`;
}

afterEach(() => vi.unstubAllGlobals());

describe('start', () => {
  it('redirects to Google with PKCE, offline access and a signed state', async () => {
    const response = await call(startUrl({ login_hint: 'me@example.com' }));
    expect(response.status).toBe(302);
    const google = new URL(response.headers.get('location') ?? '');
    expect(google.origin + google.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(google.searchParams)).toMatchObject({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: `${ORIGIN}/oauth/google/callback`,
      response_type: 'code',
      code_challenge: CHALLENGE,
      code_challenge_method: 'S256',
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'select_account consent',
      login_hint: 'me@example.com',
    });
    const state = await verifyState(google.searchParams.get('state') ?? '', env.STATE_SECRET);
    expect(state).toMatchObject({ r: EXTENSION, s: 'ext-state' });
  });

  it.each([
    ['an unregistered extension', { redirect_uri: 'https://evil.chromiumapp.org/' }],
    ['a scope it does not grant', { scope: 'https://www.googleapis.com/auth/calendar' }],
    ['a malformed challenge', { code_challenge: 'short' }],
    ['an odd prompt', { prompt: 'login' }],
  ])('rejects %s', async (_, overrides) => {
    const response = await call(startUrl(overrides));
    expect(response.status).toBe(400);
  });
});

describe('callback', () => {
  it('returns the code and the extension state to the extension', async () => {
    const state = await signState(
      { r: EXTENSION, s: 'ext-state', e: Date.now() + 60_000 },
      env.STATE_SECRET,
    );
    const response = await call(
      `/oauth/google/callback?${new URLSearchParams({ code: 'abc', state })}`,
    );
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`${EXTENSION}?code=abc&state=ext-state`);
  });

  it('passes errors through', async () => {
    const state = await signState(
      { r: EXTENSION, s: 's', e: Date.now() + 60_000 },
      env.STATE_SECRET,
    );
    const response = await call(
      `/oauth/google/callback?${new URLSearchParams({ error: 'access_denied', state })}`,
    );
    expect(response.headers.get('location')).toBe(`${EXTENSION}?error=access_denied&state=s`);
  });

  it('rejects forged, expired and no-longer-allowed states', async () => {
    const expired = await signState({ r: EXTENSION, s: 's', e: Date.now() - 1 }, env.STATE_SECRET);
    const forged = await signState(
      { r: EXTENSION, s: 's', e: Date.now() + 60_000 },
      'other-secret',
    );
    const removed = await signState(
      { r: 'https://gone.chromiumapp.org/', s: 's', e: Date.now() + 60_000 },
      env.STATE_SECRET,
    );
    for (const state of [expired, forged, removed, 'garbage']) {
      const response = await call(
        `/oauth/google/callback?${new URLSearchParams({ code: 'abc', state })}`,
      );
      expect(response.status).toBe(400);
    }
  });
});

describe('token endpoints', () => {
  function stubGoogle(reply: Record<string, unknown>, status = 200) {
    const seen: URLSearchParams[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      expect(url).toBe('https://oauth2.googleapis.com/token');
      seen.push(new URLSearchParams(String(init.body)));
      return new Response(JSON.stringify(reply), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    });
    return seen;
  }

  it('exchanges a code with the client secret and the extension verifier', async () => {
    const seen = stubGoogle({
      access_token: 'at',
      expires_in: 3599,
      refresh_token: 'rt',
      scope: 's',
      extra: 'dropped',
    });
    const response = await call('/oauth/google/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'abc', code_verifier: 'verifier' }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      access_token: 'at',
      expires_in: 3599,
      refresh_token: 'rt',
      scope: 's',
    });
    expect(Object.fromEntries(seen[0] ?? [])).toEqual({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: 'shh',
      grant_type: 'authorization_code',
      code: 'abc',
      code_verifier: 'verifier',
      redirect_uri: `${ORIGIN}/oauth/google/callback`,
    });
  });

  it('refreshes tokens and relays Google errors', async () => {
    stubGoogle(
      { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' },
      400,
    );
    const response = await call('/oauth/google/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: 'rt' }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'invalid_grant',
      error_description: 'Token has been expired or revoked.',
    });
  });

  it('rejects malformed bodies and wrong methods', async () => {
    expect((await call('/oauth/google/token', { method: 'POST', body: 'code=abc' })).status).toBe(
      400,
    );
    expect((await call('/oauth/google/token')).status).toBe(405);
  });
});

describe('routing and limits', () => {
  it('serves other paths from static assets', async () => {
    expect(await (await call('/privacy')).text()).toBe('asset');
  });

  it('refuses to run unconfigured', async () => {
    const response = await call(startUrl(), undefined, { ...env, STATE_SECRET: '' });
    expect(response.status).toBe(503);
  });

  it('applies the rate limiter', async () => {
    const limited: Env = { ...env, RATE_LIMITER: { limit: async () => ({ success: false }) } };
    expect((await call(startUrl(), undefined, limited)).status).toBe(429);
  });
});
