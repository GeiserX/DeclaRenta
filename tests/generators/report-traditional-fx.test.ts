/**
 * «Tradicional con divisa» (issue #434): the report plumbing around the engine.
 * Method helpers, the settings echo, which messages appear in which method, the
 * es locale matching the engine text byte for byte, the two-part 1637 cost, and
 * the other locales carrying every new key with the same placeholders.
 */
import { describe, it, expect, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { generateTaxReport, reportOptionsForMethod } from "../../src/generators/report.js";
import { fxMethodOf, type FxMethod, type TaxMessage } from "../../src/types/tax.js";
import { localizeMessage, localizeHint, setLocale } from "../../src/i18n/index.js";
import es from "../../src/i18n/locales/es.js";
import en from "../../src/i18n/locales/en.js";
import ca from "../../src/i18n/locales/ca.js";
import eu from "../../src/i18n/locales/eu.js";
import gl from "../../src/i18n/locales/gl.js";
import { run, toStatement, TRAD, MONO } from "../integration/fx-traditional-harness.js";
import { SCENARIOS } from "../integration/fx-traditional-scenarios.js";

const sc = (id: string) => SCENARIOS.find((s) => s.id === id)!;
const TRAD_IDS = [
  "fx_traditional_method",
  "fx_traditional_risk",
  "fx_traditional_no_conversion",
  "fx_traditional_lost_dollars",
  "fx_traditional_guard",
  "fx_traditional_inflight",
  "fx_traditional_uncovered",
  "fx_traditional_orphan",
].map((id) => `report.${id}`);
const conditional = (ms: TaxMessage[]) =>
  ms.filter((m) => TRAD_IDS.includes(m.id) && m.id !== "report.fx_traditional_method" && m.id !== "report.fx_traditional_risk");
const ctx = (ms: TaxMessage[], id: string) => ms.find((m) => m.id === `report.fx_traditional_${id}`)?.context;

describe("method helpers", () => {
  it("reportOptionsForMethod maps each method to its engine flags", () => {
    expect(reportOptionsForMethod("multidivisa")).toEqual({ skipFx: false, traditionalFx: false });
    expect(reportOptionsForMethod("tradicional-divisa")).toEqual({ skipFx: false, traditionalFx: true });
    expect(reportOptionsForMethod("monodivisa")).toEqual({ skipFx: true, traditionalFx: false });
  });

  it("fxMethodOf reads the settings echo; monodivisa wins over a stray traditionalFx", () => {
    expect(fxMethodOf({ monodivisa: false })).toBe("multidivisa");
    expect(fxMethodOf({ monodivisa: false, traditionalFx: true })).toBe("tradicional-divisa");
    expect(fxMethodOf({ monodivisa: true })).toBe("monodivisa");
    expect(fxMethodOf({ monodivisa: true, traditionalFx: true })).toBe("monodivisa");
  });

  it("each method's report echoes back to the same method", () => {
    const { st, rates } = toStatement(sc("a"));
    for (const m of ["multidivisa", "tradicional-divisa", "monodivisa"] as FxMethod[]) {
      const r = generateTaxReport(st, rates, 2024, reportOptionsForMethod(m));
      expect(fxMethodOf(r.settings!)).toBe(m);
    }
  });
});

describe("settings echo and skipFx precedence", () => {
  const { st, rates } = toStatement(sc("f"));

  it("traditionalFx is written only in the mode", () => {
    expect(generateTaxReport(st, rates, 2024, TRAD).settings?.traditionalFx).toBe(true);
    expect(generateTaxReport(st, rates, 2024).settings).not.toHaveProperty("traditionalFx");
    expect(generateTaxReport(st, rates, 2024, MONO).settings).not.toHaveProperty("traditionalFx");
  });

  it("skipFx wins: skipFx + traditionalFx gives exactly the monodivisa report", () => {
    const both = generateTaxReport(st, rates, 2024, { skipFx: true, traditionalFx: true });
    const mono = generateTaxReport(st, rates, 2024, MONO);
    expect(JSON.stringify(both)).toBe(JSON.stringify(mono));
  });

  it("the stock side of every year equals monodivisa's, field by field", () => {
    for (const id of ["f", "h2", "r", "A2b", "W"]) {
      const s = sc(id);
      const trad = run(s, TRAD);
      const mono = run(s, MONO);
      for (const [y, v] of trad) {
        expect(JSON.stringify(v.report.capitalGains), `${id} ${y}`).toBe(JSON.stringify(mono.get(y)!.report.capitalGains));
      }
    }
  });
});

describe("messages per method", () => {
  it("method + risk only in the mode; the default notes are replaced there", () => {
    const { st, rates } = toStatement(sc("f"));
    const trad = generateTaxReport(st, rates, 2024, TRAD).messages.map((m) => m.id);
    const dflt = generateTaxReport(st, rates, 2024).messages.map((m) => m.id);
    const mono = generateTaxReport(st, rates, 2024, MONO).messages.map((m) => m.id);
    expect(trad).toContain("report.fx_traditional_method");
    expect(trad).toContain("report.fx_traditional_risk");
    for (const id of ["report.competitor_reconciliation", "report.fx_method_consistency", "report.fx_deferred_no_conversion", "report.monodivisa_conversions_skipped"]) {
      expect(trad, id).not.toContain(id);
    }
    for (const ids of [dflt, mono]) for (const id of TRAD_IDS) expect(ids, id).not.toContain(id);
    expect(mono).toContain("report.monodivisa_conversions_skipped");
  });

  it("severities: method is info; risk, inflight and orphan are warnings", () => {
    const ms = run(sc("h2"), TRAD).get(2025)!.report.messages;
    expect(ms.find((m) => m.id === "report.fx_traditional_method")?.severity).toBe("info");
    expect(ms.find((m) => m.id === "report.fx_traditional_risk")?.severity).toBe("warning");
    expect(ms.find((m) => m.id === "report.fx_traditional_inflight")?.severity).toBe("warning");
  });

  it("a plain closed cycle (a) raises no conditional message", () => {
    expect(conditional(run(sc("a"), TRAD).get(2024)!.report.messages)).toEqual([]);
  });

  it("lost dollars (f): one sale, 20.00 €", () => {
    expect(ctx(run(sc("f"), TRAD).get(2024)!.report.messages, "lost_dollars")).toEqual({ n: "1", ccy: "USD", amount: "20.00" });
  });

  it("negative-cost guard (t): its own note and trigger, never counted as lost dollars", () => {
    // t: 1000 USD bought at 0.50, shares bought at 1.20, sold for 1100 USD at 0.60.
    // The sale returned more dollars than it spent, so nothing was lost.
    const r = run(sc("t"), TRAD).get(2024)!.report;
    expect(ctx(r.messages, "lost_dollars")).toBeUndefined();
    expect(ctx(r.messages, "guard")).toEqual({ n: "1", ccy: "USD", amount: "700.00" });
    expect(r.messages.find((m) => m.id === "report.fx_traditional_guard")?.severity).toBe("info");
    const rows = r.fxGains.disposals.filter((d) => d.trigger.startsWith("stock_sale"));
    expect(rows.map((d) => d.trigger)).toEqual(["stock_sale_guard"]);
    expect(ctx(run(sc("t"), { ...TRAD, titulares: 2 }).get(2024)!.report.messages, "guard")).toEqual({ n: "1", ccy: "USD", amount: "350.00" });
  });

  it("a losing sale (f) books lost dollars and no guard row", () => {
    const r = run(sc("f"), TRAD).get(2024)!.report;
    expect(ctx(r.messages, "guard")).toBeUndefined();
    expect(r.fxGains.disposals.some((d) => d.trigger === "stock_sale_guard")).toBe(false);
  });

  it("no conversion this year (h2 2024): the sale's dollars wait in cash", () => {
    const ms = run(sc("h2"), TRAD).get(2024)!.report.messages;
    expect(ctx(ms, "no_conversion")).toEqual({ ccy: "USD" });
  });

  it("in-flight dollars: h2 / y / s 2025 −200.00, r 2025 −160.00", () => {
    for (const [id, qty, amount] of [
      ["h2", "2000.00", "-200.00"],
      ["y", "2000.00", "-200.00"],
      ["s", "2000.00", "-200.00"],
      ["r", "1600.00", "-160.00"],
    ] as const) {
      expect(ctx(run(sc(id), TRAD).get(2025)!.report.messages, "inflight"), id).toEqual({ qty, ccy: "USD", years: "2024", amount });
    }
  });

  it("titulares 2 halves every quantity and amount", () => {
    const s2 = { ...TRAD, titulares: 2 };
    expect(ctx(run(sc("s"), s2).get(2025)!.report.messages, "inflight")).toEqual({ qty: "1000.00", ccy: "USD", years: "2024", amount: "-100.00" });
    expect(ctx(run(sc("f"), s2).get(2024)!.report.messages, "lost_dollars")).toEqual({ n: "1", ccy: "USD", amount: "10.00" });
    expect(ctx(run(sc("g"), s2).get(2024)!.report.messages, "uncovered")).toEqual({ qty: "1000.00", ccy: "USD" });
  });

  it("uncovered (g): a USD deposit with no EUR origin", () => {
    expect(ctx(run(sc("g"), TRAD).get(2024)!.report.messages, "uncovered")).toEqual({ qty: "2000.00", ccy: "USD" });
  });
});

describe("1637 two-part cost (declaredShiftEur)", () => {
  it("h2 2025: the conversion's cost carries the −200 € already declared in the 2024 stock line", () => {
    const per = run(sc("h2"), { ...TRAD, fxTrace: true });
    const r = per.get(2025)!.report;
    const shift = r.fxGains.disposals.reduce((s, d) => s.plus(d.declaredShiftEur ?? 0), new Decimal(0));
    expect(shift.toFixed(2)).toBe("-200.00");
    // The 2024 sale's unpark row explains the shifted cost in two parts.
    const note = (per.get(2024)!.report.fxTrace ?? []).find((t) => t.kind === "unpark" && (t.note ?? "").includes("variación ya declarada"));
    expect(note?.note).toBe("coste = 0.9 €/USD (coste de la divisa) + -0.1 €/USD (variación ya declarada en la acción)");
  });

  it("never set in the default", () => {
    const r = run(sc("h2"), {}).get(2025)!.report;
    expect(r.fxGains.disposals.every((d) => d.declaredShiftEur === undefined)).toBe(true);
  });
});

describe("es locale = engine text, byte for byte", () => {
  beforeEach(async () => {
    await setLocale("es");
  });

  it("every message of the mode and the renamed default/monodivisa notes", () => {
    const seen = new Map<string, TaxMessage>();
    const take = (ms: TaxMessage[]) => {
      for (const m of ms) if (!seen.has(m.id)) seen.set(m.id, m);
    };
    for (const id of ["a", "f", "g", "h2", "r", "t"]) for (const v of run(sc(id), TRAD).values()) take(v.report.messages);
    for (const id of ["a", "h2"]) {
      for (const v of run(sc(id), {}).values()) take(v.report.messages);
      for (const v of run(sc(id), MONO).values()) take(v.report.messages);
    }
    const check = [
      ...TRAD_IDS.filter((id) => id !== "report.fx_traditional_orphan"),
      "report.competitor_reconciliation",
      "report.monodivisa_conversions_skipped",
      "report.fx_deferred_no_conversion",
    ];
    for (const id of check) {
      const m = seen.get(id);
      expect(m, id).toBeDefined();
      expect(localizeMessage(m!), id).toBe(m!.message);
      expect(localizeHint(m!), `${id}.hint`).toBe(m!.hint);
    }
  });
});

describe("every new key in every locale, with the same placeholders", () => {
  const keys = Object.keys(es).filter(
    (k) =>
      k.startsWith("report.fx_traditional_") ||
      k.startsWith("report.fx_method_name.") ||
      k === "report.settings_line" ||
      k.startsWith("report.fx_method_consistency") ||
      k.startsWith("report.fx_deferred_no_conversion"),
  );
  const ph = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

  it("covers the 7 ids, their hints, the 3 method names and the settings line", () => {
    expect(keys.length).toBeGreaterThanOrEqual(7 * 2 + 3 + 1);
  });

  for (const [name, loc] of Object.entries({ en, ca, eu, gl })) {
    it(name, () => {
      for (const k of keys) {
        const v = (loc as Record<string, string>)[k];
        expect(v, `${name} ${k}`).toBeTruthy();
        expect(ph(v!), `${name} ${k}`).toEqual(ph((es as Record<string, string>)[k]!));
      }
    });
  }
});
