import { limitWindow } from './provider.js';
import type { LimitWindow } from '../../shared/types.js';

/**
 * The shape of `GET /api/oauth/usage` -- the endpoint Claude Code's own
 * `/usage` reads, so the notch and the CLI can never disagree.
 *
 * Pure and exported so the response shape is pinned by tests rather than by a
 * live account: this is not a published API and it can change without notice.
 */
export interface ClaudeUsageResponse {
  limits?: { kind?: string; percent?: number; resets_at?: string | null }[];
  five_hour?: { utilization?: number; resets_at?: string | null } | null;
  seven_day?: { utilization?: number; resets_at?: string | null } | null;
  seven_day_opus?: { utilization?: number; resets_at?: string | null } | null;
}

function parseDate(text: string | null | undefined): number | null {
  if (!text) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}

/** The wording the reference design used for the kinds it drew. */
export function claudeWindowLabel(kind: string): string {
  switch (kind) {
    case 'session':
      return 'Current session';
    case 'weekly_all':
      return 'All models';
    case 'weekly_opus':
      return 'Opus weekly';
    case 'weekly_sonnet':
      return 'Sonnet weekly';
    default:
      return kind
        .replace(/^weekly_/, '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

function rank(id: string): number {
  if (id === 'session') return 0;
  if (id === 'weekly_all') return 1;
  return 2;
}

/**
 * `limits` is the forward-compatible shape and is preferred. The named windows
 * are *merged in* rather than used only as a fallback: an entry is present in
 * `limits` only while its `resets_at` has not passed, so a session that has
 * just rolled over vanishes from the array while `five_hour` still carries it
 * -- losing the session exactly when someone is most likely to be looking.
 */
export function claudeWindows(payload: ClaudeUsageResponse): LimitWindow[] {
  const windows: LimitWindow[] = [];

  for (const limit of payload.limits ?? []) {
    const kind = limit.kind;
    const percent = limit.percent;
    if (typeof kind !== 'string' || typeof percent !== 'number') continue;
    windows.push(
      limitWindow({
        id: kind,
        label: claudeWindowLabel(kind),
        usedFraction: percent / 100,
        resetsAt: parseDate(limit.resets_at)
      })
    );
  }

  const merge = (
    w: { utilization?: number; resets_at?: string | null } | null | undefined,
    id: string,
    label: string
  ): void => {
    if (!w || typeof w.utilization !== 'number') return;
    if (windows.some((existing) => existing.id === id)) return;
    windows.push(
      limitWindow({ id, label, usedFraction: w.utilization / 100, resetsAt: parseDate(w.resets_at) })
    );
  };
  merge(payload.five_hour, 'session', 'Current session');
  merge(payload.seven_day, 'weekly_all', 'All models');
  merge(payload.seven_day_opus, 'weekly_opus', 'Opus weekly');

  return windows.sort((a, b) => (rank(a.id) === rank(b.id) ? a.id.localeCompare(b.id) : rank(a.id) - rank(b.id)));
}

/**
 * How long to wait after a 429.
 *
 * The server's own hint is honoured only as a floor-*raiser*: this endpoint
 * answers `Retry-After: 0`, and obeying that literally means retrying at once,
 * which is what keeps you rate limited. So the wait starts at a minute and
 * doubles per consecutive 429, capped so it always recovers on its own.
 */
export function claudeBackoffSeconds(consecutive: number, retryAfter: number): number {
  const floor = 60;
  const ceiling = 15 * 60;
  const doubled = floor * 2 ** Math.min(consecutive, 4);
  return Math.min(ceiling, Math.max(doubled, retryAfter));
}
