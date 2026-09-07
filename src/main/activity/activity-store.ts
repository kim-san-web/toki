import type { ProviderActivity } from '../../shared/types.js';
import type { ActivityMonitor } from './monitor.js';
import { summarise } from './monitor.js';
import type { SettingsStore } from '../settings-store.js';
import type { UsageArchive } from '../archive.js';

/**
 * Every monitor's reading, reduced to one row per provider.
 *
 * A monitor for a disabled provider is stopped outright, so nothing is read
 * from it -- and its historical events are refused by the cutoff the archive
 * stamped when it was switched off.
 */
export class ActivityStore {
  private listeners = new Set<() => void>();
  private running = new Set<string>();

  constructor(
    private readonly monitors: ActivityMonitor[],
    private readonly settings: SettingsStore,
    private readonly archive: UsageArchive
  ) {}

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(): void {
    for (const listener of this.listeners) listener();
  }

  /** Start monitors for enabled providers, stop the rest. Idempotent. */
  sync(): void {
    for (const monitor of this.monitors) {
      const wanted = this.settings.isEnabled(monitor.providerId) && !this.settings.get().demoMode;
      const isRunning = this.running.has(monitor.providerId);
      if (wanted && !isRunning) {
        monitor.start();
        this.running.add(monitor.providerId);
      } else if (!wanted && isRunning) {
        monitor.stop();
        this.running.delete(monitor.providerId);
      }
    }
  }

  stop(): void {
    for (const monitor of this.monitors) {
      if (this.running.has(monitor.providerId)) monitor.stop();
    }
    this.running.clear();
  }

  list(): ProviderActivity[] {
    return this.monitors.map((monitor) => {
      if (!this.running.has(monitor.providerId)) {
        return { providerId: monitor.providerId, state: 'unavailable' as const, sessions: [] };
      }
      const cutoff = this.archive.activityCutoff(monitor.providerId);
      const sessions = monitor.read();
      const filtered = sessions === null ? null : sessions.filter((s) => s.since >= cutoff);
      return summarise(monitor.providerId, filtered);
    });
  }

  /** True while anything at all is running -- the store polls faster then. */
  get anyBusy(): boolean {
    return this.list().some((activity) => activity.state === 'working' || activity.state === 'waiting');
  }
}
