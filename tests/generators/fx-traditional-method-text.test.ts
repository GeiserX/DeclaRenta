/**
 * «Tradicional con divisa» (issue #434): the method note must explain the cost
 * of the currency a sale gives back the way the engine computes it. The
 * invested currency that comes back costs what it cost plus the rate change
 * between buying and selling the shares (only that part of the share result,
 * never the whole of it); the profit enters at the sale-date rate; the invested
 * currency that does not come back is booked on its own at the sale.
 *
 * Example: 100 USD cost 70 EUR, invested at 0.80, a sale returns 80 USD at
 * 0.90. The share loss is 8 EUR. The 80 USD come back at 0.70 + 0.10 = 0.80,
 * a 64 EUR basis (not 70 − 8 nor 56 − 8), and the 20 USD lost book 2 EUR.
 */
import { describe, it, expect } from "vitest";
import { run, TRAD, lifetime, type Scenario } from "../integration/fx-traditional-harness.js";
import { generateTaxReport } from "../../src/generators/report.js";
import { toStatement } from "../integration/fx-traditional-harness.js";
import es from "../../src/i18n/locales/es.js";
import en from "../../src/i18n/locales/en.js";
import ca from "../../src/i18n/locales/ca.js";
import eu from "../../src/i18n/locales/eu.js";
import gl from "../../src/i18n/locales/gl.js";

const sc: Scenario = {
  id: "F2",
  years: [2024],
  closed: true,
  ev: [
    { k: "fund", d: "2024-01-02", usd: "100", r: "0.70" },
    { k: "buy", d: "2024-02-01", sym: "AAA", qty: "1", px: "100", r: "0.80" },
    { k: "sell", d: "2024-03-01", sym: "AAA", qty: "1", px: "80", r: "0.90" },
    { k: "conv", d: "2024-04-01", usd: "80", r: "0.90" },
  ],
};

describe("the engine on the example", () => {
  it("share loss 8, returned 80 USD at a 64 EUR basis, 2 EUR on the 20 USD lost", () => {
    const y = run(sc, TRAD).get(2024)!;
    expect(y.stock.toFixed(2)).toBe("-8.00");
    const ds = y.report.fxGains.disposals;
    const lost = ds.filter((d) => d.trigger === "stock_sale");
    expect(lost.map((d) => [d.quantity.toFixed(2), d.gainLossEur.toFixed(2)])).toEqual([["20.00", "2.00"]]);
    const conv = ds.filter((d) => d.disposeDate === "2024-04-01");
    expect(conv.reduce((s, d) => s + d.costBasisEur.toNumber(), 0)).toBeCloseTo(64, 9);
    expect(lifetime(run(sc, TRAD)).toFixed(2)).toBe("2.00"); // 72 out − 70 in
  });
});

describe("the method note says the same, in every locale", () => {
  const old: Record<string, string> = {
    es: "más la ganancia o pérdida ya declarada en esa venta",
    en: "plus the gain or loss already declared on that sale",
    ca: "més el guany o la pèrdua ja declarats en aquesta venda",
    eu: "gehi salmenta horretan aitortutako irabazia edo galera",
    gl: "máis a ganancia ou perda xa declarada nesa venda",
  };
  const locales = { es, en, ca, eu, gl };
  for (const [lang, dict] of Object.entries(locales)) {
    it(`${lang}: never adds the whole share result to the currency basis`, () => {
      expect(dict["report.fx_traditional_method"]).not.toContain(old[lang]);
    });
  }

  it("es names the three parts: rate change only, profit at the sale rate, lost currency apart", () => {
    const m = es["report.fx_traditional_method"];
    expect(m).toContain("variación del tipo de cambio entre la compra y la venta de las acciones");
    expect(m).toContain("al tipo del día de la venta");
    expect(m).toContain("no recuperas");
  });

  it("en names the three parts", () => {
    const m = en["report.fx_traditional_method"];
    expect(m).toContain("the rate change between buying and selling the shares");
    expect(m).toContain("at the sale-date rate");
    expect(m).toContain("do not get back");
  });

  it("the engine text is the es locale, byte for byte", () => {
    const { st, rates } = toStatement(sc);
    const m = generateTaxReport(st, rates, 2024, TRAD).messages.find((x) => x.id === "report.fx_traditional_method")!;
    expect(m.message).toBe(es["report.fx_traditional_method"]);
  });
});
