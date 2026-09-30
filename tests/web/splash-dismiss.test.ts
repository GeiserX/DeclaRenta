// @vitest-environment jsdom
/**
 * The splash's "start" button must always hand over to the app.
 *
 * Dismissal used to wait only for the exit animation's animationend event. A
 * browser that does not run the animation (reduced motion, a hidden tab, headless
 * Chrome under CI load) never fires it, so the splash stayed on screen and the
 * mobile-width e2e test timed out waiting for it. jsdom runs no animations, so
 * it reproduces that browser exactly.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const INDEX_HTML = readFileSync(resolve(__dirname, "../../src/web/index.html"), "utf-8");

function memoryStorage(): Storage {
  const store = new Map<string, string>();
  const storage: Storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, val: string) => {
      store.set(key, val);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
  return storage;
}

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("__APP_VERSION__", "test");
  vi.stubGlobal("__COMMIT_HASH__", "test");
  document.documentElement.innerHTML = new DOMParser().parseFromString(INDEX_HTML, "text/html").documentElement.innerHTML;
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal("fetch", () => Promise.reject(new Error("no network in tests")));
  await import("../../src/web/main.js");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("splash dismissal", () => {
  it("shows the app after the start click even when the exit animation never ends", async () => {
    expect(document.body.classList.contains("splash-visible")).toBe(true);
    document.getElementById("splash-cta")!.click();
    // No animationend is dispatched here, as in a browser that skips the animation.
    await new Promise((r) => setTimeout(r, 800));
    expect(document.body.classList.contains("splash-visible")).toBe(false);
    expect((document.getElementById("splash") as HTMLElement).style.display).toBe("none");
  });

  it("finishes at once when the animation does end, and only once", () => {
    const splash = document.getElementById("splash")!;
    document.getElementById("splash-cta")!.click();
    splash.dispatchEvent(new Event("animationend"));
    expect(document.body.classList.contains("splash-visible")).toBe(false);
    // Showing the splash again must not be undone by the timer of the first dismissal.
    document.querySelector<HTMLElement>(".top-bar-brand")!.click();
    expect(document.body.classList.contains("splash-visible")).toBe(true);
  });
});
