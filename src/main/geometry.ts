import type { NotchEdge } from '../shared/types.js';

/**
 * Where the notch window goes, and how big.
 *
 * The whole UI is laid out in one-dimensional **stack space** -- `along` the
 * edge and `across` from it -- regardless of which edge it is on. This is the
 * only place that maps that back onto real screen coordinates, so nothing else
 * in the app has to know about edges at all.
 */
export interface WorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StackSize {
  /** Extent along the edge. */
  along: number;
  /** Extent away from the edge. */
  across: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function isVertical(edge: NotchEdge): boolean {
  return edge === 'left' || edge === 'right';
}

/** Stack space to a screen rectangle, in the work area's coordinates. */
export function toRect(edge: NotchEdge, size: StackSize, offset: number, area: WorkArea): Rect {
  const clamped = Math.min(1, Math.max(0, offset));
  if (isVertical(edge)) {
    const height = Math.min(size.along, area.height);
    const width = Math.min(size.across, area.width);
    const y = area.y + Math.round((area.height - height) * clamped);
    const x = edge === 'left' ? area.x : area.x + area.width - width;
    return { x, y, width, height };
  }
  const width = Math.min(size.along, area.width);
  const height = Math.min(size.across, area.height);
  const x = area.x + Math.round((area.width - width) * clamped);
  const y = edge === 'top' ? area.y : area.y + area.height - height;
  return { x, y, width, height };
}

/**
 * The reverse: where along the edge a dragged window ended up.
 *
 * Used when the notch is dragged, so the stored offset survives a resolution
 * change -- a pixel position would put the notch off-screen on a smaller
 * display.
 */
export function toOffset(edge: NotchEdge, rect: Rect, area: WorkArea): number {
  if (isVertical(edge)) {
    const travel = area.height - rect.height;
    if (travel <= 0) return 0.5;
    return Math.min(1, Math.max(0, (rect.y - area.y) / travel));
  }
  const travel = area.width - rect.width;
  if (travel <= 0) return 0.5;
  return Math.min(1, Math.max(0, (rect.x - area.x) / travel));
}

/**
 * Which edge a rectangle was dropped nearest, so dragging the notch to another
 * side of the screen re-anchors it there rather than leaving it floating.
 */
export function nearestEdge(rect: Rect, area: WorkArea): NotchEdge {
  const centreX = rect.x + rect.width / 2;
  const centreY = rect.y + rect.height / 2;
  const distances: { edge: NotchEdge; distance: number }[] = [
    { edge: 'top', distance: centreY - area.y },
    { edge: 'bottom', distance: area.y + area.height - centreY },
    { edge: 'left', distance: centreX - area.x },
    { edge: 'right', distance: area.x + area.width - centreX }
  ];
  return distances.reduce((best, next) => (next.distance < best.distance ? next : best)).edge;
}
