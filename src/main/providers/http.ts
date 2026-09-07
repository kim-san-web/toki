import { UsageError } from './provider.js';

/**
 * The only way this app talks to a network.
 *
 * Endpoints are pinned by host, redirects are refused, and no response body is
 * ever logged: a redirect off the pinned host with a borrowed bearer token
 * attached is exactly how a leaked credential happens.
 */
export interface PinnedRequest {
  url: string;
  allowedHost: string;
  headers: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function getPinnedJson<T>(req: PinnedRequest): Promise<T> {
  const url = new URL(req.url);
  if (url.protocol !== 'https:') throw new UsageError('failed', 'refusing a non-HTTPS endpoint');
  if (url.host !== req.allowedHost) {
    throw new UsageError('failed', `refusing a request to ${url.host}`);
  }

  const timeout = AbortSignal.timeout(req.timeoutMs ?? 15_000);
  const signal = req.signal ? AbortSignal.any([timeout, req.signal]) : timeout;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: req.headers,
      /*
       * `follow`, verified afterwards -- not `error`, and not a hand-rolled
       * follower.
       *
       * `redirect: 'error'` looks stricter and is worse in practice: some hosts
       * (Codex's usage endpoint behind Cloudflare is one) inspect the request
       * and answer **403 with an HTML challenge page** when redirects are not
       * accepted, even though the successful response is not itself a redirect.
       * Pinning that way turned a working 200 into a spurious auth failure and
       * sent the provider back to a stale local file.
       *
       * The guarantee that actually matters is that the credential never
       * reaches another origin, and that is checked below against
       * `response.url` -- the *final* URL after any hops. A cross-origin
       * redirect strips the Authorization header in fetch anyway, so this is
       * belt and braces.
       */
      redirect: 'follow',
      signal
    });
  } catch (error) {
    if (signal.aborted) throw new UsageError('failed', 'the request timed out');
    // The message can carry the URL, which can carry a query token: say what
    // failed, not what was sent.
    throw new UsageError('failed', `could not reach ${url.host}`);
  }

  // Where the response actually came from, after every hop.
  if (response.url) {
    let landed: URL | null = null;
    try {
      landed = new URL(response.url);
    } catch {
      landed = null;
    }
    if (landed && (landed.protocol !== 'https:' || landed.host !== req.allowedHost)) {
      throw new UsageError('failed', `refusing an answer from ${landed.host}`);
    }
  }

  if (response.status === 401 || response.status === 403) {
    /*
     * A 403 is not always an auth failure.
     *
     * Endpoints behind a bot filter answer 403 with an **HTML challenge page**
     * to requests they merely dislike -- intermittently, for the same token
     * that worked a moment earlier. Reporting that as `needsAuth` is actively
     * harmful: it tells the user to sign in to something they are already
     * signed in to, and it makes the provider throw away a perfectly good
     * credential.
     *
     * The content type separates the two cleanly: a real rejection comes back
     * as JSON from the API, a challenge as `text/html` from the edge.
     */
    const contentType = response.headers.get('content-type') ?? '';
    if (response.status === 403 && contentType.includes('text/html')) {
      throw new UsageError('failed', 'the endpoint refused this request; it usually works on a retry');
    }
    throw new UsageError('needsAuth', 'the endpoint rejected the borrowed credential');
  }
  if (response.status === 429) {
    const hint = Number(response.headers.get('retry-after') ?? '0');
    throw new UsageError('rateLimited', 'asked to slow down', Number.isFinite(hint) ? hint : 0);
  }
  if (!response.ok) {
    throw new UsageError('badResponse', `the endpoint answered ${response.status}`);
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new UsageError('badResponse', 'the endpoint answered with something unreadable');
  }
}
