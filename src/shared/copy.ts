import type { LimitWindow, ProviderSnapshot, ProviderStatus } from './types.js';

/**
 * Every string the UI shows about time or numbers, in one place and pure, so
 * the wording can be tested without a window.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Calendar days between two instants, in local time. */
export function daysApart(from: number, to: number): number {
  const a = new Date(from);
  const b = new Date(to);
  a.setHours(0, 0, 0, 0);
  b.setHours(0, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / DAY);
}

function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function weekday(at: number): string {
  return new Date(at).toLocaleDateString(undefined, { weekday: 'short' });
}

/**
 * When a window rolls over.
 *
 * A countdown while it is close enough to plan around, and a clock time once it
 * is far enough away that "in 7 hours" makes you do the arithmetic yourself.
 */
export function resetCopy(resetsAt: number | null, now = Date.now()): string {
  if (resetsAt === null) return 'Reset time unknown';
  const delta = resetsAt - now;
  if (delta <= 0) return 'Resetting now';
  if (delta < MINUTE) return 'Resets in under a minute';
  if (delta < HOUR) return `Resets in ${Math.round(delta / MINUTE)} min`;
  if (delta < 6 * HOUR) {
    let hours = Math.floor(delta / HOUR);
    let mins = Math.round((delta % HOUR) / MINUTE);
    // Rounding the remainder can reach a full hour -- "1h 60m" is not a time
    // anyone writes, so carry it.
    if (mins === 60) {
      hours += 1;
      mins = 0;
    }
    return mins === 0 ? `Resets in ${hours}h` : `Resets in ${hours}h ${mins}m`;
  }
  const days = daysApart(now, resetsAt);
  if (days === 0) return `Resets ${clockTime(resetsAt)}`;
  if (days === 1) return `Resets tomorrow ${clockTime(resetsAt)}`;
  if (days < 7) return `Resets ${weekday(resetsAt)} ${clockTime(resetsAt)}`;
  return `Resets ${new Date(resetsAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

/** How long ago something happened, for the age of a stale reading. */
export function elapsedCopy(since: number, now = Date.now()): string {
  const delta = Math.max(0, now - since);
  if (delta < MINUTE) return 'just now';
  if (delta < HOUR) {
    const m = Math.round(delta / MINUTE);
    return m === 1 ? '1 min ago' : `${m} min ago`;
  }
  if (delta < DAY) {
    const h = Math.round(delta / HOUR);
    return h === 1 ? '1 hour ago' : `${h} hours ago`;
  }
  const d = Math.round(delta / DAY);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

/**
 * The line under a window's bar.
 *
 * Both ends of the same figure, deliberately: vendors do not agree on which to
 * show -- Codex writes "87% remaining", Claude writes "% used" -- and picking
 * one side leaves the reader converting in their head.
 */
export function windowSummary(w: LimitWindow): string {
  if (w.usedFraction !== null) {
    const used = Math.round(w.usedFraction * 100);
    return `${used}% used - ${Math.max(0, 100 - used)}% left`;
  }
  if (w.remaining !== null) return w.remaining === 1 ? '1 left' : `${w.remaining} left`;
  if (w.used !== null) return w.used === 1 ? '1 used' : `${w.used} used`;
  return 'No reading';
}

/**
 * The line under a window whose figure has been withheld because its reset
 * passed.
 *
 * Says what happened and what fixes it, rather than leaving a blank the user
 * has to interpret as either "broken" or "zero".
 */
export function staleWindowNote(providerName: string): string {
  return `Window reset - use ${providerName} once for a fresh reading`;
}

export function blockSummary(reason: string, resetsAt: number | null, now = Date.now()): string {
  if (resetsAt === null || resetsAt <= now) return reason;
  const days = daysApart(now, resetsAt);
  const when = days >= 1 ? `${weekday(resetsAt)} ${clockTime(resetsAt)}` : clockTime(resetsAt);
  return `${reason} until ${when}`;
}

/** Signing in means something different per provider, so say which door. */
function authPrompt(s: ProviderSnapshot): string {
  switch (s.id.split(':')[0]) {
    case 'claude':
      return 'Sign in to Claude Code to read your usage';
    case 'cursor':
      return 'Sign in to Cursor in the editor';
    case 'codex':
      return 'Sign in to Codex to read your usage';
    case 'glm':
      return 'Set a GLM coding-plan key in a tool TOKI can read';
    default:
      return `Sign in to ${s.displayName} to read your usage`;
  }
}

/** What the card says instead of limit rows when there is nothing to show. */
export function statusMessage(s: ProviderSnapshot, now = Date.now()): string | null {
  if (s.windows.length > 0) return null;
  const st: ProviderStatus = s.status;
  switch (st.kind) {
    case 'disabled':
      return `${s.displayName} is switched off. Turn it on in Settings to read its usage.`;
    case 'needsAuth':
      return authPrompt(s);
    case 'accessDenied':
      return `TOKI was refused access to ${s.displayName}'s saved login on this PC.`;
    case 'unsupported':
      return st.why;
    case 'error':
      return `Couldn't read usage - ${st.why}`;
    case 'stale':
      return `Last read ${elapsedCopy(st.since, now)}`;
    case 'ok':
      return 'Waiting for the first reading...';
  }
}

/** The short line under a stale ring. */
export function staleNote(s: ProviderSnapshot, now = Date.now()): string | null {
  if (s.status.kind !== 'stale') return null;
  return `Read ${elapsedCopy(s.status.since, now)}`;
}

export function activityLabel(state: 'working' | 'waiting' | 'idle' | 'unavailable'): string {
  switch (state) {
    case 'working':
      return 'working';
    case 'waiting':
      return 'waiting on you';
    case 'idle':
      return 'idle';
    case 'unavailable':
      return 'no activity signal';
  }
}
