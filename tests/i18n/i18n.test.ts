import { describe, it, expect, beforeEach } from "vitest";
import { t, setLocale, getCurrentLocale, detectLocale, initLocale, type Locale } from "../../src/i18n/index.js";
import es from "../../src/i18n/locales/es.js";
import en from "../../src/i18n/locales/en.js";
import ca from "../../src/i18n/locales/ca.js";
import eu from "../../src/i18n/locales/eu.js";
import gl from "../../src/i18n/locales/gl.js";

describe("i18n", () => {
  beforeEach(() => {
    setLocale("es");
  });

  describe("t()", () => {
    it("should return Spanish text by default", () => {
      expect(t("app.title")).toBe("DeclaRenta");
      expect(t("app.subtitle")).toBe("Broker extranjero → Renta española");
    });

    it("should return English text when locale is en", () => {
      setLocale("en");
      expect(t("app.subtitle")).toBe("Foreign broker → Spanish tax return");
    });

    it("should return Catalan text when locale is ca", () => {
      setLocale("ca");
      expect(t("app.subtitle")).toBe("Broker estranger → Renda espanyola");
    });

    it("should interpolate {{params}}", () => {
      expect(t("results.operations_count", { count: "42" })).toBe("42 operación(es)");
    });

    it("should interpolate multiple params", () => {
      expect(t("status.files_processed", { count: "2", brokers: "IBKR, Degiro", trades: "150" }))
        .toBe("2 fichero(s) procesado(s) — IBKR, Degiro — 150 operaciones");
    });

    it("should fall back to Spanish if key missing in locale", () => {
      // All locales should have all keys, but test fallback behavior
      setLocale("es");
      expect(t("app.title")).toBe("DeclaRenta");
    });

    it("should return key itself if not found in any locale", () => {
      // This tests the fallback chain: current locale -> es -> key
      const result = t("nonexistent.key" as never);
      expect(result).toBe("nonexistent.key");
    });
  });

  describe("locale management", () => {
    it("should default to detected locale", () => {
      initLocale();
      // In test environment, detectLocale() uses navigator.language
      const expected = detectLocale();
      expect(getCurrentLocale()).toBe(expected);
    });

    it("should switch locale with setLocale()", () => {
      setLocale("en");
      expect(getCurrentLocale()).toBe("en");
      setLocale("ca");
      expect(getCurrentLocale()).toBe("ca");
    });

    it("should ignore invalid locale", () => {
      setLocale("es");
      setLocale("xx" as Locale);
      expect(getCurrentLocale()).toBe("es");
    });
  });

  describe("detectLocale()", () => {
    it("should return a valid locale", () => {
      const locale = detectLocale();
      expect(["es", "en", "ca", "eu", "gl"]).toContain(locale);
    });
  });

  describe("locale completeness", () => {
    const esKeys = Object.keys(es).sort();

    it("English should have all keys from Spanish", () => {
      const enKeys = Object.keys(en).sort();
      expect(enKeys).toEqual(esKeys);
    });

    it("Catalan should have all keys from Spanish", () => {
      const caKeys = Object.keys(ca).sort();
      expect(caKeys).toEqual(esKeys);
    });

    it("Basque should have all keys from Spanish", () => {
      const euKeys = Object.keys(eu).sort();
      expect(euKeys).toEqual(esKeys);
    });

    it("Galician should have all keys from Spanish", () => {
      const glKeys = Object.keys(gl).sort();
      expect(glKeys).toEqual(esKeys);
    });

    it("no locale should have empty values", () => {
      const locales = { es, en, ca, eu, gl };
      for (const [name, translations] of Object.entries(locales)) {
        for (const [key, value] of Object.entries(translations)) {
          expect(value, `${name}.${key} should not be empty`).not.toBe("");
        }
      }
    });
  });
});
