import { describe, it, expect } from "vitest";
import { generateTaxReport } from "../../src/generators/report.js";
import { degiroParser } from "../../src/parsers/degiro.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

// ===========================================================================
// End-to-end: Degiro GBX (pence) import — issue #282.
// ---------------------------------------------------------------------------
// THE BUG: Degiro quotes LSE instruments in GBX (penny sterling). The ECB only
// publishes GBP, so an un-normalized "GBX" trade is unresolvable: the
// crypto-valuation pre-pass (resolveCryptoTradeValues) dropped ALL of them.
// The visible symptom was asymmetric — the buys silently created no FIFO lots
// while the user could rescue the sale via a manual rate, so the report showed
// the 510-share sale with cost basis 0 (`fifo.sell_without_lots`) and the
// manual-opening-lots panel asked for lots the file actually contains.
//
// THE FIX: the Degiro parser normalizes GBX→GBP (price and local value ÷100,
// shared `normalizeFractionalCurrency` helper, same as Trading 212), so the
// engine only ever sees a real ISO currency and the whole pipeline just works.
//
// This test runs the EXACT export from the issue through degiroParser →
// generateTaxReport with a fixed in-memory GBP rate map and pins the
// hand-computed EUR figures (V2422-20: same-fiat security → both legs at the
// sale-date rate 1.16):
//   lot A (swap-in 2022): 110 × 4.5889 GBP                 = 504.779 GBP
//   lot B (buy 2024):     400 × 1.0956 + 5.37 EUR/1.20     = 442.715 GBP
//   sale (2026):          510 × 3.3345 − 10.66 EUR/1.16    = 1691.40534... GBP
//   proceeds = 1691.40534 × 1.16 = 1962.03 €
//   cost     = 947.494    × 1.16 = 1099.09 €
//   gain     =                      862.94 €
// ===========================================================================

const GBX_CSV = [
  "Fecha,Hora,Producto,ISIN,Bolsa de referencia,Centro de ejecución,Número,Precio,,Valor local,,Valor EUR,Tipo de cambio,Comisión AutoFX,Costes de transacción y/o externos EUR,Total EUR,ID Orden",
  '26-05-2026,09:12,KISTOS HOLDINGS PLC,GB00BP7NQJ77,LSE,AIMX,-510,"333,4500",GBX,"170059,50",GBX,"1969,88","86,3297","-4,93","-5,73","1959,22",00000000-0000-4000-8000-000000000001',
  '12-07-2024,13:02,KISTOS HOLDINGS PLC,GB00BP7NQJ77,LSE,AIMX,400,"109,5600",GBX,"-43824,00",GBX,"-521,59","84,0202","-1,30","-4,07","-526,96",00000000-0000-4000-8000-000000000002',
  '29-12-2022,14:34,KISTOS HOLDINGS PLC,GB00BP7NQJ77,LSE,,110,"458,8900",GBX,"-50477,90",GBX,"-576,11","87,6194","0,00",,"-576,11",',
  '29-12-2022,14:34,KISTOS PLC,GB00BLF7NX68,LSE,,-110,"458,8900",GBX,"50477,90",GBX,"576,11","87,6194","0,00",,"576,11",',
  '22-09-2021,10:35,KISTOS PLC,GB00BLF7NX68,LSE,AIMX,110,"316,7800",GBX,"-34845,80",GBX,"-405,33","85,9697","-0,40","-3,97","-409,70",00000000-0000-4000-8000-000000000003',
].join("\n");

/** Fixed GBP rates (EUR per 1 GBP) for the four trade dates — all business days. */
function makeRateMap(): EcbRateMap {
  const map: EcbRateMap = new Map();
  map.set("2021-09-22", new Map([["GBP", "1.17"]]));
  map.set("2022-12-29", new Map([["GBP", "1.13"]]));
  map.set("2024-07-12", new Map([["GBP", "1.20"]]));
  map.set("2026-05-26", new Map([["GBP", "1.16"]]));
  return map;
}

describe("Degiro GBX end-to-end (issue #282)", () => {
  const statement = degiroParser.parse(GBX_CSV);
  const report = generateTaxReport(statement, makeRateMap(), 2026);

  it("consumes the buys as FIFO lots — no sell_without_lots / insufficient_lots", () => {
    const ids = report.messages.map((m) => m.id);
    expect(ids).not.toContain("fifo.sell_without_lots");
    expect(ids).not.toContain("fifo.insufficient_lots");
  });

  it("produces the two 2026 disposals covering all 510 shares", () => {
    const disposals = report.capitalGains.disposals;
    expect(disposals).toHaveLength(2);
    const quantities = disposals.map((d) => d.quantity.toString()).sort();
    expect(quantities).toEqual(["110", "400"]);
    for (const d of disposals) {
      expect(d.currency).toBe("GBP");
      expect(d.costBasisEur.greaterThan(0)).toBe(true);
    }
  });

  it("pins the hand-computed EUR figures (V2422-20 sale-date rate)", () => {
    expect(report.capitalGains.transmissionValue.toFixed(2)).toBe("1962.03");
    expect(report.capitalGains.acquisitionValue.toFixed(2)).toBe("1099.09");
    expect(report.capitalGains.netGainLoss.toFixed(2)).toBe("862.94");
  });

  it("books no divisa gain (no EUR conversion ever happens in the file)", () => {
    expect(report.fxGains.netGainLoss.toFixed(2)).toBe("0.00");
    expect(report.fxGains.disposals).toHaveLength(0);
  });
});
