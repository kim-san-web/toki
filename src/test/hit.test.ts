import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hitRegion, pointerInside } from '../shared/hit.js';

const SHELL = { left: 100, top: 0, right: 300, bottom: 60 };

test('with no card, the region is just the shell', () => {
  assert.deepEqual(hitRegion(SHELL, null), { x: 100, y: 0, width: 200, height: 60 });
});

test('an open card extends the region so the pointer can travel onto it', () => {
  // Without this the tracker sees the pointer leave the moment it moves off a
  // ring toward the card, and the notch closes under the cursor.
  const card = { left: 120, top: 60, right: 388, bottom: 360 };
  assert.deepEqual(hitRegion(SHELL, card), { x: 100, y: 0, width: 288, height: 360 });
});

test('a zero-sized card is ignored, not unioned to the origin', () => {
  // A card that is closed or not yet laid out measures 0x0 at 0,0; including it
  // would drag the region up to the top-left of the window.
  assert.deepEqual(hitRegion(SHELL, { left: 0, top: 0, right: 0, bottom: 0 }), {
    x: 100,
    y: 0,
    width: 200,
    height: 60
  });
});

test('a card above the shell extends upwards, for a bottom-edge notch', () => {
  const card = { left: 120, top: -300, right: 388, bottom: 0 };
  assert.deepEqual(hitRegion(SHELL, card), { x: 100, y: -300, width: 288, height: 360 });
});

test('the pointer test is window-relative', () => {
  // The region spans screen x 1130..1330 and y 0..60.
  const rect = { x: 100, y: 0, width: 200, height: 60 };
  const bounds = { x: 1030, y: 0 };
  assert.equal(pointerInside({ x: 1130, y: 0 }, bounds, rect), true, 'top-left corner is inside');
  assert.equal(pointerInside({ x: 1329, y: 59 }, bounds, rect), true, 'last pixel is inside');
  // Just outside on each edge.
  assert.equal(pointerInside({ x: 1129, y: 10 }, bounds, rect), false, 'one pixel left');
  assert.equal(pointerInside({ x: 1330, y: 10 }, bounds, rect), false, 'one past the right');
  assert.equal(pointerInside({ x: 1200, y: 60 }, bounds, rect), false, 'one past the bottom');
  assert.equal(pointerInside({ x: 1200, y: -1 }, bounds, rect), false, 'above the top');
});

test('a window on a second display offsets correctly', () => {
  const rect = { x: 0, y: 0, width: 100, height: 40 };
  assert.equal(pointerInside({ x: 2570, y: 5 }, { x: 2560, y: 0 }, rect), true);
  assert.equal(pointerInside({ x: 10, y: 5 }, { x: 2560, y: 0 }, rect), false);
});
