/**
 * WCAG AA text contrast for the theme tokens and the tax-bracket labels.
 *
 * The status colours (--success, --warning, --danger, --accent) stay as they
 * are for fills and bars. Text uses the separate --*-text tokens, which must
 * reach 4.5:1 (WCAG 2.x AA, normal text) on every background token in both
 * themes. The test reads style.css directly so a future token edit that drops
 * below AA fails here.
 */

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { BRACKET_COLORS, BRACKET_LABEL_COLOR, renderTaxBracketCard } from "../../src/web/charts.js";

const css = readFileSync(new URL("../../src/web/style.css", import.meta.url), "utf-8");

type Rgb = [number, number, number];

function parseColor(value: string): { rgb: Rgb; alpha: number } {
  const v = value.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const n = hex[1]!;
    return { rgb: [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16)) as Rgb, alpha: 1 };
  }
  const rgba = /^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)$/.exec(v);
  if (rgba) {
    return { rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])], alpha: Number(rgba[4]) };
  }
  throw new Error(`unsupported colour: ${value}`);
}

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.x contrast ratio between two opaque colours. */
function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Composite a translucent colour over an opaque background. */
function over(fg: { rgb: Rgb; alpha: number }, bg: Rgb): Rgb {
  return fg.rgb.map((c, i) => c * fg.alpha + bg[i]! * (1 - fg.alpha)) as Rgb;
}

/** Custom properties declared in the first block opened by `selector`. */
function themeVars(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`theme block not found: ${selector}`);
  const body = css.slice(start, css.indexOf("}", start));
  const vars: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) vars[m[1]!] = m[2]!.trim();
  return vars;
}

const THEMES = {
  "dark (default :root)": themeVars(":root"),
  "light (prefers-color-scheme)": themeVars(':root:not([data-theme="dark"])'),
  'light ([data-theme="light"])': themeVars('\n[data-theme="light"]'),
  'dark ([data-theme="dark"])': themeVars('\n[data-theme="dark"]'),
};

const TEXT_TOKENS = ["--text", "--muted", "--success-text", "--warning-text", "--danger-text", "--accent-text"];
const BACKGROUNDS = ["--bg", "--surface", "--surface-raised"];
const AA = 4.5;

describe("theme text contrast (WCAG AA)", () => {
  for (const [name, vars] of Object.entries(THEMES)) {
    for (const text of TEXT_TOKENS) {
      for (const bg of BACKGROUNDS) {
        it(`${name}: ${text} on ${bg} >= 4.5:1`, () => {
          expect(vars[text], `${text} missing in ${name}`).toBeDefined();
          const ratio = contrast(parseColor(vars[text]!).rgb, parseColor(vars[bg]!).rgb);
          expect(ratio).toBeGreaterThanOrEqual(AA);
        });
      }
    }

    for (const fill of ["--accent-fill", "--accent-fill-hover", "--success-fill"]) {
      it(`${name}: white text on ${fill} >= 4.5:1`, () => {
        expect(vars[fill], `${fill} missing in ${name}`).toBeDefined();
        expect(contrast([255, 255, 255], parseColor(vars[fill]!).rgb)).toBeGreaterThanOrEqual(AA);
      });
    }

    it(`${name}: --warning-text on the warning banner background >= 4.5:1`, () => {
      const banner = over(parseColor(vars["--warning-bg"]!), parseColor(vars["--surface"]!).rgb);
      expect(contrast(parseColor(vars["--warning-text"]!).rgb, banner)).toBeGreaterThanOrEqual(AA);
    });
  }

  it("the prefers-color-scheme light block mirrors the explicit light theme", () => {
    expect(THEMES["light (prefers-color-scheme)"]).toEqual(THEMES['light ([data-theme="light"])']);
  });

  it("the default :root mirrors the explicit dark theme", () => {
    const rootColours = { ...THEMES["dark (default :root)"] };
    delete rootColours["--topbar-h"];
    expect(rootColours).toEqual(THEMES['dark ([data-theme="dark"])']);
  });

  it("white text only sits on the --*-fill tokens, never on the raw status colours", () => {
    const offenders: string[] = [];
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const body = m[2]!;
      if (!/(^|[\s;])color:\s*(white|#fff\b|#ffffff)/i.test(body)) continue;
      if (/background(-color)?:[^;]*var\(--(accent|accent-hover|success|warning|danger)\)/.test(body)) offenders.push(m[1]!.trim());
    }
    expect(offenders).toEqual([]);
  });

  it("text never uses the fill tokens directly (only the --*-text variants)", () => {
    const offenders = css.match(/(^|[\s;{])color:\s*var\(--(success|warning|danger|accent)[,)]/gm) ?? [];
    expect(offenders).toEqual([]);
  });
});

describe("tax bracket rate labels (WCAG AA)", () => {
  for (const fill of BRACKET_COLORS) {
    it(`label on ${fill} >= 4.5:1`, () => {
      expect(contrast(parseColor(BRACKET_LABEL_COLOR).rgb, parseColor(fill).rgb)).toBeGreaterThanOrEqual(AA);
    });
  }

  it("renders every label in the AA colour on fully opaque segments", () => {
    // A base large enough to fill every 2025 band, so each band gets a segment.
    const html = renderTaxBracketCard("Estimación", 2025, 2_000_000, 0);
    const labels = [...html.matchAll(/<text [^>]*text-anchor="middle" fill="([^"]+)" font-size="10"/g)];
    expect(labels.length).toBeGreaterThan(0);
    for (const m of labels) expect(m[1]).toBe(BRACKET_LABEL_COLOR);
    const segments = [...html.matchAll(/<rect [^>]*fill="(#[0-9a-f]{6})"[^>]*\/>/gi)];
    expect(segments.length).toBe(BRACKET_COLORS.length);
    for (const s of segments) expect(s[0]).not.toMatch(/opacity=/);
  });
});
