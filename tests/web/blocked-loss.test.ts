/**
 * Tests for src/web/blocked-loss.ts — the "Pérdida bloqueada" column and the
 * "Solo bloqueadas" filter shared by the operations annex and the operations
 * table in main.ts (art. 33.5.f LIRPF).
 *
 * Pure helpers returning data or HTML strings; t() yields es.ts without
 * initLocale(), and setLocale() switches it for the locale check.
 */

import { afterEach, describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import {
  blockedLossCell,
  blockedLossHeader,
  filterByKind,
  hasBlockedLoss,
  showBlockedLossColumn,
} from "../../src/web/blocked-loss.js";
import { setLocale } from "../../src/i18n/index.js";
import type { FifoDisposal } from "../../src/types/tax.js";

function disposal(gain: number, blocked: number): FifoDisposal {
  return {
    isin: "US0378331005",
    symbol: "AAPL",
    description: "APPLE INC",
    sellDate: "2025-09-20",
    acquireDate: "2025-03-15",
    quantity: new Decimal(10),
    gainLossFcy: new Decimal(gain),
    proceedsFcy: new Decimal(1000 + gain),
    costBasisFcy: new Decimal(1000),
    proceedsEur: new Decimal(1000 + gain),
    costBasisEur: new Decimal(1000),
    gainLossEur: new Decimal(gain),
    holdingPeriodDays: 189,
    currency: "EUR",
    sellEcbRate: new Decimal(1),
    acquireEcbRate: new Decimal(1),
    assetCategory: "STK",
    washSaleBlocked: blocked > 0,
    blockedLossEur: new Decimal(blocked),
  };
}

const gain = disposal(200, 0);
const freeLoss = disposal(-300, 0);
const partlyBlocked = disposal(-1000, 300);
const all = [gain, freeLoss, partlyBlocked];

afterEach(() => setLocale("es"));

describe("hasBlockedLoss / showBlockedLossColumn", () => {
  it("is true only for a positive blocked amount", () => {
    expect(hasBlockedLoss(gain)).toBe(false);
    expect(hasBlockedLoss(freeLoss)).toBe(false);
    expect(hasBlockedLoss(partlyBlocked)).toBe(true);
  });

  it("shows the column only when some sale is blocked", () => {
    expect(showBlockedLossColumn([gain, freeLoss])).toBe(false);
    expect(showBlockedLossColumn(all)).toBe(true);
    expect(showBlockedLossColumn([])).toBe(false);
  });
});

describe("filterByKind", () => {
  it("'all' and unknown values keep everything", () => {
    expect(filterByKind(all, "all")).toEqual(all);
    expect(filterByKind(all, "nonsense")).toEqual(all);
  });

  it("'gain' and 'loss' keep their previous meaning", () => {
    expect(filterByKind(all, "gain")).toEqual([gain]);
    expect(filterByKind(all, "loss")).toEqual([freeLoss, partlyBlocked]);
  });

  it("'blocked' keeps only sales with a blocked loss", () => {
    expect(filterByKind(all, "blocked")).toEqual([partlyBlocked]);
    expect(filterByKind([gain, freeLoss], "blocked")).toEqual([]);
  });
});

describe("blockedLossCell", () => {
  it("prints the blocked amount, not the whole loss", () => {
    expect(blockedLossCell(partlyBlocked)).toBe('<td class="num blocked-loss">300,00</td>');
  });

  it("is blank when there is no blocked loss", () => {
    expect(blockedLossCell(freeLoss)).toBe('<td class="num blocked-loss"></td>');
    expect(blockedLossCell(gain)).toBe('<td class="num blocked-loss"></td>');
  });
});

describe("blockedLossHeader", () => {
  it("names the column and explains it with the legal reference", () => {
    const h = blockedLossHeader();
    expect(h.label).toBe("Pérdida bloqueada EUR");
    expect(h.title).toContain("art. 33.5.f LIRPF");
    expect(h.title).toContain("no imputables");
  });

  it("follows the active locale", () => {
    setLocale("en");
    expect(blockedLossHeader().label).toBe("Blocked loss EUR");
  });
});
