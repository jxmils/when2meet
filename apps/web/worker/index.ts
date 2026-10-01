import { type BrokerEnv, callback, exchange, jsonResponse, refresh, start } from './oauth.ts';

interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env extends BrokerEnv {
  ASSETS: AssetFetcher;
  RATE_LIMITER?: RateLimiter;
}

const routes: Record<
  string,
  { method: string; handle: (r: Request, e: Env) => Promise<Response> }
> = {
  '/oauth/google/start': { method: 'GET', handle: start },
  '/oauth/google/callback': { method: 'GET', handle: callback },
  '/oauth/google/token': { method: 'POST', handle: exchange },
  '/oauth/google/refresh': { method: 'POST', handle: refresh },
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    const route = routes[pathname];
    if (!route) return env.ASSETS.fetch(request);
    if (request.method !== route.method) return jsonResponse({ error: 'method_not_allowed' }, 405);
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.STATE_SECRET) {
      return jsonResponse({ error: 'not_configured' }, 503);
    }
    if (env.RATE_LIMITER) {
      const key = request.headers.get('cf-connecting-ip') ?? 'unknown';
      const { success } = await env.RATE_LIMITER.limit({ key });
      if (!success) return jsonResponse({ error: 'rate_limited' }, 429);
    }
    return route.handle(request, env);
  },
};
