/**
 * Modelo D-6 guide generator.
 *
 * D-6 (Declaración de inversiones en el exterior) is filed with the
 * Registro de Inversiones Exteriores (Secretaría de Estado de Comercio): the
 * user prepares and signs the declaration in the AFORIX program, entering each
 * position by hand, then uploads the signed file at eAFORIX
 * (https://oficinavirtual.comercio.gob.es/eAFORIX/).
 *
 * This generator creates a structured cheat sheet showing exactly what to
 * type into each AFORIX form field, plus a step-by-step guide.
 *
 * Who must file: Since Orden ICT/1408/2021, generally only significant
 * holdings (10% or more of capital/voting rights) in listed foreign companies.
 * Retail portfolio holders are usually outside scope; this is an advisory guide.
 * Deadline: January 31 of the following year.
 */

import Decimal from "decimal.js";
import type { OpenPosition } from "../types/ibkr.js";
import type { EcbRateMap } from "../types/ecb.js";
import { hasNoMarketValue, isD6Holding, lookupPositionRate, positionValueOf } from "../engine/ecb.js";
import { d6ShareCount, fitsModelo720Amount } from "./modelo720.js";

/** A single position row for the D-6 report */
export interface D6Position {
  isin: string;
  description: string;
  countryCode: string;
  exchangeCode: string;
  sharesAtYearEnd: string;
  marketValueEur: string;
  currency: string;
}

/** A cancelled position (was in prior year, no longer held) */
export interface D6Cancellation {
  isin: string;
  reason: string;
}

/** A held position the guide cannot list as an entry (no value or no valid share count): declare it by hand. */
export interface D6Unvalued {
  isin: string;
  description: string;
}

/** Complete D-6 report data */
export interface D6Report {
  year: number;
  declarantName: string;
  declarantNif: string;
  positions: D6Position[];
  cancelled: D6Cancellation[];
  totalPositions: number;
  totalValueEur: string;
  /** Held foreign positions left out because they have no year-end rate, no market value, no valid share count or a value too big for the 720's valoración (#470): declare them by hand. */
  unvaluedCount: number;
  /** Those positions, as the guide names them. Present only when there is one. */
  unvalued?: D6Unvalued[];
  guide: string[];
}

/** Map ISIN country prefix to AFORIX exchange code (best-effort, equities only) */
function exchangeFromIsin(isin: string, assetCategory?: string): string {
  // Bonds trade OTC or on dedicated platforms, not equity exchanges
  if (assetCategory === "BOND") return "XOTC";
  const country = isin.slice(0, 2).toUpperCase();
  const map: Record<string, string> = {
    US: "XNYS", // NYSE (default for US)
    GB: "XLON", // London
    DE: "XETR", // Xetra
    FR: "XPAR", // Euronext Paris
    NL: "XAMS", // Euronext Amsterdam
    IE: "XDUB", // Dublin / often traded on XETR
    CH: "XSWX", // SIX
    JP: "XTKS", // Tokyo
    CA: "XTSE", // Toronto
    HK: "XHKG", // Hong Kong
    AU: "XASX", // ASX
    TW: "XTAI", // Taiwan
    KR: "XKRX", // Korea
  };
  return map[country] ?? "XXXX";
}

/**
 * Generate a D-6 report from open positions at year end.
 *
 * @param positions - Open positions at Dec 31
 * @param rateMap - ECB exchange rates
 * @param year - Tax year
 * @param declarantName - Full name
 * @param declarantNif - NIF
 * @param previousYearIsins - ISINs declared in the previous year's D-6 (for cancellations)
 * @returns D6Report with positions, cancellations and AFORIX guide
 */
