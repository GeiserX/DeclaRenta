/**
 * Tests for src/web/year-default.ts: the tax year the app opens on after files
 * load, and the one-line notice when the data also covers later years.
 */

import { afterEach, describe, expect, it } from "vitest";
import { newerYears, pickDefaultYear, renderNewerYearsNotice } from "../../src/web/year-default.js";
import { setLocale } from "../../src/i18n/index.js";

const MAY_2026 = new Date(2026, 4, 15);

describe("pickDefaultYear", () => {
  it("opens on the last closed year when the data also covers the current year", () => {
    expect(pickDefaultYear([2026, 2025], MAY_2026)).toBe(2025);
    expect(pickDefaultYear([2024, 2025, 2026], MAY_2026)).toBe(2025);
  });

  it("does not depend on the order of the detected years", () => {
    expect(pickDefaultYear([2025, 2026], MAY_2026)).toBe(2025);
  });

  it("opens on the only year present", () => {
    expect(pickDefaultYear([2023], MAY_2026)).toBe(2023);
  });

  it("falls back to the newest closed year when the last closed year is missing", () => {
    expect(pickDefaultYear([2026, 2024], MAY_2026)).toBe(2024);
    expect(pickDefaultYear([2022, 2023], MAY_2026)).toBe(2023);
  });

  it("opens on the current year when the data covers no closed year", () => {
    expect(pickDefaultYear([2026], MAY_2026)).toBe(2026);
  });

  it("falls back to the last closed year when no year was detected", () => {
    expect(pickDefaultYear([], MAY_2026)).toBe(2025);
  });

  it("follows the calendar: in January the year that just ended is the last closed one", () => {
    expect(pickDefaultYear([2027, 2026, 2025], new Date(2027, 0, 5))).toBe(2026);
  });
});

describe("newerYears", () => {
  it("lists only the years after the shown one, ascending", () => {
    expect(newerYears([2026, 2024, 2025, 2027], 2025)).toEqual([2026, 2027]);
    expect(newerYears([2026, 2025], 2026)).toEqual([]);
  });
});

describe("renderNewerYearsNotice", () => {
  afterEach(async () => {
    await setLocale("es");
  });

  it("says which later years the data covers", async () => {
    await setLocale("es");
    const html = renderNewerYearsNotice([2026, 2025, 2024], 2025);
    expect(html).toContain("Mostrando 2025; tus datos también cubren 2026.");
    expect(html).toContain("banner-info");
    expect(html).not.toContain("2024");
  });

  it("lists several later years", async () => {
    await setLocale("es");
    expect(renderNewerYearsNotice([2024, 2025, 2026], 2024)).toContain("también cubren 2025, 2026.");
  });

  it("is empty when no later year is present", () => {
    expect(renderNewerYearsNotice([2026, 2025], 2026)).toBe("");
    expect(renderNewerYearsNotice([], 2025)).toBe("");
  });

  it("is translated", async () => {
    await setLocale("en");
    expect(renderNewerYearsNotice([2026, 2025], 2025)).toContain("Showing 2025; your data also covers 2026.");
  });
});
