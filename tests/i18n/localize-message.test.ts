import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  localizeMessage,
  localizeHint,
  isTranslationKey,
  setLocale,
  type LocalizableMessage,
} from "../../src/i18n/index.js";
import es from "../../src/i18n/locales/es.js";

describe("localizeMessage / localizeHint", () => {
  beforeEach(() => {
    setLocale("es");
  });
  afterEach(() => {
    setLocale("es");
  });

  describe("known id → localizes via the locale key", () => {
    it("renders the active locale's text for a known id (English)", () => {
      setLocale("en");
      const m: LocalizableMessage = {
        id: "report.competitor_reconciliation",
        // The engine's Spanish fallback — must be IGNORED because the id is a known key.
        message:
          "Si otra herramienta muestra un importe distinto, puede deberse a que no calcula las ganancias por tipo de cambio (Art. 33.1 LIRPF).",
      };
      const out = localizeMessage(m);
      expect(out).toBe(
        "If another tool shows a different amount, it may be because it does not calculate foreign-exchange gains (Art. 33.1 LIRPF).",
      );
      // Crucially NOT the Spanish fallback.
      expect(out).not.toBe(m.message);
    });

    it("renders the active locale's text for fx conservation mismatch (English)", () => {
      setLocale("en");
      const m: LocalizableMessage = {
        id: "fx.conservation_mismatch",
        message:
          "⚠ Descuadre interno del motor de divisa para USD: -3629.27 unidades sin cuadrar. Las casillas 1633/1637 pueden no reconciliar.",
        hint: "Esto es una comprobación interna (no debería ocurrir). Si lo ves, repórtalo en GitHub adjuntando el informe; los importes de divisa pueden necesitar revisión manual.",
        context: { currency: "USD", mismatch: "-3629.27" },
      };

      expect(localizeMessage(m)).toBe(
        "⚠ Internal foreign-exchange engine mismatch for USD: -3629.27 unbalanced units. Boxes 1633/1637 may fail to reconcile.",
      );
      expect(localizeHint(m)).toBe(
        "This is an internal consistency check and should not happen. If you see it, report it on GitHub and attach the report; the foreign-exchange amounts may need manual review.",
      );
      expect(localizeMessage(m)).not.toBe(m.message);
    });

    it("renders the Spanish locale text (byte-identical to the engine) when locale is es", () => {
      const m: LocalizableMessage = {
        id: "report.competitor_reconciliation",
        message:
          "Si otra herramienta muestra un importe distinto, puede deberse a que no calcula las ganancias por tipo de cambio (Art. 33.1 LIRPF).",
      };
      // es locale text equals the engine's emitted Spanish message exactly.
      expect(localizeMessage(m)).toBe(m.message);
    });

    it("localizes the hint via the ${id}.hint key (English)", () => {
      setLocale("en");
      const m: LocalizableMessage = {
        id: "report.competitor_reconciliation",
        message: "irrelevant",
        hint: "Puedes activar el modo monodivisa en tu perfil fiscal para comparar con herramientas como Autodeclaro o Taxdown.",
      };
      expect(localizeHint(m)).toBe(
        "You can enable single-currency mode in your fiscal profile to compare with tools such as Autodeclaro or Taxdown.",
      );
    });
  });

  describe("unknown id → falls back to the engine's message/hint verbatim", () => {
    it("returns m.message unchanged for an id with no locale key", () => {
      setLocale("en");
      const m: LocalizableMessage = {
        id: "parser.unparsed_section",
        message: "Missing ISIN for ABC — sección no reconocida",
        hint: "Una pista cualquiera del motor.",
      };
      expect(isTranslationKey(m.id)).toBe(false);
      expect(localizeMessage(m)).toBe("Missing ISIN for ABC — sección no reconocida");
      expect(localizeHint(m)).toBe("Una pista cualquiera del motor.");
    });

    it("returns undefined hint when an unknown id has no hint", () => {
      const m: LocalizableMessage = { id: "totally.unknown.id", message: "x" };
      expect(localizeHint(m)).toBeUndefined();
    });
  });

  describe("interpolation fills {{placeholders}} from context", () => {
    it("interpolates a single {{count}} placeholder (English)", () => {
      setLocale("en");
      const m: LocalizableMessage = {
        id: "report.crypto_income_unvalued",
        message: "Hay 3 ingreso(s) en criptomoneda ...", // engine fallback, ignored
        context: { count: "3" },
      };
      expect(localizeMessage(m)).toBe(
        "There are 3 crypto income item(s) (e.g. staking rewards) that could not be valued automatically and are not included in the calculated amounts.",
      );
    });

    it("interpolates multiple distinct placeholders (Spanish, byte-identical to the engine)", () => {
      const m: LocalizableMessage = {
        id: "fifo.sell_without_lots",
        // Build the engine's exact Spanish string from the same field values.
        message:
          "⚠ Venta sin lotes: AAPL (US0378331005) × 5 el 2025-03-14. Coste base = 0 (posible posición corta o datos previos incompletos).",
        context: { symbol: "AAPL", isin: "US0378331005", quantity: "5", date: "2025-03-14" },
      };
      // localizeMessage(es) reconstructs exactly what the engine emitted.
      expect(localizeMessage(m)).toBe(m.message);
    });

    it("repeats a placeholder used twice in one template ({{currency}})", () => {
      const m: LocalizableMessage = {
        id: "fx.missing_prior_lots",
        message: "ignored",
        context: { count: "2", currency: "USD", totalQuantity: "10.00" },
      };
      const out = localizeMessage(m);
      // {{currency}} appears twice in the template; both must be filled.
      expect(out).toContain("2 disposiciones de USD");
      expect(out).toContain("(total: 10.00 USD)");
      expect(out).not.toContain("{{");
    });

    it("leaves {{placeholders}} unfilled when context is absent (documents the design)", () => {
      // A caller passing a known id but no context yields the raw template. This is
      // the intended trade-off: localizeMessage keys on the id, not on context.
      const m: LocalizableMessage = { id: "report.crypto_income_unvalued", message: "x" };
      expect(localizeMessage(m)).toContain("{{count}}");
    });
  });

  describe("isTranslationKey", () => {
    it("is true for a real es key and false for a non-key", () => {
      expect(isTranslationKey("report.non_finite_total")).toBe(true);
      expect(isTranslationKey("report.non_finite_total.hint")).toBe(true);
      expect(isTranslationKey("not.a.real.key")).toBe(false);
    });

    it("recognizes every migrated message id as a key", () => {
      // Spot-check a representative spread across engine, report and parser ids.
      const ids = [
        "fx.missing_prior_lots",
        "fifo.unknown_category",
        "fifo.merger_applied",
        "report.crypto_valuation_unresolved",
        "report.titularidad_compartida",
        "flatex.lagerstellenwechsel.unmatched",
        "degiro.rows_skipped",
        "binance.unparseable_timestamp",
        "parser.executions_merged",
      ];
      for (const id of ids) {
        expect(isTranslationKey(id), `${id} should be a key`).toBe(true);
        expect(Object.prototype.hasOwnProperty.call(es, id)).toBe(true);
      }
    });
  });
});
