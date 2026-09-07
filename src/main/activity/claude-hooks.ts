import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeAtomic } from '../atomic.js';
import { log } from '../log.js';

/**
 * Installs TOKI's activity hooks into a Claude Code profile's `settings.json`.
 *
 * Claude Code's settings file is owned by Claude Code and edited by the user,
 * so this is surgical: existing hooks are preserved, TOKI's entries are keyed
 * by a marker so they can be found and removed again, and the whole file is
 * replaced atomically -- a half-written settings.json would stop Claude Code
 * from starting at all.
 */
const MARKER = 'toki-hook';

type HookEntry = { type: string; command: string };
type Matcher = { matcher?: string; hooks: HookEntry[] };
type HooksBlock = Record<string, Matcher[]>;

/** Which Claude Code events TOKI listens to, and what each one means. */
export function tokiHooks(hookCommand: string): HooksBlock {
  const run = (event: string): Matcher[] => [
    { hooks: [{ type: 'command', command: `${hookCommand} ${event}` }] }
  ];
  return {
    SessionStart: run('session-start'),
    UserPromptSubmit: run('busy'),
    PreToolUse: run('busy'),
    Notification: run('waiting'),
    Stop: run('idle'),
    SessionEnd: run('session-end')
  };
}

function isToki(matcher: Matcher): boolean {
  return matcher.hooks.some((hook) => hook.command.includes(MARKER));
}

export function mergeHooks(existing: HooksBlock, ours: HooksBlock): HooksBlock {
  const merged: HooksBlock = {};
  for (const [event, matchers] of Object.entries(existing)) {
    const kept = matchers.filter((m) => !isToki(m));
    if (kept.length > 0) merged[event] = kept;
  }
  for (const [event, matchers] of Object.entries(ours)) {
    merged[event] = [...(merged[event] ?? []), ...matchers];
  }
  return merged;
}

export function removeHooks(existing: HooksBlock): HooksBlock {
  const stripped: HooksBlock = {};
  for (const [event, matchers] of Object.entries(existing)) {
    const kept = matchers.filter((m) => !isToki(m));
    if (kept.length > 0) stripped[event] = kept;
  }
  return stripped;
}

/**
 * Rewrites one profile's settings.json.
 *
 * Serialised by the caller across profiles, and atomic per file: two TOKI
 * windows installing hooks at once must not interleave into a broken file.
 */
export function applyHooks(profileDir: string, hookCommand: string, install: boolean): boolean {
  const path = join(profileDir, 'settings.json');
  let settings: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      settings = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    } catch (error) {
      // Refuse rather than overwrite: this file belongs to Claude Code, and
      // replacing one we could not parse would discard the user's config.
      log.error('hooks', `refusing to rewrite unreadable settings.json: ${String(error)}`);
      return false;
    }
  }
  const existing = (settings.hooks as HooksBlock | undefined) ?? {};
  const next = install ? mergeHooks(existing, tokiHooks(hookCommand)) : removeHooks(existing);
  if (Object.keys(next).length === 0) delete settings.hooks;
  else settings.hooks = next;

  try {
    writeAtomic(path, JSON.stringify(settings, null, 2) + '\n');
    return true;
  } catch (error) {
    log.error('hooks', `could not write settings.json: ${String(error)}`);
    return false;
  }
}
