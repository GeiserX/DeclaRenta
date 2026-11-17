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

  it("records traditionalFx only for «Tradicional con divisa»", () => {
    const report = generateTaxReport(createEmptyStatement(), new Map(), 2025, { traditionalFx: true });
    expect(report.settings).toEqual({ ...BASE, traditionalFx: true });
  });
});

describe("formatReportSettings", () => {
  afterEach(async () => {
    await setLocale("es");
  });

  it("reads in Spanish", async () => {
    await setLocale("es");
    expect(formatReportSettings({ monodivisa: true, trackAutoConvert: true, titulares: 2 }, t)).toBe(
      "Ajustes del cálculo: método Tradicional sin divisa (monodivisa), titulares 2, autoconversiones sí",
    );
    expect(formatReportSettings({ ...BASE, traditionalFx: true }, t)).toBe(
      "Ajustes del cálculo: método Tradicional con divisa, titulares 1, autoconversiones sí",
    );
    expect(formatReportSettings(BASE, t)).toBe(
      "Ajustes del cálculo: método Criterio DGT (multidivisa), titulares 1, autoconversiones sí",
    );
  });

  it("follows the active locale", async () => {
    await setLocale("en");
    expect(formatReportSettings({ monodivisa: false, trackAutoConvert: false, titulares: 1 }, t)).toBe(
      "Calculation settings: method DGT criterion (multi-currency), holders 1, auto-conversions no",
    );
  });

  it("fills every placeholder in all five locales", async () => {
    for (const locale of ["es", "en", "ca", "eu", "gl"] as const) {
      await setLocale(locale);
      for (const s of [{ ...BASE }, { ...BASE, traditionalFx: true as const }, { ...BASE, monodivisa: true }]) {
        expect(formatReportSettings({ ...s, trackAutoConvert: false, titulares: 3 }, t)).not.toMatch(/\{\{|results\.|report\./);
      }
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
    expect(reportSettingsDiffer(BASE, { ...BASE, traditionalFx: true })).toBe(true);
  });

  it("compares the method, so a stray traditionalFx under monodivisa is still monodivisa", () => {
    const mono = { ...BASE, monodivisa: true };
    expect(reportSettingsDiffer(mono, { ...mono, traditionalFx: true })).toBe(false);
  });
});
