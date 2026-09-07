import type { JSX } from 'react';
import { StrictMode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { NotchEdge, ProviderActivity, ProviderSnapshot } from '../shared/types.js';
import { toki } from './api.js';
import { useDashboard, useNow } from './useDashboard.js';
import { Ring, RingValue } from './Ring.js';
import { Card } from './Card.js';
import { TokiMark } from './Glyph.js';
import { hitRegion } from '../shared/hit.js';
import { isConnected } from '../shared/bands.js';
import { Questions } from './Questions.js';
import { useTheme } from './useTheme.js';
import './theme.css';
import './notch.css';

const RING = 40;
const STROKE = 3.5;

/**
 * The notch.
 *
 * Laid out entirely in **stack space**: a row along the edge, and things that
 * open away from it. Which edge that actually is only ever changes one CSS
 * class, so the layout never forks into four versions of itself.
 */
function Notch(): JSX.Element | null {
  const state = useDashboard();
  const now = useNow();
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const collapseTimer = useRef<number | null>(null);

  const settings = state?.settings;
  const edge: NotchEdge = settings?.edge ?? 'top';
  useTheme(settings);

  /**
   * Only providers that have actually connected get a ring.
   *
   * The notch is a glanceable instrument, and a ring showing a dash is not a
   * reading -- it is a row of setup instructions taking up space next to real
   * numbers. Anything not connected lives in Settings, which is where it would
   * be connected anyway.
   */
  const allProviders = state?.providers ?? [];
  const providers = useMemo(() => allProviders.filter(isConnected), [allProviders]);
  const activityById = useMemo(() => {
    const map = new Map<string, ProviderActivity>();
    for (const entry of state?.activity ?? []) map.set(entry.providerId, entry);
    return map;
  }, [state?.activity]);

  const alwaysOpen = settings?.visibility === 'always';
  const open = expanded || alwaysOpen;
  const cardId = selected ?? hovered;

  /**
   * The card that is showing, which is *not* simply the hovered one.
   *
   * Moving the pointer from one ring to the next crosses a few pixels of gap,
   * during which nothing is hovered. Rendering that literally unmounts the card
   * and remounts it a frame later — the flicker that made sliding along the
   * rings feel broken. Instead the last card stays mounted and its *content*
   * cross-fades, so the panel keeps its shape and only what is inside changes.
   */
  const [stickyId, setStickyId] = useState<string | null>(null);
  useEffect(() => {
    if (cardId !== null) setStickyId(cardId);
  }, [cardId]);
  // Only clear it when the whole notch closes, not on every gap.
  useEffect(() => {
    if (!open) setStickyId(null);
  }, [open]);

  const cardVisible = cardId !== null;
  const card = providers.find((p) => p.id === (cardId ?? stickyId)) ?? null;
  /**
   * Anything blocked on the user is shown whenever the notch is open, without
   * hovering a ring: a pending question is the one thing here worth
   * interrupting for, so it must not be hidden behind a hover.
   */
  const asking = (state?.questions.length ?? 0) > 0;

  /**
   * The window only ever needs to know how many rings there are.
   *
   * It is sized for its worst case and never resized on hover: an OS window
   * resize runs on a different clock from the CSS transition inside it, so
   * resizing per hover made the panel tear as the pointer crossed between
   * rings.
   */
  useEffect(() => {
    toki.setProviderCount(Math.max(1, providers.length));
  }, [providers.length]);

  /**
   * The window accepts the mouse only while the pointer is over something
   * actually drawn.
   *
   * This cannot be driven by `open`: the window is now sized for its worst case
   * and is mostly empty transparent space, so making the whole thing
   * interactive would swallow clicks across a wide band of the screen for
   * whatever app is underneath. The `.hit` wrapper below is the real drawn
   * region, and it owns this flag.
   *
   * Flipping the flag while the pointer is *inside* that region is safe --
   * hit-testing only gets stricter and the pointer is already over content.
   * Flipping it on every hover of a child would not be: Windows re-evaluates
   * hit-testing and drops the enter/leave pair that follows, which reads as the
   * notch flickering shut under the cursor.
   */

  const cancelCollapse = useCallback(() => {
    if (collapseTimer.current !== null) {
      window.clearTimeout(collapseTimer.current);
      collapseTimer.current = null;
    }
  }, []);

  /**
   * A grace period before collapsing.
   *
   * The pointer crosses gaps between elements constantly, and a notch that
   * snaps shut the instant it leaves one ring is unusable. Pinning a card with
   * a click cancels it entirely.
   */
  const scheduleCollapse = useCallback(() => {
    cancelCollapse();
    collapseTimer.current = window.setTimeout(() => {
      setExpanded(false);
      setHovered(null);
      setSelected(null);
    }, 420);
  }, [cancelCollapse]);

  useEffect(() => cancelCollapse, [cancelCollapse]);

  /**
   * Report the drawn region so the main process can track the cursor against
   * it, and open/close on what it reports.
   *
   * Measured after every layout change, because the region grows the moment the
   * notch expands -- and the expanded region is what has to keep the pointer
   * "inside" while it moves between rings.
   */
  const hitRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const node = hitRef.current;
    if (!node) return;

    const report = (): void => {
      // The slot is part of the hit region whenever it is showing anything --
      // a card, a question, or both -- so the pointer can reach its buttons.
      const cardNode = cardVisible || asking ? cardRef.current : null;
      toki.setHitRect(
        hitRegion(node.getBoundingClientRect(), cardNode?.getBoundingClientRect() ?? null)
      );
    };

    report();
    const observer = new ResizeObserver(report);
    observer.observe(node);
    if (cardRef.current) observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, [open, cardVisible, asking, card?.id, state?.questions.length, providers.length, edge]);

  useEffect(() => {
    return toki.onPointer((inside) => {
      if (inside) {
        cancelCollapse();
        setExpanded(true);
      } else if (selected === null) {
        scheduleCollapse();
      }
    });
  }, [cancelCollapse, scheduleCollapse, selected]);

  if (!state || !settings || settings.visibility === 'hidden') return null;

  const vertical = edge === 'left' || edge === 'right';

  return (
    <div className={`stage stage--${edge}${open ? ' stage--open' : ''}`}>
      {/*
        The one region that is really drawn, and therefore the only one that
        takes the mouse. Everything outside it stays click-through, however
        large the window is.
      */}
      <div className="stack hit" ref={hitRef}>
        <div className={`shell${open ? ' shell--open' : ''}`}>
          {!open ? (
            <div className="pill" aria-label="TOKI">
              <TokiMark size={13} />
              <PillDots providers={providers} activity={activityById} />
            </div>
          ) : (
            <div className={`row${vertical ? ' row--vertical' : ''}`}>
              {providers.length === 0 ? (
                /*
                 * Nothing is connected yet.
                 *
                 * The orb alone would be a bare gear floating on the edge with
                 * no hint of what it is for, so the empty state says what to do
                 * and is itself the button that does it. It disappears the
                 * moment a first provider reads.
                 */
                <button
                  type="button"
                  className="setup"
                  onClick={() => toki.openSettings()}
                >
                  <TokiMark size={15} />
                  <span>Connect a provider</span>
                </button>
              ) : (
                providers.map((provider) => (
                  <div className="cell" key={provider.id}>
                    <Ring
                      snapshot={provider}
                      activity={activityById.get(provider.id)?.state ?? 'unavailable'}
                      size={RING}
                      stroke={STROKE}
                      selected={cardId === provider.id}
                      onSelect={() =>
                        setSelected((current) => (current === provider.id ? null : provider.id))
                      }
                      onHover={(hovering) => setHovered(hovering ? provider.id : null)}
                    />
                    <RingValue snapshot={provider} size={RING} />
                  </div>
                ))
              )}
              <button
                type="button"
                className="orb"
                onClick={() => toki.openSettings()}
                title="TOKI settings"
                aria-label="TOKI settings"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <path
                    className="orb__arc"
                    d="M5 15a7.5 7.5 0 1114 0"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  <g className="orb__gear">
                    <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
                    <path
                      d="M12 3v2.2M12 18.8V21M21 12h-2.2M5.2 12H3M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6M18.4 18.4l-1.6-1.6M7.2 7.2L5.6 5.6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </g>
                </svg>
              </button>
            </div>
          )}
        </div>

        {/*
          Absolutely positioned, so a closed card contributes nothing to the
          stack's box -- the hover region stays exactly the size of the pill
          until there is really a card to hover.
        */}
        {/* Questions sit with the card: both are things that open below the rings. */}
        <div
          ref={cardRef}
          className={`card-slot${(cardVisible && card) || (open && asking) ? ' card-slot--open' : ''}`}
        >
          {open && <Questions questions={state.questions} now={now} />}
          {card && (
            // Keyed by provider so React swaps the *content* and replays the
            // fade, while the slot itself stays put and keeps its shape.
            <Card key={card.id} snapshot={card} activity={activityById.get(card.id)} now={now} />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The resting pill's only content besides the mark: one dot per provider,
 * coloured by band, with a live one for anything working.
 *
 * Enough to be worth glancing at without expanding, and small enough that it
 * never competes with what is on screen underneath.
 */
function PillDots({
  providers,
  activity
}: {
  providers: ProviderSnapshot[];
  activity: Map<string, ProviderActivity>;
}): JSX.Element {
  if (providers.length === 0) {
    // Nothing connected: a single dim dot keeps the pill a recognisable shape
    // rather than shrinking to a bare mark, and reads as "idle", not "broken".
    return <span className="pill__dots"><span className="pill__dot pill__dot--none" /></span>;
  }
  return (
    <span className="pill__dots">
      {providers.slice(0, 5).map((provider) => {
        const state = activity.get(provider.id)?.state ?? 'unavailable';
        const fraction = provider.windows.find((w) => w.id === provider.headlineId)?.usedFraction ?? null;
        return (
          <span
            key={provider.id}
            className={`pill__dot pill__dot--${state}`}
            style={{
              background:
                fraction === null
                  ? 'var(--toki-faint)'
                  : fraction < 0.5
                    ? 'var(--band-ample)'
                    : fraction < 0.7
                      ? 'var(--band-watch)'
                      : 'var(--band-critical)'
            }}
          />
        );
      })}
    </span>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Notch />
    </StrictMode>
  );
}
