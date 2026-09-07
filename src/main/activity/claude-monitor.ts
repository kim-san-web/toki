import { existsSync, watch, type FSWatcher } from 'node:fs';
import { basename } from 'node:path';
import type { AgentSession } from '../../shared/types.js';
import { eventsDir, readEvents, pruneEvents, isAlive } from './events.js';
import type { ActivityMonitor } from './monitor.js';
import { log } from '../log.js';

/**
 * Claude Code's activity, from hook events.
 *
 * Claude Code on Windows publishes no session registry to watch, so TOKI asks
 * it to tell us instead: `SessionStart`, `PreToolUse`, `Notification` and
 * `Stop` hooks run `toki-hook`, which writes one small file per session. That
 * is an explicit lifecycle -- not an inference from a file's mtime, which is
 * how a dashboard ends up confidently reporting a crashed agent as "working".
 *
 * The directory is *watched* rather than polled, so "Claude just finished"
 * appears immediately, with a slow timer alongside purely to notice sessions
 * whose process died without sending anything -- no file event will ever report
 * that.
 */
export class ClaudeActivityMonitor implements ActivityMonitor {
  private watcher: FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;
  private debounce: NodeJS.Timeout | null = null;
  private sessions: AgentSession[] = [];

  constructor(
    readonly providerId: string,
    private readonly stateDir: string,
    private readonly cutoff: () => number,
    private readonly onChange: () => void
  ) {}

  start(): void {
    this.rescan();
    this.watch();
    this.timer = setInterval(() => this.rescan(), 5_000);
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = null;
  }

  read(): AgentSession[] | null {
    return this.sessions;
  }

  private watch(): void {
    const dir = eventsDir(this.stateDir);
    if (!existsSync(dir)) return; // the timer still covers us until a hook creates it
    try {
      this.watcher = watch(dir, () => this.schedule());
    } catch (error) {
      log.debug(this.providerId, `could not watch activity dir: ${String(error)}`);
    }
  }

  /** One state change produces several file events; coalesce them. */
  private schedule(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.rescan(), 120);
  }

  private rescan(): void {
    if (!this.watcher) this.watch();
    pruneEvents(this.stateDir);
    const found = readEvents(this.stateDir, this.cutoff())
      .filter((event) => event.providerId === this.providerId)
      // A session whose process is gone is not working, whatever its last
      // event said.
      .filter((event) => isAlive(event.pid))
      .map<AgentSession>((event) => ({
        id: event.sessionId,
        providerId: event.providerId,
        name: event.name || 'Claude',
        detail: event.detail,
        state: event.state,
        waitingFor: event.waitingFor,
        cwd: event.cwd ?? null,
        since: event.at
      }))
      .sort((a, b) => b.since - a.since);

    if (sameSessions(found, this.sessions)) return;
    this.sessions = found;
    this.onChange();
  }
}

export function sameSessions(a: AgentSession[], b: AgentSession[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((session, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      session.id === other.id &&
      session.state === other.state &&
      session.since === other.since &&
      session.waitingFor === other.waitingFor
    );
  });
}

export function folderName(cwd: string): string {
  const trimmed = cwd.replace(/[\\/]+$/, '');
  return basename(trimmed) || trimmed;
}
