import { useEffect } from 'react';
import type { CustomTheme, Settings } from '../shared/types.js';
import { DEFAULT_THEME_ID, paletteToCssVars, themeById, type ThemePalette } from '../shared/themes.js';

/**
 * Resolve the active theme, custom ones included.
 *
 * A custom theme is stored whole rather than as a diff against its parent, so
 * it keeps working if the theme it was built from is ever changed or removed.
 */
export function resolvePalette(settings: Settings): ThemePalette {
  const custom = settings.customThemes.find((t) => t.id === settings.themeId);
  if (custom) return custom.palette as unknown as ThemePalette;
  const theme = themeById(settings.themeId) ?? themeById(DEFAULT_THEME_ID);
  // The default is guaranteed present by a test, so this cannot be null in
  // practice; the fallback keeps the types honest rather than asserting.
  return (theme?.palette ?? themeById(DEFAULT_THEME_ID)!.palette) as ThemePalette;
}

/**
 * Apply a palette to the document.
 *
 * Written onto `:root` as the same custom properties the stylesheets already
 * use, so switching theme is a variable swap rather than a re-render -- nothing
 * in the layout has to know a theme exists.
 */
export function applyPalette(palette: ThemePalette): void {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(paletteToCssVars(palette))) {
    root.style.setProperty(name, value);
  }
}

export function useTheme(settings: Settings | undefined): void {
  useEffect(() => {
    if (!settings) return;
    applyPalette(resolvePalette(settings));
  }, [settings?.themeId, settings?.customThemes]);
}

/** A blank custom theme derived from an existing one, for the editor. */
export function deriveCustom(baseId: string, name: string): CustomTheme {
  const base = themeById(baseId) ?? themeById(DEFAULT_THEME_ID)!;
  return {
    // Unique per creation, so saving twice does not overwrite the first.
    id: `custom-${Date.now().toString(36)}`,
    name,
    basedOn: base.id,
    palette: { ...base.palette }
  };
}
