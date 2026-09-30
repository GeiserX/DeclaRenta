/**
 * Tests for the default tax year picked after loading files and the
 * "ejercicio en curso" banner (src/web/year-default.ts).
 *
 * An export pulled in May usually covers last year plus a few months of the
 * current one. The results must open on the year being filed, not on the
 * unfinished current year.
 */

import { describe, expect, it } from "vitest";
import { isOpenYear, pickDefaultYear, renderOpenYearBanner } from "../../src/web/year-default.js";

const MAY_2026 = new Date(2026, 4, 15);

describe("pickDefaultYear", () => {
  it("keeps the saved profile year when the data covers it", () => {
    expect(pickDefaultYear([2026, 2025], 2025, MAY_2026)).toBe(2025);
    // Even an older saved year wins over the last closed year.
    expect(pickDefaultYear([2026, 2025, 2024], 2024, MAY_2026)).toBe(2024);
    // And the current year, when the user chose it explicitly.
    expect(pickDefaultYear([2026, 2025], 2026, MAY_2026)).toBe(2026);
  });

  it("falls back to the last closed year when the saved year is not in the data", () => {
    expect(pickDefaultYear([2026, 2025], 2023, MAY_2026)).toBe(2025);
    expect(pickDefaultYear([2026, 2025], null, MAY_2026)).toBe(2025);
    // Order of the detected years does not matter.
    expect(pickDefaultYear([2024, 2025, 2026], null, MAY_2026)).toBe(2025);
  });

  it("falls back to the newest year when neither the saved nor the last closed year is present", () => {
    expect(pickDefaultYear([2023], 2025, MAY_2026)).toBe(2023);
    expect(pickDefaultYear([2021, 2023, 2022], null, MAY_2026)).toBe(2023);
    // Only the current year in the data: that is the only choice.
    expect(pickDefaultYear([2026], 2025, MAY_2026)).toBe(2026);
  });

  it("keeps the saved year (or the last closed year) when no year was detected", () => {
    expect(pickDefaultYear([], 2024, MAY_2026)).toBe(2024);
    expect(pickDefaultYear([], null, MAY_2026)).toBe(2025);
  });

  it("uses the calendar year of `today`, including 1 January and 31 December", () => {
    expect(pickDefaultYear([2026, 2025], null, new Date(2026, 0, 1))).toBe(2025);
    expect(pickDefaultYear([2026, 2025], null, new Date(2026, 11, 31))).toBe(2025);
    expect(pickDefaultYear([2027, 2026, 2025], null, new Date(2027, 0, 1))).toBe(2026);
  });
});

describe("isOpenYear / renderOpenYearBanner", () => {
  it("flags the current year and any later year as in progress", () => {
    expect(isOpenYear(2026, MAY_2026)).toBe(true);
    expect(isOpenYear(2027, MAY_2026)).toBe(true);
    expect(isOpenYear(2025, MAY_2026)).toBe(false);
    // On 31 December the year is still open; on 1 January it is closed.
    expect(isOpenYear(2026, new Date(2026, 11, 31))).toBe(true);
    expect(isOpenYear(2026, new Date(2027, 0, 1))).toBe(false);
  });

  it("shows a warning banner naming the year when the year is in progress", () => {
    const html = renderOpenYearBanner(2026, MAY_2026);
    expect(html).toContain("banner-warning");
    expect(html).toContain("2026");
    expect(html).toContain("provisionales");
  });

  it("renders nothing for a closed year", () => {
    expect(renderOpenYearBanner(2025, MAY_2026)).toBe("");
  });
});
