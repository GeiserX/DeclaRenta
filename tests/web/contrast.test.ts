/**
 * WCAG AA contrast for the theme text tokens and the tax-bracket labels.
 *
 * Reads the four theme blocks straight out of src/web/style.css (dark default,
 * light via prefers-color-scheme, and the two explicit [data-theme] overrides)
 * so a future token edit that drops a text colour below 4.5:1 fails here.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  WCAG_AA_TEXT,
  DARK_LABEL,
  LIGHT_LABEL,
  parseHex,
  relativeLuminance,
  contrastRatio,
  compositeOver,
  readableTextOn,
} from "../../src/web/contrast.js";
import { BRACKET_COLORS, renderTaxBracketCard } from "../../src/web/charts.js";

const css = readFileSync(resolve(__dirname, "../../src/web/style.css"), "utf8");

/** Parse the `--name: value;` declarations of the first block opened by `selector {`. */
function themeBlock(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`theme block not found: ${selector}`);
  const body = css.slice(start + selector.length + 2, css.indexOf("}", start));
  const vars: Record<string, string> = {};
  for (const m of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) vars[m[1]!] = m[2]!.trim();
  return vars;
}

const THEMES = {
  "dark (default :root)": themeBlock(":root"),
  "light (prefers-color-scheme)": themeBlock(':root:not([data-theme="dark"])'),
  'light ([data-theme="light"])': themeBlock('[data-theme="light"]'),
  'dark ([data-theme="dark"])': themeBlock('[data-theme="dark"]'),
};

const TEXT_TOKENS = ["text", "muted", "accent", "success", "warning", "danger"];
const BACKGROUNDS = ["bg", "surface", "surface-raised"];

describe("contrast helpers", () => {
  it("parses short and long hex", () => {
    expect(parseHex("#fff")).toEqual([255, 255, 255]);
    expect(parseHex("#1a202c")).toEqual([26, 32, 44]);
    expect(() => parseHex("red")).toThrow();
  });

  it("matches the WCAG reference values", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBe(1);
    expect(contrastRatio("#000000", "#ffffff")).toBe(21);
    expect(contrastRatio("#ffffff", "#000000")).toBe(21);
    // Known sub-AA pair from before this change: old light --success on white.
    expect(contrastRatio("#16a34a", "#ffffff")).toBeCloseTo(3.3, 1);
  });

  it("composites rgba over an opaque backdrop", () => {
    expect(compositeOver("rgba(0, 0, 0, 0.5)", "#ffffff")).toBe("#808080");
    expect(compositeOver("rgba(245, 158, 11, 0)", "#123456")).toBe("#123456");
    expect(compositeOver("#abcdef", "#000000")).toBe("#abcdef");
  });

  it("picks dark text on light fills and white text on dark fills", () => {
    expect(readableTextOn("#ffff00")).toBe(DARK_LABEL);
    expect(readableTextOn("#1e3a8a")).toBe(LIGHT_LABEL);
  });
});

describe("theme text tokens reach WCAG AA", () => {
  it("light and dark blocks are mirrored exactly", () => {
    expect(THEMES['light ([data-theme="light"])']).toEqual(THEMES["light (prefers-color-scheme)"]);
    // The default :root block also carries the layout token --topbar-h.
    const darkDefault = { ...THEMES["dark (default :root)"] };
    delete darkDefault["topbar-h"];
    expect(THEMES['dark ([data-theme="dark"])']).toEqual(darkDefault);
  });

  for (const [theme, vars] of Object.entries(THEMES)) {
    for (const token of TEXT_TOKENS) {
      for (const bg of BACKGROUNDS) {
        it(`${theme}: --${token} on --${bg}`, () => {
          const ratio = contrastRatio(vars[token]!, vars[bg]!);
          expect(ratio, `${vars[token]} on ${vars[bg]} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
        });
      }
    }

    // Warning text is mostly shown inside tinted boxes (.warning, .banner-warning).
    for (const bg of ["bg", "surface"]) {
      it(`${theme}: --warning on --warning-bg over --${bg}`, () => {
        const box = compositeOver(vars["warning-bg"]!, vars[bg]!);
        const ratio = contrastRatio(vars.warning!, box);
        expect(ratio, `${vars.warning!} on ${box} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
      });
    }
  }
});

describe("tax-bracket rate labels", () => {
  it("every band colour has a label colour at WCAG AA", () => {
    for (const color of BRACKET_COLORS) {
      const ratio = contrastRatio(readableTextOn(color), color);
      expect(ratio, `label on ${color} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
    }
  });

  it("renders opaque segments with dark labels on the light bands", () => {
    // 400k spans every 2025 savings band, so all five segments are drawn.
    const html = renderTaxBracketCard("Estimación", 2025, 400_000, 0);
    expect(html).not.toContain('opacity="0.85"');
    expect(html).not.toContain('fill="#fff"');
    for (const color of BRACKET_COLORS.slice(0, 4)) {
      expect(html).toContain(`fill="${color}"`);
    }
    expect(html).toContain(`fill="${DARK_LABEL}"`);
    expect(html).toContain(`fill="${LIGHT_LABEL}"`);
  });
});
