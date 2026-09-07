#!/usr/bin/env node
/**
 * TOKI's Claude Code activity hook.
 *
 * Claude Code runs this in its own short-lived process on session start, tool
 * use, notification and stop, feeding it the hook payload on stdin. It writes
 * one small file per session into TOKI's state directory and exits.
 *
 * Three rules, and every one of them exists because breaking it breaks the
 * *user's* tool rather than ours:
 *
 *   1. It never exits non-zero and never writes to stderr. A hook that fails is
 *      a hook that interrupts Claude Code's turn.
 *   2. It never blocks. stdin is read with a short deadline, because Claude
 *      Code waits for this process before continuing.
 *   3. It writes to its own per-session file, atomically. Several hooks fire at
 *      once; a shared append-only log would interleave into an unreadable mess.
 */
import { writeFileSync, renameSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

const EVENT = process.argv[2] ?? 'busy';

/** Where Electron's app.getPath('userData') lands for TOKI on Windows. */
function stateDir() {
  if (process.env.TOKI_STATE_DIR) return process.env.TOKI_STATE_DIR;
  const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
  return join(appData, 'TOKI');
}

function writeAtomic(path, contents) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, contents, 'utf8');
  try {
    renameSync(tmp, path);
  } catch {
    try { unlinkSync(tmp); } catch { /* nothing to clean up */ }
  }
}

async function readStdin(timeoutMs = 400) {
  if (process.stdin.isTTY) return '';
  return new Promise((resolve) => {
    let data = '';
    const done = (value) => { clearTimeout(timer); resolve(value); };
    const timer = setTimeout(() => done(data), timeoutMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => done(data));
    process.stdin.on('error', () => done(''));
  });
}

/** Claude Code's hook events, mapped to the three states the notch shows. */
function stateFor(event) {
  switch (event) {
    case 'waiting': return 'waiting';
    case 'idle':
    case 'session-end': return 'idle';
    default: return 'busy';
  }
}

function folderName(cwd) {
  if (!cwd) return 'Claude';
  return basename(String(cwd).replace(/[\\/]+$/, '')) || 'Claude';
}

/** Which profile this session belongs to, so a work login gets its own ring. */
function providerId(payload) {
  const dir = process.env.CLAUDE_CONFIG_DIR;
  if (!dir) return 'claude';
  const name = basename(dir.replace(/[\\/]+$/, ''));
  if (name === '.claude') return 'claude';
  if (name.startsWith('.claude-')) return `claude:${name.slice('.claude-'.length)}`;
  return 'claude:env';
}

try {
  const raw = await readStdin();
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = {}; }

  const sessionId = String(payload.session_id ?? payload.sessionId ?? process.ppid ?? 'unknown');
  const cwd = payload.cwd ?? process.cwd();
  const state = stateFor(EVENT);

  const dir = join(stateDir(), 'activity');
  mkdirSync(dir, { recursive: true });
  const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
  const file = join(dir, `${safe}.json`);

  if (EVENT === 'session-end') {
    // Gone, not idle: leaving the file behind would keep a finished session in
    // the tooltip until it expired.
    try { unlinkSync(file); } catch { /* already gone */ }
  } else {
    writeAtomic(file, JSON.stringify({
      sessionId: `claude.${sessionId}`,
      providerId: providerId(payload),
      name: folderName(cwd),
      detail: `Claude Code - ${cwd}`,
      state,
      // Claude Code's Notification hook carries the prompt text it is blocked
      // on; that exact wording is what makes the alert actionable rather than
      // just telling you something, somewhere, wants attention.
      waitingFor: state === 'waiting'
        ? String(payload.message ?? payload.notification ?? 'Needs your input').slice(0, 200)
        : null,
      cwd: String(cwd),
      at: Date.now(),
      pid: process.ppid ?? null
    }));
  }
} catch {
  /* never fail the user's turn over our own bookkeeping */
}

process.exit(0);
