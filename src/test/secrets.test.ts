import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SecretStore, type Crypto } from '../main/secrets.js';
import { modeOrder } from '../main/providers/provider.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'toki-secrets-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Reversible stand-in for DPAPI: these tests are about the store, not the OS. */
function crypto(available = true): Crypto {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain) => Buffer.from(`enc:${plain}`, 'utf8'),
    decryptString: (buf) => buf.toString('utf8').replace(/^enc:/, '')
  };
}

test('a secret round-trips through a new store', () => {
  new SecretStore(dir, crypto()).set('claude:apiKey', 'sk-ant-1234');
  // A fresh instance, as if the app had been restarted.
  assert.equal(new SecretStore(dir, crypto()).get('claude:apiKey'), 'sk-ant-1234');
});

test('the value is never written in the clear', () => {
  new SecretStore(dir, crypto()).set('claude:apiKey', 'sk-ant-SECRET');
  const raw = readFileSync(join(dir, 'secrets.bin'), 'utf8');
  assert.equal(raw.includes('sk-ant-SECRET'), false, 'the plaintext key must not appear on disk');
});

test('nothing is stored when the OS will not encrypt', () => {
  // A plaintext key on disk is worse than asking the user again.
  const store = new SecretStore(dir, crypto(false));
  assert.equal(store.canStore, false);
  assert.equal(store.set('claude:apiKey', 'sk-ant-1234'), false);
  assert.equal(store.get('claude:apiKey'), null);
  assert.equal(existsSync(join(dir, 'secrets.bin')), false);
});

test('an unreadable secret is discarded rather than surfaced as an error', () => {
  new SecretStore(dir, crypto()).set('claude:apiKey', 'sk-ant-1234');
  // Written by a different Windows account, or after a credential reset.
  const hostile: Crypto = {
    isEncryptionAvailable: () => true,
    encryptString: (p) => Buffer.from(p, 'utf8'),
    decryptString: () => {
      throw new Error('wrong DPAPI scope');
    }
  };
  const store = new SecretStore(dir, hostile);
  assert.equal(store.get('claude:apiKey'), null);
  assert.deepEqual(store.ids(), []);
});

test('deleting the last secret removes the file', () => {
  const store = new SecretStore(dir, crypto());
  store.set('a', '1');
  store.set('b', '2');
  store.delete('a');
  assert.equal(existsSync(join(dir, 'secrets.bin')), true, 'one secret remains');
  store.delete('b');
  // An empty encrypted blob would imply something is still stored.
  assert.equal(existsSync(join(dir, 'secrets.bin')), false);
});

test('secrets are namespaced per provider profile', () => {
  const store = new SecretStore(dir, crypto());
  store.set('claude:apiKey', 'personal');
  store.set('claude:work:apiKey', 'work');
  assert.equal(store.get('claude:apiKey'), 'personal');
  assert.equal(store.get('claude:work:apiKey'), 'work');
});

const FULL = { borrow: true, oauth: true, apiKey: true, apiKeyUrl: null, borrowNote: '' };
const BORROW_ONLY = { borrow: true, oauth: false, apiKey: false, apiKeyUrl: null, borrowNote: '' };

test('auto prefers borrowing, which needs no setup and no stored secret', () => {
  assert.deepEqual(modeOrder('auto', FULL), ['borrowed', 'oauth', 'apiKey']);
});

test('an explicit mode is honoured exactly', () => {
  // Someone who chose "API key" must never be silently served a borrowed
  // reading from a different account.
  assert.deepEqual(modeOrder('apiKey', FULL), ['apiKey']);
  assert.deepEqual(modeOrder('oauth', FULL), ['oauth']);
  assert.deepEqual(modeOrder('borrow', FULL), ['borrowed']);
});

test('modes the provider cannot offer are dropped', () => {
  assert.deepEqual(modeOrder('auto', BORROW_ONLY), ['borrowed']);
  assert.deepEqual(modeOrder('apiKey', BORROW_ONLY), [], 'no impossible mode is attempted');
});
