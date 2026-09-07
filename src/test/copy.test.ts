import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetCopy, elapsedCopy, windowSummary, blockSummary, statusMessage } from '../shared/copy.js';
import { bandFor, headlineText, headline } from '../shared/bands.js';
import type { LimitWindow, ProviderSnapshot } from '../shared/types.js';

const NOW = Date.parse('2026-09-07T12:00:00Z');

function window(init: Partial<LimitWindow> & { id: string }): LimitWindow {
  return { label: 'W', usedFraction: null, remaining: null, used: null, resetsAt: null, ...init };
}

function snapshot(init: Partial<ProviderSnapshot>): ProviderSnapshot {
  return {
    id: 'claude',
    displayName: 'Claude',
    glyph: 'claude',
    fidelity: 'official',
    status: { kind: 'ok' },
    windows: [],
    headlineId: null,
    block: null,
    account: null,
    readAt: null,
    sourceNote: 'test',
    support: { borrow: true, oauth: false, apiKey: false, apiKeyUrl: null, borrowNote: 'test' },
    origin: 'borrowed',
    hasStoredSecret: false,
    ...init
  };
}

test('reset copy counts down while close and switches to a clock when far', () => {
  assert.equal(resetCopy(NOW + 40_000, NOW), 'Resets in under a minute');
  assert.equal(resetCopy(NOW + 51 * 60_000, NOW), 'Resets in 51 min');
  assert.equal(resetCopy(NOW + 2 * 3_600_000, NOW), 'Resets in 2h');
  assert.equal(resetCopy(NOW + 2.5 * 3_600_000, NOW), 'Resets in 2h 30m');
  // The rounded remainder can reach a full hour; "1h 60m" is not a time.
  assert.equal(resetCopy(NOW + 3_600_000 + 59.7 * 60_000, NOW), 'Resets in 2h');
  assert.equal(resetCopy(null, NOW), 'Reset time unknown');
  assert.equal(resetCopy(NOW - 1000, NOW), 'Resetting now');
  // Far enough away that a countdown would make the reader do arithmetic.
  assert.match(resetCopy(NOW + 9 * 3_600_000, NOW), /^Resets /);
});

test('elapsed copy reads as a human age', () => {
  assert.equal(elapsedCopy(NOW - 10_000, NOW), 'just now');
  assert.equal(elapsedCopy(NOW - 60_000, NOW), '1 min ago');
  assert.equal(elapsedCopy(NOW - 3_600_000, NOW), '1 hour ago');
  assert.equal(elapsedCopy(NOW - 86_400_000, NOW), 'yesterday');
});

test('a window summary shows both ends of the same figure', () => {
  assert.equal(windowSummary(window({ id: 'a', usedFraction: 0.73 })), '73% used - 27% left');
  // A provider that only says what is left must not be shown as a percentage:
  // the denominator would have to be invented.
  assert.equal(windowSummary(window({ id: 'a', remaining: 1 })), '1 left');
  assert.equal(windowSummary(window({ id: 'a', used: 12 })), '12 used');
  assert.equal(windowSummary(window({ id: 'a' })), 'No reading');
});

test('a block leads with the vendor clock time, not a countdown', () => {
  assert.match(blockSummary('Opus paused', NOW + 3_600_000, NOW), /^Opus paused until /);
  assert.equal(blockSummary('Opus paused', null, NOW), 'Opus paused');
  assert.equal(blockSummary('Opus paused', NOW - 1, NOW), 'Opus paused');
});

test('bands follow the thresholds the design frame drew', () => {
  assert.equal(bandFor(0.21), 'ample');
  assert.equal(bandFor(0.52), 'watch');
  assert.equal(bandFor(0.73), 'critical');
  assert.equal(bandFor(1.0), 'exhausted');
});

test('the headline is the declared window, never whichever came first', () => {
  const s = snapshot({
    headlineId: 'session',
    windows: [window({ id: 'weekly_all', usedFraction: 0.9 }), window({ id: 'session', usedFraction: 0.1 })]
  });
  assert.equal(headline(s)?.id, 'session');
  assert.equal(headlineText(s), '10%');
});

test('a missing declared window shows a dash rather than promoting another', () => {
  const s = snapshot({ headlineId: 'session', windows: [window({ id: 'weekly_all', usedFraction: 0.9 })] });
  assert.equal(headline(s), null);
  assert.equal(headlineText(s), '--');
});

test('status messages name the right door to knock on', () => {
  assert.match(statusMessage(snapshot({ status: { kind: 'needsAuth' } }), NOW)!, /Sign in to Claude Code/);
  assert.match(
    statusMessage(snapshot({ id: 'cursor', displayName: 'Cursor', status: { kind: 'needsAuth' } }), NOW)!,
    /Sign in to Cursor in the editor/
  );
  // A work profile is still Claude Code's door.
  assert.match(
    statusMessage(snapshot({ id: 'claude:work', displayName: 'Claude (work)', status: { kind: 'needsAuth' } }), NOW)!,
    /Sign in to Claude Code/
  );
  assert.match(statusMessage(snapshot({ status: { kind: 'disabled' } }), NOW)!, /switched off/);
  // Refused is not signed out: the advice must differ.
  assert.match(statusMessage(snapshot({ status: { kind: 'accessDenied' } }), NOW)!, /refused access/);
});

test('a provider with readings has no status message', () => {
  assert.equal(statusMessage(snapshot({ windows: [window({ id: 'a', usedFraction: 0.5 })] }), NOW), null);
});
