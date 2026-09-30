/**
 * WCAG 2.x contrast helpers (pure, no DOM).
 *
 * Used by the tax-bracket bar to pick a readable label colour for each band,
 * and by tests/web/contrast.test.ts to hold the theme tokens in style.css to
 * WCAG AA (4.5:1 for normal-size text).
 */

/** Minimum contrast ratio for normal-size text under WCAG AA. */
export const WCAG_AA_TEXT = 4.5;

/** Dark label colour, the light theme's --text. */
export const DARK_LABEL = "#1a202c";
/** Light label colour. */
export const LIGHT_LABEL = "#ffffff";

type Rgb = [number, number, number];

/** Parse `#rgb` or `#rrggbb` into 0-255 channels. */
export function parseHex(hex: string): Rgb {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`Invalid hex colour: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

function toHex(rgb: Rgb): string {
  return "#" + rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("");
}

/** Relative luminance per WCAG 2.x. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two colours, from 1 to 21. Order does not matter. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Resolve a CSS colour (`#hex` or `rgba(r, g, b, a)`) painted over an opaque
 * backdrop into the opaque hex colour the eye actually sees.
 */
export function compositeOver(color: string, backdrop: string): string {
  const m = color.trim().match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (!m) return toHex(parseHex(color));
  const fg = [Number(m[1]), Number(m[2]), Number(m[3])];
  const alpha = m[4] === undefined ? 1 : Number(m[4]);
  const bg = parseHex(backdrop);
  return toHex(fg.map((c, i) => alpha * c + (1 - alpha) * bg[i]!) as Rgb);
}

/** Pick the dark or light label colour, whichever reads better on `background`. */
export function readableTextOn(background: string): string {
  return contrastRatio(DARK_LABEL, background) >= contrastRatio(LIGHT_LABEL, background) ? DARK_LABEL : LIGHT_LABEL;
}