export function generateD6Report(
  positions: OpenPosition[],
  rateMap: EcbRateMap,
  year: number,
  declarantName: string,
  declarantNif: string,
  previousYearIsins?: string[],
): D6Report {
  const yearEnd = `${year}-12-31`;

  const unvalued: D6Unvalued[] = [];
  const d6Positions: D6Position[] = positions
    .filter((p) => p.assetCategory === "STK" || p.assetCategory === "FUND" || p.assetCategory === "BOND")
    .filter((p) => {
      // Only foreign positions (non-Spanish ISINs)
      const country = p.isin.slice(0, 2).toUpperCase();
      return country !== "ES";
    })
    // Exclude short positions and rows that hold nothing (isD6Holding).
    .filter(isD6Holding)
    .flatMap((p) => {
      const ecbRate = lookupPositionRate(rateMap, yearEnd, p.currency);
      // No resolvable year-end rate, or no market value in the export → can't
      // value in EUR; skip it (never as 0 €) and count it for the caller. With
      // no share count the entry would say 0 shares: skip and count it too
      // (tested first: its value may be unreadable text).
      const value = positionValueOf(p);
      const valueEur = ecbRate === null || value === null ? null : value.mul(ecbRate);
      const shares = d6ShareCount(p);
      // A value too big for the 720's valoración (12 integer digits in euros)
      // is «sin valorar» there; the D-6 follows the same rule, so the two forms
      // never disagree on a holding and no total runs to hundreds of digits.
      // The share count follows the 720's «Número de valores» (`d6ShareCount`).
      if (valueEur === null || shares === null || hasNoMarketValue(p) || !fitsModelo720Amount(valueEur)) {
        unvalued.push({ isin: p.isin, description: p.description });
        return [];
      }

      return [{
        isin: p.isin,
        description: p.description,
        countryCode: p.isin.slice(0, 2).toUpperCase(),
        exchangeCode: exchangeFromIsin(p.isin, p.assetCategory),
        // toFixed, never toString: decimal.js writes 1e21 and above, and below
        // 1e-7, in exponent form ("5e-8"). `d6ShareCount` keeps the count to 10
        // integer digits and 20 decimals, so the string stays short.
        sharesAtYearEnd: shares.toFixed(),
        marketValueEur: valueEur.toFixed(2),
        currency: p.currency,
      }];
    });

  // Build cancellation list: ISINs in previousYearIsins no longer HELD. Use the
  // held foreign-position set, NOT `d6Positions` — a still-held position that
  // couldn't be valued (no year-end rate) is skipped from d6Positions but must
  // NOT be reported as sold/liquidated. Nor must a holding whose quantity the
  // file does not give (`quantityUnknown`, quantity "0"): the broker lists it,
  // so it is no sale, though without a share count it has no position entry.
  // Its sign then comes from its value, as in the 720's `isHeldSecurity`: a
  // short one (negative value) is no holding, so it is cancelled there too. An
  // unreadable value proves no short: the holding stays held.
  const heldIsins = new Set(
    positions
      .filter((p) => p.assetCategory === "STK" || p.assetCategory === "FUND" || p.assetCategory === "BOND")
      .filter((p) => p.isin.slice(0, 2).toUpperCase() !== "ES")
      .filter(isD6Holding)
      .map((p) => p.isin),
  );
  const previousIsins = new Set(previousYearIsins ?? []);
  const cancelled: D6Cancellation[] = [...previousIsins]
    .filter((isin) => !heldIsins.has(isin))
    .map((isin) => ({
      isin,
      reason: "Posición vendida o liquidada durante el ejercicio",
    }));

  const totalValue = d6Positions.reduce(
    (sum, p) => sum.plus(new Decimal(p.marketValueEur)),
    new Decimal(0),
  );

  const guide = [
    `═══════════════════════════════════════════════════════════════`,
    `  MODELO D-6 — Guía de cumplimentación AFORIX`,
    `  Ejercicio: ${year}  |  Plazo: hasta 31 de enero de ${year + 1}`,
    `═══════════════════════════════════════════════════════════════`,
    ``,
    `PASO 1: Abrir el programa AFORIX`,
    `  → Programa de la Secretaría de Estado de Comercio (comercio.gob.es)`,
    `  → Crear una declaración del modelo D-6 (inversiones en el exterior)`,
    ``,
    `PASO 2: Datos del declarante`,
    `  NIF: ${declarantNif}`,
    `  Nombre: ${declarantName}`,
    `  Tipo: Persona física`,
    `  Ejercicio: ${year}`,
    ``,
    `PASO 3: Añadir posiciones (una por cada valor)`,
    ``,
  ];

  for (let i = 0; i < d6Positions.length; i++) {
    const p = d6Positions[i]!;
    guide.push(`  ─── Posición ${i + 1} de ${d6Positions.length} ───`);
    guide.push(`  ISIN:              ${p.isin}`);
    guide.push(`  Denominación:      ${p.description}`);
    guide.push(`  País emisor:       ${p.countryCode}`);
    guide.push(`  Mercado:           ${p.exchangeCode}`);
    guide.push(`  Nº títulos:        ${p.sharesAtYearEnd}`);
    guide.push(`  Valor mercado EUR: ${p.marketValueEur}`);
    guide.push(`  Divisa original:   ${p.currency}`);
    guide.push(``);
  }

  // A held holding with no value or no share count has no entry above: name
  // it, so the guide never drops a holding without a word (#470).
  if (unvalued.length > 0) {
    guide.push(`SIN VALORAR O SIN Nº DE TÍTULOS (añádelas a mano en AFORIX con su valor en euros y su número de títulos)`);
    guide.push(``);
    for (const u of unvalued) {
      guide.push(`  ${u.isin}  ${u.description}`);
    }
    guide.push(``);
  }

  if (cancelled.length > 0) {
    guide.push(`CANCELACIONES (posiciones declaradas el año anterior ya no mantenidas)`);
    guide.push(``);
    for (let i = 0; i < cancelled.length; i++) {
      const c = cancelled[i]!;
      guide.push(`  ─── Cancelación ${i + 1} de ${cancelled.length} ───`);
      guide.push(`  ISIN:   ${c.isin}`);
      guide.push(`  Motivo: ${c.reason}`);
      guide.push(``);
    }
  }

  guide.push(`PASO 4: Revisar, firmar y presentar`);
  guide.push(`  Total posiciones activas:  ${d6Positions.length}`);
  guide.push(`  Total cancelaciones:       ${cancelled.length}`);
  if (unvalued.length > 0) guide.push(`  Sin valorar (a mano):      ${unvalued.length}`);
  guide.push(`  Valor total:               ${totalValue.toFixed(2)} EUR`);
  guide.push(`  → Firmar electrónicamente la declaración en AFORIX`);
  guide.push(`  → Subir el fichero firmado (.aforixd) en eAFORIX:`);
  guide.push(`    https://oficinavirtual.comercio.gob.es/eAFORIX/`);
  guide.push(``);
  guide.push(`NOTA: desde la Orden ICT/1408/2021, el D-6 suele limitarse`);
  guide.push(`a participaciones del 10% o más en sociedades cotizadas extranjeras.`);
  guide.push(`Esta guía no determina por sí sola obligación de presentación.`);

  return {
    year,
    declarantName,
    declarantNif,
    positions: d6Positions,
    cancelled,
    totalPositions: d6Positions.length,
    totalValueEur: totalValue.toFixed(2),
    unvaluedCount: unvalued.length,
    ...(unvalued.length > 0 ? { unvalued } : {}),
    guide,
  };
}
