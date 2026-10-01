export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Supplies an OAuth access token; asked again with `forceRefresh` after a 401. */
export type TokenSource = (options?: { forceRefresh?: boolean }) => Promise<string>;

export type ProviderErrorCode =
  | 'auth'
  | 'forbidden'
  | 'not-found'
  | 'rate-limited'
  | 'server'
  | 'network'
  | 'bad-response';

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status: number | undefined;

  constructor(code: ProviderErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.status = status;
  }
}

export interface ApiClient {
  token: TokenSource;
  fetch?: FetchLike;
  /** Base delay for retries after 429/5xx/network errors (default 500 ms). */
  retryDelayMs?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Authorised JSON request with one token refresh on 401 and up to two retries on rate limits,
 * server errors and network failures.
 */
export async function fetchJson<T>(
  client: ApiClient,
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const doFetch = client.fetch ?? ((input, options) => globalThis.fetch(input, options));
  const baseDelay = client.retryDelayMs ?? 500;
  let forceRefresh = false;
  for (let attempt = 0; ; attempt++) {
    const token = await client.token({ forceRefresh });
    let response: Response;
    try {
      response = await doFetch(url, {
        ...init,
        headers: {
          ...headersOf(init.headers),
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
    } catch (error) {
      if (attempt < 2) {
        await sleep(baseDelay * 2 ** attempt);
        continue;
      }
      throw new ProviderError('network', `Network error: ${(error as Error).message}`);
    }
    if (response.status === 401 && !forceRefresh) {
      forceRefresh = true;
      continue;
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      await sleep(retryAfterMs(response) ?? baseDelay * 2 ** attempt);
      continue;
    }
    if (!response.ok) throw await errorFrom(response);
    try {
      return (await response.json()) as T;
    } catch {
      throw new ProviderError('bad-response', 'The calendar service sent an unreadable response.');
    }
  }
}

function headersOf(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  return Object.fromEntries(new Headers(headers).entries());
}

function retryAfterMs(response: Response): number | null {
  const value = response.headers.get('retry-after');
  if (!value) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.min(seconds, 30) * 1000 : null;
}

async function errorFrom(response: Response): Promise<ProviderError> {
  let detail = '';
  try {
    const body = (await response.json()) as {
      error?: { message?: string; errors?: { reason?: string }[]; code?: string } | string;
      error_description?: string;
    };
    if (typeof body.error === 'string') detail = body.error_description ?? body.error;
    else detail = body.error?.message ?? '';
    const reason = typeof body.error === 'object' ? body.error?.errors?.[0]?.reason : undefined;
    if (response.status === 403 && reason && /rateLimit/i.test(reason)) {
      return new ProviderError('rate-limited', detail || 'Rate limit exceeded.', 403);
    }
  } catch {
    // Not JSON; fall through to a generic message.
  }
  const status = response.status;
  const message = detail || `HTTP ${status}`;
  if (status === 401) return new ProviderError('auth', message, status);
  if (status === 403) return new ProviderError('forbidden', message, status);
  if (status === 404) return new ProviderError('not-found', message, status);
  if (status === 429) return new ProviderError('rate-limited', message, status);
  return new ProviderError(status >= 500 ? 'server' : 'bad-response', message, status);
}
