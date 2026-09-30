// @vitest-environment jsdom
/**
 * The splash's "start" button must always hand over to the app.
 *
 * Dismissal used to wait only for the exit animation's animationend event. A
 * browser that does not run the animation (reduced motion, a hidden tab) never
 * fires it, so the splash stayed on screen. jsdom runs no animations, so it
 * reproduces that browser exactly. The other half of the fix, wiring the button
 * before the locale table is awaited, has no jsdom test: importing main.js here
 * waits for that same top-level await.
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

  it("finishes at once when the animation does end", () => {
    const splash = document.getElementById("splash")!;
    document.getElementById("splash-cta")!.click();
    splash.dispatchEvent(new Event("animationend"));
    expect(document.body.classList.contains("splash-visible")).toBe(false);
  });

  it("ignores the end of a child's animation", () => {
    document.getElementById("splash-cta")!.click();
    document.querySelector(".splash-logo")!.dispatchEvent(new Event("animationend", { bubbles: true }));
    expect(document.body.classList.contains("splash-visible")).toBe(true);
    // The splash's own event still ends the dismissal afterwards.
    document.getElementById("splash")!.dispatchEvent(new Event("animationend"));
    expect(document.body.classList.contains("splash-visible")).toBe(false);
  });

  it("leaves a splash reopened from the logo before the timer fires", async () => {
    document.getElementById("splash-cta")!.click();
    await new Promise((r) => setTimeout(r, 200));
    document.querySelector<HTMLElement>(".top-bar-brand")!.click();
    expect(document.body.classList.contains("splash-visible")).toBe(true);
    await new Promise((r) => setTimeout(r, 700));
    expect(document.body.classList.contains("splash-visible")).toBe(true);
    expect((document.getElementById("splash") as HTMLElement).style.display).toBe("");
  });
});
