import { existsSync, openSync, readSync, closeSync, fstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CredentialMode, CredentialSupport, ProviderAccount } from '../../shared/types.js';
import { codexHome } from '../paths.js';
import { log } from '../log.js';
import { withDb, queryAll } from './sqlite.js';
import { UsageError, type ProviderReading, type SignInRoute, type UsageProvider } from './provider.js';
import { codexWindows, codexBlock, readRollout } from './codex-usage.js';
import { codexLiveWindows, codexLiveBlock, type CodexLiveResponse } from './codex-live.js';
import { getPinnedJson } from './http.js';

/**
 * Reads Codex usage from the rollout log of the thread it last worked on.
 *
 * No credential and no network: Codex records its own rate-limit snapshots
 * locally as it runs. The newest rollout is found through Codex's thread index
 * (`state_5.sqlite`) rather than by walking the sessions tree, which holds
 * thousands of files -- and the walk is bounded even in the fallback.
 */
export class CodexProvider implements UsageProvider {
  readonly id = 'codex';
  readonly displayName = 'Codex';
  readonly glyph = 'openai' as const;
  readonly fidelity = 'official' as const;
  readonly sourceNote = "Codex's own usage, live where it will answer";
  /**
   * Borrow only, honestly declared.
   *
   * Codex publishes no usage endpoint an API key could query -- the numbers
   * exist solely because Codex records what it saw as it ran. Offering a key
   * field here would be a box that cannot work.
   */
  readonly support: CredentialSupport = {
    borrow: true,
    oauth: false,
    apiKey: false,
    apiKeyUrl: null,
    borrowNote: "Codex's own login and usage record in ~/.codex"
  };
  readonly signIn: SignInRoute = {
    kind: 'openApp',
    name: 'Codex',
    hint: 'Run `codex` once and sign in - TOKI reads the usage it records locally.'
  };

  /** Only the tail matters: the newest snapshot is at the end of the file. */
  private static readonly TAIL_BYTES = 256 * 1024;
  /**
   * How long a rollout's own snapshot counts as current.
   *
   * Codex does not publish usage; it writes what it saw into a file as it runs.
   * The file stops changing the moment you stop using Codex, and reading it
   * still succeeds instantly -- the *fetch* is fresh while the *reading* may be
   * days old. Only a file-backed provider needs this distinction.
   */
  static readonly CURRENT_FOR_MS = 5 * 60_000;

  constructor(private readonly home: string = codexHome()) {}

  async fetch(signal: AbortSignal, _mode: CredentialMode): Promise<ProviderReading> {
    // Ask Codex's own server first. The rollout below records what was true
    // during the last turn; this is what is true now, and the two disagree by
    // however long it has been since Codex was used -- which is exactly how a
    // spent 5h window keeps reporting 99% after it has refilled.
    const live = await this.liveReading(signal);
    if (live) return live;

    const rollout = this.newestRollout();
    if (!rollout) {
      throw new UsageError('nothingMetered', 'No Codex threads on this PC yet');
    }
    const reading = readRollout(this.tail(rollout));
    if (!reading) {
      throw new UsageError('nothingMetered', 'Codex has not recorded a usage snapshot yet');
    }
    const windows = codexWindows(reading.limits);
    if (windows.length === 0) {
      throw new UsageError('nothingMetered', 'Codex reported no usage windows');
    }
    log.debug('codex', `read ${windows.length} window(s) from a rollout`);
    return {
      windows,
      headlineId: 'primary',
      block: codexBlock(reading.limits),
      recordedAt: reading.recordedAt,
      origin: 'borrowed',
      account: this.account()
    };
  }

