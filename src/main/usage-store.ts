import type { ProviderSnapshot, ProviderStatus, Settings } from '../shared/types.js';
import { UsageError, emptySnapshot, type UsageProvider } from './providers/provider.js';
import { claudeBackoffSeconds } from './providers/claude-usage.js';
import { CodexProvider } from './providers/codex.js';
import { demoProviders } from './providers/demo.js';
import type { UsageArchive } from './archive.js';
import type { SettingsStore } from './settings-store.js';
import { log, scrub } from './log.js';

/**
 * Collects every provider's reading on a timer and caches the result.
 *
 * The UI never learns how Claude, Cursor or Codex work; it reads snapshots.
 * Three rules hold the whole thing together:
 *
 *  1. A disabled provider is never touched -- no file read, no request.
 *  2. Every failure degrades to a *visible status* rather than a made-up
 *     percentage, keeping the last good reading and saying how old it is.
 *  3. A refresh in flight when the settings change is abandoned by generation,
 *     so an answer for the old configuration can never overwrite the new one.
 */
export class UsageStore {
  private snapshots = new Map<string, ProviderSnapshot>();
  private inFlight: Promise<void> | null = null;
  private generation = 0;
  private abort: AbortController | null = null;
  private timer: NodeJS.Timeout | null = null;
  private consecutiveRateLimits = new Map<string, number>();
  private listeners = new Set<() => void>();
  private lastSweptAt = 0;

  /** Poll cadence. Slower when nothing is running: nobody is watching. */
  static readonly ACTIVE_INTERVAL_MS = 60_000;
  static readonly IDLE_INTERVAL_MS = 5 * 60_000;

  private busy = false;

  constructor(
    private readonly providers: UsageProvider[],
    private readonly settings: SettingsStore,
    private readonly archive: UsageArchive
  ) {
    for (const provider of providers) {
      const stored = archive.reading(provider.id);
      const base = stored ?? emptySnapshot(provider);
      this.snapshots.set(provider.id, this.applyEnablement(base, provider));
    }
  }

