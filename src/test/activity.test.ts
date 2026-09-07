import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { summarise, expire, BUSY_EXPIRY_MS, WAITING_EXPIRY_MS } from '../main/activity/monitor.js';
import { writeEvent, readEvents, pruneEvents, isAlive } from '../main/activity/events.js';
import { mergeHooks, removeHooks, tokiHooks, applyHooks } from '../main/activity/claude-hooks.js';
import type { AgentSession } from '../shared/types.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'toki-activity-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function session(init: Partial<AgentSession> & { id: string }): AgentSession {
  return {
    providerId: 'claude',
    name: 'p',
    detail: 'd',
    state: 'busy',
    waitingFor: null,
    cwd: null,
    since: Date.now(),
    ...init
  };
}

test('no signal is unavailable, never idle', () => {
  // Reporting "nothing is running" when the truth is "nothing told us" is what
  // makes a dashboard untrustworthy.
  assert.equal(summarise('claude', null).state, 'unavailable');
  assert.equal(summarise('claude', []).state, 'idle');
});

test('waiting outranks busy: it is the only state that wants something', () => {
  const now = Date.now();
  const state = summarise(
    'claude',
    [session({ id: 'a', state: 'busy', since: now }), session({ id: 'b', state: 'waiting', since: now })],
    now
  ).state;
  assert.equal(state, 'waiting');
});

test('a stale busy session expires rather than working forever', () => {
  const now = Date.now();
  // A tool killed mid-turn never sends its "finished" event.
  const stale = [session({ id: 'a', state: 'busy', since: now - BUSY_EXPIRY_MS - 1 })];
  assert.deepEqual(expire(stale, now), []);
  assert.equal(summarise('claude', stale, now).state, 'idle');

  const waiting = [session({ id: 'b', state: 'waiting', since: now - WAITING_EXPIRY_MS - 1 })];
  assert.deepEqual(expire(waiting, now), []);
});

test('an event round-trips through its own per-session file', () => {
  writeEvent(dir, {
    sessionId: 'claude.abc',
    providerId: 'claude',
    name: 'toki',
    detail: 'Terminal',
    state: 'busy',
    waitingFor: null,
    at: Date.now(),
    pid: process.pid
  });
  const events = readEvents(dir);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.state, 'busy');
});

test('events from before a cutoff are refused', () => {
  // Re-enabling a provider must not rehydrate history from before consent.
  const old = Date.now() - 10_000;
  writeEvent(dir, {
    sessionId: 'old',
    providerId: 'claude',
    name: 'x',
    detail: '',
    state: 'busy',
    waitingFor: null,
    at: old,
    pid: null
  });
  assert.equal(readEvents(dir, old + 1).length, 0);
  assert.equal(readEvents(dir, old - 1).length, 1);
});

test('a session id cannot escape the activity directory', () => {
  writeEvent(dir, {
    sessionId: '../../evil',
    providerId: 'claude',
    name: 'x',
    detail: '',
    state: 'busy',
    waitingFor: null,
    at: Date.now(),
    pid: null
  });
  assert.equal(existsSync(join(dir, '..', '..', 'evil.json')), false);
  assert.equal(readEvents(dir).length, 1);
});

test('unreadable event files are skipped, not fatal', () => {
  mkdirSync(join(dir, 'activity'), { recursive: true });
  writeFileSync(join(dir, 'activity', 'half.json'), '{"sessionId":"a","st');
  assert.deepEqual(readEvents(dir), []);
});

test('old event files are pruned', () => {
  writeEvent(dir, {
    sessionId: 'a',
    providerId: 'claude',
    name: 'x',
    detail: '',
    state: 'busy',
    waitingFor: null,
    at: Date.now(),
    pid: null
  });
  // Backdate the file rather than passing a negative max age: the filesystem's
  // mtime clock and Date.now() are not the same source, and on Windows a
  // just-written file can carry a timestamp a shade ahead of the wall clock.
  const path = join(dir, 'activity', 'a.json');
  const old = new Date(Date.now() - 2 * 86_400_000);
  utimesSync(path, old, old);

  assert.equal(readEvents(dir).length, 1);
  pruneEvents(dir, 86_400_000);
  assert.deepEqual(readEvents(dir), []);
});

test('fresh event files survive pruning', () => {
  writeEvent(dir, {
    sessionId: 'b',
    providerId: 'claude',
    name: 'x',
    detail: '',
    state: 'busy',
    waitingFor: null,
    at: Date.now(),
    pid: null
  });
  pruneEvents(dir, 86_400_000);
  assert.equal(readEvents(dir).length, 1);
});

test('our own pid is alive, and a missing pid is not evidence of death', () => {
  assert.equal(isAlive(process.pid), true);
  assert.equal(isAlive(null), true);
  assert.equal(isAlive(0x7ffffff), false);
});

test('installing hooks keeps the user\u2019s existing ones', () => {
  const existing = { PreToolUse: [{ hooks: [{ type: 'command', command: 'their-own-thing' }] }] };
  const merged = mergeHooks(existing, tokiHooks('node toki-hook.mjs'));
  assert.equal(merged.PreToolUse!.length, 2);
  assert.equal(merged.PreToolUse![0]!.hooks[0]!.command, 'their-own-thing');
  assert.ok(merged.SessionStart);
});

test('installing twice does not duplicate our hooks', () => {
  const ours = tokiHooks('node toki-hook.mjs');
  const once = mergeHooks({}, ours);
  const twice = mergeHooks(once, ours);
  assert.equal(twice.PreToolUse!.length, 1);
});

test('removing hooks leaves the user\u2019s alone', () => {
  const merged = mergeHooks(
    { PreToolUse: [{ hooks: [{ type: 'command', command: 'their-own-thing' }] }] },
    tokiHooks('node toki-hook.mjs')
  );
  const stripped = removeHooks(merged);
  assert.equal(stripped.PreToolUse!.length, 1);
  assert.equal(stripped.PreToolUse![0]!.hooks[0]!.command, 'their-own-thing');
  assert.equal(stripped.SessionStart, undefined);
});

test('settings.json is rewritten in place, preserving unrelated keys', () => {
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ theme: 'dark', mcpServers: { a: 1 } }));
  assert.equal(applyHooks(dir, 'node toki-hook.mjs', true), true);

  const written = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'));
  assert.equal(written.theme, 'dark');
  assert.deepEqual(written.mcpServers, { a: 1 });
  assert.ok(written.hooks.SessionStart);

  applyHooks(dir, 'node toki-hook.mjs', false);
  const after = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'));
  assert.equal(after.theme, 'dark');
  assert.equal(after.hooks, undefined);
});

test('an unparseable settings.json is refused rather than overwritten', () => {
  // The file belongs to Claude Code; replacing one we could not read would
  // discard the user's configuration.
  writeFileSync(join(dir, 'settings.json'), '{ not json');
  assert.equal(applyHooks(dir, 'node toki-hook.mjs', true), false);
  assert.equal(readFileSync(join(dir, 'settings.json'), 'utf8'), '{ not json');
});
