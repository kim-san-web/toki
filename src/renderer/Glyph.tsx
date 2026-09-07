import type { JSX } from 'react';
import type { ProviderGlyph } from '../shared/types.js';

/**
 * Each provider's mark, drawn as a single filled path in `currentColor`.
 *
 * Traced into one 24-unit box each and optically scaled: boxes of equal size
 * are not marks of equal size, and the eye reads the mark. A spark's corners
 * are mostly empty, so at the same box size it reads smaller than a solid knot.
 */
const OPTICAL_SCALE: Record<ProviderGlyph, number> = {
  claude: 0.97,
  openai: 0.94,
  cursor: 0.97,
  glm: 0.95,
  generic: 1
};

const PATHS: Record<ProviderGlyph, string> = {
  // Anthropic's burst: a clean radial star, nothing else. An earlier version
  // carried two bars under it that read as a rendering artefact at 17px.
  claude:
    'M12 1.9l1.62 6.05 4.43-4.43-2.6 5.62 6.05-1.62-5.4 3.1 5.4 3.1-6.05-1.62 2.6 5.62-4.43-4.43L12 22.1l-1.62-6.05-4.43 4.43 2.6-5.62-6.05 1.62 5.4-3.1-5.4-3.1 6.05 1.62-2.6-5.62 4.43 4.43z',
  // OpenAI reads as a rounded six-petal knot -- deliberately curved, so it can
  // never be mistaken for Cursor's hard-edged cube beside it.
  openai:
    'M12 2.3c2.1 0 3.9 1.2 4.8 2.9 1.9-.2 3.9.7 4.9 2.5 1.05 1.82.83 4-.35 5.6.75 1.78.4 3.92-1 5.32-1.4 1.4-3.54 1.75-5.32 1-1.6 1.18-3.78 1.4-5.6.35-1.8-1-2.7-3-2.5-4.9C5.2 14.2 4 12.4 4 10.3c0-2.1 1.2-3.9 2.9-4.8.9-1.9 2.9-3.2 5.1-3.2zm0 2.2a3.4 3.4 0 00-3.3 2.5l-.2.75-.75.2A3.4 3.4 0 006.2 11a3.4 3.4 0 001.5 2.8l.65.44-.06.78a3.4 3.4 0 003.32 3.66 3.4 3.4 0 002.8-1.5l.44-.65.78.06a3.4 3.4 0 003.6-4.55l-.26-.74.5-.6a3.4 3.4 0 00-2.3-5.56l-.78-.06-.44-.65A3.4 3.4 0 0012 4.5zm0 3.4a3.4 3.4 0 110 6.8 3.4 3.4 0 010-6.8z',
  // Cursor's cube: an isometric solid with a visible top face, so its
  // silhouette differs from the knot even at glyph size.
  cursor: 'M12 1.9l9 5.2v9.8l-9 5.2-9-5.2V7.1zm0 2.36L5.35 8.1 12 11.94l6.65-3.84zm-7.1 5.55v6.75L10.9 20V13.2zm14.2 0L13.1 13.2V20l5.99-3.44z',
  // Z.ai's Z in a rounded field.
  glm: 'M4.6 2.4h14.8a2.2 2.2 0 012.2 2.2v14.8a2.2 2.2 0 01-2.2 2.2H4.6a2.2 2.2 0 01-2.2-2.2V4.6a2.2 2.2 0 012.2-2.2zm2.6 4.3v2.2h6.5l-6.8 6.6v2.2h10v-2.2h-6.6l6.8-6.6V6.7z',
  generic: 'M12 2.6a9.4 9.4 0 110 18.8 9.4 9.4 0 010-18.8zm0 2.2a7.2 7.2 0 100 14.4 7.2 7.2 0 000-14.4z'
};

export function Glyph({ glyph, size = 17 }: { glyph: ProviderGlyph; size?: number }): JSX.Element {
  const scale = OPTICAL_SCALE[glyph] ?? 1;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <g transform={`translate(12 12) scale(${scale}) translate(-12 -12)`}>
        <path d={PATHS[glyph] ?? PATHS.generic} fill="currentColor" fillRule="evenodd" />
      </g>
    </svg>
  );
}

/**
 * The TOKI mark.
 *
 * Two cuts of the same logo, because the full one does not survive being small:
 * at the ~13px the resting pill uses, the ring's stroke, its gap and the
 * capsule crossing it all land within a pixel of each other and merge into a
 * blob. Below `SIMPLIFY_BELOW` the ring is dropped and the two elements that
 * still read at that size — the capsule and the accent dot — carry the mark.
 */
const SIMPLIFY_BELOW = 20;

export function TokiMark({ size = 18 }: { size?: number }): JSX.Element {
  if (size < SIMPLIFY_BELOW) {
    return (
      <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true">
        <rect x="6" y="36" width="74" height="28" rx="14" fill="currentColor" />
        <circle cx="86" cy="21" r="10" fill="var(--toki-accent)" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <path d="M35.5 27.3A30 30 0 0023.1 44" stroke="var(--toki-grey)" strokeWidth="9" strokeLinecap="round" />
      <path
        d="M23.1 44a30 30 0 0053.4 21.9M63.4 25.4A30 30 0 0135.5 27.3"
        stroke="currentColor"
        strokeWidth="9"
        strokeLinecap="round"
      />
      <rect x="5" y="39.4" width="63" height="25.2" rx="12.6" fill="currentColor" />
      <circle cx="82" cy="19" r="7.4" fill="var(--toki-accent)" />
    </svg>
  );
}
