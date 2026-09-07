import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cursorWindows } from '../main/providers/cursor-usage.js';
import { UsageError } from '../main/providers/provider.js';

test('the allowance percentage is the headline, not the used/limit pair', () => {
  // A free plan reports used:0 limit:0 while real usage is happening, because
  // the allowance arrives as a bonus rather than as a dollar limit. Reading
  // used/limit reports 0% for an account 10% through its month.
  const windows = cursorWindows({
    billingCycleEnd: '2026-09-24T03:32:15.933Z',
    membershipType: 'free',
    individualUsage: { plan: { used: 0, limit: 0, totalPercentUsed: 9.5, apiPercentUsed: 19 } }
  });
  assert.equal(windows[0]!.id, 'included');
  assert.equal(windows[0]!.usedFraction, 0.095);
  assert.equal(windows[0]!.resetsAt, Date.parse('2026-09-24T03:32:15.933Z'));
  assert.equal(windows[1]!.id, 'api');
});

test('zero is a reading, not an absence', () => {
  // Cursor itself says "you've used 0% of your included total usage".
  const windows = cursorWindows({ individualUsage: { plan: { totalPercentUsed: 0 } } });
  assert.equal(windows.length, 1);
  assert.equal(windows[0]!.usedFraction, 0);
});

test('an unlimited plan is not an error', () => {
  assert.throws(
    () => cursorWindows({ isUnlimited: true, membershipType: 'enterprise', individualUsage: {} }),
    (error: unknown) => error instanceof UsageError && error.kind === 'nothingMetered'
  );
});

test('an on-demand bucket is only shown when it states a real ceiling', () => {
  const withCeiling = cursorWindows({
    individualUsage: { plan: { totalPercentUsed: 5 }, onDemand: { enabled: true, used: 4, limit: 20 } }
  });
  assert.equal(withCeiling[1]!.id, 'on_demand');
  assert.equal(withCeiling[1]!.usedFraction, 0.2);

  const withoutCeiling = cursorWindows({
    individualUsage: { plan: { totalPercentUsed: 5 }, onDemand: { enabled: true, used: 4, limit: null } }
  });
  assert.equal(withoutCeiling.length, 1);
});
