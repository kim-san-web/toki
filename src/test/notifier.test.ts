import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerRoute } from '../shared/routes.js';

test('every provider offers somewhere to go and answer', () => {
  for (const id of ['claude', 'codex', 'cursor', 'glm']) {
    const route = answerRoute(id);
    assert.ok(route.web || route.app, `${id} must offer a route`);
    if (route.web) assert.match(route.web, /^https:\/\//, `${id}: only https`);
  }
});

test('a Claude profile routes like Claude', () => {
  // A work profile is still answered in Claude Code.
  assert.deepEqual(answerRoute('claude:work'), answerRoute('claude'));
});

test('an unknown provider offers nothing rather than a wrong link', () => {
  const route = answerRoute('mystery');
  assert.equal(route.web, null);
  assert.equal(route.app, null);
});

test('only providers with a real protocol claim one', () => {
  // Claude Code and Codex run in a terminal: there is no URL that focuses them,
  // and inventing one would produce a button that silently does nothing.
  assert.equal(answerRoute('claude').app?.protocol, null);
  assert.equal(answerRoute('codex').app?.protocol, null);
  assert.equal(answerRoute('cursor').app?.protocol, 'cursor://');
});
