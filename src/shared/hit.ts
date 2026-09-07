/**
 * The region the notch actually draws, as a rectangle.
 *
 * The main process tracks the OS cursor against this instead of relying on DOM
 * hover, because a transparent, non-focusable, click-through overlay on Windows
 * does not receive `mouseenter` dependably -- a notch that waits for one can
 * simply never open.
 */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface HitRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The union of the shell and, when one is open, the detail card.
 *
 * A union rather than one padded element. Padding was tried and is wrong: the
 * card is anchored with `top: 100%`, which resolves against the *padded* box, so
 * reserving room for the card also pushes it that same distance off screen.
 *
 * Taking the extent of both boxes is what lets the pointer travel from a ring
 * down onto the card it opened without the tracker seeing it leave the drawn
 * region and closing the notch under the cursor.
 */
export function hitRegion(shell: Box, card: Box | null): HitRect {
  let { left, top, right, bottom } = shell;
  // A zero-sized card is one that is closed or not yet laid out; including it
  // would drag the region to the origin.
  if (card && card.right > card.left && card.bottom > card.top) {
    left = Math.min(left, card.left);
    top = Math.min(top, card.top);
    right = Math.max(right, card.right);
    bottom = Math.max(bottom, card.bottom);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Whether a screen-space point falls inside a window-relative hit region. */
export function pointerInside(
  cursor: { x: number; y: number },
  windowBounds: { x: number; y: number },
  rect: HitRect
): boolean {
  const left = windowBounds.x + rect.x;
  const top = windowBounds.y + rect.y;
  return (
    cursor.x >= left && cursor.x < left + rect.width && cursor.y >= top && cursor.y < top + rect.height
  );
}
