// @vitest-environment jsdom
/**
 * The Modelo 720 "generate" button must never do nothing. When the click
 * produces no file, a banner next to the button says why: below the 50,000 €
 * threshold (with the rule for later years), or above it with every asset left
 * out of the file.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderSection720 } from "../../src/web/section-720.js";
import { getProfile, saveProfile } from "../../src/web/profile.js";
import { createEmptyStatement } from "../../src/parsers/merge.js";
import { t } from "../../src/i18n/index.js";
import type { OpenPosition } from "../../src/types/ibkr.js";

const YEAR = new Date().getFullYear() - 1; // the profile's default declaration year

function position(isin: string, value: string): OpenPosition {
  return {
    accountId: "U0000001",
    symbol: "FUND",
    description: "WORLD INDEX FUND",
    isin,
    currency: "EUR",
    assetCategory: "FUND",
    quantity: "100",
    costBasisMoney: value,
    costBasisPrice: "1",
    markPrice: "1",
    positionValue: value,
    fifoPnlUnrealized: "0",
    fxRateToBase: "1",
  };
}

function statementWith(...positions: OpenPosition[]) {
  const statement = createEmptyStatement();
  statement.toDate = `${YEAR}1231`;
  statement.openPositions = positions;
  return statement;
}

function completeProfile(): void {
  saveProfile({ ...getProfile(), nif: "12345678Z", apellidos: "GARCIA LOPEZ", nombre: "ANA", year: YEAR });
}

function clickGenerate(): void {
  const button = document.getElementById("m720-generate-btn") as HTMLButtonElement | null;
  expect(button).not.toBeNull();
  expect(button!.disabled).toBe(false);
  button!.click();
}

/** In-memory localStorage (newer Node versions shadow jsdom's with their own). */
function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
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
    get length() {
      return store.size;
    },
    key: (i: number) => [...store.keys()][i] ?? null,
  };
}

const notice = () => document.querySelector("#m720-content .m720-not-generated");

describe("Modelo 720 generate button", () => {
  let createObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    document.body.innerHTML = `<div id="m720-content"></div>`;
    createObjectURL = vi.fn(() => "blob:m720");
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("explains a below-threshold result, with the rule for later years, instead of doing nothing", () => {
    completeProfile();
    renderSection720(statementWith(position("IE00B4L5Y983", "30000")), new Map());
    expect(notice()).toBeNull();

    clickGenerate();

    const banner = notice();
    expect(banner).not.toBeNull();
    expect(banner!.classList.contains("banner-info")).toBe(true);
    expect(banner!.getAttribute("role")).toBe("status");
    expect(banner!.textContent).toContain(t("m720.threshold_not_exceeded", { amount: "30.000,00" }));
    expect(banner!.textContent).toContain(t("m720.successive_years_note"));
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("answers the threshold question before asking for a complete profile", () => {
    renderSection720(statementWith(position("IE00B4L5Y983", "30000")), new Map());

    clickGenerate();

    expect(notice()?.textContent).toContain(t("m720.threshold_not_exceeded", { amount: "30.000,00" }));
    expect(document.querySelector("#m720-content .profile-required")).toBeNull();
  });

  it("shows one banner however many times the button is clicked", () => {
    completeProfile();
    renderSection720(statementWith(position("IE00B4L5Y983", "30000")), new Map());

    clickGenerate();
    clickGenerate();

    expect(document.querySelectorAll("#m720-content .m720-not-generated")).toHaveLength(1);
  });

  it("asks to value an unvalued holding instead of saying no filing is needed", () => {
    completeProfile();
    // 30,000 € valued plus a holding the export gives no price for.
    const unpriced = { ...position("US0000000001", "0"), markPrice: "0" };
    renderSection720(statementWith(position("IE00B4L5Y983", "30000"), unpriced), new Map());

    clickGenerate();

    const banner = notice();
    expect(banner).not.toBeNull();
    expect(banner!.classList.contains("banner-warning")).toBe(true);
    expect(banner!.textContent).toContain(t("m720.positions_unvalued", { count: "1" }));
    expect(banner!.textContent).not.toContain(t("m720.threshold_not_exceeded", { amount: "30.000,00" }));
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("says the assets must be declared by hand when everything over the threshold was left out", () => {
    completeProfile();
    // Above 50,000 € but no ISIN: counts for the threshold, cannot be written.
    renderSection720(statementWith(position("", "60000")), new Map());

    clickGenerate();

    const banner = notice();
    expect(banner).not.toBeNull();
    expect(banner!.classList.contains("banner-warning")).toBe(true);
    expect(banner!.textContent).toContain(t("m720.not_generated_left_out"));
    expect(banner!.textContent).not.toContain(t("m720.threshold_not_exceeded", { amount: "60.000,00" }));
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("downloads the file and shows no banner when there is something to file", () => {
    completeProfile();
    renderSection720(statementWith(position("IE00B4L5Y983", "60000")), new Map());

    clickGenerate();

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(notice()).toBeNull();
  });
});