  /** A stored reading is shown as stale, never as if it had just been taken. */
  private applyEnablement(snapshot: ProviderSnapshot, provider: UsageProvider): ProviderSnapshot {
    if (!this.settings.isEnabled(provider.id)) {
      return { ...emptySnapshot(provider), status: { kind: 'disabled' } };
    }
    if (snapshot.readAt !== null) {
      return { ...snapshot, status: { kind: 'stale', since: snapshot.readAt } };
    }
    return snapshot;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  list(): ProviderSnapshot[] {
    if (this.settings.get().demoMode) return demoProviders();
    return this.providers.map((p) => this.snapshots.get(p.id) ?? emptySnapshot(p));
  }

  get sweptAt(): number {
    return this.lastSweptAt;
  }

  get refreshing(): boolean {
    return this.inFlight !== null;
  }

  /** Called by the activity monitors: something is running, so poll faster. */
  setBusy(busy: boolean): void {
    if (this.busy === busy) return;
    this.busy = busy;
    if (this.timer) this.start();
  }

  start(): void {
    this.stop();
    const interval = this.busy ? UsageStore.ACTIVE_INTERVAL_MS : UsageStore.IDLE_INTERVAL_MS;
    this.timer = setInterval(() => void this.refresh(), interval);
    void this.refresh();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Applies a settings change.
   *
   * Enabling reads for the first time; disabling forgets everything read from
   * that provider and stamps an activity cutoff, so switching it back on cannot
   * rehydrate history from before consent.
   */
  applySettings(previous: Settings, next: Settings): void {
    let changed = false;
    for (const provider of this.providers) {
      const was = previous.providers[provider.id]?.enabled ?? false;
      const now = next.providers[provider.id]?.enabled ?? false;
      if (was === now) continue;
      changed = true;
      if (!now) {
        provider.forgetCached();
        this.archive.forget(provider.id);
        this.consecutiveRateLimits.delete(provider.id);
        this.snapshots.set(provider.id, { ...emptySnapshot(provider), status: { kind: 'disabled' } });
      } else {
        this.snapshots.set(provider.id, emptySnapshot(provider));
      }
    }
    if (previous.demoMode !== next.demoMode) {
      changed = true;
      for (const provider of this.providers) provider.forgetCached();
    }
    if (changed) {
      // Abandon anything in flight: it was started for the old configuration.
      this.invalidate();
      this.emit();
      if (this.timer) void this.refresh();
    }
  }

  private invalidate(): void {
    this.generation += 1;
    this.abort?.abort();
    this.abort = null;
    this.inFlight = null;
  }

  /**
   * One sweep. Concurrent callers share the same promise rather than starting
   * competing sweeps -- the tray's "Refresh now" during a scheduled poll must
   * not double every request.
   */
  refresh(): Promise<void> {
    if (this.settings.get().demoMode) {
      this.lastSweptAt = Date.now();
      this.emit();
      return Promise.resolve();
    }
    if (this.inFlight) return this.inFlight;

    const generation = this.generation;
    const controller = new AbortController();
    this.abort = controller;
    this.emit();

    const run = (async () => {
      await Promise.all(
        this.providers.map((provider) => this.refreshOne(provider, generation, controller.signal))
      );
    })().finally(() => {
      if (generation === this.generation) {
        this.inFlight = null;
        this.abort = null;
        this.lastSweptAt = Date.now();
        this.emit();
      }
    });

    this.inFlight = run;
    return run;
  }

  private set(id: string, snapshot: ProviderSnapshot, generation: number): void {
    if (generation !== this.generation) return; // an answer for a configuration we have left
    this.snapshots.set(id, snapshot);
    this.emit();
  }

  private previous(provider: UsageProvider): ProviderSnapshot {
    return this.snapshots.get(provider.id) ?? emptySnapshot(provider);
  }

  /** Keep the numbers, change the status: an old reading is still a reading. */
  private degrade(provider: UsageProvider, status: ProviderStatus, generation: number): void {
    const previous = this.previous(provider);
    const keepWindows = previous.readAt !== null;
    this.set(
      provider.id,
      {
        ...previous,
        status,
        windows: keepWindows ? previous.windows : [],
        block: keepWindows ? previous.block : null,
        account: provider.account(),
        support: provider.support,
        hasStoredSecret: provider.hasStoredSecret?.() ?? false
      },
      generation
    );
  }

  private async refreshOne(provider: UsageProvider, generation: number, signal: AbortSignal): Promise<void> {
    if (!this.settings.isEnabled(provider.id)) {
      this.set(provider.id, { ...emptySnapshot(provider), status: { kind: 'disabled' } }, generation);
      return;
    }

    const backoff = this.archive.backoffUntil(provider.id);
    if (backoff !== null && backoff > Date.now()) {
      const previous = this.previous(provider);
      // Not an error to show: it is a wait we chose. Keep the last reading with
      // its age rather than replacing it with a scary red row.
      this.degrade(
        provider,
        previous.readAt !== null ? { kind: 'stale', since: previous.readAt } : { kind: 'ok' },
        generation
      );
      return;
    }

    try {
      const mode = this.settings.providerPref(provider.id).mode ?? 'auto';
      const reading = await provider.fetch(signal, mode);
      if (generation !== this.generation) return;

      const now = Date.now();
      const recordedAt = reading.recordedAt ?? now;
      // A file-backed reading is fresh to *fetch* and can still be days old.
      const status: ProviderStatus =
        reading.recordedAt !== null && reading.recordedAt !== undefined && now - reading.recordedAt > CodexProvider.CURRENT_FOR_MS
          ? { kind: 'stale', since: reading.recordedAt }
          : { kind: 'ok' };

      const snapshot: ProviderSnapshot = {
        id: provider.id,
        displayName: provider.displayName,
        glyph: provider.glyph,
        fidelity: provider.fidelity,
        status,
        windows: reading.windows,
        headlineId: reading.headlineId,
        block: reading.block ?? null,
        account: reading.account ?? provider.account(),
        readAt: recordedAt,
        sourceNote: provider.sourceNote,
        support: provider.support,
        origin: reading.origin ?? 'borrowed',
        hasStoredSecret: provider.hasStoredSecret?.() ?? false
      };
      this.set(provider.id, snapshot, generation);
      this.archive.saveReading(snapshot);
      this.archive.saveBackoff(provider.id, null);
      this.consecutiveRateLimits.set(provider.id, 0);
    } catch (error) {
      if (generation !== this.generation) return;
      this.handleFailure(provider, error, generation);
    }
  }

  private handleFailure(provider: UsageProvider, error: unknown, generation: number): void {
    if (!(error instanceof UsageError)) {
      log.error(provider.id, scrub(String(error)));
      this.degrade(provider, { kind: 'error', why: 'unexpected failure' }, generation);
      return;
    }

    switch (error.kind) {
      case 'rateLimited': {
        const consecutive = (this.consecutiveRateLimits.get(provider.id) ?? 0) + 1;
        this.consecutiveRateLimits.set(provider.id, consecutive);
        const seconds = claudeBackoffSeconds(consecutive, error.retryAfter);
        // Persisted, so relaunching during a penalty waits instead of spending
        // an attempt extending it.
        this.archive.saveBackoff(provider.id, Date.now() + seconds * 1000);
        log.info(provider.id, `rate limited (${consecutive}x), next attempt in ${seconds}s`);
        const previous = this.previous(provider);
        this.degrade(
          provider,
          previous.readAt !== null ? { kind: 'stale', since: previous.readAt } : { kind: 'ok' },
          generation
        );
        return;
      }
      case 'needsAuth':
        provider.forgetCached();
        this.degrade(provider, { kind: 'needsAuth' }, generation);
        return;
      case 'accessDenied':
        this.degrade(provider, { kind: 'accessDenied' }, generation);
        return;
      case 'credentialExpired': {
        // The last reading is still true, just old -- not a sign-out.
        const previous = this.previous(provider);
        this.degrade(
          provider,
          previous.readAt !== null ? { kind: 'stale', since: previous.readAt } : { kind: 'needsAuth' },
          generation
        );
        return;
      }
      case 'nothingMetered':
        this.degrade(provider, { kind: 'unsupported', why: error.message }, generation);
        return;
      default:
        log.warn(provider.id, scrub(error.message));
        this.degrade(provider, { kind: 'error', why: error.message }, generation);
    }
  }
}
