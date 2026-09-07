import type { JSX } from 'react';
import { useMemo, useState } from 'react';
import type { CustomTheme, Settings } from '../shared/types.js';
import {
  THEMES,
  type Theme,
  type ThemeGroup,
  type ThemePalette,
  themeById,
  themesByGroup
} from '../shared/themes.js';
import { deriveCustom, applyPalette, resolvePalette } from './useTheme.js';

const GROUPS: { id: ThemeGroup; label: string }[] = [
  { id: 'essential', label: 'Essential' },
  { id: 'soft', label: 'Soft' },
  { id: 'nature', label: 'Nature' },
  { id: 'vivid', label: 'Vivid' },
  { id: 'retro', label: 'Retro' },
  { id: 'pro', label: 'Pro' }
];

/**
 * The theme library, plus an editor for building one of your own.
 *
 * Every swatch is drawn from the theme's *own* palette rather than a static
 * image, so a card is always an honest preview of what applying it does -- and
 * a custom theme previews identically to a built-in one.
 */
export function ThemePicker({
  settings,
  onChange
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}): JSX.Element {
  const [group, setGroup] = useState<ThemeGroup | 'custom'>('essential');
  const [editing, setEditing] = useState<CustomTheme | null>(null);

  const shown = useMemo(() => (group === 'custom' ? [] : themesByGroup(group)), [group]);
  const customs = settings.customThemes;

  const apply = (id: string): void => onChange({ themeId: id });

  const startEditor = (): void => {
    const base = themeById(settings.themeId) ?? THEMES[0]!;
    setEditing(deriveCustom(base.id, `My ${base.name}`));
  };

  const saveCustom = (theme: CustomTheme): void => {
    // Replace when re-saving an existing one, append when it is new, so editing
    // twice does not leave two copies in the list.
    const others = settings.customThemes.filter((t) => t.id !== theme.id);
    onChange({ customThemes: [...others, theme], themeId: theme.id });
    setEditing(null);
  };

  const removeCustom = (id: string): void => {
    const remaining = settings.customThemes.filter((t) => t.id !== id);
    onChange({
      customThemes: remaining,
      // Never leave the app pointing at a theme that no longer exists.
      themeId: settings.themeId === id ? 'toki-dark' : settings.themeId
    });
  };

  if (editing) {
    return (
      <ThemeEditor
        theme={editing}
        settings={settings}
        onCancel={() => {
          setEditing(null);
          // Undo the live preview.
          applyPalette(resolvePalette(settings));
        }}
        onSave={saveCustom}
      />
    );
  }

  return (
    <div className="themes">
      <div className="themes__tabs">
        {GROUPS.map((g) => (
          <button
            key={g.id}
            type="button"
            className={`chip${group === g.id ? ' chip--on' : ''}`}
            onClick={() => setGroup(g.id)}
          >
            {g.label}
          </button>
        ))}
        <button
          type="button"
          className={`chip${group === 'custom' ? ' chip--on' : ''}`}
          onClick={() => setGroup('custom')}
        >
          Mine{customs.length > 0 ? ` (${customs.length})` : ''}
        </button>
      </div>

      <div className="themes__grid">
        {group === 'custom' ? (
          customs.length === 0 ? (
            <p className="themes__empty">
              Nothing saved yet. Build one from any theme and it appears here.
            </p>
          ) : (
            customs.map((theme) => (
              <ThemeCard
                key={theme.id}
                id={theme.id}
                name={theme.name}
                blurb={`Based on ${themeById(theme.basedOn)?.name ?? 'a theme'}`}
                palette={theme.palette as unknown as ThemePalette}
                active={settings.themeId === theme.id}
                onApply={() => apply(theme.id)}
                onEdit={() => setEditing(theme)}
                onRemove={() => removeCustom(theme.id)}
              />
            ))
          )
        ) : (
          shown.map((theme: Theme) => (
            <ThemeCard
              key={theme.id}
              id={theme.id}
              name={theme.name}
              blurb={theme.blurb}
              palette={theme.palette}
              active={settings.themeId === theme.id}
              onApply={() => apply(theme.id)}
            />
          ))
        )}
      </div>

      <button type="button" className="btn" onClick={startEditor}>
        Make my own
      </button>
    </div>
  );
}

