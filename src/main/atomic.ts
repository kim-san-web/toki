import { writeFileSync, renameSync, mkdirSync, openSync, fsyncSync, closeSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';

/**
 * Write a file so a reader never sees half of it.
 *
 * The temp file is created in the *same directory* on purpose: rename is only
 * atomic within a volume, and %TEMP% is frequently on a different one. The
 * flush before the rename is what makes the content -- not just the directory
 * entry -- survive a hard power loss.
 */
export function writeAtomic(path: string, contents: string): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, contents, 'utf8');
  const fd = openSync(tmp, 'r+');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmp, path);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      /* the rename is what matters; a stray temp file is not worth throwing over */
    }
    throw error;
  }
}

export function readJson<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(path: string, value: unknown): void {
  writeAtomic(path, JSON.stringify(value, null, 2));
}
