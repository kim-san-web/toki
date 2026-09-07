import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The notch has no window to print into, so anything worth diagnosing goes to
 * a file next to the settings. Deliberately dumb: no rotation library, no
 * dependency, and every write is best-effort -- logging must never be the
 * reason a poll fails.
 */
let logPath: string | null = null;
let verbose = process.env.TOKI_DEV === '1' || process.env.TOKI_VERBOSE === '1';

export function initLog(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true });
    logPath = join(dir, 'toki.log');
  } catch {
    logPath = null;
  }
}

export function setVerbose(on: boolean): void {
  verbose = on;
}

function write(level: string, scope: string, message: string): void {
  const line = `${new Date().toISOString()} ${level} [${scope}] ${message}`;
  if (verbose || level !== 'debug') {
    // eslint-disable-next-line no-console
    console.log(line);
  }
  if (!logPath) return;
  try {
    appendFileSync(logPath, line + '\n');
  } catch {
    /* logging must never throw into a caller */
  }
}

export const log = {
  debug: (scope: string, message: string) => write('debug', scope, message),
  info: (scope: string, message: string) => write('info ', scope, message),
  warn: (scope: string, message: string) => write('warn ', scope, message),
  error: (scope: string, message: string) => write('error', scope, message)
};

/** Never let a provider's own message leak a token into the log or the UI. */
export function scrub(text: string): string {
  return text
    .replace(/[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, '<jwt>')
    .replace(/\b(sk|sess|xoxb|ghp|gho)-[A-Za-z0-9_-]{16,}/g, '<token>')
    .replace(/[A-Za-z0-9_-]{40,}/g, '<redacted>');
}
