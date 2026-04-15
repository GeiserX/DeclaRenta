/**
 * Modelo D-6 guide generator.
 *
 * D-6 (Declaración de inversiones en el exterior) is filed via the AFORIX
 * web form on Banco de España. There is no file upload — the user must
 * manually enter each position.
 *
 * This generator creates a structured cheat sheet showing exactly what to
 * type into each AFORIX form field, plus a step-by-step guide.
 *
 * Who must file: Any resident holding foreign securities as of Dec 31.
 * Deadline: January 31 of the following year.
 */

import Decimal from "decimal.js";
import type { OpenPosition } from "../types/ibkr.js";
import type { EcbRateMap } from "../types/ecb.js";
import { getEcbRate } from "../engine/ecb.js";

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

/** Complete D-6 report data */
export interface D6Report {
  year: number;
  declarantName: string;
  declarantNif: string;
  positions: D6Position[];
  totalPositions: number;
  totalValueEur: string;
  guide: string[];
}

/** Map ISIN country prefix to AFORIX exchange code (best-effort) */
function exchangeFromIsin(isin: string): string {
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
 * @returns D6Report with positions and AFORIX guide
 */
export function generateD6Report(
  positions: OpenPosition[],
  rateMap: EcbRateMap,
  year: number,
  declarantName: string,
  declarantNif: string,
): D6Report {
  const yearEnd = `${year}-12-31`;

  const d6Positions: D6Position[] = positions
    .filter((p) => p.assetCategory === "STK" || p.assetCategory === "FUND")
    .filter((p) => {
      // Only foreign positions (non-Spanish ISINs)
      const country = p.isin.slice(0, 2).toUpperCase();
      return country !== "ES";
    })
    .map((p) => {
      const ecbRate = getEcbRate(rateMap, yearEnd, p.currency);
      const valueEur = new Decimal(p.positionValue).abs().mul(ecbRate);

      return {
        isin: p.isin,
        description: p.description,
        countryCode: p.isin.slice(0, 2).toUpperCase(),
        exchangeCode: exchangeFromIsin(p.isin),
        sharesAtYearEnd: new Decimal(p.quantity).abs().toString(),
        marketValueEur: valueEur.toFixed(2),
        currency: p.currency,
      };
    });

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
    `PASO 1: Acceder a AFORIX`,
    `  → https://sefreca.bde.es/sefreca/`,
    `  → Seleccionar "Modelo D-6 (Inversiones en el exterior)"`,
    `  → Identificarse con certificado digital o Cl@ve`,
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

  guide.push(`PASO 4: Revisar y enviar`);
  guide.push(`  Total posiciones: ${d6Positions.length}`);
  guide.push(`  Valor total:      ${totalValue.toFixed(2)} EUR`);
  guide.push(``);
  guide.push(`NOTA: El D-6 es obligatorio para CUALQUIER importe de valores`);
  guide.push(`extranjeros. No tiene umbral mínimo (a diferencia del Modelo 720).`);

  return {
    year,
    declarantName,
    declarantNif,
    positions: d6Positions,
    totalPositions: d6Positions.length,
    totalValueEur: totalValue.toFixed(2),
    guide,
  };
}
