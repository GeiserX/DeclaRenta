// @vitest-environment jsdom
/**
 * Only Spanish ships in the entry bundle. en, ca, eu and gl load on demand, and
 * a switch waits for its table so t() never mixes a half-loaded locale.
 *
 * Each non-Spanish locale module is wrapped by a mock that records when it is
 * evaluated. A static import would evaluate all four as soon as the i18n module
 * loads, which is what the first test rules out.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

type I18n = typeof import("../../src/i18n/index.js");

const LAZY = ["en", "ca", "eu", "gl"] as const;
let loaded: string[] = [];

async function freshI18n(failing: string[] = []): Promise<I18n> {
  vi.resetModules();
  loaded = [];
  for (const l of LAZY) {
    vi.doMock(`../../src/i18n/locales/${l}.js`, async () => {
      if (failing.includes(l)) throw new Error(`chunk for ${l} failed to load`);
      loaded.push(l);
      return vi.importActual(`../../src/i18n/locales/${l}.js`);
    });
  }
  return import("../../src/i18n/index.js");
}

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, val: string) => { store.set(key, val); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    get length() { return store.size; },
    key: (i: number) => [...store.keys()][i] ?? null,
  };
}

describe("locales load on demand", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const l of LAZY) vi.doUnmock(`../../src/i18n/locales/${l}.js`);
  });

  it("loading the i18n module does not load any non-Spanish table", async () => {
    const i18n = await freshI18n();
    expect(i18n.t("app.subtitle")).toBe("Broker extranjero → Renta española");
    expect(loaded).toEqual([]);
  });

  it("setLocale('eu') keeps Spanish until Basque has loaded, then switches", async () => {
    const i18n = await freshI18n();
    const switching = i18n.setLocale("eu");
    // Before the table arrives, the previous locale (es) stays in force.
    expect(i18n.getCurrentLocale()).toBe("es");
    expect(i18n.t("app.subtitle")).toBe("Broker extranjero → Renta española");
    await switching;
    expect(i18n.getCurrentLocale()).toBe("eu");
    expect(i18n.t("app.subtitle")).toBe("Atzerriko brokerra → Espainiako errenta");
    expect(loaded).toEqual(["eu"]);
  });

  it("localechange fires only after the new table is in place", async () => {
    const i18n = await freshI18n();
    const seen: string[] = [];
    const listener = () => { seen.push(i18n.t("app.subtitle")); };
    document.addEventListener("localechange", listener);
    try {
      await i18n.setLocale("ca");
    } finally {
      document.removeEventListener("localechange", listener);
    }
    expect(seen).toEqual(["Broker estranger → Renda espanyola"]);
  });

  it("initLocale waits for the saved locale before resolving", async () => {
    vi.stubGlobal("localStorage", memoryStorage({ locale: "gl" }));
    const i18n = await freshI18n();
    await i18n.initLocale();
    expect(i18n.getCurrentLocale()).toBe("gl");
    expect(loaded).toEqual(["gl"]);
    expect(i18n.t("app.subtitle")).not.toBe("Broker extranjero → Renta española");
  });

  it("when the saved locale cannot load, initLocale falls back to Spanish instead of failing", async () => {
    vi.stubGlobal("localStorage", memoryStorage({ locale: "gl" }));
    const i18n = await freshI18n(["gl"]);
    await expect(i18n.initLocale()).resolves.toBeUndefined();
    expect(i18n.getCurrentLocale()).toBe("es");
    expect(i18n.t("app.subtitle")).toBe("Broker extranjero → Renta española");
  });

  it("a failed switch rejects and leaves the previous locale active", async () => {
    const i18n = await freshI18n(["eu"]);
    await i18n.setLocale("en");
    await expect(i18n.setLocale("eu")).rejects.toThrow();
    expect(i18n.getCurrentLocale()).toBe("en");
    expect(i18n.t("app.subtitle")).toBe("Foreign broker → Spanish tax return");
  });

  it("two quick switches end on the last one chosen", async () => {
    const i18n = await freshI18n();
    const first = i18n.setLocale("en");
    const second = i18n.setLocale("eu");
    await Promise.all([first, second]);
    expect(i18n.getCurrentLocale()).toBe("eu");
  });
});
