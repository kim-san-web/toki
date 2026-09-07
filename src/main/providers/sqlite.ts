import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { log } from '../log.js';

/**
 * Read-only access to another app's SQLite store.
 *
 * Deliberately *not* `immutable=1`. Cursor and Codex both run their databases
 * in WAL mode, and `immutable` tells SQLite to ignore the write-ahead log --
 * so it happily returns whatever was true at the last checkpoint. That is how
 * you end up serving a token the editor has already rotated.
 *
 * `query_only` is set as well as `readOnly`, so no statement can write even by
 * accident, and extensions are refused: this opens files owned by other
 * programs and must never be a way to run their code.
 */
export function openReadOnly(path: string): DatabaseSync | null {
  if (!existsSync(path)) return null;
  try {
    const db = new DatabaseSync(path, { readOnly: true, allowExtension: false });
    db.exec('PRAGMA query_only = ON');
    return db;
  } catch (error) {
    log.debug('sqlite', `could not open ${path}: ${String(error)}`);
    return null;
  }
}

export function queryAll<T = Record<string, unknown>>(
  db: DatabaseSync,
  sql: string,
  ...params: (string | number | null)[]
): T[] {
  try {
    return db.prepare(sql).all(...params) as T[];
  } catch (error) {
    log.debug('sqlite', `query failed: ${String(error)}`);
    return [];
  }
}

export function withDb<T>(path: string, body: (db: DatabaseSync) => T): T | null {
  const db = openReadOnly(path);
  if (!db) return null;
  try {
    return body(db);
  } finally {
    try {
      db.close();
    } catch {
      /* closing a read-only handle is best-effort */
    }
  }
}
