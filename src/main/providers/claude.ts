import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type {
  CredentialMode,
  CredentialOrigin,
  CredentialSupport,
  ProviderAccount
} from '../../shared/types.js';
import { log } from '../log.js';
import type { SecretStore } from '../secrets.js';
import { getPinnedJson } from './http.js';
import { modeOrder, UsageError, type ProviderReading, type SignInRoute, type UsageProvider } from './provider.js';
import { claudeWindows, type ClaudeUsageResponse } from './claude-usage.js';
import { refreshTokens, type OAuthTokens } from './claude-oauth.js';

/**
 * Claude usage, from whichever credential is actually available.
 *
 * Three ways in, tried in order under `auto`:
 *
 *  1. **Borrowed** — the token Claude Code keeps in `<config dir>/
 *     .credentials.json`. Free and needs no setup, but not always usable: on
 *     Windows some installs write that file with **empty** token fields and
 *     `expiresAt: 0`, so there is nothing to read however correct the reader
 *     is. That is exactly why the other two modes exist.
 *  2. **OAuth** — TOKI signs in itself and owns the resulting token, so it
 *     refreshes it rather than waiting for another app to.
 *  3. **API key** — a key the user pastes in, encrypted at rest.
 *
 * A borrowed token is never refreshed here: minting one would mean writing a
 * credential this app does not own and racing its owner for it.
 */
export class ClaudeProvider implements UsageProvider {
  readonly glyph = 'claude' as const;
  readonly fidelity = 'official' as const;
  readonly sourceNote: string;
  readonly support: CredentialSupport;

  private readonly dir: string;
  /** Held so the file is read once per token rather than once per poll. */
  private borrowed: { token: string; expiresAt: number; plan: string | null; mtimeMs: number } | null = null;

  constructor(
    readonly id: string,
    readonly displayName: string,
    dir: string,
    private readonly secrets: SecretStore
  ) {
    this.dir = dir;
    this.sourceNote = `Claude Code's login in ${dir}`;
    /*
     * No API-key mode, deliberately.
     *
     * The numbers this app shows -- a 5-hour session window and a weekly
     * window -- are *subscription* limits, and they only exist for a Pro or Max
     * plan. A console API key is pay-as-you-go: it is billed per token and has
     * no session quota to report, so there is nothing for a ring to draw. The
     * endpoint agrees; it is literally `/api/oauth/usage`.
     *
     * Offering the field anyway would be offering a box that cannot work, and
     * a user pasting a valid key into it would rightly conclude TOKI was
     * broken. Same reasoning as Codex being borrow-only.
     */
    this.support = {
      borrow: true,
      oauth: true,
      apiKey: false,
      apiKeyUrl: null,
      borrowNote: `Claude Code's own login in ${dir}`
    };
  }

  get signIn(): SignInRoute {
    const command = this.id === 'claude' ? 'claude' : `CLAUDE_CONFIG_DIR=${this.dir} claude`;
    return {
      kind: 'openApp',
      name: 'Claude Code',
      hint: `Run \`${command}\` and sign in, or sign in to TOKI directly in Settings.`
    };
  }

  /** Keys under which this profile's own secrets are filed. */
  private get oauthKey(): string {
    return `${this.id}:oauth`;
  }
  private get apiKeyKey(): string {
    return `${this.id}:apiKey`;
  }

  private credentialsPath(): string {
    return join(this.dir, '.credentials.json');
  }

  /**
   * The token Claude Code wrote, if there is a usable one.
   *
   * Returns null rather than throwing when the file exists but is *empty* — a
   * real and common state on Windows — so `auto` moves on to the next mode
   * instead of reporting a sign-in problem the user cannot fix by signing in.
   */
  private loadBorrowed(): { token: string; expiresAt: number; plan: string | null } | null {
    const path = this.credentialsPath();
    let mtimeMs: number;
    try {
      mtimeMs = statSync(path).mtimeMs;
    } catch {
      this.borrowed = null;
      return null;
    }
    if (this.borrowed && this.borrowed.mtimeMs === mtimeMs) return this.borrowed;

    let raw: string;
    try {
      raw = readFileSync(path, 'utf8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES') {
        throw new UsageError('accessDenied', "Windows refused access to Claude Code's saved login");
      }
      return null;
    }

    let parsed: { claudeAiOauth?: { accessToken?: string; expiresAt?: number; subscriptionType?: string } };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    const oauth = parsed.claudeAiOauth;
    // An empty string here is the failure this whole class of mode exists for.
    if (!oauth?.accessToken || typeof oauth.expiresAt !== 'number' || oauth.expiresAt <= 0) {
      this.borrowed = null;
      return null;
    }

    this.borrowed = {
      token: oauth.accessToken,
      expiresAt: oauth.expiresAt,
      plan: oauth.subscriptionType ?? null,
      mtimeMs
    };
    return this.borrowed;
  }

