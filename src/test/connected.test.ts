import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isConnected } from '../shared/bands.js';
import { UsageStore } from '../main/usage-store.js';
import { SettingsStore } from '../main/settings-store.js';
import { UsageArchive } from '../main/archive.js';
import { UsageError, type ProviderReading, type SignInRoute, type UsageProvider } from '../main/providers/provider.js';
import type { ProviderAccount, ProviderSnapshot } from '../shared/types.js';

function snapshot(init: Partial<ProviderSnapshot>): ProviderSnapshot {
  return {
    id: 'x',
    displayName: 'X',
    glyph: 'generic',
    fidelity: 'official',
    status: { kind: 'ok' },
    windows: [],
    headlineId: null,
    block: null,
    account: null,
    readAt: null,
    sourceNote: '',
    support: { borrow: true, oauth: false, apiKey: false, apiKeyUrl: null, borrowNote: '' },
    origin: 'none',
    hasStoredSecret: false,
    ...init
  };
}

const WINDOW = { id: 'w', label: 'W', usedFraction: 0.4, remaining: null, used: null, resetsAt: null };

test('a provider with no windows is not connected', () => {
  assert.equal(isConnected(snapshot({ status: { kind: 'disabled' } })), false);
  assert.equal(isConnected(snapshot({ status: { kind: 'needsAuth' } })), false);
  assert.equal(isConnected(snapshot({ status: { kind: 'unsupported', why: 'free plan' } })), false);
});

test('a provider with a reading is connected', () => {
  assert.equal(isConnected(snapshot({ windows: [WINDOW] })), true);
});

test('a connected provider that is now FAILING stays connected', () => {
  // The important case. A ring vanishing must mean "not set up" -- never "set
  // up and quietly broken" -- or the dashboard cannot be trusted.
  for (const status of [
    { kind: 'stale' as const, since: Date.now() - 60_000 },
    { kind: 'error' as const, why: 'network' },
    { kind: 'accessDenied' as const }
  ]) {
    assert.equal(isConnected(snapshot({ windows: [WINDOW], status })), true, `${status.kind} must keep its ring`);
  }
});

/* ---- the same rule, end to end through the store ------------------------ */

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'toki-conn-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

class Fake implements UsageProvider {
  readonly glyph = 'generic' as const;
  readonly fidelity = 'official' as const;
  readonly sourceNote = 'fake';
  readonly support = { borrow: true, oauth: false, apiKey: false, apiKeyUrl: null, borrowNote: '' };
  readonly signIn: SignInRoute = { kind: 'url', url: 'https://example.com', label: 'x' };
  behaviour: (() => Promise<ProviderReading>) | null = null;
  constructor(readonly id = 'fake', readonly displayName = 'Fake') {}
  async fetch(): Promise<ProviderReading> {
    if (!this.behaviour) throw new UsageError('needsAuth', 'nothing');
    return this.behaviour();
  }
  account(): ProviderAccount | null {
    return null;
  }
  forgetCached(): void {}
}

function build(provider: UsageProvider) {
  const settings = new SettingsStore(dir);
  const archive = new UsageArchive(dir);
  return { settings, archive, store: new UsageStore([provider], settings, archive) };
}

test('a provider that never reads never appears in the notch', async () => {
  const provider = new Fake();
  const { store, settings } = build(provider);
  store.applySettings(settings.get(), settings.update({ providers: { fake: { enabled: true } } }));
  await store.refresh();
  assert.equal(store.list().filter(isConnected).length, 0);
  // Settings still lists it, which is where it would be connected.
  assert.equal(store.list().length, 1);
});

test('a provider appears once it reads, and survives a later failure', async () => {
  const provider = new Fake();
  provider.behaviour = async () => ({ windows: [WINDOW], headlineId: 'w' });
  const { store, settings } = build(provider);
  store.applySettings(settings.get(), settings.update({ providers: { fake: { enabled: true } } }));

  await store.refresh();
  assert.equal(store.list().filter(isConnected).length, 1, 'appears after a reading');

  provider.behaviour = async () => {
    throw new UsageError('failed', 'the network went away');
  };
  await store.refresh();
  assert.equal(store.list().filter(isConnected).length, 1, 'must not vanish when it breaks');
});

test('switching a provider off removes it from the notch', async () => {
  const provider = new Fake();
  provider.behaviour = async () => ({ windows: [WINDOW], headlineId: 'w' });
  const { store, settings } = build(provider);
  let previous = settings.get();
  let next = settings.update({ providers: { fake: { enabled: true } } });
  store.applySettings(previous, next);
  await store.refresh();
  assert.equal(store.list().filter(isConnected).length, 1);

  previous = next;
  next = settings.update({ providers: { fake: { enabled: false } } });
  store.applySettings(previous, next);
  // Its readings are forgotten, so it drops out rather than lingering as a dash.
  assert.equal(store.list().filter(isConnected).length, 0);
});
