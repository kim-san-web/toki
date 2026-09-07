import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsageStore } from '../main/usage-store.js';
import { SettingsStore } from '../main/settings-store.js';
import { UsageArchive } from '../main/archive.js';
import { UsageError, type ProviderReading, type SignInRoute, type UsageProvider } from '../main/providers/provider.js';
import { SecretStore } from '../main/secrets.js';
import { ClaudeProvider } from '../main/providers/claude.js';
import type { ProviderAccount } from '../shared/types.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'toki-store-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

class FakeProvider implements UsageProvider {
  readonly glyph = 'generic' as const;
  readonly fidelity = 'official' as const;
  readonly sourceNote = 'a fake';
  readonly signIn: SignInRoute = { kind: 'url', url: 'https://example.com', label: 'x' };
  readonly support = {
    borrow: true,
    oauth: false,
    apiKey: false,
    apiKeyUrl: null,
    borrowNote: 'a fake'
  };
  calls = 0;
  forgot = 0;
  behaviour: (() => Promise<ProviderReading>) | null = null;

  constructor(
    readonly id = 'fake',
    readonly displayName = 'Fake'
  ) {}

  async fetch(): Promise<ProviderReading> {
    this.calls += 1;
    if (!this.behaviour) throw new UsageError('failed', 'no behaviour set');
    return this.behaviour();
  }

  account(): ProviderAccount | null {
    return null;
  }

  forgetCached(): void {
    this.forgot += 1;
  }
}

function build(provider: UsageProvider) {
  const settings = new SettingsStore(dir);
  const archive = new UsageArchive(dir);
  return { settings, archive, store: new UsageStore([provider], settings, archive) };
}

const READING: ProviderReading = {
  windows: [{ id: 'w', label: 'W', usedFraction: 0.5, remaining: null, used: null, resetsAt: null }],
  headlineId: 'w'
};

test('a disabled provider is never read at all', async () => {
  const provider = new FakeProvider();
  provider.behaviour = async () => READING;
  const { store } = build(provider);

  await store.refresh();

  assert.equal(provider.calls, 0);
  assert.equal(store.list()[0]!.status.kind, 'disabled');
});

test('enabling reads, and the reading is kept', async () => {
  const provider = new FakeProvider();
  provider.behaviour = async () => READING;
  const { store, settings } = build(provider);

  const before = settings.get();
  const after = settings.update({ providers: { fake: { enabled: true } } });
  store.applySettings(before, after);
  await store.refresh();

  const snapshot = store.list()[0]!;
  assert.equal(provider.calls, 1);
  assert.equal(snapshot.status.kind, 'ok');
  assert.equal(snapshot.windows[0]!.usedFraction, 0.5);
});

test('disabling forgets the reading and stamps an activity cutoff', async () => {
  const provider = new FakeProvider();
  provider.behaviour = async () => READING;
  const { store, settings, archive } = build(provider);

  let previous = settings.get();
  let next = settings.update({ providers: { fake: { enabled: true } } });
  store.applySettings(previous, next);
  await store.refresh();
  assert.ok(archive.reading('fake'));

  previous = next;
  next = settings.update({ providers: { fake: { enabled: false } } });
  store.applySettings(previous, next);

  assert.equal(archive.reading('fake'), null);
  assert.equal(provider.forgot, 1);
  assert.ok(archive.activityCutoff('fake') > 0);
  assert.equal(store.list()[0]!.status.kind, 'disabled');
  assert.deepEqual(store.list()[0]!.windows, []);
});

test('a failure keeps the last reading and says how old it is', async () => {
  const provider = new FakeProvider();
  provider.behaviour = async () => READING;
  const { store, settings } = build(provider);
  const before = settings.get();
  store.applySettings(before, settings.update({ providers: { fake: { enabled: true } } }));
  await store.refresh();

  provider.behaviour = async () => {
    throw new UsageError('failed', 'the network went away');
  };
  await store.refresh();

  const snapshot = store.list()[0]!;
  // The numbers survive: an old reading is still a reading.
  assert.equal(snapshot.windows[0]!.usedFraction, 0.5);
  assert.equal(snapshot.status.kind, 'error');
});

test('a 429 persists a back-off and skips the next attempt', async () => {
  const provider = new FakeProvider();
  provider.behaviour = async () => {
    throw new UsageError('rateLimited', 'slow down', 0);
  };
  const { store, settings, archive } = build(provider);
  store.applySettings(settings.get(), settings.update({ providers: { fake: { enabled: true } } }));

  await store.refresh();
  assert.equal(provider.calls, 1);
  const until = archive.backoffUntil('fake');
  assert.ok(until !== null && until > Date.now());

  // The next sweep must not spend an attempt extending the penalty.
  await store.refresh();
  assert.equal(provider.calls, 1);
});

test('an expired credential is not a sign-out', async () => {
  const provider = new FakeProvider();
  provider.behaviour = async () => READING;
  const { store, settings } = build(provider);
  store.applySettings(settings.get(), settings.update({ providers: { fake: { enabled: true } } }));
  await store.refresh();

  provider.behaviour = async () => {
    throw new UsageError('credentialExpired', 'will refresh');
  };
  await store.refresh();

  // Telling someone to sign in when they are signed in sends them to fix the
  // wrong thing.
  assert.equal(store.list()[0]!.status.kind, 'stale');
});

test('nothing metered is a status, not an error', async () => {
  const provider = new FakeProvider();
  provider.behaviour = async () => {
    throw new UsageError('nothingMetered', 'the free plan has nothing to meter');
  };
  const { store, settings } = build(provider);
  store.applySettings(settings.get(), settings.update({ providers: { fake: { enabled: true } } }));
  await store.refresh();

  const status = store.list()[0]!.status;
  assert.equal(status.kind, 'unsupported');
  assert.match(status.kind === 'unsupported' ? status.why : '', /free plan/);
});

