import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRollout, codexWindows, codexWindowLabel, codexBlock } from '../main/providers/codex-usage.js';
import { latestLifecycle } from '../main/activity/codex-monitor.js';

/** Recorded verbatim from a live rollout on a Windows machine. */
const LINE = JSON.stringify({
  timestamp: '2026-09-05T12:48:10.164Z',
  type: 'event_msg',
  payload: {
    type: 'token_count',
    rate_limits: {
      limit_id: 'codex',
      primary: { used_percent: 99.0, window_minutes: 300, resets_at: 1788624760 },
      secondary: { used_percent: 16.0, window_minutes: 10080, resets_at: 1789211560 },
      plan_type: 'plus'
    }
  }
});

test('the newest snapshot in a rollout wins', () => {
  const older = LINE.replace('"used_percent":99', '"used_percent":10');
  const reading = readRollout(`${older}\n${LINE}\n`);
  assert.ok(reading);
  assert.equal(reading.limits.primary?.used_percent, 99);
  assert.equal(reading.recordedAt, Date.parse('2026-09-05T12:48:10.164Z'));
});

test('a truncated first line does not throw away the file', () => {
  // A tail window almost always begins mid-object.
  const reading = readRollout(`{"type":"event_msg","payl\n${LINE}\n`);
  assert.ok(reading);
  assert.equal(reading.limits.primary?.used_percent, 99);
});

test('rate_limits at the top level is read as well as under payload', () => {
  const flat = JSON.stringify({ timestamp: '2026-09-05T12:00:00Z', rate_limits: { primary: { used_percent: 5 } } });
  assert.equal(readRollout(flat)?.limits.primary?.used_percent, 5);
});

test('a rollout with no snapshot reads as nothing rather than as zero', () => {
  assert.equal(readRollout('{"type":"event_msg","payload":{"type":"task_started"}}'), null);
  assert.equal(readRollout(''), null);
});

test('resets_at is an absolute epoch in seconds', () => {
  const reading = readRollout(LINE)!;
  // Pinned to a moment *before* the recorded reset: these fixtures carry fixed
  // epochs, and with real time they eventually roll over and are correctly
  // withheld -- which would make this test fail for the right reason.
  const now = 1788624760 * 1000 - 60_000;
  const windows = codexWindows(reading.limits, now);
  assert.equal(windows[0]!.resetsAt, 1788624760 * 1000);
  assert.equal(windows[0]!.usedFraction, 0.99);
});

test('the countdown form is honoured too, so no build silently loses its reset', () => {
  const now = 1_700_000_000_000;
  const windows = codexWindows({ primary: { used_percent: 5, resets_in_seconds: 600 } }, now);
  assert.equal(windows[0]!.resetsAt, now + 600_000);
});

test('windows are labelled by their length, since Codex only names them by index', () => {
  assert.equal(codexWindowLabel(300, 'primary'), '5h limit');
  assert.equal(codexWindowLabel(10080, 'secondary'), 'Weekly limit');
  assert.equal(codexWindowLabel(43200, 'primary'), 'Monthly limit');
  assert.equal(codexWindowLabel(30, 'primary'), '30m limit');
  assert.equal(codexWindowLabel(undefined, 'primary'), 'Current session');
});

test('a reached limit is reported separately from the headline', () => {
  const now = 1788624760 * 1000 - 60_000; // before the fixture's reset
  const block = codexBlock(
    {
      primary: { used_percent: 100, window_minutes: 300, resets_at: 1788624760 },
      rate_limit_reached_type: 'primary'
    },
    now
  );
  assert.ok(block);
  assert.equal(block.resetsAt, 1788624760 * 1000);
  assert.equal(codexBlock({ primary: { used_percent: 10 } }, now), null);
});

test('lifecycle reads the newest event, and approval outranks a running task', () => {
  const started = JSON.stringify({ timestamp: '2026-09-05T12:00:00Z', payload: { type: 'task_started' } });
  const approval = JSON.stringify({ timestamp: '2026-09-05T12:01:00Z', payload: { type: 'exec_approval_request' } });
  const done = JSON.stringify({ timestamp: '2026-09-05T12:02:00Z', payload: { type: 'task_complete' } });

  assert.equal(latestLifecycle(started)?.state, 'busy');
  // A turn stopped to ask permission is still "started" as far as task events
  // go; showing it as busy hides the one state that needs the user.
  assert.equal(latestLifecycle(`${started}\n${approval}`)?.state, 'waiting');
  assert.equal(latestLifecycle(`${started}\n${approval}\n${done}`)?.state, 'idle');
  assert.equal(latestLifecycle('nothing here'), null);
});
