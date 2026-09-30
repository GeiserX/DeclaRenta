/**
 * Text contrast in both themes (WCAG 2.1 AA).
 *
 * The status colours (--success, --warning) are bright enough to mark a bar or
 * a border, but on the light theme they sit near 3:1 against white, below the
 * 4.5:1 that body text needs. The design keeps every piece of text in a neutral
 * token (--text, --muted, --accent) and moves the status into a coloured arrow,
 * tick or left border. These tests read style.css and charts.ts output and hold
 * that line: text tokens reach 4.5:1, icon colours reach 3:1, and no text rule
 * paints itself in a status colour.
 */

import { readFileSync } from "fs";
import { describe, it, expect } from "vitest";
import { renderTaxBracketCard } from "../../src/web/charts.js";

const css = readFileSync(new URL("../../src/web/style.css", import.meta.url), "utf-8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

interface Rule { selector: string; body: string }

/** Innermost `selector { declarations }` blocks; @media wrappers are skipped. */
function rules(source: string): Rule[] {
  const out: Rule[] = [];
  for (const m of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ selector: m[1]!.trim(), body: m[2]! });
  }
  return out;
}

function vars(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

function themeVars(selector: string): Record<string, string> {
  const rule = rules(css).find((r) => r.selector === selector);
  if (!rule) throw new Error(`theme block ${selector} not found in style.css`);
  return vars(rule.body);
}

/** WCAG 2.1 relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(m[1]!.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const THEMES = {
  dark: themeVars(":root"),
  light: themeVars('[data-theme="light"]'),
};

describe("WCAG contrast helper", () => {
  it("matches the reference values (black/white 21:1, light --success 3.30:1)", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#16a34a", "#ffffff")).toBeCloseTo(3.3, 2);
  });
});

describe("theme tokens", () => {
  it("the light palette under prefers-color-scheme mirrors the explicit light theme", () => {
    expect(themeVars(':root:not([data-theme="dark"])')).toEqual(THEMES.light);
  });

  for (const [name, v] of Object.entries(THEMES)) {
    for (const token of ["--text", "--muted", "--accent"]) {
      for (const bg of ["--surface", "--bg"]) {
        it(`${name}: text token ${token} reaches 4.5:1 on ${bg}`, () => {
          expect(contrast(v[token]!, v[bg]!)).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
    // Gains, losses and saved ticks are shown as a coloured glyph; WCAG 1.4.11
    // asks 3:1 for graphics.
    for (const token of ["--success", "--danger"]) {
      for (const bg of ["--surface", "--bg"]) {
        it(`${name}: icon colour ${token} reaches 3:1 on ${bg}`, () => {
          expect(contrast(v[token]!, v[bg]!)).toBeGreaterThanOrEqual(3);
        });
      }
    }
  }
});

describe("status colours are never used for text", () => {
  // The copy button in a casilla card holds only an SVG tick (no text), so its
  // green is a graphic, not text.
  const ICON_ONLY = new Set([".casilla-copy.copied"]);

  it("no text rule takes its colour from --success or --warning", () => {
    const offenders = rules(css)
      .filter((r) => /(^|[;\s])color\s*:\s*var\(--(success|warning)/.test(r.body))
      .flatMap((r) => r.selector.split(",").map((s) => s.trim()))
      .filter((sel) => !/::?(before|after)$/.test(sel) && !ICON_ONLY.has(sel));
    expect(offenders).toEqual([]);
  });

  it("gains and losses are neutral text with a coloured arrow", () => {
    const all = rules(css);
    const text = all.find((r) => r.selector.replace(/\s+/g, " ") === ".gain, .loss");
    expect(text?.body).toMatch(/color\s*:\s*var\(--text\)/);
    const gainIcon = all.find((r) => r.selector.includes(".gain::before"));
    expect(gainIcon?.body).toMatch(/color\s*:\s*var\(--success\)/);
    const lossIcon = all.find((r) => r.selector === ".loss::before");
    expect(lossIcon?.body).toMatch(/color\s*:\s*var\(--danger\)/);
  });
});

describe("tax bracket bar labels", () => {
  // 60.000 € of savings base in 2025 spans the 19%, 21% and 23% bands.
  const html = renderTaxBracketCard("Tramos", 2025, 60000, 0);
  const svg = html.slice(html.indexOf("<svg"), html.indexOf("</svg>"));
  const labels = [...svg.matchAll(/<text([^>]*)>([^<]*)<\/text>/g)];

  it("renders a rate label for each wide segment", () => {
    expect(labels.map((l) => l[2])).toEqual(["19%", "21%", "23%"]);
  });

  it("draws the labels in the theme text colour, never white on the fill", () => {
    for (const [, attrs] of labels) {
      expect(attrs).toContain('fill="var(--text)"');
      expect(attrs).not.toContain('fill="#fff"');
    }
  });

  it("places the labels under the bar, not on the coloured segment", () => {
    const rect = /<rect[^>]*y="([\d.]+)"[^>]*height="([\d.]+)"/.exec(svg)!;
    const barBottom = Number(rect[1]) + Number(rect[2]);
    for (const [, attrs] of labels) {
      const y = Number(/\sy="([\d.]+)"/.exec(attrs!)![1]);
      expect(y).toBeGreaterThan(barBottom);
    }
  });
});
