import { randomBytes, createHash } from 'node:crypto';
import { log } from '../log.js';
import { UsageError } from './provider.js';

/**
 * Claude Code's own OAuth client, used to sign TOKI in directly.
 *
 * This is the fallback for the case that made it necessary: Claude Code on
 * Windows writes `.credentials.json` with **empty** token fields on some
 * installs, so there is genuinely nothing to borrow and the ring stays blank
 * however correct the reader is.
 *
 * PKCE with S256, so no client secret is needed or stored -- the verifier never
 * leaves this process and only its hash is sent with the authorise request.
 */
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
const TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
/** Anthropic's own out-of-band redirect: the user pastes the code back. */
const REDIRECT_URI = 'https://console.anthropic.com/oauth/code/callback';
const SCOPES = 'org:create_api_key user:profile user:inference';

export interface PkcePair {
  verifier: string;
  challenge: string;
}

/** base64url without padding, which is what the spec requires. */
function base64url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function createPkce(): PkcePair {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function authorizeUrl(pkce: PkcePair): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('code', 'true');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('code_challenge', pkce.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  // Echoed back with the code; checked on return so a code pasted from another
  // sign-in cannot be exchanged against this one.
  url.searchParams.set('state', pkce.verifier);
  return url.toString();
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch ms. */
  expiresAt: number;
}

/**
 * Exchange the pasted code for tokens.
 *
 * Anthropic's console returns the code as `code#state`; both halves are needed
 * and the state half must match the verifier we generated.
 */
export async function exchangeCode(raw: string, pkce: PkcePair): Promise<OAuthTokens> {
  /*
   * People paste this out of a browser, so it arrives with whatever the browser
   * and clipboard added: surrounding whitespace, a newline, quotes from a
   * double-click selection, or the whole callback URL rather than the code.
   * Every one of those is the user doing the obvious thing, so each is handled
   * rather than rejected.
   */
  let trimmed = raw.trim().replace(/^["'“”]+|["'“”]+$/g, '');
  if (!trimmed) throw new UsageError('needsAuth', 'Paste the code from your browser first');

  // The full callback URL, pasted whole.
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const fromQuery = url.searchParams.get('code');
      if (fromQuery) {
        const stateParam = url.searchParams.get('state');
        trimmed = stateParam ? `${fromQuery}#${stateParam}` : fromQuery;
      }
    } catch {
      /* not a URL after all; fall through and treat it as a code */
    }
  }

  const [code, state] = trimmed.split('#');
  if (!code) throw new UsageError('needsAuth', 'That does not look like a sign-in code');
  if (state && state !== pkce.verifier) {
    throw new UsageError('needsAuth', 'That code is from a different sign-in — start again');
  }

  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        code_verifier: pkce.verifier,
        state: state ?? pkce.verifier
      })
    });
  } catch {
    throw new UsageError('failed', 'Could not reach the sign-in service');
  }

  if (!response.ok) {
    // The body can echo the code back; never log or surface it verbatim.
    log.warn('claude-oauth', `token exchange answered ${response.status}`);
    if (response.status === 429) {
      throw new UsageError('rateLimited', 'Too many sign-in attempts — wait a minute and retry', 60);
    }
    // An authorisation code is single-use and short-lived, which is by far the
    // most common reason a paste fails: it was already spent, or it went stale
    // while the window sat open. Saying so is more useful than "rejected".
    throw new UsageError(
      'needsAuth',
      'That code did not work. Codes expire quickly and work once — click Open sign-in for a fresh one.'
    );
  }

  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!payload.access_token) {
    throw new UsageError('needsAuth', 'The sign-in did not return a token');
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000
  };
}

/**
 * Trade a refresh token for a fresh access token.
 *
 * Unlike a borrowed credential, a token TOKI minted is TOKI's to maintain --
 * there is no other app that will rotate it, so refreshing here is correct
 * rather than racing an owner for it.
 */
export async function refreshTokens(refreshToken: string): Promise<OAuthTokens> {
  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CLIENT_ID
      })
    });
  } catch {
    throw new UsageError('failed', 'Could not reach the sign-in service');
  }
  if (!response.ok) {
    throw new UsageError('needsAuth', 'The saved sign-in expired — sign in again');
  }
  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!payload.access_token) throw new UsageError('needsAuth', 'The refresh did not return a token');
  return {
    accessToken: payload.access_token,
    // Anthropic rotates refresh tokens; keep the new one when given.
    refreshToken: payload.refresh_token ?? refreshToken,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000
  };
}

/*
 * Note there is no `openSignIn` here.
 *
 * Opening a browser needs `electron`, and importing that into a module of pure
 * token logic makes the whole file unloadable under plain Node -- every test
 * touching it then fails on something unrelated to what it tests. The caller in
 * `index.ts` owns the browser; this file owns the protocol.
 */
