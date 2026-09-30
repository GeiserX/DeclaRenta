// @vitest-environment jsdom
/**
 * The 720 section remembers the files it generates, so next year's file writes
 * the origin (field 423) right: M for a security already declared and still
 * held, C for one declared and sold since, A for a new one. The forget button
 * drops that memory and everything goes back to A.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Statement } from "../../src/types/broker.js";

const HISTORY_KEY = "declarenta_720_history";
const APPLE = "US0378331005";
const SAP = "DE0007164600";
const ISHARES = "IE00B4L5Y983";

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

function statement(year: number, holdings: [isin: string, valueEur: string][]): Statement {
  return {
    accountId: "U1234567",
    fromDate: `${year}0101`,
    toDate: `${year}1231`,
    period: "",
    trades: [],
    cashTransactions: [],
    corporateActions: [],
    securitiesInfo: [],
    openPositions: holdings.map(([isin, value]) => ({
      accountId: "U1234567",
      symbol: isin.slice(0, 4),
      description: `Security ${isin}`,
      isin,
      currency: "EUR",
      assetCategory: "STK",
      quantity: "100",
      costBasisMoney: "0",
      costBasisPrice: "0",
      markPrice: "0",
      positionValue: value,
      fifoPnlUnrealized: "0",
      fxRateToBase: "1",
      custodianCountry: "IE",
    })),
  };
}

let section: typeof import("../../src/web/section-720.js");
let downloads: Blob[];

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(new TextDecoder("latin1").decode(reader.result as ArrayBuffer));
    };
    reader.onerror = () => {
      reject(new Error("could not read the downloaded file"));
    };
    reader.readAsArrayBuffer(blob);
  });
}

/** Render the section for `year` (the profile's declaration year) with `holdings`. */
function render(year: number, holdings: [string, string][]): void {
  localStorage.setItem("declarenta_profile", JSON.stringify({
    nif: "12345678Z", apellidos: "PEREZ", nombre: "ANA", telefono: "600000000", year,
  }));
  section.renderSection720(statement(year, holdings), new Map());
}

/** Render the section for `year` with `holdings`, click Generate, and return ISIN → origin of each type-2 record. */
async function generate(year: number, holdings: [string, string][]): Promise<Record<string, string>> {
  render(year, holdings);
  const before = downloads.length;
  document.getElementById("m720-generate-btn")!.click();
  expect(downloads.length).toBe(before + 1);
  const lines = (await readBlob(downloads.at(-1)!)).split("\n").filter((l) => l.startsWith("2"));
  return Object.fromEntries(lines.map((l) => [l.slice(131, 143).trim(), l[422]!]));
}

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("localStorage", memoryStorage());
  document.body.innerHTML = `<div id="m720-content"></div>`;
  downloads = [];
  URL.createObjectURL = (blob: Blob) => {
    downloads.push(blob);
    return "blob:test";
  };
  URL.revokeObjectURL = () => {};
  HTMLAnchorElement.prototype.click = () => {};
  section = await import("../../src/web/section-720.js");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("720 origin from the files generated in this browser", () => {
  it("first year: everything is A and the section says so, with nothing to forget", async () => {
    expect(await generate(2024, [[APPLE, "40000"], [SAP, "30000"]])).toEqual({ [APPLE]: "A", [SAP]: "A" });
    expect(document.querySelector(".m720-previous")).not.toBeNull();
    expect(document.getElementById("m720-forget-btn")).toBeNull();
    expect(localStorage.getItem(HISTORY_KEY)).not.toBeNull();
  });

  it("next year: held securities go as M, sold ones as C, new ones as A", async () => {
    await generate(2024, [[APPLE, "40000"], [SAP, "30000"]]);
    const origins = await generate(2025, [[APPLE, "45000"], [ISHARES, "20000"]]);
    expect(origins).toEqual({ [APPLE]: "M", [ISHARES]: "A", [SAP]: "C" });

    // The banner names the year the origin comes from and offers to forget it
    expect(document.querySelector(".m720-previous")?.textContent).toContain("2024");
    expect(document.getElementById("m720-forget-btn")).not.toBeNull();
    // The sale has no disposal in the data: the section asks to complete its C record
    expect(document.getElementById("m720-content")?.textContent).toContain(SAP);
  });

  it("20,000 € rule: the threshold bar compares with the remembered total", async () => {
    await generate(2024, [[APPLE, "40000"], [SAP, "30000"]]);

    // 65,000 € against 70,000 €: not more than 20,000 € up, shown as a note
    render(2025, [[APPLE, "45000"], [ISHARES, "20000"]]);
    let verdict = document.querySelector(".threshold-bar p")!;
    expect(verdict.classList.contains("muted")).toBe(true);
    expect(verdict.textContent).toContain("2024");

    // 95,000 € against 70,000 €: 25,000 € up, filing again is required
    render(2025, [[APPLE, "45000"], [ISHARES, "50000"]]);
    verdict = document.querySelector(".threshold-bar p")!;
    expect(verdict.classList.contains("warning")).toBe(true);
    expect(verdict.textContent).toContain("25.000,00");
  });

  it("the forget button drops the memory: everything goes back to A and nothing is cancelled", async () => {
    await generate(2024, [[APPLE, "40000"], [SAP, "30000"]]);
    render(2025, [[APPLE, "45000"], [ISHARES, "20000"]]);
    document.getElementById("m720-forget-btn")!.click();

    expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
    expect(document.getElementById("m720-forget-btn")).toBeNull();
    expect(await generate(2025, [[APPLE, "45000"], [ISHARES, "20000"]])).toEqual({ [APPLE]: "A", [ISHARES]: "A" });
  });

  it("everything sold since last year still offers the file, to declare the cancellations", async () => {
    await generate(2024, [[APPLE, "60000"]]);
    expect(await generate(2025, [])).toEqual({ [APPLE]: "C" });
  });
});
