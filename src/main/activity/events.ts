import { existsSync, mkdirSync, readFileSync, openSync, closeSync, writeSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { writeAtomic } from '../atomic.js';

/**
 * The event file the Claude Code hook CLI appends to, and TOKI reads.
 *
 * A hook fires in its own short-lived process, several can fire at once, and
 * none of them can hold a lock for the app -- so this is designed around the
 * only thing that is safe under concurrency on Windows: one small file per
 * session, replaced atomically, rather than one shared file appended to by
 * everybody. A half-written shared log is unreadable; a half-written
 * per-session file only loses that session's latest event.
 */
export interface AgentEvent {
  sessionId: string;
  providerId: string;
  name: string;
  detail: string;
  state: 'busy' | 'waiting' | 'idle';
  waitingFor: string | null;
  /** Where the session is running, for opening the right folder or app. */
  cwd?: string | null;
  /** Epoch ms. */
  at: number;
  /** The process that owns the session, so a crashed one can be noticed. */
  pid: number | null;
}

export function eventsDir(stateDir: string): string {
  return join(stateDir, 'activity');
}

/** Called by the hook CLI. Never throws into the hook: a failed write must not fail the tool. */
export function writeEvent(stateDir: string, event: AgentEvent): void {
  try {
    const dir = eventsDir(stateDir);
    mkdirSync(dir, { recursive: true });
    const safe = event.sessionId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
    writeAtomic(join(dir, `${safe}.json`), JSON.stringify(event));
  } catch {
    /* the hook's job is the tool's turn, not our bookkeeping */
  }
}

/** Every event file, ignoring any written before `cutoff`. */
export function readEvents(stateDir: string, cutoff = 0): AgentEvent[] {
  const dir = eventsDir(stateDir);
  if (!existsSync(dir)) return [];
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const events: AgentEvent[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const path = join(dir, name);
    try {
      const event = JSON.parse(readFileSync(path, 'utf8')) as AgentEvent;
      if (typeof event.at !== 'number' || event.at < cutoff) continue;
      if (typeof event.sessionId !== 'string' || typeof event.state !== 'string') continue;
      events.push(event);
    } catch {
      /* a file being replaced right now: it will be read on the next pass */
    }
  }
  return events;
}

/** Drop event files older than a day, so the directory cannot grow forever. */
export function pruneEvents(stateDir: string, maxAgeMs = 86_400_000): void {
  const dir = eventsDir(stateDir);
  if (!existsSync(dir)) return;
  const now = Date.now();
  try {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      try {
        if (now - statSync(path).mtimeMs > maxAgeMs) unlinkSync(path);
      } catch {
        /* already gone */
      }
    }
  } catch {
    /* pruning is housekeeping, never load-bearing */
  }
}

/** Whether a pid is still running. Signal 0 tests without touching the process. */
export function isAlive(pid: number | null): boolean {
  if (pid === null) return true; // no pid to check is not evidence of death
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export { openSync, closeSync, writeSync };
