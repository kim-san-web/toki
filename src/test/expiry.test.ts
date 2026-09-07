import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codexWindows, readRollout } from '../main/providers/codex-usage.js';
import { codexLiveWindows, codexLiveBlock, liveWindowLabel } from '../main/providers/codex-live.js';
import { glmWindows } from '../main/providers/glm.js';
import { SecretStore, type Crypto } from '../main/secrets.js';

const NOW = Date.parse('2026-09-07T02:00:00Z');
const HOUR = 3_600_000;

test('a rollout window whose reset has passed reports no figure', () => {
  // The exact failure seen in the wild: a rollout said 99% used with a reset
  // 30 hours in the past. The quota had long since refilled, and the file
  // itself carried the proof. A stale number is bad; a known-wrong one is worse.
  const windows = codexWindows(
    {
      primary: { used_percent: 99, window_minutes: 300, resets_at: (NOW - 30 * HOUR) / 1000 },
      secondary: { used_percent: 16, window_minutes: 10080, resets_at: (NOW + 5 * 24 * HOUR) / 1000 }
    },
    NOW
  );
  const [primary, secondary] = windows;
  assert.equal(primary!.usedFraction, null, 'the expired figure must be withheld');
  assert.equal(primary!.resetsAt, null, 'a past reset must not read as a countdown');
  assert.equal(primary!.label, '5h limit', 'the window is still named');
  // The window that has NOT rolled over is untouched.
  assert.equal(secondary!.usedFraction, 0.16);
});

test('a rollout window still counting down keeps its figure', () => {
  const windows = codexWindows(
    { primary: { used_percent: 99, window_minutes: 300, resets_at: (NOW + HOUR) / 1000 } },
    NOW
  );
  assert.equal(windows[0]!.usedFraction, 0.99);
  assert.equal(windows[0]!.resetsAt, NOW + HOUR);
});

test('the live endpoint shape is parsed, in seconds not minutes', () => {
  // Recorded from a live account. Note limit_window_seconds, where the rollout
  // reports minutes -- the two shapes must not share a parser.
  const windows = codexLiveWindows(
    {
      plan_type: 'plus',
      rate_limit: {
        allowed: true,
        limit_reached: false,
        primary_window: { used_percent: 0, limit_window_seconds: 18000, reset_at: (NOW + 5 * HOUR) / 1000 },
        secondary_window: { used_percent: 32, limit_window_seconds: 604800, reset_at: (NOW + 5 * 24 * HOUR) / 1000 }
      }
    },
    NOW
  );
  assert.equal(windows.length, 2);
  assert.equal(windows[0]!.usedFraction, 0, 'a refilled window really is 0%');
  assert.equal(windows[0]!.label, '5h limit');
  assert.equal(windows[1]!.usedFraction, 0.32);
  assert.equal(windows[1]!.label, 'Weekly limit');
});

test('a live reading keeps its figure even if the reset moment just passed', () => {
  // Unlike a file, this was taken now -- a reset a second ago is clock skew,
  // not staleness, so only the countdown is dropped.
  const windows = codexLiveWindows(
    {
      rate_limit: {
        primary_window: { used_percent: 44, limit_window_seconds: 18000, reset_at: (NOW - 1000) / 1000 }
      }
    },
    NOW
  );
  assert.equal(windows[0]!.usedFraction, 0.44);
  assert.equal(windows[0]!.resetsAt, null);
});

test('live window labels convert seconds correctly', () => {
  assert.equal(liveWindowLabel(18000, 'primary'), '5h limit');
  assert.equal(liveWindowLabel(604800, 'secondary'), 'Weekly limit');
  assert.equal(liveWindowLabel(undefined, 'primary'), 'Current session');
});

test('a reached live limit is reported as a block', () => {
  const block = codexLiveBlock(
    {
      rate_limit: {
        limit_reached: true,
        primary_window: { used_percent: 100, limit_window_seconds: 18000, reset_at: (NOW + HOUR) / 1000 }
      },
      rate_limit_reached_type: 'primary'
    },
    NOW
  );
  assert.ok(block);
  assert.match(block.reason, /5h limit reached/);
  assert.equal(codexLiveBlock({ rate_limit: { limit_reached: false } }, NOW), null);
});

test('a GLM window past its refresh time withholds its figure too', () => {
  const expired = glmWindows(
    { data: { usage: [{ used: 90, limit: 100, type: 'prompt', refreshTime: (NOW - HOUR) / 1000 }] } },
    NOW
  );
  assert.equal(expired[0]!.usedFraction, null);
  const live = glmWindows(
    { data: { usage: [{ used: 90, limit: 100, type: 'prompt', refreshTime: (NOW + HOUR) / 1000 }] } },
    NOW
  );
  assert.equal(live[0]!.usedFraction, 0.9);
});

test('an empty rollout snapshot is still nothing', () => {
  assert.equal(readRollout(''), null);
});

/* ---- the encryption-timing bug ------------------------------------------ */

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'toki-late-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** DPAPI as Electron really behaves: unavailable until the app is ready. */
function lateCrypto(): Crypto & { ready: () => void } {
  let ready = false;
  return {
    ready: () => {
      ready = true;
    },
    isEncryptionAvailable: () => ready,
    encryptString: (plain) => Buffer.from(`enc:${plain}`, 'utf8'),
    decryptString: (buf) => buf.toString('utf8').replace(/^enc:/, '')
  };
}

test('a store built before the OS is ready still saves once it is', () => {
  // The shipped bug: `isEncryptionAvailable()` is false until app.whenReady(),
  // so probing it in the constructor latched "unavailable" forever and every
  // save was refused with "Windows would not encrypt" on a machine where
  // encryption works perfectly.
  const crypto = lateCrypto();
  const store = new SecretStore(dir, crypto);

  assert.equal(store.canStore, false, 'not ready yet');
  assert.equal(store.set('claude:apiKey', 'sk-early'), false);

  crypto.ready();

  assert.equal(store.canStore, true, 'the answer must be re-asked, not cached from boot');
  assert.equal(store.set('claude:apiKey', 'sk-ant-1234'), true);
  assert.equal(existsSync(join(dir, 'secrets.bin')), true);
  assert.equal(store.get('claude:apiKey'), 'sk-ant-1234');
});

test('a secret saved earlier is found even if the first read came too early', () => {
  const first = lateCrypto();
  first.ready();
  new SecretStore(dir, first).set('claude:oauth', '{"accessToken":"x"}');

  // A fresh store, read before the OS is ready, then again after.
  const crypto = lateCrypto();
  const store = new SecretStore(dir, crypto);
  assert.equal(store.get('claude:oauth'), null, 'nothing is readable while locked');
  crypto.ready();
  assert.equal(store.get('claude:oauth'), '{"accessToken":"x"}', 'the file loads once it can');
  assert.equal(store.has('claude:oauth'), true);
});
