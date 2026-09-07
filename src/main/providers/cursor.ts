import { existsSync } from 'node:fs';
import type { CredentialMode, CredentialSupport, ProviderAccount } from '../../shared/types.js';
import type { SecretStore } from '../secrets.js';
import { cursorStateDb } from '../paths.js';
import { log } from '../log.js';
import { withDb, queryAll } from './sqlite.js';
import { getPinnedJson } from './http.js';
import { modeOrder, UsageError, type ProviderReading, type SignInRoute, type UsageProvider } from './provider.js';
import { cursorWindows, type CursorUsageSummary } from './cursor-usage.js';

/**
 * Reads the session Cursor's editor keeps for itself, in the SQLite
 * global-state store it inherits from VS Code (`%APPDATA%\Cursor\User\
 * globalStorage\state.vscdb`), and asks Cursor's own usage endpoint with it.
 *
 * TOKI only ever reads that store, and never writes the session anywhere: the
 * cookie is built per request, used once, and dropped.
 */
export class CursorProvider implements UsageProvider {
  readonly id = 'cursor';
  readonly displayName = 'Cursor';
  readonly glyph = 'cursor' as const;
  readonly fidelity = 'official' as const;
  readonly sourceNote = "Cursor's own signed-in session in %APPDATA%\\Cursor";
  /**
   * Borrow, or a session token pasted in.
   *
   * Cursor has no OAuth client TOKI may use, so the manual path takes the
   * editor's own session cookie value -- useful when Cursor is installed under
   * a different Windows account, or on a machine where it is not installed at
   * all.
   */
  readonly support: CredentialSupport = {
    borrow: true,
    oauth: false,
    apiKey: true,
    apiKeyUrl: 'https://cursor.com/dashboard',
    borrowNote: "Cursor's signed-in session in %APPDATA%\\Cursor"
  };
  readonly signIn: SignInRoute = {
    kind: 'openApp',
    name: 'Cursor',
    hint: 'Sign in inside the Cursor editor - TOKI borrows that session, it never asks for its own.'
  };

  constructor(
    private readonly secrets: SecretStore,
    private readonly storePath: string = cursorStateDb()
  ) {}

  private value(key: string): string | null {
    return withDb(this.storePath, (db) => {
      const rows = queryAll<{ value: string }>(db, 'SELECT value FROM ItemTable WHERE key = ?', key);
      return rows[0]?.value ?? null;
    });
  }

  /**
   * The session token pair, read fresh on every request.
   *
   * Nothing is cached: the editor rotates this, and holding a copy buys one
   * SQLite read per poll while risking serving a token Cursor has replaced.
   */
  /**
   * The editor's own session as one cookie, or null when there is none.
   *
   * Null rather than throwing, so `auto` falls through to a pasted token
   * instead of reporting a sign-in problem on a machine without Cursor.
   */
  private borrowedCookie(): string | null {
    if (!existsSync(this.storePath)) return null;
    const token = this.value('cursorAuth/accessToken');
    const accountId =
      this.value('cursorAuth/stripeMembershipAuthId') ?? this.value('cursorAuth/cachedSignUpType');
    if (!token || !accountId) return null;
    // Cursor's web API wants the pair as one cookie, exactly as the editor sends it.
    return `WorkosCursorSessionToken=${accountId}%3A%3A${token}`;
  }

  async fetch(signal: AbortSignal, mode: CredentialMode): Promise<ProviderReading> {
    let cookie: string | null = null;
    let origin: 'borrowed' | 'apiKey' = 'borrowed';

    for (const candidate of modeOrder(mode, this.support)) {
      if (candidate === 'borrowed') {
        const borrowed = this.borrowedCookie();
        if (borrowed) {
          cookie = borrowed;
          origin = 'borrowed';
          break;
        }
      } else if (candidate === 'apiKey') {
        const stored = this.secrets.get('cursor:apiKey');
        if (stored) {
          // Accepted either as the raw cookie or as the bare token pair, since
          // people copy it out of devtools both ways.
          cookie = stored.includes('WorkosCursorSessionToken=')
            ? stored
            : `WorkosCursorSessionToken=${stored}`;
          origin = 'apiKey';
          break;
        }
      }
    }

    if (!cookie) {
      throw new UsageError('needsAuth', 'Cursor is installed but not signed in');
    }

    const payload = await getPinnedJson<CursorUsageSummary>({
      url: 'https://cursor.com/api/usage-summary',
      allowedHost: 'cursor.com',
      headers: { cookie, accept: 'application/json' },
      signal
    });
    const windows = cursorWindows(payload);
    log.debug('cursor', `read ${windows.length} window(s) via ${origin}`);
    return { windows, headlineId: 'included', origin, account: this.account() };
  }

  account(): ProviderAccount | null {
    const email = this.value('cursorAuth/cachedEmail');
    if (!email) return null;
    return {
      label: email,
      plan: this.value('cursorAuth/stripeMembershipType'),
      source: 'Cursor',
      manageUrl: 'https://cursor.com/dashboard'
    };
  }

  forgetCached(): void {
    /* nothing is held between reads */
  }
}
