import { describe, it, expect, vi, afterEach } from "vitest";
import { setLocale, getCurrentLocale, detectLocale } from "../../src/i18n/index.js";
import type { Locale } from "../../src/i18n/index.js";

describe("setLocale - document dispatch branch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    // Reset locale back to es
    setLocale("es");
  });

  it("should dispatch localechange event when document is available", () => {
    const dispatchSpy = vi.fn();
    vi.stubGlobal("document", {
      documentElement: { lang: "es" },
      dispatchEvent: dispatchSpy,
    });

    setLocale("en");
    expect(getCurrentLocale()).toBe("en");
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
  });

  it("should not throw when document is undefined", () => {
    vi.stubGlobal("document", undefined);
    expect(() => { setLocale("ca"); }).not.toThrow();
    expect(getCurrentLocale()).toBe("ca");
  });

  it("should reject invalid locale", () => {
    setLocale("es");
    setLocale("invalid" as Locale);
    expect(getCurrentLocale()).toBe("es");
  });
});

describe("detectLocale - navigator branches", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should return 'ca' for Catalan navigator language", () => {
    vi.stubGlobal("navigator", { language: "ca-ES" });
    expect(detectLocale()).toBe("ca");
  });

  it("should return 'eu' for Basque navigator language", () => {
    vi.stubGlobal("navigator", { language: "eu-ES" });
    expect(detectLocale()).toBe("eu");
  });

  it("should return 'gl' for Galician navigator language", () => {
    vi.stubGlobal("navigator", { language: "gl-ES" });
    expect(detectLocale()).toBe("gl");
  });

  it("should return 'en' for English navigator language", () => {
    vi.stubGlobal("navigator", { language: "en-US" });
    expect(detectLocale()).toBe("en");
  });

  it("should return 'es' for Spanish navigator language", () => {
    vi.stubGlobal("navigator", { language: "es-ES" });
    expect(detectLocale()).toBe("es");
  });

  it("should return 'es' for unknown language", () => {
    vi.stubGlobal("navigator", { language: "fr-FR" });
    expect(detectLocale()).toBe("es");
  });

  it("should return 'es' when navigator is undefined", () => {
    vi.stubGlobal("navigator", undefined);
    expect(detectLocale()).toBe("es");
  });
});
