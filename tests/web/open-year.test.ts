/**
 * Tests for src/web/open-year.ts: the Review-step year card and the
 * "ejercicio en curso" banner shown on Results, 720, 721 and D-6 when the
 * chosen year has not ended yet. t() defaults to Spanish without initLocale().
 */

import { describe, expect, it } from "vitest";
import { isYearInProgress, renderOpenYearBanner, renderReviewYearCard } from "../../src/web/open-year.js";

const MAY_2026 = new Date(2026, 4, 15);
const DEC_31_2025 = new Date(2025, 11, 31, 23, 59);

describe("isYearInProgress", () => {
  it("is true for the current calendar year and later ones", () => {
    expect(isYearInProgress(2026, MAY_2026)).toBe(true);
    expect(isYearInProgress(2027, MAY_2026)).toBe(true);
  });

  it("is false for a closed year, even on its last day", () => {
    expect(isYearInProgress(2025, MAY_2026)).toBe(false);
    expect(isYearInProgress(2024, DEC_31_2025)).toBe(false);
    expect(isYearInProgress(2025, DEC_31_2025)).toBe(true);
  });
});

describe("renderOpenYearBanner", () => {
  it("warns that the figures are provisional for the current year", () => {
    const html = renderOpenYearBanner(2026, { today: MAY_2026 });
    expect(html).toContain("banner-warning");
    expect(html).toContain("Ejercicio en curso: 2026 aún no ha terminado");
    expect(html).not.toContain('href="#renta"');
  });

  it("links to the year selector when asked (720/721/D-6)", () => {
    const html = renderOpenYearBanner(2026, { withLink: true, today: MAY_2026 });
    expect(html).toContain('<a href="#renta">Elegir otro ejercicio</a>');
  });

  it("renders nothing for a closed year", () => {
    expect(renderOpenYearBanner(2025, { withLink: true, today: MAY_2026 })).toBe("");
  });
});

describe("renderReviewYearCard", () => {
  it("offers a selector, newest first, when the data covers several years", () => {
    const html = renderReviewYearCard(2026, [2026, 2025], MAY_2026);
    expect(html).toContain('id="review-year-select"');
    expect(html).toMatch(/<option value="2026" selected>2026<\/option><option value="2025">2025<\/option>/);
    expect(html).toContain("Por defecto se elige el más reciente");
  });

  it("tags an open year and leaves a closed one untagged", () => {
    expect(renderReviewYearCard(2026, [2026, 2025], MAY_2026)).toContain('class="review-year-tag">en curso<');
    expect(renderReviewYearCard(2025, [2026, 2025], MAY_2026)).not.toContain("review-year-tag");
  });

  it("shows a plain year with a single-year file", () => {
    const html = renderReviewYearCard(2023, [2023], MAY_2026);
    expect(html).not.toContain("<select");
    expect(html).toContain(">2023</div>");
    expect(html).toContain("Los modelos 100, 720, 721 y D-6 usan este ejercicio.");
  });

  it("keeps a chosen year that is missing from the data selectable", () => {
    const html = renderReviewYearCard(2024, [2026, 2025], MAY_2026);
    expect(html).toContain('<option value="2024" selected>2024</option>');
  });
});
