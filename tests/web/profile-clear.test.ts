// @vitest-environment jsdom
/**
 * The "delete my data from this browser" button in the fiscal profile.
 *
 * The form saves NIF, name and phone on every keystroke. Before this button,
 * nothing in the app removed them, so the next person using the same browser
 * found them prefilled.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initProfile, getProfile } from "../../src/web/profile.js";

let store: Record<string, string>;
let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  store = {};
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => { store[key] = val; },
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  });
  reload = vi.fn();
  vi.stubGlobal("location", { reload });
  document.body.innerHTML = `<div id="profile-form-container"></div>`;
  initProfile();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function typeNif(value: string): void {
  const input = document.getElementById("profile-nif") as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("profile clear button", () => {
  it("typing a NIF stores it at once (control)", () => {
    typeNif("00000000T");
    expect(getProfile().nif).toBe("00000000T");
  });

  it("keeps the data when the user cancels the confirmation", () => {
    typeNif("00000000T");
    vi.stubGlobal("confirm", vi.fn(() => false));
    (document.getElementById("profile-clear-btn") as HTMLButtonElement).click();
    expect(getProfile().nif).toBe("00000000T");
    expect(reload).not.toHaveBeenCalled();
  });

  it("deletes the stored profile and reports, then reloads the page", () => {
    typeNif("00000000T");
    store.declarenta_reports = "[]";
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    (document.getElementById("profile-clear-btn") as HTMLButtonElement).click();
    expect(confirm).toHaveBeenCalledOnce();
    expect(store.declarenta_profile).toBeUndefined();
    expect(store.declarenta_reports).toBeUndefined();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("is a plain button, so pressing it never submits (and re-saves) the form", () => {
    expect((document.getElementById("profile-clear-btn") as HTMLButtonElement).type).toBe("button");
  });
});
