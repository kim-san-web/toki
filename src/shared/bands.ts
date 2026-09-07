import type { ProviderSnapshot, LimitWindow } from './types.js';

/**
 * The colour a ring or bar takes at a given level of use.
 *
 * Thresholds are the reference design's, kept because they read correctly:
 * under half is calm, 50-70 is a warning, past 70 is urgent.
 */
export type UsageBand = 'ample' | 'watch' | 'critical' | 'exhausted';

export function bandFor(usedFraction: number): UsageBand {
  if (usedFraction < 0.5) return 'ample';
  if (usedFraction < 0.7) return 'watch';
  if (usedFraction < 1) return 'critical';
  return 'exhausted';
}

export const BAND_COLOR: Record<UsageBand, string> = {
  ample: '#22E5A0',
  watch: '#F2E63D',
  critical: '#FF5A2B',
  exhausted: '#FF3B1F'
};

export function bandColor(usedFraction: number | null | undefined): string {
  if (usedFraction === null || usedFraction === undefined) return '#3A3F45';
  return BAND_COLOR[bandFor(usedFraction)];
}

/**
 * Whether a provider has actually connected to something.
 *
 * The test is simply "has it any limit windows", and that is exactly right
 * rather than merely convenient, because the store keeps a provider's windows
 * once it has ever been read successfully:
 *
 *  - never connected (disabled, no credential, nothing to borrow) -> no windows
 *  - connected and reading -> windows
 *  - connected and *now failing* -> windows are kept, with a stale or error
 *    status, so a provider that broke this morning does not silently disappear
 *    from the notch. Vanishing is the one behaviour that would make the
 *    dashboard untrustworthy: a missing ring must mean "not set up", never
 *    "set up and quietly broken".
 *  - switched off -> windows are cleared and forgotten -> no windows
 *
 * Settings deliberately does not use this: that is where providers are
 * connected, so it must list every one of them.
 */
export function isConnected(s: ProviderSnapshot): boolean {
  return s.windows.length > 0;
}

/** The window the ring means. Never "whichever came first" once declared. */
export function headline(s: ProviderSnapshot): LimitWindow | null {
  if (!s.headlineId) return s.windows[0] ?? null;
  return s.windows.find((w) => w.id === s.headlineId) ?? null;
}

export function headlineFraction(s: ProviderSnapshot): number | null {
  return headline(s)?.usedFraction ?? null;
}

/**
 * What the cell prints under the ring. A dash, never a confident-looking 0%,
 * when there is no reading.
 */
export function headlineText(s: ProviderSnapshot): string {
  const h = headline(s);
  if (!h) return '--';
  if (h.usedFraction !== null) return `${Math.round(h.usedFraction * 100)}%`;
  if (h.remaining !== null) return String(h.remaining);
  if (h.used !== null) return String(h.used);
  return '--';
}
