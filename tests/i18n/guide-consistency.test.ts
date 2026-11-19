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
    const wholeSaleRule = {
      es: /sin recomprar/,
      en: /without buying it back/,
      ca: /sense recomprar/,
      eu: /berrerosi gabe saltzen/,
      gl: /sen recomprar/,
    };
    for (const [name, locale] of Object.entries(locales) as [keyof typeof locales, (typeof locales)["es"]][]) {
      expect(locale["annex.wash_released_hint"], name).toMatch(closeNeedsNoRebuy[name]);
      expect(locale["guide_rw.blocked_losses_hint"], name).toMatch(onlyUncoveredShares[name]);
      // The hint on every blocked sale says the same (it used to read as a
      // whole-sale rule: "once you sell … without buying it back").
      expect(locale["annex.wash_hint"], name).toMatch(onlyUncoveredShares[name]);
      expect(locale["annex.wash_hint"], name).not.toMatch(wholeSaleRule[name]);
    }
  });

  it("gives the 1-year window only to securities on no EEA regulated or equivalent market; NYSE and Nasdaq are no deviation (DGT V0778-25)", () => {
    // The old wording: 1 year "if unlisted" / "if not on an EU regulated market",
    // and NYSE- or Nasdaq-only listings presented as a DeclaRenta deviation.
    const equivalent = { es: /equivalente/, en: /equivalent/, ca: /equivalent/, eu: /baliokide/, gl: /equivalente/ };
    const oldWording = {
      es: /1 año si no cotiza|2 meses cotizados|según el valor/,
      en: /1 year if unlisted|2 months listed|depending on the security/,
      ca: /1 any si no cotitza|2 mesos cotitzats|segons el valor/,
      eu: /urtebete kotizatzen ez badu|hilabete kotizatuak|balioaren arabera/,
      gl: /1 ano se non cotiza|2 meses cotizados|segundo o valor/,
    };
    // Letter f's regulated markets are those of the whole European Economic
    // Area (V0778-25), not only the EU: an Oslo Børs share gets 2 months.
    const eea = { es: /Espacio Económico Europeo/, en: /European Economic Area/, ca: /Espai Econòmic Europeu/, eu: /Europako Esparru Ekonomiko/, gl: /Espazo Económico Europeo/ };
    const euOnly = { es: /regulado de la UE/, en: /EU regulated/, ca: /regulat de la UE/, eu: /EBko merkatu/, gl: /regulado da UE/ };
    const keys = ["casilla.blocked_losses", "annex.wash_hint", "guide_rw.blocked_losses_hint", "report.antichurning_window_past_data"] as const;
    for (const [name, locale] of Object.entries(locales) as [keyof typeof locales, (typeof locales)["es"]][]) {
      for (const key of keys) {
        expect(locale[key], `${name} ${key}`).toMatch(equivalent[name]);
        expect(locale[key], `${name} ${key}`).not.toMatch(oldWording[name]);
        expect(locale[key], `${name} ${key}`).not.toMatch(euOnly[name]);
      }
      for (const key of ["annex.wash_hint", "guide_rw.blocked_losses_hint", "report.antichurning_window_past_data"] as const) {
        expect(locale[key], `${name} ${key}`).toMatch(eea[name]);
      }
      // The hints name the equivalent markets, so a NYSE-only share reads as 2 months.
      expect(locale["annex.wash_hint"], name).toMatch(/NYSE/);
      expect(locale["guide_rw.blocked_losses_hint"], name).toMatch(/NYSE/);
    }
    // The Spanish text report.ts writes into the message is the es locale's.
    const source = readFileSync(new URL("../../src/generators/report.ts", import.meta.url), "utf8");
    const pinned = "(2 meses; 1 año si el valor no cotiza en un mercado regulado del Espacio Económico Europeo ni en uno equivalente; en las criptomonedas, solo el año siguiente a la venta)";
    expect(source).toContain(pinned);
    expect(es["report.antichurning_window_past_data"]).toContain(pinned);

    const doc = (p: string) => readFileSync(new URL(`../../docs/${p}`, import.meta.url), "utf8");
    const docs = { casillas: doc("casillas.md"), faq: doc("faq.md"), modelos: doc("modelos-fiscales.md"), design: doc("design/antichurning-proportional.md") };
    for (const [name, text] of Object.entries(docs)) {
      expect(text, name).toMatch(/V0778-25/);
      expect(text, name).not.toMatch(/aunque solo cotice fuera de la UE|listed only outside an EU regulated/);
      expect(text, name).not.toMatch(/no está admitido a negociación en un mercado regulado de la UE, art/);
      expect(text, name).not.toMatch(/2 meses cotizados|\(cotizados\)|valores \*\*cotizados\*\*|valores \*\*no cotizados\*\*/);
      // EEA, not EU: Norway, Iceland and Liechtenstein have letter-f markets.
      expect(text, name).not.toMatch(/mercado regulado de la UE|EU regulated market/);
      // Crypto is no «valor o participación»: letter e, never a letter-g example.
      expect(text, name).not.toMatch(/solo OTC, cripto|la mayoría de criptomonedas\)|most crypto/);
    }
    expect(docs.casillas).toMatch(/mercado de un tercer país declarado equivalente por la Comisión Europea/);
    // The MiFID II decisions (US, Australia, Hong Kong) and the EMIR ones
    // (Toronto, Tokyo, Singapore: open for shares, so 2 months), and the
    // per-ISIN window that replaced the old "2 months for every ISIN" gap (#452).
    expect(docs.casillas).toMatch(/2017\/2318[^.]*2017\/2319|2017\/2319[^.]*2017\/2318/);
    expect(docs.casillas).toMatch(/2016\/2273[^.]*2016\/2271[^.]*2016\/2270/);
    expect(docs.casillas).toMatch(/### Plazo de 2 meses o de 1 año por valor/);
    expect(docs.casillas).toMatch(/--antichurning-1y[\s\S]*--antichurning-2m/);
    expect(docs.casillas).toMatch(/Londres \(`LSE`\) para las ventas desde el 01\/01\/2021/);
    expect(docs.casillas).toMatch(/33\.5\.e[^.]*#457/);
    expect(docs.modelos).toMatch(/Londres/);
    expect(docs.design).toMatch(/Window per ISIN \(#452\)[\s\S]{0,1200}2016\/2273[\s\S]{0,1500}NON_EQUIVALENT_LISTINGS/);
    expect(docs.design).toMatch(/33\.5\.e[\s\S]{0,300}#457/);
    const claude = readFileSync(new URL("../../CLAUDE.md", import.meta.url), "utf8");
    expect(claude).toMatch(/2017\/2318/);
    expect(claude).toMatch(/London Stock Exchange from 2021[^\n]*#452/);
    expect(claude).toMatch(/never list Toronto or Tokyo as settled 1-year markets/);
    expect(claude).toMatch(/33\.5\.e[^\n]*#457/);
    expect(claude).not.toMatch(/or non-EU listing|on an EU regulated or equivalent|on an EU regulated market, or|most crypto/);
    // The engine's own header no longer reads letter f as "MiFID venues" only.
    const engine = readFileSync(new URL("../../src/engine/wash-sale.ts", import.meta.url), "utf8");
    expect(engine).not.toMatch(/on MiFID venues/);
    expect(engine).toMatch(/V0778-25/);
    expect(engine).not.toMatch(/EU regulated market|most crypto/);
    expect(engine).toMatch(/#457/);
  });

  it("tells the user how DeclaRenta picks the 1-year window per security and how to set it by hand, never listing Toronto or Tokyo as 1 year (#452)", () => {
    // The guide and the window warning describe the law and the engine: 1 year
    // when IBKR shows only a market with no equivalence (London from 2021) or
    // the user marks it; Toronto, Tokyo and Singapore have an EMIR equivalence
    // decision and stay at 2 months. The old note sent users to a manual check.
    const flag = "--antichurning-1y";
    for (const [name, locale] of Object.entries(locales)) {
      for (const key of ["guide_rw.blocked_losses_hint", "report.antichurning_window_past_data.hint"] as const) {
        const text = locale[key];
        expect(text, `${name} ${key}`).toContain(flag);
        expect(text, `${name} ${key}`).toMatch(/2021/);
        expect(text, `${name} ${key}`).toMatch(/SIX[^.]*OTC Markets/);
        expect(text, `${name} ${key}`).not.toMatch(/Toronto[^.]*OTC Markets|OTC Markets[^.]*Toronto|Tok(io|yo|ion)[^.]*OTC Markets/);
        expect(text, `${name} ${key}`).not.toMatch(/#452/);
      }
      // The guide names Toronto, Tokyo and Singapore as equivalent (2 months), open for shares.
      expect(locale["guide_rw.blocked_losses_hint"], name).toMatch(/Toronto[^.]*Singap(ur|ore)[^.]*(DGT|DGTren)/);
    }
    // report.ts writes the Spanish hint itself; it must say the same as es.ts.
    const source = readFileSync(new URL("../../src/generators/report.ts", import.meta.url), "utf8");
    const note = "Ese plazo es de 1 año en los valores a los que DeclaRenta aplica 1 año (porque IBKR solo los muestra en un mercado sin equivalencia, como Londres desde 2021, SIX u OTC Markets, o porque tú los marcaste) y de 2 meses en los demás valores con ISIN.";
    expect(source).toContain(note);
    expect(es["report.antichurning_window_past_data.hint"]).toContain(note);
    expect(source).not.toMatch(/Toronto, Tokio u OTC Markets/);
    for (const p of ["modelos-fiscales.md", "index.md"]) {
      const text = readFileSync(new URL(`../../docs/${p}`, import.meta.url), "utf8");
      expect(text, p).toMatch(/Plazo anti-churning por valor[^\n]*casillas\.md#plazo-de-2-meses-o-de-1-ano-por-valor/);
      expect(text, p).not.toMatch(/Toronto, Tokio u OTC Markets|2 meses a todo valor con ISIN: si el tuyo/);
    }
    // The engine's comments no longer list Toronto as a 1-year market.
    const engine = readFileSync(new URL("../../src/engine/wash-sale.ts", import.meta.url), "utf8");
    expect(engine).not.toMatch(/SIX or Toronto|\(London, SIX, Toronto\)/);
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

  it("tells the user to correct a year with lowered withholding through a rectificativa from 2024 on, not only a complementaria (#458)", () => {
    const complementaria = /complementaria|complementària|osagarria/;
    const keys = ["report.withholding_corrected_prior_year.hint", "report.spanish_withholding_corrected_prior_year.hint"] as const;
    for (const [name, locale] of Object.entries(locales)) {
      for (const key of keys) {
        const text = locale[key];
        expect(text, `${name} ${key}`).toMatch(/rectificativa/);
        // Every complementaria is the 2023-and-earlier one.
        for (const m of text.matchAll(new RegExp(complementaria, "g"))) {
          const before = text.slice(0, m.index);
          expect(before.lastIndexOf("2023"), `${name} ${key}`).toBeGreaterThan(before.lastIndexOf("2024"));
        }
      }
    }
    // report.ts writes the Spanish hint itself; it must match es.ts.
    const source = readFileSync(new URL("../../src/generators/report.ts", import.meta.url), "utf8");
    const pinned = "(2024 y posteriores: autoliquidación rectificativa; 2023 y anteriores: autoliquidación complementaria).";
    expect(source.split(pinned).length - 1).toBe(2);
    for (const key of keys) expect(es[key]).toContain(pinned);
    const modelos = readFileSync(new URL("../../docs/modelos-fiscales.md", import.meta.url), "utf8");
    expect(modelos).toMatch(/0597[^\n]*autoliquidación rectificativa si es 2024 o posterior/);
  });

  it("the docs say the same: partial release, total exit only with no rebuy, the unlisted window, and the right correction procedure (#455 follow-up)", () => {
    const doc = (p: string) => readFileSync(new URL(`../../docs/${p}`, import.meta.url), "utf8");
    const casillas = doc("casillas.md");
    const faq = doc("faq.md");
    const modelos = doc("modelos-fiscales.md");
    const design = doc("design/antichurning-proportional.md");
    const faqAnswer = faq.slice(faq.indexOf("### ¿Qué hago con las pérdidas bloqueadas"), faq.indexOf("### ¿Puedo exportar"));
    // The statute's test, as DGT V0778-25 reads letter f: an EEA regulated market
    // OR a third-country market the Commission declared equivalent (NYSE and
    // Nasdaq are). Only a security on neither falls under letter g, and the
    // engine's ISIN heuristic deviates there (#452); crypto is letter e (#457).
    expect(faqAnswer).toMatch(/1 año si el valor no está admitido a negociación ni en un mercado regulado del Espacio Económico Europeo ni en un mercado de un tercer país declarado equivalente por la Comisión Europea, art\. 33\.5\.g/);
    expect(faqAnswer).toMatch(/NYSE y Nasdaq[^.]*consulta DGT V0778-25/);
    expect(faqAnswer).toMatch(/Plazo anti-churning por valor[^.]*--antichurning-1y/);
    expect(faqAnswer).toMatch(/Toronto, Tokio y Singapur tienen una decisión de equivalencia y usan 2 meses/);
    expect(faqAnswer).not.toMatch(/SIX o Toronto/);
    expect(faqAnswer).toMatch(/33\.5\.e[^.]*#457/);
    expect(faqAnswer).not.toMatch(/si el valor no cotiza/);
    // A window still open at filing time is corrected with a rectificativa.
    expect(casillas).toMatch(/30 de junio del año siguiente[^.]*autoliquidación rectificativa/);
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

  it("tells a user who corrects an earlier year to remove the same loss from a later filed year, and never says every later purchase blocks (review of #453)", () => {
    // A loss 0.66.13 blocked against the one-purchase exception may have been
    // released, and deducted, in a later filed year: correcting only the earlier
    // year would deduct it twice. And a buy that only covers a short is no
    // repurchase, so "the purchases after always block" is wrong.
    const laterYears = {
      es: /revisa también los años posteriores que ya presentaste[^.]*corrige también ese año para quitarla/,
      en: /also check the later years you already filed[^.]*correct that year too to remove it/,
      ca: /revisa també els anys posteriors que ja vas presentar[^.]*corregeix també aquell any per treure-la/,
      eu: /berrikusi dagoeneko aurkeztu dituzun ondorengo urteak ere[^.]*zuzendu urte hori ere/,
      gl: /revisa tamén os anos posteriores que xa presentaches[^.]*corrixe tamén ese ano para quitala/,
    };
    const shortCover = { es: /posición corta/, en: /short position/, ca: /posició curta/, eu: /posizio motz/, gl: /posición curta/ };
    const alwaysBlock = /bloquean siempre|always block|sempre bloquegen|beti blokeatzen|bloquean sempre/;
    for (const [name, locale] of Object.entries(locales) as [keyof typeof locales, (typeof locales)["es"]][]) {
      const text = locale["guide_rw.blocked_losses_hint"];
      expect(text, name).toMatch(laterYears[name]);
      expect(text, name).toMatch(shortCover[name]);
      expect(text, name).not.toMatch(alwaysBlock);
    }
    const doc = (p: string) => readFileSync(new URL(`../../docs/${p}`, import.meta.url), "utf8");
    for (const p of ["casillas.md", "faq.md"]) {
      expect(doc(p), p).toMatch(/revisa también los años posteriores que ya presentaste/);
      expect(doc(p), p).toMatch(/salvo la que solo cierra una posición corta/);
      expect(doc(p), p).not.toMatch(/bloquea siempre/);
    }
  });

  it("gives crypto only the year after the sale (art. 33.5.e), in the 5 locales, report.ts, the docs and the engine (#457)", () => {
    // Letter e counts only a reacquisition «dentro del año siguiente a la fecha
    // de dicha transmisión»: a buy before the sale never blocks a crypto loss.
    const yearAfter = {
      es: /cripto[^.;]*año siguiente a la venta/,
      en: /crypto[^.;]*year after the sale/,
      ca: /cripto[^.;]*any següent a la venda/,
      eu: /kripto[^.;]*salmentaren ondorengo urte/,
      gl: /cripto[^.;]*ano seguinte á venda/,
    };
    const sameCoin = {
      es: /mismo valor o la misma criptomoneda/,
      en: /same security or the same coin/,
      ca: /mateix valor o la mateixa criptomoneda/,
      eu: /Balio bera edo kriptomoneta bera/,
      gl: /mesmo valor ou a mesma criptomoeda/,
    };
    const beforeSale = {
      es: /anteriores a la venta no cuentan/,
      en: /before the sale do not/,
      ca: /anteriors a la venda no compten/,
      eu: /salmentaren aurreko[^.]*ez dute balio/,
      gl: /anteriores á venda non contan/,
    };
    const keys = ["casilla.blocked_losses", "annex.wash_hint", "guide_rw.blocked_losses_hint", "report.antichurning_window_past_data"] as const;
    for (const [name, locale] of Object.entries(locales) as [keyof typeof locales, (typeof locales)["es"]][]) {
      for (const key of keys) expect(locale[key], `${name} ${key}`).toMatch(yearAfter[name]);
      expect(locale["report.antichurning_window_open_at_filing.hint"], name).toMatch(sameCoin[name]);
      for (const key of ["guide_rw.blocked_losses_hint", "report.antichurning_window_past_data.hint"] as const) {
        expect(locale[key], `${name} ${key}`).toMatch(beforeSale[name]);
      }
    }
    // report.ts writes the Spanish text itself; it must say the same as es.ts.
    const source = readFileSync(new URL("../../src/generators/report.ts", import.meta.url), "utf8");
    expect(source).toContain("En las criptomonedas solo cuentan las compras de la misma criptomoneda, en cualquier exchange, hechas después de la venta");
    expect(es["report.antichurning_window_past_data.hint"]).toContain("En las criptomonedas solo cuentan las compras de la misma criptomoneda, en cualquier exchange, hechas después de la venta");
    expect(source).toContain("Si compras el mismo valor o la misma criptomoneda hasta el ${ctx.windowEnd} inclusive");

    // The old claim that the engine gives crypto ±1 year must not come back.
    const oldClaim = /DeclaRenta les aplica ±1 año|engine (gives it|applies) ±1 year|criptomonedas[^.\n]*±12 meses|±12 meses[^.\n]*criptomonedas|#457, not handled/;
    const doc = (p: string) => readFileSync(new URL(`../../docs/${p}`, import.meta.url), "utf8");
    const texts = {
      casillas: doc("casillas.md"),
      faq: doc("faq.md"),
      modelos: doc("modelos-fiscales.md"),
      design: doc("design/antichurning-proportional.md"),
      claude: readFileSync(new URL("../../CLAUDE.md", import.meta.url), "utf8"),
      engine: readFileSync(new URL("../../src/engine/wash-sale.ts", import.meta.url), "utf8"),
    };
    for (const [name, text] of Object.entries(texts)) {
      expect(text, name).not.toMatch(oldClaim);
      expect(text, name).toMatch(/33\.5\.e/);
    }
    // Crypto = letter e is a deduction from the DGT's doctrine, not a holding.
    for (const name of ["casillas", "faq", "design"] as const) {
      expect(texts[name], name).toMatch(/V0525-25/);
      expect(texts[name], name).toMatch(/V1613-25/);
    }
    expect(texts.casillas).toMatch(/ninguna consulta[^.]*criptomonedas[^.]*33\.5/i);
    // Rewards do not count as a reacquisition: a documented choice.
    expect(texts.casillas).toMatch(/staking[^.]*no cuentan como recompra|no cuentan como recompra[^.]*staking/);
  });

  it("names the window's last day as included wherever a hint says up to {{windowEnd}} (#457 follow-up)", () => {
    // The detector counts a repurchase on the window's last day itself (sale +
    // 12 months, de fecha a fecha), so «antes del» / «before» would leave it out.
    const inclusive = {
      es: /hasta el \{\{windowEnd\}\} inclusive/,
      en: /up to and including \{\{windowEnd\}\}/,
      ca: /fins al \{\{windowEnd\}\} inclòs/,
      eu: /\{\{windowEnd\}\} arte, egun hori barne/,
      gl: /ata o \{\{windowEnd\}\} incluído/,
    };
    const exclusive = /(antes del?|(?<!or )before|abans del|baino lehen|at the latest until) \{\{windowEnd\}\}|\{\{windowEnd\}\} baino lehen/;
    for (const [name, locale] of Object.entries(locales) as [keyof typeof locales, (typeof locales)["es"]][]) {
      for (const key of ["report.antichurning_window_open_at_filing.hint", "report.antichurning_window_past_data.hint"] as const) {
        expect(locale[key], `${name} ${key}`).not.toMatch(exclusive);
      }
      expect(locale["report.antichurning_window_open_at_filing.hint"], name).toMatch(inclusive[name]);
    }
    const source = readFileSync(new URL("../../src/generators/report.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/antes del \$\{(ctx|base)\.windowEnd\}/);
  });

  it("tells users who filed crypto with 0.66.13 or earlier to correct that year, or the loss is never deducted (#457)", () => {
    // 0.66.13 let a buy before the sale block a crypto loss and released it in a
    // later year. The new engine deducts it in the year of the sale and no later
    // year releases it: without a correction the loss is lost.
    const neverDeducted = {
      es: /criptomonedas[^]*0\.66\.13[^]*solicitud de rectificación\); si no, no se deduce nunca/,
      en: /crypto[^]*0\.66\.13[^]*«solicitud de rectificación»\); otherwise it is never deducted/,
      ca: /criptomonedes[^]*0\.66\.13[^]*sol·licitud de rectificació\); si no, no es dedueix mai/,
      eu: /Kriptomonetetan[^]*0\.66\.13[^]*zuzenketa-eskaera\); bestela, ez da inoiz kentzen/,
      gl: /criptomoedas[^]*0\.66\.13[^]*solicitude de rectificación\); se non, non se deduce nunca/,
    };
    const twice = { es: /dos veces/, en: /twice/, ca: /dues vegades/, eu: /bi aldiz/, gl: /dúas veces/ };
    for (const [name, locale] of Object.entries(locales) as [keyof typeof locales, (typeof locales)["es"]][]) {
      expect(locale["guide_rw.blocked_losses_hint"], name).toMatch(neverDeducted[name]);
      expect(locale["guide_rw.blocked_losses_hint"], name).toMatch(twice[name]);
    }
    const doc = (p: string) => readFileSync(new URL(`../../docs/${p}`, import.meta.url), "utf8");
    const casillas = doc("casillas.md");
    expect(casillas).toContain('!!! warning "Criptomonedas: si declaraste con la versión 0.66.13 o anterior"');
    expect(casillas).toMatch(/0\.66\.13[^]*Si no lo corriges, esa pérdida no se deduce nunca[^]*no la deduzcas dos veces/);
    expect(doc("faq.md")).toMatch(/criptomonedas, si declaraste un año con la versión 0\.66\.13 o anterior[^.]*no se deduce nunca/);
  });

  it("says a crypto loss is released only when the rebought coins are sold, in the docs and the 5 locales (#457 follow-up)", () => {
    // Letter e: «se integrará cuando se produzca la posterior transmisión del
    // elemento patrimonial». The first #457 fix kept the share-count definitive
    // test, which released on a sale of other coins; the docs called it open.
    const doc = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
    const files = {
      casillas: doc("docs/casillas.md"),
      faq: doc("docs/faq.md"),
      modelos: doc("docs/modelos-fiscales.md"),
      design: doc("docs/design/antichurning-proportional.md"),
      claude: doc("CLAUDE.md"),
    };
    const oldOpenPoint = /puede liberarla antes de que vendas las unidades recompradas|can release before the reacquired units\s+are sold|Es un punto abierto|the engine keeps the #451\s+definitive test/;
    for (const [name, text] of Object.entries(files)) expect(text, name).not.toMatch(oldOpenPoint);
    expect(files.casillas).toMatch(/libera cuando las vendes[^.]*\. Si vendes otras unidades[^.]*\([^)]*\)[^.]*no se libera/);
    expect(files.casillas).toMatch(/Ninguna consulta de la DGT trata esta regla para las criptomonedas/);
    expect(files.faq).toMatch(/criptomonedas es distinto: la pérdida queda atada a las unidades de la recompra/);
    expect(files.modelos).toMatch(/criptomonedas, la pérdida diferida se integra cuando se venden las unidades de la recompra/);
    expect(files.design).toMatch(/A sale of other coins releases nothing/);
    expect(files.claude).toMatch(/Release = transmission of the rebought coins/);
    const otherCoins = {
      es: /vender otras unidades no la integra/i,
      en: /selling other coins does not release it/i,
      ca: /vendre'n altres unitats no la integra/i,
      eu: /beste unitate batzuk saltzeak ez du integratzen/i,
      gl: /vender outras unidades non a integra/i,
    };
    // A rebuy after the sale of the rebought coins does not hold the loss back
    // (no roll onto the new coins): the hints say «aunque vuelvas a comprar».
    const evenIfRebought = {
      es: /aunque vuelvas a comprar (esa|esta) criptomoneda/,
      en: /even if you buy (that|this) coin again/,
      ca: /encara que tornis a comprar aquesta criptomoneda/,
      eu: /kriptomoneta (bera|hau) berriro erosten baduzu ere/,
      gl: /aínda que volvas comprar (esa|esta) criptomoeda/,
    };
    const roll = /no vuelvas a comprar|do not buy that coin again|no tornis a comprar|erosten ez baduzu|non volvas comprar/;
    for (const [name, locale] of Object.entries(locales) as [keyof typeof locales, (typeof locales)["es"]][]) {
      for (const key of ["annex.wash_hint", "guide_rw.blocked_losses_hint", "annex.wash_released_hint_crypto"] as const) {
        expect(locale[key], `${name} ${key}`).toMatch(otherCoins[name]);
        expect(locale[key], `${name} ${key}`).toMatch(evenIfRebought[name]);
        expect(locale[key], `${name} ${key}`).not.toMatch(roll);
      }
      // A crypto release row never explains itself with the securities rule.
      for (const key of ["annex.wash_released_crypto", "annex.wash_released_hint_crypto"] as const) {
        expect(locale[key], `${name} ${key}`).not.toMatch(/definitiva|definitive|behin betiko|oldest first|más antiguas|zaharrenak/);
        expect(locale[key], `${name} ${key}`).toMatch(/33\.5\.e/);
      }
      expect(locale["casilla.reintegrated_losses"], name).toMatch(/cripto|crypto|kripto/);
    }
    const rollDocs = /pasa a las unidades nuevas|passes its claims to the new coins|rolledOf/;
    for (const [name, text] of Object.entries(files)) expect(text, name).not.toMatch(rollDocs);
  });

  it("puts each migration note under a warning box whose version title covers it, so a user who filed with a covered version reads it (#454)", () => {
    // A user skips a box titled «0.66.5 o anterior» when they filed with 0.66.6
    // to 0.66.13. The #453, #454 pick-order and same-day notes concern every
    // version up to 0.66.13, so they must sit under a box titled 0.66.13 or later.
    const casillas = readFileSync(new URL("../../docs/casillas.md", import.meta.url), "utf8");
    const patch = (v: string) => Number(v.split(".")[2]);
    // Each box: its title line, then its indented (or blank) body lines.
    const boxes = [...casillas.matchAll(/^!!! warning "([^"]*)"\n((?:(?: {4}.*)?\n)*)/gm)]
      .map((m) => ({ title: m[1] ?? "", body: m[2] ?? "" }))
      .filter((b) => /versión 0\.66\.\d+ o anterior/.test(b.title));
    expect(boxes.length).toBeGreaterThanOrEqual(2);
    for (const { title, body } of boxes) {
      const covered = patch(/0\.66\.\d+/.exec(title)?.[0] ?? "0.0.0");
      const named = [...body.matchAll(/0\.66\.\d+/g)].map((m) => patch(m[0]));
      // No paragraph talks about a version the title does not cover.
      for (const v of named) expect(v, title).toBeLessThanOrEqual(covered);
      // When the box also names an older version, "Esas versiones" no longer says which.
      if (named.some((v) => v < covered)) expect(body, title).not.toMatch(/Esas versiones/);
    }
    // The #451 note concerns 0.66.5 and earlier; the #453 and #454 notes concern
    // every version up to 0.66.13, so they sit in the box titled 0.66.13.
    const v5 = boxes.find((b) => b.title === "Si declaraste con la versión 0.66.5 o anterior");
    const v13 = boxes.find((b) => b.title === "Si declaraste con la versión 0.66.13 o anterior");
    expect(v5?.body).toContain("#451");
    for (const issue of ["#453", "#454"]) expect(v13?.body).toContain(issue);
    expect(v13?.body).toMatch(/mismo día de la venta \(issue #454\)[^]*V0571-21/);
  });
});
