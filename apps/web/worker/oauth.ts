/**
 * Stateless Google OAuth broker for the browser extension.
 *
 * Why it exists: Google's verification requires redirect URIs on a domain we own, Firefox only
 * lets an extension start a sign-in whose `redirect_uri` is its own, and refresh tokens for a
 * "Web application" client need the client secret. The broker is the redirect URI Google sees,
 * hands the authorization code back to an allow-listed extension, and adds the client secret
 * when the extension exchanges or refreshes tokens. It stores and logs nothing.
 */

export interface BrokerEnv {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  STATE_SECRET: string;
  /** Comma-separated extension redirect URLs (identity.getRedirectURL()). */
  ALLOWED_REDIRECTS: string;
}

export const GOOGLE_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';

const ALLOWED_SCOPES = new Set([
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
]);
const ALLOWED_PROMPTS = new Set(['none', 'consent', 'select_account']);
const STATE_TTL_MS = 10 * 60_000;

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data)));
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

interface StatePayload {
  /** Extension redirect URL. */
  r: string;
  /** The extension's own state value, returned unchanged. */
  s: string;
  /** Expiry (epoch ms). */
  e: number;
}

export async function signState(payload: StatePayload, secret: string): Promise<string> {
  const body = base64url(encoder.encode(JSON.stringify(payload)));
  return `${body}.${base64url(await hmac(secret, body))}`;
}

export async function verifyState(
  token: string,
  secret: string,
  now = Date.now(),
): Promise<StatePayload | null> {
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  let given: Uint8Array;
  try {
    given = fromBase64url(signature);
  } catch {
    return null;
  }
  if (!timingSafeEqual(given, await hmac(secret, body))) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64url(body))) as StatePayload;
    return typeof payload.r === 'string' && typeof payload.s === 'string' && payload.e > now
      ? payload
      : null;
  } catch {
    return null;
  }
}

export function allowedRedirects(env: BrokerEnv): Set<string> {
  return new Set(
    env.ALLOWED_REDIRECTS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    },
  });

const page = (status: number, message: string) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign-in problem</title><body style="font:16px system-ui;margin:3rem auto;max-width:32rem;padding:0 1rem"><h1>Sign-in problem</h1><p>${message}</p><p>Close this window and try again from the extension.</p></body>`,
    {
      status,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    },
  );

const redirect = (location: string) =>
  new Response(null, {
    status: 302,
    headers: { location, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
  });

function callbackUrl(request: Request): string {
  return `${new URL(request.url).origin}/oauth/google/callback`;
}

/** GET /oauth/google/start: validate, sign the state, send the user to Google. */
export async function start(request: Request, env: BrokerEnv): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const redirectUri = params.get('redirect_uri') ?? '';
  const state = params.get('state') ?? '';
  const challenge = params.get('code_challenge') ?? '';
  const scopes = (params.get('scope') ?? '').split(/\s+/).filter(Boolean);
  const prompt = (params.get('prompt') ?? 'select_account').split(/\s+/).filter(Boolean);
  const loginHint = params.get('login_hint');

  if (!allowedRedirects(env).has(redirectUri)) {
    return page(400, 'This copy of the extension is not registered with this sign-in service.');
  }
  if (!state || state.length > 512 || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) {
    return page(400, 'The sign-in request was malformed.');
  }
  if (scopes.length === 0 || scopes.some((s) => !ALLOWED_SCOPES.has(s))) {
    return page(400, 'The sign-in request asked for permissions this service does not grant.');
  }
  if (prompt.some((p) => !ALLOWED_PROMPTS.has(p))) {
    return page(400, 'The sign-in request was malformed.');
  }

  const signed = await signState(
    { r: redirectUri, s: state, e: Date.now() + STATE_TTL_MS },
    env.STATE_SECRET,
  );
  const google = new URL(GOOGLE_AUTHORIZE);
  google.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: callbackUrl(request),
    response_type: 'code',
    scope: scopes.join(' '),
    state: signed,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: prompt.join(' '),
    ...(loginHint ? { login_hint: loginHint } : {}),
  }).toString();
  return redirect(google.href);
}

/** GET /oauth/google/callback: hand Google's answer back to the extension that asked. */
export async function callback(request: Request, env: BrokerEnv): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const payload = await verifyState(params.get('state') ?? '', env.STATE_SECRET);
  if (!payload || !allowedRedirects(env).has(payload.r)) {
    return page(400, 'This sign-in link has expired or is invalid.');
  }
  const back = new URL(payload.r);
  const code = params.get('code');
  const error = params.get('error');
  back.search = new URLSearchParams(
    code ? { code, state: payload.s } : { error: error ?? 'unknown_error', state: payload.s },
  ).toString();
  return redirect(back.href);
}

async function tokenRequest(fields: Record<string, string>, env: BrokerEnv): Promise<Response> {
  const response = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      ...fields,
    }),
  });
  const body = (await response.json().catch(() => ({ error: 'bad_response' }))) as Record<
    string,
    unknown
  >;
  if (!response.ok || body.error) {
    return json(
      {
        error: String(body.error ?? 'token_error'),
        error_description: String(body.error_description ?? ''),
      },
      response.status >= 500 ? 502 : 400,
    );
  }
  const { access_token, expires_in, refresh_token, scope, token_type, id_token } = body;
  return json({ access_token, expires_in, refresh_token, scope, token_type, id_token });
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) return null;
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** POST /oauth/google/token: exchange a code (with the extension's PKCE verifier). */
export async function exchange(request: Request, env: BrokerEnv): Promise<Response> {
  const body = await readJson(request);
  const code = body?.code;
  const verifier = body?.code_verifier;
  if (typeof code !== 'string' || typeof verifier !== 'string' || !code || !verifier) {
    return json({ error: 'invalid_request' }, 400);
  }
  return tokenRequest(
    {
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: callbackUrl(request),
    },
    env,
  );
}

/** POST /oauth/google/refresh: new access token from a refresh token. */
export async function refresh(request: Request, env: BrokerEnv): Promise<Response> {
  const body = await readJson(request);
  const token = body?.refresh_token;
  if (typeof token !== 'string' || !token) return json({ error: 'invalid_request' }, 400);
  return tokenRequest({ grant_type: 'refresh_token', refresh_token: token }, env);
}

export { json as jsonResponse };
