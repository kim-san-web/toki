import { existsSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentSession } from '../../shared/types.js';
import { cursorWorkspaceStorage } from '../paths.js';
import { withDb, queryAll } from '../providers/sqlite.js';
import type { ActivityMonitor } from './monitor.js';
import { folderName } from './claude-monitor.js';

/**
 * Cursor's agent activity, from the composer rows the editor keeps in its
 * per-workspace SQLite store.
 *
 * Cursor publishes no lifecycle events, so this reports only what can be read
 * honestly: a composer whose row changed within the live window is *busy*, and
 * everything else is nothing. It never claims `waiting`, because nothing in the
 * store distinguishes "asking you something" from "thinking" -- inventing that
 * distinction is exactly the kind of guess this app refuses to make.
 */
export class CursorActivityMonitor implements ActivityMonitor {
  readonly providerId = 'cursor';
  private timer: NodeJS.Timeout | null = null;
  private sessions: AgentSession[] | null = null;

  private static readonly LIVE_WINDOW_MS = 90_000;
  /** Newest workspaces only: a long-lived install has hundreds. */
  private static readonly MAX_WORKSPACES = 6;

  constructor(
    private readonly storageRoot: string = cursorWorkspaceStorage(),
    private readonly cutoff: () => number = () => 0,
    private readonly onChange: () => void = () => {}
  ) {}

  start(): void {
    this.rescan();
    this.timer = setInterval(() => this.rescan(), 5_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  read(): AgentSession[] | null {
    return this.sessions;
  }

  private recentWorkspaces(): { dir: string; mtime: number }[] {
    if (!existsSync(this.storageRoot)) return [];
    let names: string[] = [];
    try {
      names = readdirSync(this.storageRoot);
    } catch {
      return [];
    }
    const entries: { dir: string; mtime: number }[] = [];
    for (const name of names) {
      const db = join(this.storageRoot, name, 'state.vscdb');
      try {
        entries.push({ dir: db, mtime: statSync(db).mtimeMs });
      } catch {
        /* not every workspace directory has a store */
      }
    }
    return entries.sort((a, b) => b.mtime - a.mtime).slice(0, CursorActivityMonitor.MAX_WORKSPACES);
  }

  private rescan(): void {
    const workspaces = this.recentWorkspaces();
    if (workspaces.length === 0) {
      if (this.sessions !== null) {
        this.sessions = null;
        this.onChange();
      }
      return;
    }

    const now = Date.now();
    const cutoff = this.cutoff();
    const found: AgentSession[] = [];

    for (const workspace of workspaces) {
      if (now - workspace.mtime > CursorActivityMonitor.LIVE_WINDOW_MS) continue;
      if (workspace.mtime < cutoff) continue;
      const folder = withDb(workspace.dir, (db) => {
        const rows = queryAll<{ value: string }>(
          db,
          "SELECT value FROM ItemTable WHERE key = 'history.entries' LIMIT 1"
        );
        return rows.length > 0 ? rows[0]!.value : null;
      });
      const name = folder ? guessFolder(folder) : 'Cursor';
      found.push({
        id: `cursor.${workspace.dir}`,
        providerId: 'cursor',
        name,
        detail: 'Cursor',
        state: 'busy',
        waitingFor: null,
        cwd: null,
        since: workspace.mtime
      });
    }

    const sorted = found.sort((a, b) => b.since - a.since);
    if (this.sessions !== null && sorted.length === this.sessions.length && sorted.every((s, i) => this.sessions![i]?.id === s.id)) {
      return;
    }
    this.sessions = sorted;
    this.onChange();
  }
}

/** The first workspace folder mentioned in Cursor's history blob. */
export function guessFolder(historyJson: string): string {
  const match = /file:\/\/\/([A-Za-z]:\/[^"']*?)\//.exec(historyJson);
  if (!match?.[1]) return 'Cursor';
  return folderName(decodeURIComponent(match[1]));
}