function ThemeCard({
  name,
  blurb,
  palette,
  active,
  onApply,
  onEdit,
  onRemove
}: {
  id: string;
  name: string;
  blurb: string;
  palette: ThemePalette;
  active: boolean;
  onApply: () => void;
  onEdit?: () => void;
  onRemove?: () => void;
}): JSX.Element {
  return (
    <div className={`tcard${active ? ' tcard--on' : ''}`}>
      <button
        type="button"
        className="tcard__preview"
        onClick={onApply}
        // The preview is the theme's own palette, so it cannot drift from what
        // applying it actually does.
        style={{ background: palette.surfaceSolid, borderColor: palette.hairlineStrong }}
        aria-label={`Use the ${name} theme`}
      >
        <span className="tcard__rings">
          {[palette.ample, palette.watch, palette.critical].map((colour, i) => (
            <span key={i} className="tcard__ring" style={{ borderColor: palette.track }}>
              <span
                className="tcard__arc"
                style={{ borderColor: colour, transform: `rotate(${[40, 150, 250][i]}deg)` }}
              />
            </span>
          ))}
        </span>
        <span className="tcard__bar" style={{ background: palette.accent }} />
        <span className="tcard__line" style={{ background: palette.muted }} />
      </button>
      <div className="tcard__meta">
        <span className="tcard__name" title={blurb}>
          {name}
        </span>
        {onEdit && (
          <button type="button" className="link link--tiny" onClick={onEdit}>
            Edit
          </button>
        )}
        {onRemove && (
          <button type="button" className="link link--tiny link--danger" onClick={onRemove}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

/** Which palette entries are worth exposing; the rest follow from them. */
const EDITABLE: { key: keyof ThemePalette; label: string; hint: string }[] = [
  { key: 'accent', label: 'Accent', hint: 'Switches, links, highlights' },
  { key: 'surfaceSolid', label: 'Background', hint: 'The panel behind everything' },
  { key: 'text', label: 'Text', hint: 'Primary text' },
  { key: 'muted', label: 'Secondary text', hint: 'Labels and captions' },
  { key: 'ample', label: 'Plenty left', hint: 'Under half your limit used' },
  { key: 'watch', label: 'Getting close', hint: 'Half to seventy percent' },
  { key: 'critical', label: 'Nearly out', hint: 'Past seventy percent' },
  { key: 'track', label: 'Ring track', hint: 'The unfilled part of a ring' }
];

function ThemeEditor({
  theme,
  settings,
  onCancel,
  onSave
}: {
  theme: CustomTheme;
  settings: Settings;
  onCancel: () => void;
  onSave: (theme: CustomTheme) => void;
}): JSX.Element {
  const [draft, setDraft] = useState<CustomTheme>(theme);

  /**
   * Editing previews live.
   *
   * The panel behind the editor *is* the preview, so a colour is judged in
   * place rather than from a swatch -- which is the only way to tell whether
   * text is actually readable on it.
   */
  const update = (key: keyof ThemePalette, value: string): void => {
    const palette = { ...draft.palette, [key]: value };
    // The translucent surfaces follow the solid one, so a custom theme can
    // never end up see-through -- which on Windows means desktop text bleeding
    // through the notch.
    if (key === 'surfaceSolid') {
      const rgb = hexToRgb(value);
      if (rgb) {
        palette.surface = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.97)`;
        palette.card = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.985)`;
        palette.ink = value;
      }
    }
    const next = { ...draft, palette };
    setDraft(next);
    applyPalette(next.palette as unknown as ThemePalette);
  };

  return (
    <div className="editor">
      <div className="editor__head">
        <input
          className="editor__name"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="Name your theme"
          maxLength={40}
        />
        <div className="editor__actions">
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            disabled={draft.name.trim().length === 0}
            onClick={() => onSave({ ...draft, name: draft.name.trim() })}
          >
            Save theme
          </button>
        </div>
      </div>

      <p className="editor__lead">
        Changes preview here as you make them. Based on{' '}
        {themeById(draft.basedOn)?.name ?? 'a theme'}.
      </p>

      <ul className="editor__list">
        {EDITABLE.map((entry) => {
          const value = String(draft.palette[entry.key] ?? '#000000');
          return (
            <li key={entry.key} className="editor__row">
              <div className="row__body">
                <span className="row__title">{entry.label}</span>
                <span className="row__note">{entry.hint}</span>
              </div>
              <input
                type="color"
                className="editor__swatch"
                value={normaliseHex(value)}
                onChange={(e) => update(entry.key, e.target.value)}
                aria-label={entry.label}
              />
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        className="link"
        onClick={() => {
          const base = themeById(draft.basedOn);
          if (!base) return;
          const reset = { ...draft, palette: { ...base.palette } };
          setDraft(reset);
          applyPalette(base.palette);
        }}
      >
        Reset to {themeById(draft.basedOn)?.name ?? 'the original'}
      </button>
      <span className="editor__hint">Cancelling restores {resolveName(settings)}.</span>
    </div>
  );
}

function resolveName(settings: Settings): string {
  const custom = settings.customThemes.find((t) => t.id === settings.themeId);
  return custom?.name ?? themeById(settings.themeId)?.name ?? 'your theme';
}

/** `<input type="color">` only accepts `#rrggbb`, never rgba or shorthand. */
function normaliseHex(value: string): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (hex) return value.trim();
  const short = /^#([0-9a-f]{3})$/i.exec(value.trim());
  if (short) {
    const [r, g, b] = short[1]!.split('');
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  const rgb = hexToRgb(value);
  if (rgb) return `#${[rgb.r, rgb.g, rgb.b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  return '#000000';
}

function hexToRgb(value: string): { r: number; g: number; b: number } | null {
  const hex = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  const rgba = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value);
  if (rgba) return { r: Number(rgba[1]), g: Number(rgba[2]), b: Number(rgba[3]) };
  return null;
}
