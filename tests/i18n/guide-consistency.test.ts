/**
 * The Renta Web guide exists in five locales plus a spec comment in
 * casillas.ts. They must give the user the same instructions.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import es from "../../src/i18n/locales/es.js";
import en from "../../src/i18n/locales/en.js";
import ca from "../../src/i18n/locales/ca.js";
import eu from "../../src/i18n/locales/eu.js";
import gl from "../../src/i18n/locales/gl.js";

const locales = { es, en, ca, eu, gl };

/** The clave number the text gives for casilla 1626, e.g. "clave <strong>4</strong>" → "4". */
function claveFor1626(text: string): string | undefined {
  const plain = text.replace(/<[^>]+>/g, "");
  const after = plain.slice(plain.indexOf("1626"));
  return after.match(/\b(\d)\b/)?.[1];
}

describe("Renta Web guide consistency", () => {
  it("gives the same clave for casilla 1626 in every locale and in the casillas.ts spec comment", () => {
    // AEAT: clave 4 = otros elementos patrimoniales NO afectos a actividades
    // económicas; clave 5 is the afectos one, wrong for a private investor.
    for (const [name, locale] of Object.entries(locales)) {
      expect(claveFor1626(locale["guide_rw.clave_prereq_hint"]), name).toBe("4");
    }
    const source = readFileSync(new URL("../../src/generators/casillas.ts", import.meta.url), "utf8");
    const specLine = source.split("\n").find((l) => l.includes("1626 ="));
    expect(specLine).toBeDefined();
    expect(claveFor1626(specLine!)).toBe("4");
  });

  it("asks for the security's issuer as «Entidad emisora», never the broker", () => {
    for (const [name, locale] of Object.entries(locales)) {
      const text = locale["guide_rw.entidad_emisora_value"];
      expect(text, name).not.toMatch(/Interactive Brokers|Degiro|eToro/);
      expect(text, name).toContain("Apple");
    }
  });

  it("never points the double-taxation income row at casilla 0029", () => {
    for (const [name, locale] of Object.entries(locales)) {
      expect(locale["guide_rw.dt_campo_hint"], name).toContain("0588");
      expect(locale["guide_rw.dt_campo_hint"], name).not.toContain("0029");
    }
  });

  it("never says a blocked loss is added to the new position's cost, and warns users who filed with 0.66.5 or earlier (#451)", () => {
    // The deferred loss waits for a «transmisión definitiva»; it is not added to
    // the cost of the repurchased shares (docs/design/antichurning-proportional.md).
    for (const [name, locale] of Object.entries(locales)) {
      const text = locale["guide_rw.blocked_losses_hint"];
      expect(text, name).not.toMatch(/se suma a la adquisición|added to the acquisition cost|se suma a l'adquisició|eskuraketa kostuari gehitzen|súmase á adquisición/);
      expect(text, name).toContain("0.66.5");
      expect(locale["casilla.reintegrated_losses"], name).not.toMatch(/años anteriores|prior years|anys anteriors|Aurreko urteetako|anos anteriores/);
      // The other direction: a loss the new engine releases in a year already
      // filed with 0.66.5 or earlier can be claimed by rectifying that return.
      expect(text, name).toMatch(/rectificación|rectificació|zuzenketa/);
    }
  });

  it("says the release comes from the shares no rebuy covers, not from a sale with no rebuy (#451)", () => {
    // A partly rebought sale releases its definitive shares (V0913-08: 10
    // rebought, 955 definitive), so the hint must not say the sale has no rebuy.
    const saleHasNoRebuy =
      /Esta venta no tiene recompra|This sale has no repurchase|Aquesta venda no té recompra|Salmenta honek ez du berrerosketarik|Esta venda non ten recompra/;
    const salesWithoutRebuy =
      /\(ventas sin recompra|\(sales with no repurchase|\(vendes sense recompra|berrerosketarik gabeko salmentak|\(vendas sen recompra/;
    for (const [name, locale] of Object.entries(locales)) {
      expect(locale["annex.wash_released_hint"], name).not.toMatch(saleHasNoRebuy);
      expect(locale["annex.wash_released_hint"], name).toMatch(/transmisión definitiva|transmissió definitiva|behin betiko eskualdaketa/);
      expect(locale["casilla.reintegrated_losses"], name).not.toMatch(salesWithoutRebuy);
    }
  });

  it("says only the shares no rebuy covers are definitive, and a sale that closes the position releases everything only with no rebuy (#455 follow-up)", () => {
    const closeNeedsNoRebuy = {
      es: /cierra la posición y ninguna recompra en su plazo la cubre/,
      en: /closes the position and no repurchase in its window covers it/,
      ca: /tanca la posició i cap recompra en el seu termini no la cobreix/,
      eu: /posizioa ixten badu eta epean inolako berrerosketak estaltzen ez badu/,
      gl: /pecha a posición e ningunha recompra no seu prazo a cobre/,
    };
    const onlyUncoveredShares = {
      es: /solo cuentan las acciones no recompradas/,
      en: /only the shares not bought back count/,
      ca: /només compten les accions no recomprades/,
      eu: /berrerosi gabeko akzioek bakarrik balio dute/,
      gl: /só contan as accións non recompradas/,
    };
    for (const [name, locale] of Object.entries(locales) as [keyof typeof locales, (typeof locales)["es"]][]) {
      expect(locale["annex.wash_released_hint"], name).toMatch(closeNeedsNoRebuy[name]);
      expect(locale["guide_rw.blocked_losses_hint"], name).toMatch(onlyUncoveredShares[name]);
    }
  });

  it("corrects a filed year with an «autoliquidación rectificativa» from 2024 on, and keeps complementaria for 2023 and earlier (#455 follow-up)", () => {
    // AEAT, Manual práctico de Renta 2025: the rectificativa is the only way to
    // correct an IRPF return from tax year 2024 on, in both directions; the old
    // complementaria / solicitud de rectificación stay for 2023 and earlier.
    const complementaria = /complementaria|complementària|osagarria/;
    for (const [name, locale] of Object.entries(locales)) {
      const text = locale["guide_rw.blocked_losses_hint"];
      expect(text, name).toMatch(/rectificativa/);
      expect(text, name).toContain("2024");
      const at2023 = text.indexOf("2023");
      expect(at2023, name).toBeGreaterThan(-1);
      // Every complementaria is the 2023-and-earlier one.
      for (const m of text.matchAll(new RegExp(complementaria, "g"))) {
        const before = text.slice(0, m.index);
        expect(before.lastIndexOf("2023"), name).toBeGreaterThan(before.lastIndexOf("2024"));
      }
    }
  });

  it("the docs say the same: partial release, total exit only with no rebuy, the unlisted window, and the right correction procedure (#455 follow-up)", () => {
    const doc = (p: string) => readFileSync(new URL(`../../docs/${p}`, import.meta.url), "utf8");
    const casillas = doc("casillas.md");
    const faq = doc("faq.md");
    const modelos = doc("modelos-fiscales.md");
    const design = doc("design/antichurning-proportional.md");
    const faqAnswer = faq.slice(faq.indexOf("### ¿Qué hago con las pérdidas bloqueadas"), faq.indexOf("### ¿Puedo exportar"));
    expect(faqAnswer).toMatch(/1 año si el valor no cotiza, art\. 33\.5\.g/);
    expect(faqAnswer).toMatch(/solo son definitivas las acciones no recompradas/);
    expect(casillas).toMatch(/solo son definitivas las acciones que ninguna recompra/);
    for (const [name, text] of Object.entries({ casillas, faq, modelos })) {
      // The old whole-sale wording: a sale "with no rebuy in its window".
      expect(text, name).not.toMatch(/\((una venta )?sin recompra en su plazo\)/);
      expect(text, name).not.toMatch(/presenta una (autoliquidación )?complementaria de aquel año/);
      // A sale that empties the position releases everything only with no rebuy.
      for (const m of text.matchAll(/posición a cero[^.]*\./g)) expect(m[0], name).toMatch(/ninguna recompra/);
    }
    // The #451 migration note (the dividend-withholding note in modelos-fiscales.md is another topic).
    for (const [name, text] of Object.entries({ casillas, faqAnswer })) {
      expect(text, name).toMatch(/complementaria si es 2023 o anterior|2023 y anteriores: autoliquidación complementaria/);
      expect(text, name).toMatch(/rectificativa si es 2024 o posterior|2024 y posteriores: autoliquidación rectificativa/);
    }
    expect(design).toMatch(/autoliquidación rectificativa/);
    expect(design).not.toMatch(/or must file an «autoliquidación\s+complementaria» for the earlier year/);
  });
});
