import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPkce, authorizeUrl, exchangeCode } from '../main/providers/claude-oauth.js';
import { UsageError } from '../main/providers/provider.js';
import { createHash } from 'node:crypto';

test('PKCE uses S256 with a base64url verifier and a real hash', () => {
  const pkce = createPkce();
  // base64url: no +, /, or = padding, or the server rejects it.
  assert.match(pkce.verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.match(pkce.challenge, /^[A-Za-z0-9_-]{43}$/);
  const expected = createHash('sha256')
    .update(pkce.verifier)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  assert.equal(pkce.challenge, expected, 'the challenge must be the hash of the verifier');
  assert.notEqual(pkce.verifier, pkce.challenge, 'sending the verifier would defeat PKCE');
});

test('two sign-ins never share a verifier', () => {
  assert.notEqual(createPkce().verifier, createPkce().verifier);
});

test('the authorize URL carries everything the server needs', () => {
  const pkce = createPkce();
  const url = new URL(authorizeUrl(pkce));
  assert.equal(url.origin + url.pathname, 'https://claude.ai/oauth/authorize');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_challenge'), pkce.challenge);
  assert.equal(url.searchParams.get('response_type'), 'code');
  // The secret half must never appear in a URL the browser will log.
  assert.equal(url.searchParams.get('code_verifier'), null);
});

test('a code from a different sign-in is refused', async () => {
  const mine = createPkce();
  const theirs = createPkce();
  await assert.rejects(
    () => exchangeCode(`somecode#${theirs.verifier}`, mine),
    (error: unknown) =>
      error instanceof UsageError && /different sign-in/.test(error.message)
  );
});

test('an empty or malformed paste is rejected before any request', async () => {
  const pkce = createPkce();
  await assert.rejects(() => exchangeCode('   ', pkce), (e: unknown) => e instanceof UsageError);
  await assert.rejects(() => exchangeCode('#onlystate', pkce), (e: unknown) => e instanceof UsageError);
});

test('a code pasted with quotes or the whole callback URL still parses', async () => {
  // People paste what the browser gives them. Each of these is the user doing
  // the obvious thing, so the state check must still run rather than the paste
  // being rejected as malformed.
  const mine = createPkce();
  const theirs = createPkce();

  for (const pasted of [
    `  "somecode#${theirs.verifier}"  `,
    `https://console.anthropic.com/oauth/code/callback?code=somecode&state=${theirs.verifier}`
  ]) {
    await assert.rejects(
      () => exchangeCode(pasted, mine),
      (error: unknown) => error instanceof UsageError && /different sign-in/.test(error.message),
      `should have parsed and rejected on state: ${pasted.slice(0, 40)}`
    );
  }
});
