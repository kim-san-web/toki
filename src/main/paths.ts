import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';

/**
 * Where each tool keeps its state on Windows.
 *
 * macOS keeps app data under ~/Library and secrets in the keychain; Windows has
 * neither, so every path here is either %APPDATA%, %LOCALAPPDATA% or a dotfile
 * in the user profile -- which is also why several of these credentials are
 * plain files rather than protected items. TOKI only ever reads them.
 */

export const HOME = homedir();

export function appData(): string {
  return process.env.APPDATA ?? join(HOME, 'AppData', 'Roaming');
}

export function localAppData(): string {
  return process.env.LOCALAPPDATA ?? join(HOME, 'AppData', 'Local');
}

/**
 * Claude Code's config directory. `CLAUDE_CONFIG_DIR` wins when set, which is
 * how a separate work login is kept apart.
 */
export function claudeHome(): string {
  return process.env.CLAUDE_CONFIG_DIR ?? join(HOME, '.claude');
}

/**
 * Every Claude Code profile on this PC: the default `~/.claude` first, then any
 * `~/.claude-<slug>` directory that has actually been signed in to, in
 * alphabetical order -- so the rings never swap places between launches.
 */
export function claudeProfiles(): { id: string; displayName: string; dir: string }[] {
  const out: { id: string; displayName: string; dir: string }[] = [];
  const base = join(HOME, '.claude');
  if (existsSync(base)) out.push({ id: 'claude', displayName: 'Claude', dir: base });

  let entries: string[] = [];
  try {
    entries = readdirSync(HOME);
  } catch {
    entries = [];
  }
  const extra = entries
    .filter((name) => name.startsWith('.claude-'))
    .filter((name) => existsSync(join(HOME, name, '.credentials.json')))
    .sort();
  for (const name of extra) {
    const slug = name.slice('.claude-'.length);
    out.push({ id: `claude:${slug}`, displayName: `Claude (${slug})`, dir: join(HOME, name) });
  }

  // An explicit CLAUDE_CONFIG_DIR that is neither of the above still counts.
  const configured = process.env.CLAUDE_CONFIG_DIR;
  if (configured && !out.some((p) => p.dir === configured)) {
    out.push({ id: 'claude:env', displayName: 'Claude (configured)', dir: configured });
  }
  return out;
}

export function codexHome(): string {
  return process.env.CODEX_HOME ?? join(HOME, '.codex');
}

/** Cursor inherits VS Code's global-state store, under %APPDATA%. */
export function cursorStateDb(): string {
  return join(appData(), 'Cursor', 'User', 'globalStorage', 'state.vscdb');
}

export function cursorGlobalStorage(): string {
  return join(appData(), 'Cursor', 'User', 'globalStorage');
}

export function cursorWorkspaceStorage(): string {
  return join(appData(), 'Cursor', 'User', 'workspaceStorage');
}

/** Where a GLM coding-plan key may already be held by a tool on this PC. */
export function glmKeySources(): { path: string; kind: 'claude-settings' | 'json-env' | 'opencode' }[] {
  return [
    { path: join(claudeHome(), 'settings.json'), kind: 'claude-settings' },
    { path: join(HOME, '.claude', 'settings.json'), kind: 'claude-settings' },
    { path: join(HOME, '.zcode', 'config.json'), kind: 'json-env' },
    { path: join(appData(), 'zcode', 'config.json'), kind: 'json-env' },
    { path: join(HOME, '.config', 'opencode', 'opencode.json'), kind: 'opencode' },
    { path: join(appData(), 'opencode', 'opencode.json'), kind: 'opencode' }
  ];
}
