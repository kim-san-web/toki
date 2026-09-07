import { limitWindow } from './provider.js';
import type { LimitWindow, UsageBlock } from '../../shared/types.js';

/**
 * Codex's live usage endpoint -- what the account is actually using *now*.
 *
 * This exists because the rollout log answers a different question. A rollout
 * records what Codex saw during a turn and then stops changing, so once a
 * window rolls over the file still claims yesterday's percentage and nothing
 * local can correct it. Asking the server is the only way to learn that a 5h
 * window has refilled without the user running Codex again.
 *
 * Recorded from a live account:
 *
 * ```json
 * { "plan_type": "plus",
 *   "rate_limit": {
 *     "allowed": true, "limit_reached": false,
 *     "primary_window":   { "used_percent": 0,  "limit_window_seconds": 18000,  "reset_at": 1788751350 },
 *     "secondary_window": { "used_percent": 32, "limit_window_seconds": 604800, "reset_at": 1789211560 } },
 *   "rate_limit_reached_type": null }
 * ```
 *
 * Note `reset_at` is an absolute epoch in **seconds**, and the window length is
 * in **seconds** here where the rollout reports minutes -- the two shapes are
 * genuinely different and must not share a parser.
 */
export interface CodexLiveResponse {
  plan_type?: string | null;
  rate_limit?: {
    allowed?: boolean;
    limit_reached?: boolean;
    primary_window?: CodexLiveWindow | null;
    secondary_window?: CodexLiveWindow | null;
  } | null;
  rate_limit_reached_type?: string | null;
  credits?: { has_credits?: boolean; unlimited?: boolean; balance?: string } | null;
}

interface CodexLiveWindow {
  used_percent?: number;
  limit_window_seconds?: number;
  reset_after_seconds?: number;
  reset_at?: number;
}

/** Seconds here, unlike the rollout's minutes. */
export function liveWindowLabel(seconds: number | undefined, fallback: string): string {
  if (!seconds || seconds <= 0) return fallback === 'primary' ? 'Current session' : 'Longer window';
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)}m limit`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h limit`;
  const days = Math.round(minutes / (60 * 24));
  if (days === 7) return 'Weekly limit';
  if (days === 30) return 'Monthly limit';
  return `${days}d limit`;
}

function liveWindow(w: CodexLiveWindow | null | undefined, id: string, now: number): LimitWindow | null {
  if (!w || typeof w.used_percent !== 'number') return null;

  let resetsAt: number | null = null;
  if (typeof w.reset_at === 'number') resetsAt = w.reset_at * 1000;
  else if (typeof w.reset_after_seconds === 'number') resetsAt = now + w.reset_after_seconds * 1000;

  // Unlike the rollout, this reading was taken now -- so a reset time a moment
  // in the past is clock skew, not a stale file, and the percentage still
  // stands. Only the countdown is dropped.
  const passed = resetsAt !== null && resetsAt <= now;

  return limitWindow({
    id,
    label: liveWindowLabel(w.limit_window_seconds, id),
    usedFraction: w.used_percent / 100,
    resetsAt: passed ? null : resetsAt
  });
}

export function codexLiveWindows(payload: CodexLiveResponse, now = Date.now()): LimitWindow[] {
  const limits = payload.rate_limit;
  if (!limits) return [];
  return [
    liveWindow(limits.primary_window, 'primary', now),
    liveWindow(limits.secondary_window, 'secondary', now)
  ].filter((w): w is LimitWindow => w !== null);
}

/** A limit the server says has actually been reached, separate from the headline. */
export function codexLiveBlock(payload: CodexLiveResponse, now = Date.now()): UsageBlock | null {
  const limits = payload.rate_limit;
  if (!limits) return null;
  const reached = payload.rate_limit_reached_type;
  if (!reached && limits.limit_reached !== true) return null;

  const which = reached === 'secondary' ? limits.secondary_window : limits.primary_window;
  const window = liveWindow(which, reached ?? 'primary', now);
  return {
    reason: `Codex ${liveWindowLabel(which?.limit_window_seconds, reached ?? 'primary')} reached`,
    resetsAt: window?.resetsAt ?? null
  };
}
