import { limitWindow } from './provider.js';
import type { LimitWindow } from '../../shared/types.js';
import { UsageError } from './provider.js';

/**
 * Parses Cursor's `GET /api/usage-summary`:
 *
 * ```json
 * { "billingCycleEnd": "2026-09-24T03:32:15.933Z",
 *   "membershipType": "free", "isUnlimited": false,
 *   "individualUsage": {
 *     "plan": { "used": 0, "limit": 0, "totalPercentUsed": 9.5, "apiPercentUsed": 19 },
 *     "onDemand": { "enabled": false, "used": 0, "limit": null } } }
 * ```
 *
 * Cursor meters an **allowance, not a request count** -- the dashboard's
 * "included usage - N% used" is `totalPercentUsed`. The `used`/`limit` pair
 * sits at zero on a free plan even while real usage is happening, because the
 * allowance arrives as a bonus rather than as a dollar limit. Reading
 * `used`/`limit` therefore reports 0% for an account that is 10% through its
 * month.
 */
export interface CursorUsageSummary {
  billingCycleEnd?: string;
  membershipType?: string;
  isUnlimited?: boolean;
  individualUsage?: {
    plan?: { used?: number; limit?: number; totalPercentUsed?: number; apiPercentUsed?: number };
    onDemand?: { enabled?: boolean; used?: number; limit?: number | null };
  };
}

function parseDate(text: string | undefined): number | null {
  if (!text) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}

export function cursorWindows(payload: CursorUsageSummary): LimitWindow[] {
  const resetsAt = parseDate(payload.billingCycleEnd);
  const usage = payload.individualUsage ?? {};
  const plan = usage.plan ?? {};
  const windows: LimitWindow[] = [];

  // Zero is a reading, not an absence. Cursor itself says "you've used 0% of
  // your included total usage", so if Cursor calls it 0%, so does TOKI.
  if (typeof plan.totalPercentUsed === 'number') {
    windows.push(
      limitWindow({
        id: 'included',
        label: 'Included usage',
        usedFraction: plan.totalPercentUsed / 100,
        resetsAt
      })
    );
  }
  if (typeof plan.apiPercentUsed === 'number' && plan.apiPercentUsed > 0) {
    windows.push(
      limitWindow({ id: 'api', label: 'API usage', usedFraction: plan.apiPercentUsed / 100, resetsAt })
    );
  }
  const onDemand = usage.onDemand;
  if (onDemand?.enabled && typeof onDemand.limit === 'number' && onDemand.limit > 0 && typeof onDemand.used === 'number') {
    windows.push(
      limitWindow({
        id: 'on_demand',
        label: 'On demand',
        usedFraction: onDemand.used / onDemand.limit,
        resetsAt
      })
    );
  }

  if (windows.length > 0) return windows;

  const membership = payload.membershipType ?? 'this';
  if (payload.isUnlimited === true) {
    throw new UsageError('nothingMetered', `Unlimited on the ${membership} plan - nothing to meter`);
  }
  throw new UsageError('nothingMetered', `The ${membership} plan has nothing for Cursor to meter yet`);
}
