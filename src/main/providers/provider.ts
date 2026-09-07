import type {
  CredentialMode,
  CredentialOrigin,
  CredentialSupport,
  Fidelity,
  LimitWindow,
  ProviderAccount,
  ProviderGlyph,
  ProviderSnapshot,
  UsageBlock
} from '../../shared/types.js';

/**
 * One source of usage numbers.
 *
 * An adapter knows exactly one thing: how to turn whatever its owning tool
 * already keeps on this PC into windows. It never decides how often it is
 * called, never caches across calls for the store's benefit, and never invents
 * a number -- every failure is thrown as a `UsageError` the store can render.
 */
export interface UsageProvider {
  readonly id: string;
  readonly displayName: string;
  readonly glyph: ProviderGlyph;
  readonly fidelity: Fidelity;
  /** Where the reading comes from, in the user's own terms. Shown in Settings. */
  readonly sourceNote: string;
  /** Which credential modes this provider can actually offer. */
  readonly support: CredentialSupport;

  /**
   * May throw `UsageError`. Called only while the provider is enabled.
   *
   * `mode` narrows which credential to use; `auto` lets the adapter try each
   * one it supports in turn, so a user who has signed in to the owning tool
   * needs no setup and a user whose tool wrote an empty credential still gets a
   * reading.
   */
  fetch(signal: AbortSignal, mode: CredentialMode): Promise<ProviderReading>;

  /** Non-secret identity, for the Settings row. Null when not signed in. */
  account(): ProviderAccount | null;

  /** Drop anything held in memory. Called on disable and on demo transitions. */
  forgetCached(): void;

  /** True when TOKI holds a secret of its own for this provider. */
  hasStoredSecret?(): boolean;

  /** Where the user goes to fix a missing credential. */
  readonly signIn: SignInRoute;
}

export type SignInRoute =
  | { kind: 'openApp'; name: string; hint: string }
  | { kind: 'url'; url: string; label: string };

export interface ProviderReading {
  windows: LimitWindow[];
  headlineId: string | null;
  /** Which credential mode actually produced this reading. */
  origin?: CredentialOrigin;
  block?: UsageBlock | null;
  /**
   * When the *reading* was taken, which is not when the fetch happened. A file
   * on disk reads instantly and can still be three days old.
   */
  recordedAt?: number | null;
  account?: ProviderAccount | null;
}

export type UsageErrorKind =
  /** No usable credential -- the user has to sign in to the owning tool. */
  | 'needsAuth'
  /** The credential is there and we were refused it. Not the same as signed out. */
  | 'accessDenied'
  /** There but expired; the owning app refreshes it next time it runs. */
  | 'credentialExpired'
  /** The endpoint answered with something we do not understand. */
  | 'badResponse'
  /** Asked to slow down. */
  | 'rateLimited'
  /** Readable, and genuinely nothing is being metered. Not an error. */
  | 'nothingMetered'
  /** Something else went wrong. */
  | 'failed';

export class UsageError extends Error {
  readonly kind: UsageErrorKind;
  /** Seconds, for `rateLimited`. */
  readonly retryAfter: number;

  constructor(kind: UsageErrorKind, message: string, retryAfter = 0) {
    super(message);
    this.name = 'UsageError';
    this.kind = kind;
    this.retryAfter = retryAfter;
  }
}

export function limitWindow(init: Partial<LimitWindow> & { id: string; label: string }): LimitWindow {
  return {
    usedFraction: null,
    remaining: null,
    used: null,
    resetsAt: null,
    ...init
  };
}

/** A snapshot for a provider that has never been read. */
export function emptySnapshot(p: UsageProvider): ProviderSnapshot {
  return {
    id: p.id,
    displayName: p.displayName,
    glyph: p.glyph,
    fidelity: p.fidelity,
    status: { kind: 'disabled' },
    windows: [],
    headlineId: null,
    block: null,
    account: null,
    readAt: null,
    sourceNote: p.sourceNote,
    support: p.support,
    origin: 'none',
    hasStoredSecret: false
  };
}

/**
 * Which credential modes to try, in order, for a requested mode.
 *
 * Borrowing comes first under `auto` because it needs no setup and no stored
 * secret. An explicit mode is honoured exactly, so a user who has chosen "API
 * key" is never silently served a borrowed reading from another account.
 */
export function modeOrder(requested: CredentialMode, support: CredentialSupport): CredentialOrigin[] {
  const wanted: CredentialOrigin[] =
    requested === 'auto'
      ? ['borrowed', 'oauth', 'apiKey']
      : requested === 'borrow'
        ? ['borrowed']
        : requested === 'oauth'
          ? ['oauth']
          : ['apiKey'];
  return wanted.filter((origin) =>
    origin === 'borrowed' ? support.borrow : origin === 'oauth' ? support.oauth : support.apiKey
  );
}
