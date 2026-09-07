import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THEMES, DEFAULT_THEME_ID, themeById, themesByGroup, paletteToCssVars } from '../shared/themes.js';

/** Relative luminance, per WCAG. */
function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  assert.ok(m, `not a hex colour: ${hex}`);
  const n = parseInt(m[1]!, 16);
  const channel = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  );
}

/** An rgba() surface flattened onto black, which is what it composites over. */
function flatten(rgba: string): string {
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(rgba);
  assert.ok(m, `not an rgba colour: ${rgba}`);
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

function alphaOf(rgba: string): number {
  const m = /rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/i.exec(rgba);
  return m ? Number(m[1]) : 1;
}

test('the library is substantial and every id is unique', () => {
  assert.ok(THEMES.length >= 24, `expected a real library, got ${THEMES.length}`);
  assert.equal(new Set(THEMES.map((t) => t.id)).size, THEMES.length, 'ids must be unique');
});

test('the default theme exists and is the brand one', () => {
  const theme = themeById(DEFAULT_THEME_ID);
  assert.ok(theme, 'the default must resolve');
  assert.equal(theme.palette.accent.toUpperCase(), '#49E9F5', "TOKI's own accent");
});

test('an unknown id resolves to null rather than a broken theme', () => {
  assert.equal(themeById('no-such-theme'), null);
});

test('every panel is opaque enough to be legible over the desktop', () => {
  // backdrop-filter does not blur the desktop behind a transparent Electron
  // window on Windows, so alpha is the only thing stopping text bleeding
  // through the notch.
  for (const theme of THEMES) {
    assert.ok(alphaOf(theme.palette.surface) >= 0.95, `${theme.id}: surface too transparent`);
    assert.ok(alphaOf(theme.palette.card) >= 0.95, `${theme.id}: card too transparent`);
  }
});

test('text is comfortably readable on every theme', () => {
  for (const theme of THEMES) {
    const ratio = contrast(theme.palette.text, flatten(theme.palette.surface));
    assert.ok(ratio >= 7, `${theme.id}: text contrast ${ratio.toFixed(2)} is below 7:1`);
  }
});

test('a light theme really is light, and a dark one dark', () => {
  // The easy mistake is leaving white text on a light surface.
  for (const theme of THEMES) {
    const surface = luminance(flatten(theme.palette.surface));
    const text = luminance(theme.palette.text);
    if (theme.mood === 'light') {
      assert.ok(surface > text, `${theme.id} claims light but its text is brighter than its surface`);
    } else {
      assert.ok(text > surface, `${theme.id} claims dark but its surface is brighter than its text`);
    }
  }
});

test('the usage bands stay visible and distinct in every theme', () => {
  for (const theme of THEMES) {
    const bg = flatten(theme.palette.surface);
    for (const band of ['ample', 'watch', 'critical'] as const) {
      const ratio = contrast(theme.palette[band], bg);
      assert.ok(ratio >= 1.6, `${theme.id}: ${band} is nearly invisible (${ratio.toFixed(2)})`);
    }
    // They signal calm -> warning -> urgent, so they must not be the same colour.
    const set = new Set([theme.palette.ample, theme.palette.watch, theme.palette.critical]);
    assert.equal(set.size, 3, `${theme.id}: the bands must be distinguishable`);
  }
});

test('the accent is visible against the panel', () => {
  for (const theme of THEMES) {
    const ratio = contrast(theme.palette.accent, flatten(theme.palette.surface));
    assert.ok(ratio >= 1.8, `${theme.id}: accent contrast ${ratio.toFixed(2)} is too low`);
  }
});

test('every theme maps to the exact CSS variables the app sets', () => {
  const expected = [
    '--toki-ink', '--toki-surface', '--toki-surface-solid', '--toki-card',
    '--toki-hairline', '--toki-hairline-strong', '--toki-text', '--toki-muted',
    '--toki-faint', '--toki-accent', '--toki-grey', '--track',
    '--band-ample', '--band-watch', '--band-critical'
  ].sort();
  for (const theme of THEMES) {
    const vars = paletteToCssVars(theme.palette);
    assert.deepEqual(Object.keys(vars).sort(), expected, `${theme.id} maps the wrong variables`);
    for (const [name, value] of Object.entries(vars)) {
      assert.ok(value && value.trim().length > 0, `${theme.id}: ${name} is empty`);
    }
  }
});

test('the groups partition the library, with real choice in each', () => {
  const groups = ['essential', 'nature', 'vivid', 'soft', 'retro', 'pro'] as const;
  let counted = 0;
  for (const group of groups) {
    const found = themesByGroup(group);
    assert.ok(found.length >= 3, `${group} needs real choice, has ${found.length}`);
    counted += found.length;
  }
  assert.equal(counted, THEMES.length, 'every theme belongs to exactly one known group');
});

test('both bold and soft tastes are represented', () => {
  // The library exists so different people find something they like.
  assert.ok(themesByGroup('soft').length >= 4, 'soft/pastel options');
  assert.ok(themesByGroup('vivid').length >= 4, 'bold/neon options');
  assert.ok(THEMES.some((t) => t.mood === 'light'), 'at least one light theme');
});
