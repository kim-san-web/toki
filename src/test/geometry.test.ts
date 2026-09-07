import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toRect, toOffset, nearestEdge, isVertical } from '../main/geometry.js';
import { windowSize, LAYOUT } from '../main/layout.js';

const AREA = { x: 0, y: 40, width: 1920, height: 1000 };

test('a top notch pins to the work area, not the display bounds', () => {
  // So a bottom notch rests on the taskbar and a top one under any app bar.
  const rect = toRect('top', { along: 400, across: 80 }, 0.5, AREA);
  assert.equal(rect.y, 40);
  assert.equal(rect.x, (1920 - 400) / 2);
});

test('offset moves the notch along its edge', () => {
  assert.equal(toRect('top', { along: 400, across: 80 }, 0, AREA).x, 0);
  assert.equal(toRect('top', { along: 400, across: 80 }, 1, AREA).x, 1520);
  assert.equal(toRect('left', { along: 400, across: 80 }, 0, AREA).y, 40);
  assert.equal(toRect('left', { along: 400, across: 80 }, 1, AREA).y, 640);
});

test('bottom and right anchor to the far side of the work area', () => {
  assert.equal(toRect('bottom', { along: 400, across: 80 }, 0.5, AREA).y, 40 + 1000 - 80);
  assert.equal(toRect('right', { along: 400, across: 80 }, 0.5, AREA).x, 1920 - 80);
});

test('an oversized notch is clamped rather than pushed off-screen', () => {
  const rect = toRect('top', { along: 5000, across: 80 }, 0.5, AREA);
  assert.equal(rect.width, 1920);
  assert.equal(rect.x, 0);
});

test('offset round-trips, so the position survives a resolution change', () => {
  const rect = toRect('top', { along: 400, across: 80 }, 0.25, AREA);
  assert.ok(Math.abs(toOffset('top', rect, AREA) - 0.25) < 0.001);
});

test('a dropped window re-anchors to the nearest edge', () => {
  assert.equal(nearestEdge({ x: 900, y: 45, width: 200, height: 60 }, AREA), 'top');
  assert.equal(nearestEdge({ x: 900, y: 980, width: 200, height: 60 }, AREA), 'bottom');
  assert.equal(nearestEdge({ x: 2, y: 500, width: 60, height: 200 }, AREA), 'left');
  assert.equal(nearestEdge({ x: 1860, y: 500, width: 60, height: 200 }, AREA), 'right');
});

test('vertical edges are the ones that stack a column', () => {
  assert.equal(isVertical('left'), true);
  assert.equal(isVertical('right'), true);
  assert.equal(isVertical('top'), false);
});

test('the window is sized for its worst case, not for hover state', () => {
  // Resizing per hover is what made the notch tear when the pointer crossed
  // between rings, so size must depend only on things that actually change the
  // maximum extent.
  const four = windowSize('top', 4, 1);
  const six = windowSize('top', 6, 1);
  assert.ok(six.along > four.along, 'more providers need more room along the edge');

  // Room for the card is always reserved, so opening one never resizes.
  assert.ok(four.across > 62 + 20, 'the card must have somewhere to go');

  // Scale moves everything together.
  assert.ok(windowSize('top', 4, 1.5).along > four.along);
  assert.ok(windowSize('top', 4, 1.5).across > four.across);
});

test('every edge reserves room for the card in the direction it opens', () => {
  // The card always opens *away* from the edge, so `across` is the axis that
  // must hold it whichever edge the notch is on.
  for (const edge of ['top', 'right', 'bottom', 'left'] as const) {
    const size = windowSize(edge, 4, 1);
    assert.ok(size.across > LAYOUT.cardWidth, `${edge} must fit the card`);
    // A pending question renders between the shell and the card and pushes the
    // card away from the edge. Reserving only the card's own height clipped its
    // footer exactly when an agent was waiting on an answer.
    const opening = edge === 'top' || edge === 'bottom' ? size.across : size.along;
    assert.ok(
      opening >= LAYOUT.cardHeight + LAYOUT.ask * LAYOUT.askSlots,
      `${edge} must hold the card and the questions stacked above it`
    );
    assert.ok(size.along > LAYOUT.cell * 4, `${edge} must fit four cells`);
    // Whole pixels: a fractional bound is truncated by the OS and clips the shadow.
    assert.equal(size.along, Math.round(size.along));
    assert.equal(size.across, Math.round(size.across));
  }
});
