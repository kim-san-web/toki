import { join } from 'node:path';
import { DEFAULT_SETTINGS, type Settings, type ProviderPref } from '../shared/types.js';
import { readJson, writeJson } from './atomic.js';
import { log } from './log.js';

/**
 * Preferences, persisted atomically.
 *
 * Every provider is off until switched on. That is the whole privacy posture of
 * this app in one line: a fresh install reads nobody's credentials, and demo
 * mode is a separate flag so turning the sample data on can never be mistaken
 * for consent to read a real one.
 */
export class SettingsStore {
  private readonly path: string;
  private value: Settings;
  private listeners = new Set<(s: Settings) => void>();

  constructor(dir: string) {
    this.path = join(dir, 'settings.json');
    const stored = readJson<Partial<Settings>>(this.path, {});
    // `providers` is rebuilt rather than spread from the defaults: sharing
    // DEFAULT_SETTINGS.providers would let one store's toggles appear in the
    // next one constructed in the same process.
    this.value = {
      ...DEFAULT_SETTINGS,
      ...stored,
      providers: { ...DEFAULT_SETTINGS.providers, ...stored.providers }
    };
  }

  get(): Settings {
    return this.value;
  }

  providerPref(id: string): ProviderPref {
    return this.value.providers[id] ?? { enabled: false };
  }

  isEnabled(id: string): boolean {
    return this.providerPref(id).enabled;
  }

  update(patch: Partial<Settings>): Settings {
    const providers = patch.providers
      ? { ...this.value.providers, ...patch.providers }
      : this.value.providers;
    this.value = { ...this.value, ...patch, providers };
    try {
      writeJson(this.path, this.value);
    } catch (error) {
      log.error('settings', `could not persist: ${String(error)}`);
    }
    for (const listener of this.listeners) listener(this.value);
    return this.value;
  }

  onChange(listener: (s: Settings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
