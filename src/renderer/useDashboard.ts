import { useEffect, useState } from 'react';
import type { DashboardState } from '../shared/types.js';
import { toki } from './api.js';

/**
 * The dashboard, pushed whole from the main process.
 *
 * The renderer keeps no derived copy of it: every number on screen comes from
 * the latest push, so there is nothing that can drift out of step with what the
 * store actually read.
 */
export function useDashboard(): DashboardState | null {
  const [state, setState] = useState<DashboardState | null>(null);

  useEffect(() => {
    let live = true;
    void toki.getState().then((initial) => {
      if (live) setState(initial);
    });
    const off = toki.onState(setState);
    return () => {
      live = false;
      off();
    };
  }, []);

  return state;
}

/**
 * A clock that ticks only as often as the copy it drives changes.
 *
 * Reset countdowns are worded in minutes, so a one-second timer would rerender
 * the whole notch sixty times for one visible change.
 */
export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