test('concurrent refreshes share one sweep', async () => {
  const provider = new FakeProvider();
  // The promise is created up front, not captured from inside `fetch`: the
  // store may await other work before calling the provider, so a resolver
  // assigned inside the fetch body is not guaranteed to exist yet.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  provider.behaviour = async () => {
    await gate;
    return READING;
  };
  const { store, settings } = build(provider);
  store.applySettings(settings.get(), settings.update({ providers: { fake: { enabled: true } } }));

  const a = store.refresh();
  const b = store.refresh();
  // The tray's "Refresh now" during a scheduled poll must not double the work.
  assert.equal(a, b);
  release();
  await a;
  assert.equal(provider.calls, 1);
});

test('a stored reading is restored on relaunch, marked stale', async () => {
  const provider = new FakeProvider();
  provider.behaviour = async () => READING;
  const first = build(provider);
  first.settings.update({ providers: { fake: { enabled: true } } });
  first.store.applySettings({ ...first.settings.get(), providers: {} }, first.settings.get());
  await first.store.refresh();

  // A fresh process reading the same state directory.
  const settings = new SettingsStore(dir);
  const archive = new UsageArchive(dir);
  const store = new UsageStore([new FakeProvider()], settings, archive);
  const snapshot = store.list()[0]!;

  assert.equal(snapshot.windows[0]!.usedFraction, 0.5);
  // Never presented as if it had just been taken.
  assert.equal(snapshot.status.kind, 'stale');
});

/**
 * A stand-in for Windows DPAPI.
 *
 * Reversible rather than real encryption: these tests are about whether the
 * store persists, isolates and forgets values, not about the OS primitive.
 */
function fakeCrypto(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain: string) => Buffer.from(plain, 'utf8'),
    decryptString: (encrypted: Buffer) => encrypted.toString('utf8')
  };
}

test('the Claude adapter reports needsAuth when there is nothing to borrow', async () => {
  const profile = join(dir, '.claude');
  mkdirSync(profile, { recursive: true });
  const provider = new ClaudeProvider('claude', 'Claude', profile, new SecretStore(dir, fakeCrypto()));
  await assert.rejects(
    () => provider.fetch(new AbortController().signal, 'auto'),
    (error: unknown) => error instanceof UsageError && error.kind === 'needsAuth'
  );
  assert.equal(provider.account(), null);
});

test('an EMPTY borrowed credential falls through instead of blocking', async () => {
  // This is the real state Claude Code leaves on some Windows installs: the
  // file exists and every token field is blank. Treating it as a sign-in
  // problem left the ring permanently empty with no way to fix it.
  const profile = join(dir, '.claude');
  mkdirSync(profile, { recursive: true });
  writeFileSync(
    join(profile, '.credentials.json'),
    JSON.stringify({ claudeAiOauth: { accessToken: '', refreshToken: '', expiresAt: 0, scopes: [] } })
  );
  const provider = new ClaudeProvider('claude', 'Claude', profile, new SecretStore(dir, fakeCrypto()));

  assert.equal(provider.originAvailable(), 'none');
  await assert.rejects(
    () => provider.fetch(new AbortController().signal, 'auto'),
    (error: unknown) => error instanceof UsageError && error.kind === 'needsAuth'
  );
});

test('an expired borrowed token is credentialExpired, and no request is made', async () => {
  const profile = join(dir, '.claude');
  mkdirSync(profile, { recursive: true });
  writeFileSync(
    join(profile, '.credentials.json'),
    JSON.stringify({ claudeAiOauth: { accessToken: 'x'.repeat(40), expiresAt: 1000, subscriptionType: 'max' } })
  );
  const provider = new ClaudeProvider('claude', 'Claude', profile, new SecretStore(dir, fakeCrypto()));
  await assert.rejects(
    () => provider.fetch(new AbortController().signal, 'auto'),
    (error: unknown) => error instanceof UsageError && error.kind === 'credentialExpired'
  );
  // The plan is still readable, so the Settings row can say which login it is.
  assert.equal(provider.account()?.plan, 'max');
});

test('a stored API key is found when there is nothing to borrow', () => {
  const profile = join(dir, '.claude');
  mkdirSync(profile, { recursive: true });
  const secrets = new SecretStore(dir, fakeCrypto());
  const provider = new ClaudeProvider('claude', 'Claude', profile, secrets);

  assert.equal(provider.originAvailable(), 'none');
  assert.equal(provider.hasStoredSecret(), false);

  secrets.set('claude:apiKey', 'sk-ant-test');
  assert.equal(provider.originAvailable(), 'apiKey');
  assert.equal(provider.hasStoredSecret(), true);
  assert.equal(provider.account()?.source, 'API key');
});

test('borrowing wins over a stored key under auto', () => {
  const profile = join(dir, '.claude');
  mkdirSync(profile, { recursive: true });
  writeFileSync(
    join(profile, '.credentials.json'),
    JSON.stringify({
      claudeAiOauth: { accessToken: 'y'.repeat(40), expiresAt: Date.now() + 3_600_000, subscriptionType: 'pro' }
    })
  );
  const secrets = new SecretStore(dir, fakeCrypto());
  secrets.set('claude:apiKey', 'sk-ant-test');
  const provider = new ClaudeProvider('claude', 'Claude', profile, secrets);
  // Borrowing needs no setup and belongs to the account already signed in.
  assert.equal(provider.originAvailable(), 'borrowed');
  assert.equal(provider.account()?.source, 'Claude Code');
});
