import { existsSync, openSync, readSync, closeSync, fstatSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentSession } from '../../shared/types.js';
import { withDb, queryAll } from '../providers/sqlite.js';
import { codexHome } from '../paths.js';
import type { ActivityMonitor } from './monitor.js';
import { folderName } from './claude-monitor.js';
import { log } from '../log.js';

/**
 * Codex's activity, from the lifecycle events in its own rollout.
 *
 * Codex records `task_started`, `task_complete` and its approval requests as it
 * runs, so the state can be read rather than inferred: the newest of those
 * events *is* the answer. A rollout whose file has not changed recently is
 * reported as nothing running, because Codex writes on every turn -- but a
 * rollout that was never found at all reports `null`, which the summary turns
 * into "no signal" rather than "idle".
 */
export class CodexActivityMonitor implements ActivityMonitor {
  readonly providerId = 'codex';
  private timer: NodeJS.Timeout | null = null;
  private sessions: AgentSession[] | null = null;
  /** Cached so an unchanged rollout costs one stat, not a 64 KB read. */
  private lastSeen = new Map<string, number>();

  private static readonly TAIL_BYTES = 64 * 1024;
  /** How long after the last write a rollout still counts as a live session. */
  private static readonly LIVE_WINDOW_MS = 5 * 60_000;

  constructor(
    private readonly home: string = codexHome(),
    private readonly cutoff: () => number = () => 0,
    private readonly onChange: () => void = () => {}
  ) {}

  start(): void {
    this.rescan();
    this.timer = setInterval(() => this.rescan(), 4_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  read(): AgentSession[] | null {
    return this.sessions;
  }

  private recentThreads(): { id: string; path: string; title: string; cwd: string }[] {
    return (
      withDb(join(this.home, 'state_5.sqlite'), (db) =>
        queryAll<{ id: string; rollout_path: string; title: string; cwd: string; updated_at_ms: number }>(
          db,
          `SELECT id, rollout_path, title, cwd, updated_at_ms FROM threads
           WHERE archived = 0 ORDER BY updated_at_ms DESC LIMIT 6`
        )
          .filter((row) => typeof row.rollout_path === 'string' && existsSync(row.rollout_path))
          .map((row) => ({
            id: row.id,
            path: row.rollout_path,
            title: row.title ?? 'Codex',
            cwd: row.cwd ?? ''
          }))
      ) ?? []
    );
  }

  private rescan(): void {
    const threads = this.recentThreads();
    if (threads.length === 0) {
      // No index and no rollouts: no signal, which is not the same as idle.
      if (this.sessions !== null) {
        this.sessions = null;
        this.onChange();
      }
      return;
    }

    const now = Date.now();
    const cutoff = this.cutoff();
    const found: AgentSession[] = [];

    for (const thread of threads) {
      let mtime: number;
      try {
        mtime = statSync(thread.path).mtimeMs;
      } catch {
        continue;
      }
      if (now - mtime > CodexActivityMonitor.LIVE_WINDOW_MS) continue;
      if (mtime < cutoff) continue;

      const state = this.tailState(thread.path);
      if (!state) continue;
      const folder = thread.cwd ? folderName(thread.cwd.replace(/^\\\\\?\\/, '')) : 'Codex';
      found.push({
        id: `codex.${thread.id}`,
        providerId: 'codex',
        name: thread.title || folder,
        detail: folder,
        state: state.state,
        waitingFor: state.waitingFor,
        cwd: thread.cwd ? thread.cwd.replace(/^\\\\\?\\/, '') : null,
        since: state.at
      });
      this.lastSeen.set(thread.path, mtime);
    }

    const sorted = found.sort((a, b) => b.since - a.since);
    if (this.sessions !== null && sameLength(sorted, this.sessions)) return;
    this.sessions = sorted;
    this.onChange();
  }

  /** The newest lifecycle event in a rollout's tail. */
  private tailState(path: string): { state: 'busy' | 'waiting' | 'idle'; waitingFor: string | null; at: number } | null {
    let fd: number | null = null;
    try {
      fd = openSync(path, 'r');
      const size = fstatSync(fd).size;
      const length = Math.min(size, CodexActivityMonitor.TAIL_BYTES);
      const buffer = Buffer.alloc(length);
      readSync(fd, buffer, 0, length, size - length);
      return latestLifecycle(buffer.toString('utf8'));
    } catch (error) {
      log.debug('codex-activity', `could not read rollout: ${String(error)}`);
      return null;
    } finally {
      if (fd !== null) closeSync(fd);
    }
  }
}

function sameLength(a: AgentSession[], b: AgentSession[]): boolean {
  return (
    a.length === b.length &&
    a.every((s, i) => b[i]?.id === s.id && b[i]?.state === s.state && b[i]?.since === s.since)
  );
}

/**
 * Reads Codex's own event names rather than guessing from file activity.
 *
 * Approval requests outrank a running task: a turn that has stopped to ask for
 * permission is still "started" as far as the task events are concerned, and
 * showing it as busy hides the one state that needs the user.
 */
export function latestLifecycle(
  tail: string
): { state: 'busy' | 'waiting' | 'idle'; waitingFor: string | null; at: number } | null {
  const lines = tail.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || !line.includes('"type"')) continue;
    let event: { timestamp?: string; payload?: { type?: string } };
    try {
      event = JSON.parse(line) as typeof event;
    } catch {
      continue; // truncated head of the tail window
    }
    const kind = event.payload?.type;
    if (!kind) continue;
    const at = event.timestamp ? Date.parse(event.timestamp) : Date.now();
    const stamp = Number.isFinite(at) ? at : Date.now();

    if (kind === 'exec_approval_request' || kind === 'apply_patch_approval_request') {
      return {
        state: 'waiting',
        waitingFor: kind === 'exec_approval_request' ? 'Approve a command' : 'Approve an edit',
        at: stamp
      };
    }
    if (kind === 'task_complete' || kind === 'turn_aborted' || kind === 'error') {
      return { state: 'idle', waitingFor: null, at: stamp };
    }
    if (kind === 'task_started') {
      return { state: 'busy', waitingFor: null, at: stamp };
    }
  }
  return null;
}
