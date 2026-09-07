import type { AgentSession, ActivityState, ProviderActivity } from '../../shared/types.js';

/**
 * One source of "is it still working?".
 *
 * A monitor reports *sessions*, never a state: reducing them is the store's
 * job, so every provider's rule for "waiting outranks busy" is the same one.
 */
export interface ActivityMonitor {
  readonly providerId: string;
  start(): void;
  stop(): void;
  /** Null means no signal at all -- which is not the same as nothing running. */
  read(): AgentSession[] | null;
}

/**
 * How long a session may sit in `busy` or `waiting` without a fresh event
 * before it stops being believed.
 *
 * Necessary because these signals arrive as events, not as state: a tool killed
 * mid-turn never sends its "finished" event, and without an expiry the notch
 * would show it working forever.
 */
export const BUSY_EXPIRY_MS = 3 * 60_000;
export const WAITING_EXPIRY_MS = 30 * 60_000;

export function expire(sessions: AgentSession[], now = Date.now()): AgentSession[] {
  return sessions.filter((session) => {
    if (session.state === 'busy') return now - session.since < BUSY_EXPIRY_MS;
    if (session.state === 'waiting') return now - session.since < WAITING_EXPIRY_MS;
    return false; // an idle session is not worth a row
  });
}

/**
 * Reduce a provider's sessions to the one thing worth knowing at a glance.
 *
 * Anything blocked on you outranks anything merely busy: it is the only state
 * where the notch is asking for something. `null` sessions become
 * `unavailable`, never `idle` -- reporting "nothing is running" when the truth
 * is "nothing told us" is the failure mode that makes a dashboard untrustworthy.
 */
export function summarise(providerId: string, sessions: AgentSession[] | null, now = Date.now()): ProviderActivity {
  if (sessions === null) return { providerId, state: 'unavailable', sessions: [] };
  const live = expire(sessions, now);
  let state: ActivityState = 'idle';
  if (live.some((s) => s.state === 'waiting')) state = 'waiting';
  else if (live.some((s) => s.state === 'busy')) state = 'working';
  return { providerId, state, sessions: live };
}