  /**
   * The account's live usage, read with the token Codex itself keeps.
   *
   * Returns null rather than throwing when there is no token or the endpoint
   * will not answer: falling back to the rollout is a genuine improvement over
   * nothing, and someone who has simply never signed in to Codex should not see
   * an error.
   */
  private async liveReading(signal: AbortSignal): Promise<ProviderReading | null> {
    const auth = this.tokens();
    if (!auth) return null;

    /**
     * One retry, because the bot filter in front of this endpoint challenges
     * roughly a third of requests at random and lets the same request straight
     * through moments later. Without it, a live reading would silently fall
     * back to the stale rollout about that often -- which is the entire bug
     * this method exists to fix.
     *
     * Only the challenge is retried; a genuine auth failure or a rate limit is
     * not, since repeating those is either pointless or harmful.
     */
    for (let attempt = 0; attempt < 2; attempt++) {
      const reading = await this.attemptLive(auth, signal, attempt === 0);
      if (reading !== null) return reading;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 1200));
    }
    return null;
  }

  private async attemptLive(
    auth: { accessToken: string; accountId: string },
    signal: AbortSignal,
    retryable: boolean
  ): Promise<ProviderReading | null> {
    try {
      const payload = await getPinnedJson<CodexLiveResponse>({
        url: 'https://chatgpt.com/backend-api/codex/usage',
        allowedHost: 'chatgpt.com',
        headers: {
          authorization: `Bearer ${auth.accessToken}`,
          /*
           * These are the headers Codex's own client sends, and they matter.
           *
           * The endpoint sits behind a bot filter that answers 403 with an HTML
           * challenge to requests that do not look like the real client -- so a
           * missing User-Agent, or an unfamiliar one, produces an intermittent
           * "rejected credential" for a token that is perfectly valid. The
           * account header is what scopes the reading to this login.
           */
          'user-agent': 'codex_cli_rs/0.153.4 (Windows 11) TOKI',
          'chatgpt-account-id': auth.accountId,
          originator: 'codex_cli_rs',
          accept: 'application/json'
        },
        signal
      });
      const windows = codexLiveWindows(payload);
      if (windows.length === 0) return null;
      log.debug('codex', `live reading, ${windows.length} window(s)`);
      return {
        windows,
        headlineId: 'primary',
        block: codexLiveBlock(payload),
        // Taken just now, so it is current by definition -- unlike a rollout.
        recordedAt: Date.now(),
        origin: 'borrowed',
        account: this.account()
      };
    } catch (error) {
      // An expired Codex token is ordinary: the CLI refreshes it when it runs.
      log.debug('codex', `live usage unavailable: ${error instanceof Error ? error.message : 'unknown'}`);
      void retryable;
      return null;
    }
  }

  /** The token Codex keeps for itself. Read per request, never stored. */
  private tokens(): { accessToken: string; accountId: string } | null {
    const path = join(this.home, 'auth.json');
    if (!existsSync(path)) return null;
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
        tokens?: { access_token?: string; account_id?: string };
      };
      const accessToken = parsed.tokens?.access_token;
      const accountId = parsed.tokens?.account_id;
      if (!accessToken || !accountId) return null;
      return { accessToken, accountId };
    } catch {
      return null;
    }
  }

  /** The rollout of the most recently touched, unarchived thread. */
  private newestRollout(): string | null {
    const indexed = withDb(join(this.home, 'state_5.sqlite'), (db) =>
      queryAll<{ rollout_path: string }>(
        db,
        'SELECT rollout_path FROM threads WHERE archived = 0 ORDER BY updated_at_ms DESC LIMIT 8'
      )
        .map((row) => row.rollout_path)
        .find((path) => typeof path === 'string' && existsSync(path)) ?? null
    );
    if (indexed) return indexed;
    return this.newestOnDisk();
  }

  /**
   * Fallback for a Codex old enough to have no thread index: the newest rollout
   * under the year/month/day tree.
   *
   * Bounded deliberately -- newest year, newest month, newest two days -- so a
   * long-lived sessions tree cannot turn a poll into a full directory walk.
   */
  private newestOnDisk(): string | null {
    const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs');
    const sessions = join(this.home, 'sessions');
    if (!existsSync(sessions)) return null;
    const descend = (dir: string, take: number): string[] => {
      try {
        return readdirSync(dir)
          .sort()
          .reverse()
          .slice(0, take)
          .map((name) => join(dir, name));
      } catch {
        return [];
      }
    };
    let best: { path: string; mtime: number } | null = null;
    for (const year of descend(sessions, 1)) {
      for (const month of descend(year, 1)) {
        for (const day of descend(month, 2)) {
          for (const file of descend(day, 40)) {
            if (!file.endsWith('.jsonl')) continue;
            try {
              const mtime = statSync(file).mtimeMs;
              if (!best || mtime > best.mtime) best = { path: file, mtime };
            } catch {
              /* a rollout can be deleted between listing and stat */
            }
          }
        }
      }
    }
    return best?.path ?? null;
  }

  /** Reads the last chunk of a file: rollouts grow without bound. */
  private tail(path: string): string {
    let fd: number | null = null;
    try {
      fd = openSync(path, 'r');
      const size = fstatSync(fd).size;
      const length = Math.min(size, CodexProvider.TAIL_BYTES);
      const buffer = Buffer.alloc(length);
      readSync(fd, buffer, 0, length, size - length);
      return buffer.toString('utf8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES') {
        throw new UsageError('accessDenied', "Windows refused access to Codex's rollout log");
      }
      throw new UsageError('failed', "Codex's rollout could not be read");
    } finally {
      if (fd !== null) closeSync(fd);
    }
  }

  account(): ProviderAccount | null {
    const path = join(this.home, 'auth.json');
    if (!existsSync(path)) return null;
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
        auth_mode?: string;
        tokens?: { id_token?: string };
      };
      // The id token is a JWT whose *claims* carry the account email. Decoded
      // locally, never sent anywhere, and only the email is kept.
      const email = emailFromIdToken(parsed.tokens?.id_token);
      return {
        label: email ?? 'Signed in',
        plan: parsed.auth_mode === 'apikey' ? 'API key' : null,
        source: 'Codex',
        manageUrl: 'https://chatgpt.com/codex/settings/usage'
      };
    } catch {
      return null;
    }
  }

  forgetCached(): void {
    /* nothing is held: every read goes to disk */
  }
}

/** The email claim from an OIDC id token, or null. The token itself is discarded. */
function emailFromIdToken(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
      email?: string;
    };
    return typeof claims.email === 'string' ? claims.email : null;
  } catch {
    return null;
  }
}
