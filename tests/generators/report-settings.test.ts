import { describe, it, expect, afterEach } from "vitest";
import { formatReportSettings, reportSettingsDiffer } from "../../src/generators/report-settings.js";
import { generateTaxReport } from "../../src/generators/report.js";
import { createEmptyStatement } from "../../src/parsers/merge.js";
import { t, setLocale } from "../../src/i18n/index.js";
import type { ReportSettings } from "../../src/types/tax.js";

const BASE: ReportSettings = { monodivisa: false, trackAutoConvert: true, titulares: 1 };

describe("generateTaxReport settings", () => {
  it("records the defaults when no options are given", () => {
    const report = generateTaxReport(createEmptyStatement(), new Map(), 2025);
    expect(report.settings).toEqual(BASE);
  });

  it("records monodivisa, auto-conversions and titulares from the options", () => {
    const report = generateTaxReport(createEmptyStatement(), new Map(), 2025, {
      skipFx: true,
      trackAutoConvert: false,
      titulares: 2,
    });
    expect(report.settings).toEqual({ monodivisa: true, trackAutoConvert: false, titulares: 2 });
  });

  it("records the titulares the amounts were really split by, not an invalid input", () => {
    const report = generateTaxReport(createEmptyStatement(), new Map(), 2025, { titulares: Number.NaN });
    expect(report.settings?.titulares).toBe(1);
  });
});

describe("formatReportSettings", () => {
  afterEach(async () => {
    await setLocale("es");
  });

  it("reads in Spanish", async () => {
    await setLocale("es");
    expect(formatReportSettings({ monodivisa: true, trackAutoConvert: true, titulares: 2 }, t)).toBe(
      "Ajustes del cálculo: monodivisa sí, titulares 2, autoconversiones sí",
    );
  });

  it("follows the active locale", async () => {
    await setLocale("en");
    expect(formatReportSettings({ monodivisa: false, trackAutoConvert: false, titulares: 1 }, t)).toBe(
      "Calculation settings: single-currency no, holders 1, auto-conversions no",
    );
  });

  it("fills every placeholder in all five locales", async () => {
    for (const locale of ["es", "en", "ca", "eu", "gl"] as const) {
      await setLocale(locale);
      expect(formatReportSettings({ monodivisa: true, trackAutoConvert: false, titulares: 3 }, t)).not.toMatch(/\{\{|results\./);
    }
  });
});

describe("reportSettingsDiffer", () => {
  it("is false for the same settings", () => {
    expect(reportSettingsDiffer(BASE, { ...BASE })).toBe(false);
  });

  it("is true when any one setting changes", () => {
    expect(reportSettingsDiffer(BASE, { ...BASE, monodivisa: true })).toBe(true);
    expect(reportSettingsDiffer(BASE, { ...BASE, trackAutoConvert: false })).toBe(true);
    expect(reportSettingsDiffer(BASE, { ...BASE, titulares: 2 })).toBe(true);
  });
});
