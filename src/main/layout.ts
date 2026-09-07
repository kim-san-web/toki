import type { NotchEdge } from '../shared/types.js';
import { isVertical, type StackSize } from './geometry.js';

/**
 * Every measurement the notch window needs, in one place.
 *
 * Sizes are in *logical* pixels and scale together: change the size in Settings
 * and the pill, the rings and the type all grow in the same proportion.
 */
export const LAYOUT = {
  /** The resting pill, before anything is expanded. */
  restAlong: 78,
  restAcross: 22,
  /** The expanded stack: one cell per provider. */
  cell: 62,
  ring: 40,
  ringStroke: 3.5,
  /** Padding inside the expanded body, along and across the edge. */
  padAlong: 12,
  padAcross: 10,
  /** The detail card that opens beside a ring. */
  cardWidth: 268,
  cardHeight: 300,
  /**
   * Room kept between the shell and the card for pending-question banners.
   *
   * A question renders *above* the card -- it outranks a percentage -- so every
   * banner pushes the card further from the edge. Without this the card's
   * footer is clipped by the window the moment an agent asks something, which
   * is precisely when the panel is being read.
   *
   * Reserved unconditionally, and for two banners rather than one: a question
   * arriving must not resize the window while it is being read, and the band is
   * transparent and click-through, so holding it costs nothing on screen.
   */
  ask: 116,
  askSlots: 2,
  /** Space kept clear so a shadow is never clipped by the window edge. */
  shadow: 30
} as const;

/**
 * The notch window's size.
 *
 * Deliberately **independent of hover state**. An earlier version resized the
 * window on every expand, collapse and card change, which produced the glitch
 * this replaced: `setBounds` is a synchronous OS operation on a different clock
 * from the CSS transition inside the window, so moving between two rings —
 * card closes, window shrinks, card reopens, window grows — made the panel jump
 * and tear several times per second.
 *
 * Now the window is sized once for the worst case it will ever need to draw and
 * simply stays there. It is transparent and click-through outside the drawn
 * content, so the extra area costs nothing visually, and every expansion becomes
 * a pure CSS animation inside a window that never moves.
 *
 * The only inputs are things that genuinely change the maximum extent: which
 * edge it is on, how many providers there are, and the size setting.
 */
export function windowSize(edge: NotchEdge, providerCount: number, scale: number): StackSize {
  const s = (n: number) => Math.round(n * scale);
  const count = Math.max(1, providerCount);

  // The expanded body: cells in a row, plus the settings orb.
  const bodyAlong = s(LAYOUT.cell) * count + s(LAYOUT.cell) * 0.6 + s(LAYOUT.padAlong) * 2;
  const bodyAcross = s(LAYOUT.cell) + s(LAYOUT.padAcross) * 2;

  const cardAlong = s(LAYOUT.cardWidth) + s(24);
  const cardAcross = s(LAYOUT.cardHeight) + s(LAYOUT.ask * LAYOUT.askSlots);

  // Rounded: a fractional window bound is truncated by the OS, and losing a
  // sub-pixel off the card's reserved room clips its shadow.
  if (isVertical(edge)) {
    // A vertical notch stacks its cells along the edge and opens the card
    // sideways, away from it -- so `across` is what must hold the card's width.
    return {
      along: Math.round(Math.max(bodyAlong, cardAcross) + LAYOUT.shadow * 2),
      across: Math.round(bodyAcross + cardAlong + LAYOUT.shadow)
    };
  }
  return {
    along: Math.round(Math.max(bodyAlong, cardAlong) + LAYOUT.shadow * 2),
    across: Math.round(bodyAcross + cardAcross + LAYOUT.shadow)
  };
}
