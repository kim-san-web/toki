import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudeWindows, claudeBackoffSeconds, claudeWindowLabel } from '../main/providers/claude-usage.js';

test('the forward-compatible limits array is read', () => {
  const windows = claudeWindows({
    limits: [
      { kind: 'session', percent: 73, resets_at: '2026-09-07T13:00:00Z' },
      { kind: 'weekly_all', percent: 7, resets_at: '2026-09-10T00:00:00Z' }
    ]
  });
  assert.equal(windows.length, 2);
  assert.equal(windows[0]!.id, 'session');
  assert.equal(windows[0]!.label, 'Current session');
  assert.equal(windows[0]!.usedFraction, 0.73);
  assert.equal(windows[0]!.resetsAt, Date.parse('2026-09-07T13:00:00Z'));
});

test('a named window is merged in, not merely a fallback', () => {
  // `limits` drops an entry once its reset has passed, so the session would
  // vanish exactly when it rolls over -- when someone is most likely looking.
  const windows = claudeWindows({
    limits: [{ kind: 'weekly_all', percent: 7, resets_at: '2026-09-10T00:00:00Z' }],
    five_hour: { utilization: 12, resets_at: '2026-09-07T13:00:00Z' }
  });
  assert.deepEqual(windows.map((w) => w.id), ['session', 'weekly_all']);
  assert.equal(windows[0]!.usedFraction, 0.12);
});

test('the array wins over the named window for the same id', () => {
  const windows = claudeWindows({
    limits: [{ kind: 'session', percent: 73, resets_at: '2026-09-07T13:00:00Z' }],
    five_hour: { utilization: 12, resets_at: '2026-09-07T13:00:00Z' }
  });
  assert.equal(windows.length, 1);
  assert.equal(windows[0]!.usedFraction, 0.73);
});

test('session is always ordered first', () => {
  const windows = claudeWindows({
    limits: [
      { kind: 'weekly_opus', percent: 3, resets_at: '2026-09-10T00:00:00Z' },
      { kind: 'weekly_all', percent: 7, resets_at: '2026-09-10T00:00:00Z' },
      { kind: 'session', percent: 73, resets_at: '2026-09-07T13:00:00Z' }
    ]
  });
  assert.deepEqual(windows.map((w) => w.id), ['session', 'weekly_all', 'weekly_opus']);
});

test('an unreadable payload yields no windows rather than a zero', () => {
  assert.deepEqual(claudeWindows({}), []);
  assert.deepEqual(claudeWindows({ limits: [{ kind: 'session' }] }), []);
});

test('an unknown kind still gets a readable label', () => {
  assert.equal(claudeWindowLabel('weekly_haiku'), 'Haiku');
  assert.equal(claudeWindowLabel('session'), 'Current session');
});

test('the 429 back-off treats Retry-After: 0 as a floor raiser only', () => {
  // Obeying `Retry-After: 0` literally means retrying at once, which is what
  // keeps you rate limited.
  assert.equal(claudeBackoffSeconds(1, 0), 120);
  assert.equal(claudeBackoffSeconds(2, 0), 240);
  // A larger server hint wins.
  assert.equal(claudeBackoffSeconds(1, 600), 600);
  // And it always recovers on its own.
  assert.equal(claudeBackoffSeconds(99, 0), 900);
});
