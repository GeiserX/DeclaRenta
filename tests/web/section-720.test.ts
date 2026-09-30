// @vitest-environment jsdom
/**
 * A security the broker export gives no market value for (Revolut's
 * transaction log) is unvalued, not worth 0 €: the 720 section must say so and
 * must not call the securities category "below the threshold".
 *
 * Last year's Modelo 720 uploaded in the 720 section: what it declared and is
 * still held gets origin M, what is new gets A, and what it declared and was
 * sold gets a C record dated by the sale. The file is read in memory only.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Decimal from "decimal.js";
import { generateModelo720 } from "../../src/generators/modelo720.js";
import { renderSection720, rerenderSection720 } from "../../src/web/section-720.js";
import { createEmptyStatement } from "../../src/parsers/merge.js";
import { setLocale } from "../../src/i18n/index.js";
import type { Statement } from "../../src/types/broker.js";
import type { OpenPosition } from "../../src/types/ibkr.js";
import type { EcbRateMap } from "../../src/types/ecb.js";
import type { FifoDisposal } from "../../src/types/tax.js";

function stock(overrides: Partial<OpenPosition>): OpenPosition {
  return {
    accountId: "",
    symbol: "SPY",
    description: "SPDR S&P 500 ETF",
    isin: "US78462F1030",
    currency: "USD",
    assetCategory: "STK",
    quantity: "10",
    costBasisMoney: "4000",
    costBasisPrice: "400",
    markPrice: "600",
    positionValue: "6000",
    fifoPnlUnrealized: "2000",
    fxRateToBase: "1",
    custodianCountry: "IE",
    ...overrides,
  };
}

function statement(openPositions: OpenPosition[]): Statement {
  return {
    accountId: "",
    fromDate: "20250101",
    toDate: "20251231",
    period: "",
    trades: [],
    cashTransactions: [],
    corporateActions: [],
    openPositions,
    securitiesInfo: [],
  };
}

const rateMap: EcbRateMap = new Map([["2025-12-31", new Map([["USD", new Decimal("0.9")]])]]);

describe("Modelo 720 section — a holding with no market value", () => {
  beforeEach(() => {
    // The profile (tax year 2025) is read from localStorage.
    const profile = JSON.stringify({ year: 2025 });
    vi.stubGlobal("localStorage", { getItem: (key: string) => (key === "declarenta_profile" ? profile : null) });
    document.body.innerHTML = `<div id="m720-content"></div>`;
  });

  it("flags it as unvalued and does not call the category below the threshold", () => {
    // Revolut: 400 AAPL bought for $80,000, no year-end price in the export.
    const revolut = stock({ symbol: "AAPL", description: "AAPL", isin: "", quantity: "400", markPrice: "0", positionValue: "0" });
    renderSection720(statement([stock({}), revolut]), rateMap);

    const text = document.getElementById("m720-content")!.textContent;
    expect(text).toContain("no se han podido valorar");
    expect(text).toContain("No se puede determinar");
    expect(text).not.toContain("Por debajo del umbral");
    const aaplRow = [...document.querySelectorAll("#m720-content tbody tr")].find((tr) => tr.textContent.includes("AAPL"));
    expect(aaplRow?.lastElementChild?.textContent).toBe("—");
  });

  it("shows the securities category even when every holding is unvalued", () => {
    const revolut = stock({ symbol: "AAPL", description: "AAPL", isin: "", quantity: "400", markPrice: "0", positionValue: "0" });
    renderSection720(statement([revolut]), rateMap);

    expect(document.getElementById("m720-content")!.textContent).toContain("No se puede determinar");
  });
});

function position(overrides: Partial<OpenPosition> = {}): OpenPosition {
  return {
    accountId: "U7654321", symbol: "IWDA", description: "ISHARES CORE MSCI WORLD", isin: "IE00B4L5Y983",
    currency: "EUR", assetCategory: "STK", quantity: "600", costBasisMoney: "40000", costBasisPrice: "66",
    markPrice: "92", positionValue: "55200", fifoPnlUnrealized: "15200", fxRateToBase: "1", custodianCountry: "IE", ...overrides,
  };
}

const iwda = position();
const vwce = position({ symbol: "VWCE", description: "VANGUARD FTSE ALL-WORLD", isin: "IE00BK5BQT80", positionValue: "10000" });
const aapl = position({ symbol: "AAPL", description: "APPLE INC", isin: "US0378331005", positionValue: "30000" });

const config = (year: number) => ({
  nif: "12345678Z", surname: "GARCIA LOPEZ", name: "JUAN", year, phone: "600123456",
  contactName: "GARCIA LOPEZ, JUAN", declarationId: "7200000000001", isComplementary: false, isReplacement: false,
});

// Filed for 2024: IWDA and VWCE.
const file2024 = generateModelo720([iwda, vwce], new Map(), config(2024));

// 2025: IWDA still held, AAPL bought, VWCE sold on 3 March (shares bought in 2023).
function statement2025() {
  const s = createEmptyStatement();
  s.toDate = "20251231";
  s.openPositions = [iwda, aapl];
  return s;
}
const vwceSale = {
  isin: "IE00BK5BQT80", symbol: "VWCE", description: "VANGUARD FTSE ALL-WORLD", sellDate: "2025-03-03", acquireDate: "2023-05-02",
  isShort: false, costBasisFcy: new Decimal(9000), holdingPeriodDays: 671, proceedsEur: new Decimal(10500),
} as unknown as FifoDisposal;

const $ = (sel: string) => document.querySelector<HTMLElement>(sel);
const $$ = (sel: string) => [...document.querySelectorAll(sel)];

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

async function upload(content: string, name = "modelo720_2024.txt"): Promise<void> {
  const input = $("#m720-previous-input") as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [new File([content], name)] });
  const before = $("#m720-content")!.innerHTML;
  input.dispatchEvent(new Event("change"));
  for (let i = 0; i < 200 && $("#m720-content")!.innerHTML === before; i++) await new Promise((r) => setTimeout(r, 5));
}

/** Origin column of the positions table, by ISIN. */
function origins(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const tr of $$("#m720-content table tbody tr")) {
    const cells = [...tr.querySelectorAll("td")].map((td) => td.textContent);
    result[cells.at(0) ?? ""] = cells.at(4)?.slice(0, 1) ?? "";
  }
  return result;
}