  /** TOKI's own OAuth tokens, refreshed when due. */
  private async loadOwnTokens(): Promise<OAuthTokens | null> {
    const stored = this.secrets.get(this.oauthKey);
    if (!stored) return null;
    let tokens: OAuthTokens;
    try {
      tokens = JSON.parse(stored) as OAuthTokens;
    } catch {
      this.secrets.delete(this.oauthKey);
      return null;
    }
    // A minute of headroom, so a token does not expire mid-request.
    if (tokens.expiresAt > Date.now() + 60_000) return tokens;
    if (!tokens.refreshToken) return null;

    // This token is ours, so refreshing it is our job -- unlike a borrowed one.
    const fresh = await refreshTokens(tokens.refreshToken);
    this.secrets.set(this.oauthKey, JSON.stringify(fresh));
    log.debug(this.id, 'refreshed TOKI\u2019s own OAuth token');
    return fresh;
  }

  async fetch(signal: AbortSignal, mode: CredentialMode): Promise<ProviderReading> {
    const order = modeOrder(mode, this.support);
    let lastError: UsageError | null = null;

    for (const origin of order) {
      let headers: Record<string, string> | null = null;

      if (origin === 'borrowed') {
        const credentials = this.loadBorrowed();
        if (!credentials) continue; // nothing to borrow; try the next mode
        if (credentials.expiresAt <= Date.now()) {
          this.borrowed = null;
          // Not signed out: Claude Code rotates this whenever it runs.
          lastError = new UsageError('credentialExpired', 'Claude Code will refresh its token when it next runs');
          continue;
        }
        headers = {
          authorization: `Bearer ${credentials.token}`,
          'anthropic-beta': 'oauth-2025-04-20'
        };
      } else if (origin === 'oauth') {
        const tokens = await this.loadOwnTokens().catch((error) => {
          lastError = error instanceof UsageError ? error : null;
          return null;
        });
        if (!tokens) continue;
        headers = {
          authorization: `Bearer ${tokens.accessToken}`,
          'anthropic-beta': 'oauth-2025-04-20'
        };
      } else {
        // Unreachable while `support.apiKey` is false; kept so the branch is
        // explicit rather than silently missing if that ever changes.
        continue;
      }

      try {
        const payload = await getPinnedJson<ClaudeUsageResponse>({
          url: 'https://api.anthropic.com/api/oauth/usage',
          allowedHost: 'api.anthropic.com',
          headers,
          signal
        });
        const windows = claudeWindows(payload);
        if (windows.length === 0) {
          lastError = new UsageError('nothingMetered', 'Claude reported no usage windows');
          continue;
        }
        log.debug(this.id, `read ${windows.length} window(s) via ${origin}`);
        return { windows, headlineId: 'session', origin, account: this.account() };
      } catch (error) {
        if (!(error instanceof UsageError)) throw error;
        if (error.kind === 'needsAuth' && origin === 'borrowed') this.borrowed = null;
        // Rate limiting is about the endpoint, not the credential -- trying
        // another mode would just spend a second attempt into the same 429.
        if (error.kind === 'rateLimited') throw error;
        lastError = error;
      }
    }

    if (lastError) throw lastError;
    throw new UsageError('needsAuth', 'No Claude credential is available yet');
  }

  account(): ProviderAccount | null {
    const borrowed = (() => {
      try {
        return this.loadBorrowed();
      } catch {
        return null;
      }
    })();
    if (borrowed) {
      return {
        label: this.displayName,
        plan: borrowed.plan,
        source: 'Claude Code',
        manageUrl: 'https://claude.ai/settings/usage'
      };
    }
    if (this.secrets.has(this.oauthKey)) {
      return { label: this.displayName, plan: null, source: 'Signed in to TOKI', manageUrl: 'https://claude.ai/settings/usage' };
    }
    if (this.secrets.has(this.apiKeyKey)) {
      return { label: this.displayName, plan: null, source: 'API key', manageUrl: 'https://console.anthropic.com/settings/keys' };
    }
    return null;
  }

  /** What Settings shows about where the next read would come from. */
  originAvailable(): CredentialOrigin {
    try {
      if (this.loadBorrowed()) return 'borrowed';
    } catch {
      /* refused is still not "available" */
    }
    if (this.secrets.has(this.oauthKey)) return 'oauth';
    if (this.secrets.has(this.apiKeyKey)) return 'apiKey';
    return 'none';
  }

  hasStoredSecret(): boolean {
    return this.secrets.has(this.oauthKey) || this.secrets.has(this.apiKeyKey);
  }

  forgetCached(): void {
    this.borrowed = null;
  }
}
