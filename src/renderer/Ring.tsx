import type { JSX } from 'react';
import type { ActivityState, ProviderSnapshot } from '../shared/types.js';
import { bandColor, headlineFraction, headlineText } from '../shared/bands.js';
import { Glyph } from './Glyph.js';

/**
 * One provider's ring.
 *
 * Three things are layered in a fixed order, so they can never be confused for
 * one another:
 *
 *  1. the **track**, always drawn, so an empty ring still reads as a ring;
 *  2. the **usage arc**, coloured by band -- absent entirely when there is no
 *     reading, because an arc at zero looks exactly like a confident 0%;
 *  3. the **activity indicator**, inside the ring and in a deliberately
 *     neutral tone, so "an agent is working" cannot be misread as part of the
 *     used/left colour scale.
 */
export interface RingProps {
  snapshot: ProviderSnapshot;
  activity: ActivityState;
  size: number;
  stroke: number;
  selected: boolean;
  onSelect: () => void;
  onHover: (hovering: boolean) => void;
}

export function Ring({ snapshot, activity, size, stroke, selected, onSelect, onHover }: RingProps): JSX.Element {
  const fraction = headlineFraction(snapshot);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const centre = size / 2;
  const colour = bandColor(fraction);
  const status = snapshot.status.kind;
  const dim = status === 'disabled' || status === 'needsAuth' || status === 'unsupported';
  // Past 100% the arc is full rather than wrapping: a second lap would read as
  // a smaller number than the first.
  const swept = fraction === null ? 0 : Math.min(1, Math.max(0, fraction));

  return (
    <button
      type="button"
      className={`ring${selected ? ' ring--selected' : ''}${dim ? ' ring--dim' : ''}`}
      style={{ width: size, height: size }}
      onClick={onSelect}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      aria-label={`${snapshot.displayName} ${headlineText(snapshot)}`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="ring__svg">
        <circle cx={centre} cy={centre} r={radius} fill="none" stroke="var(--track)" strokeWidth={stroke} />
        {fraction !== null && (
          <circle
            cx={centre}
            cy={centre}
            r={radius}
            fill="none"
            stroke={colour}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - swept)}
            className="ring__arc"
            /* Twelve o'clock, clockwise -- the direction everybody reads a dial. */
            transform={`rotate(-90 ${centre} ${centre})`}
          />
        )}
        {activity === 'working' && (
          <circle
            cx={centre}
            cy={centre}
            r={radius - stroke - 1.5}
            fill="none"
            stroke="var(--toki-text)"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeDasharray={`${circumference * 0.16} ${circumference}`}
            className="ring__spinner"
          />
        )}
        {activity === 'waiting' && (
          <circle
            cx={centre}
            cy={centre}
            r={radius - stroke - 1.5}
            fill="none"
            stroke="var(--band-watch)"
            strokeWidth={1.5}
            className="ring__pulse"
          />
        )}
      </svg>

      {/* Themed rather than fixed: on a light theme a white glyph vanishes. */}
      <span className={`ring__glyph${dim ? ' ring__glyph--dim' : ''}`}>
        <Glyph glyph={snapshot.glyph} size={Math.round(size * 0.4)} />
      </span>

      {snapshot.block !== null && <span className="ring__block" aria-hidden="true" />}
    </button>
  );
}

/** The percentage under a ring. Kept separate so the cell can lay it out. */
export function RingValue({ snapshot, size }: { snapshot: ProviderSnapshot; size: number }): JSX.Element {
  const text = headlineText(snapshot);
  const dim = text === '--';
  return (
    <span
      className={`ring-value${dim ? ' ring-value--dim' : ''}`}
      style={{ fontSize: Math.round(size * 0.27) }}
    >
      {text}
    </span>
  );
}
