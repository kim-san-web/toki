import { limitWindow } from './provider.js';
import type { LimitWindow, UsageBlock } from '../../shared/types.js';

/**
 * Parses the rate-limit snapshot Codex records in its rollout log.
 *
 * Codex writes a JSONL rollout per thread; builds that surface usage emit a
 * `token_count` event carrying the account's own limit windows:
 *
 * ```json
 * { "timestamp": "2026-09-05T12:48:10.164Z", "type": "event_msg",
 *   "payload": { "type": "token_count",
 *     "rate_limits": {
 *       "primary":   { "used_percent": 99, "window_minutes": 300,   "resets_at": 1788624760 },
 *       "secondary": { "used_percent": 16, "window_minutes": 10080, "resets_at": 1789211560 },
 *       "plan_type": "plus" } } }
 * ```
 *
 * Recorded from a live rollout on this machine. Note the reset is `resets_at`,
 * an absolute epoch in *seconds* -- not the `resets_in_seconds` countdown the
 * published schema suggests. Both are read, so a build emitting the other form
 * does not silently lose its reset time.
 */
export interface CodexRateLimits {
  primary?: CodexBucket | null;
  secondary?: CodexBucket | null;
  plan_type?: string | null;
  rate_limit_reached_type?: string | null;
  credits?: { has_credits?: boolean; unlimited?: boolean; balance?: string } | null;
}

interface CodexBucket {
  used_percent?: number;
  window_minutes?: number;
  resets_at?: number;
  resets_in_seconds?: number;
}

/** `rate_limits` sits at the top level or under `payload`, depending on framing. */
function rateLimitsIn(object: unknown): CodexRateLimits | null {
  if (!object || typeof object !== 'object') return null;
  const record = object as Record<string, unknown>;
  if (record.rate_limits && typeof record.rate_limits === 'object') {
    return record.rate_limits as CodexRateLimits;
  }
  const payload = record.payload;
  if (payload && typeof payload === 'object') {
    const inner = (payload as Record<string, unknown>).rate_limits;
    if (inner && typeof inner === 'object') return inner as CodexRateLimits;
  }
  return null;
}

/**
 * Codex names its windows only by length, so the label is derived from it --
 * "5h limit" says more than "primary".
 */
export function codexWindowLabel(windowMinutes: number | undefined, fallback: string): string {
  if (!windowMinutes || windowMinutes <= 0) {
    return fallback === 'primary' ? 'Current session' : 'Longer window';
  }
  if (windowMinutes < 60) return `${Math.round(windowMinutes)}m limit`;
  if (windowMinutes < 60 * 24) return `${Math.round(windowMinutes / 60)}h limit`;
  const days = Math.round(windowMinutes / (60 * 24));
  if (days === 7) return 'Weekly limit';
  if (days === 30) return 'Monthly limit';
  return `${days}d limit`;
}

function bucketWindow(bucket: CodexBucket | null | undefined, id: string, now: number): LimitWindow | null {
  if (!bucket || typeof bucket.used_percent !== 'number') return null;
  let resetsAt: number | null = null;
  if (typeof bucket.resets_at === 'number') resetsAt = bucket.resets_at * 1000;
  else if (typeof bucket.resets_in_seconds === 'number') resetsAt = now + bucket.resets_in_seconds * 1000;

  /**
   * A window whose reset has already passed reports nothing, not its old
   * percentage.
   *
   * This is the difference between a *reading* and a *fact*. Codex writes what
   * it saw into a rollout as it runs; the file then sits unchanged. If the 5h
   * window said 99% and its `resets_at` was yesterday, the quota has since
   * refilled and TOKI would be showing a number that is not merely stale but
   * *known to be wrong* -- the file itself carries the proof, in the very
   * timestamp saying when it stopped being true.
   *
   * The window is kept rather than dropped, so the ring still shows which
   * limits exist and when they roll over; only the spent figure is withheld,
   * because there is no honest value for it until Codex runs again.
   */
  const expired = resetsAt !== null && resetsAt <= now;

  return limitWindow({
    id,
    label: codexWindowLabel(bucket.window_minutes, id),
    usedFraction: expired ? null : bucket.used_percent / 100,
    // A passed reset time is not a future one; showing it would read as a
    // countdown that never counts down.
    resetsAt: expired ? null : resetsAt
  });
}

export function codexWindows(limits: CodexRateLimits, now = Date.now()): LimitWindow[] {
  return [bucketWindow(limits.primary, 'primary', now), bucketWindow(limits.secondary, 'secondary', now)].filter(
    (w): w is LimitWindow => w !== null
  );
}

/** A limit Codex says has actually been reached, distinct from the headline. */
export function codexBlock(limits: CodexRateLimits, now = Date.now()): UsageBlock | null {
  const reached = limits.rate_limit_reached_type;
  if (!reached) return null;
  const bucket = reached === 'secondary' ? limits.secondary : limits.primary;
  const window = bucketWindow(bucket, reached, now);
  return { reason: `Codex ${codexWindowLabel(bucket?.window_minutes, reached)} reached`, resetsAt: window?.resetsAt ?? null };
}

export interface RolloutReading {
  limits: CodexRateLimits;
  /** When Codex actually took the reading, from the event's own timestamp. */
  recordedAt: number | null;
}

/**
 * The newest rate-limit snapshot in a rollout tail.
 *
 * The last one wins: a rollout is append-only, so earlier lines are older
 * readings of the same windows. The first line of a tail is very likely a
 * partial JSON object and is skipped rather than allowed to throw.
 */
export function readRollout(text: string): RolloutReading | null {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || !line.includes('rate_limits')) continue;
    let object: unknown;
    try {
      object = JSON.parse(line);
    } catch {
      continue; // truncated head of the tail window, or a half-written last line
    }
    const limits = rateLimitsIn(object);
    if (!limits) continue;
    const stamp = (object as { timestamp?: string }).timestamp;
    const recordedAt = stamp ? Date.parse(stamp) : NaN;
    return { limits, recordedAt: Number.isFinite(recordedAt) ? recordedAt : null };
  }
  return null;
}