/** Click Generate and return the downloaded file's detail records as "ISIN/origin/extinction date". */
async function generatedDetails(): Promise<string[]> {
  let blob: Blob | undefined;
  URL.createObjectURL = vi.fn((b: Blob | MediaSource) => { blob = b as Blob; return "blob:m720"; });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  $("#m720-generate-btn")!.click();
  const text = new TextDecoder("iso-8859-15").decode(await blob!.arrayBuffer());
  return text.split("\n").filter((l) => l[0] === "2").map((l) => `${l.slice(131, 143).trim()}/${l[422]}/${l.slice(423, 431).trim()}`);
}

describe("720 section: last year's file", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    setLocale("es");
    localStorage.setItem("declarenta_profile", JSON.stringify({
      nif: "12345678Z", apellidos: "GARCIA LOPEZ", nombre: "JUAN", telefono: "600123456", year: 2025,
    }));
    document.body.innerHTML = `<div id="m720-content"></div>`;
    renderSection720(statement2025(), new Map(), undefined, [vwceSale]);
  });

  afterEach(() => {
    // Module state outlives a test: remove any loaded file.
    $("#m720-previous-clear")?.click();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    setLocale("es");
  });

  it("marks everything A until a file is loaded", async () => {
    expect($("#m720-previous-input")).not.toBeNull();
    expect($$("#m720-content thead th")).toHaveLength(4);
    expect(await generatedDetails()).toEqual(["IE00B4L5Y983/A/", "US0378331005/A/"]);
  });

  it("with last year's file: held ISINs get M, new ones A, and the sold one a dated C record", async () => {
    await upload(file2024);
    expect($("#m720-previous-input")).toBeNull();
    expect($(".m720-previous")!.textContent).toContain("modelo720_2024.txt (ejercicio 2024): 2 valores y 0 cuentas declarados.");
    expect(origins()).toEqual({ IE00B4L5Y983: "M", US0378331005: "A" });
    expect($$(".m720-sold li").map((li) => li.textContent)).toEqual(["IE00BK5BQT80"]);
    // Up exactly 20,000 € (not more), but a declared security was sold: its extinction must be filed.
    expect($("#m720-content")!.textContent).toContain("Has vendido valores que declaraste: obligatorio declarar sus bajas");
    expect(await generatedDetails()).toEqual(["IE00B4L5Y983/M/", "US0378331005/A/", "IE00BK5BQT80/C/20250303"]);
  });

  it("re-renders in the new language and keeps the loaded file", async () => {
    await upload(file2024);
    setLocale("en");
    rerenderSection720();
    expect($(".m720-previous h3")!.textContent).toBe("Your last Modelo 720");
    expect($("#m720-previous-clear")!.textContent).toBe("Remove");
    expect(origins()).toEqual({ IE00B4L5Y983: "M", US0378331005: "A" });
  });

  it("says filing is optional when nothing grew more than 20,000 € and nothing declared was sold", async () => {
    await upload(generateModelo720([iwda, vwce, aapl], new Map(), config(2024)));
    renderSection720({ ...statement2025(), openPositions: [iwda, vwce, aapl] }, new Map(), undefined, []);
    expect($("#m720-content")!.textContent).toContain("Con tu último Modelo 720, este año no estás obligado a presentarlo");
    expect($("#m720-content .warning")).toBeNull();
  });

  it("rejects a file of the same year and a file that is not a 720", async () => {
    await upload(generateModelo720([iwda], new Map(), config(2025)), "modelo720_2025.txt");
    expect($(".m720-previous .banner-warning")!.textContent).toBe(
      "Este fichero es del ejercicio 2025. Sube el Modelo 720 de un ejercicio anterior a 2025.",
    );
    expect(origins()).toEqual({ IE00B4L5Y983: "", US0378331005: "" });

    await upload("hola\n", "notas.txt");
    expect($(".m720-previous .banner-warning")!.textContent).toBe("Este fichero no es un Modelo 720: no tiene ningún registro de detalle.");
  });

  it("Remove forgets the file: everything is A again", async () => {
    await upload(file2024);
    $("#m720-previous-clear")!.click();
    expect($("#m720-previous-input")).not.toBeNull();
    expect(await generatedDetails()).toEqual(["IE00B4L5Y983/A/", "US0378331005/A/"]);
  });
});
