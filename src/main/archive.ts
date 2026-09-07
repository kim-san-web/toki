import { join } from 'node:path';
import type { ProviderSnapshot } from '../shared/types.js';
import { readJson, writeJson } from './atomic.js';
import { log } from './log.js';

interface ArchiveShape {
  readings: Record<string, ProviderSnapshot>;
  backoffUntil: Record<string, number>;
  /**
   * When a provider was last switched off. Activity events older than this are
   * refused, so re-enabling cannot rehydrate history from before consent.
   */
  activityCutoff: Record<string, number>;
}

/**
 * A fresh, fully-owned archive.
 *
 * A function rather than a shared constant on purpose: spreading one module-level
 * object gives every instance the *same* inner `readings`/`backoffUntil` maps, so
 * one provider's rate-limit deadline leaks into every archive built afterwards in
 * the same process — including a brand new one that has read nothing.
 */
function emptyArchive(): ArchiveShape {
  return { readings: {}, backoffUntil: {}, activityCutoff: {} };
}

/**
 * The last good reading per provider, so a relaunch shows numbers immediately
 * instead of five empty rings, and the rate-limit deadline, so relaunching
 * during a penalty waits instead of spending an attempt on it.
 *
 * Only sanitised snapshots are stored -- never a token, a cookie, or a raw
 * response body.
 */
export class UsageArchive {
  private readonly path: string;
  private data: ArchiveShape;

  constructor(dir: string) {
    this.path = join(dir, 'archive.json');
    const stored = readJson<Partial<ArchiveShape>>(this.path, {});
    const fresh = emptyArchive();
    this.data = {
      readings: { ...fresh.readings, ...stored.readings },
      backoffUntil: { ...fresh.backoffUntil, ...stored.backoffUntil },
      activityCutoff: { ...fresh.activityCutoff, ...stored.activityCutoff }
    };
  }

  private flush(): void {
    try {
      writeJson(this.path, this.data);
    } catch (error) {
      log.error('archive', `could not persist: ${String(error)}`);
    }
  }

  reading(id: string): ProviderSnapshot | null {
    return this.data.readings[id] ?? null;
  }

  saveReading(snapshot: ProviderSnapshot): void {
    this.data.readings[snapshot.id] = snapshot;
    this.flush();
  }

  /** Called when a provider is switched off: its readings are forgotten. */
  forget(id: string): void {
    delete this.data.readings[id];
    delete this.data.backoffUntil[id];
    this.data.activityCutoff[id] = Date.now();
    this.flush();
  }

  backoffUntil(id: string): number | null {
    return this.data.backoffUntil[id] ?? null;
  }

  saveBackoff(id: string, until: number | null): void {
    if (until === null) delete this.data.backoffUntil[id];
    else this.data.backoffUntil[id] = until;
    this.flush();
  }

  activityCutoff(id: string): number {
    return this.data.activityCutoff[id] ?? 0;
  }
}
