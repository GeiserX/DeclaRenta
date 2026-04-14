/**
 * DeclaRenta CLI.
 *
 * Usage:
 *   declarenta convert --input flex.xml --year 2025
 *   declarenta convert --input flex.xml --year 2025 --output report.json
 *   declarenta modelo720 --input flex.xml --year 2025 --nif 12345678A
 */

import { readFileSync, writeFileSync } from "fs";
import { Command } from "commander";
import Decimal from "decimal.js";
import { parseIbkrFlexXml } from "../parsers/ibkr.js";
import { fetchEcbRates } from "../engine/ecb.js";
import { generateTaxReport } from "../generators/report.js";
import { generateModelo720 } from "../generators/modelo720.js";

// Configure Decimal.js for financial precision
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

const program = new Command();

program
  .name("declarenta")
  .description("Convert foreign broker reports into Spanish tax declarations")
  .version("0.1.0");

program
  .command("convert")
  .description("Convert IBKR Flex Query XML to Modelo 100 casilla values")
  .requiredOption("-i, --input <file>", "IBKR Flex Query XML file")
  .requiredOption("-y, --year <year>", "Tax year", parseInt)
  .option("-o, --output <file>", "Output file (JSON). Defaults to stdout")
  .action(async (opts: { input: string; year: number; output?: string }) => {
    try {
      console.error(`DeclaRenta v0.1.0 - Procesando ${opts.input} para el ejercicio ${opts.year}...`);

      // 1. Parse IBKR XML
      const xml = readFileSync(opts.input, "utf-8");
      const statement = parseIbkrFlexXml(xml);
      console.error(`  Operaciones: ${statement.trades.length}`);
      console.error(`  Transacciones de caja: ${statement.cashTransactions.length}`);
      console.error(`  Posiciones abiertas: ${statement.openPositions.length}`);

      // 2. Detect currencies and fetch ECB rates
      const currencies = new Set<string>();
      for (const t of statement.trades) currencies.add(t.currency);
      for (const c of statement.cashTransactions) currencies.add(c.currency);
      currencies.delete("EUR");

      console.error(`  Divisas detectadas: ${[...currencies].join(", ") || "solo EUR"}`);
      console.error("  Obteniendo tipos de cambio ECB...");

      const rateMap = await fetchEcbRates(opts.year, [...currencies]);
      console.error(`  Tipos ECB cargados: ${rateMap.size} fechas`);

      // 3. Generate tax report
      const report = generateTaxReport(statement, rateMap, opts.year);

      // 4. Format output
      const output = formatReport(report);

      if (opts.output) {
        writeFileSync(opts.output, JSON.stringify(output, null, 2));
        console.error(`\nInforme guardado en ${opts.output}`);
      } else {
        console.log(JSON.stringify(output, null, 2));
      }

      // 5. Print summary to stderr
      printSummary(report);
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

program
  .command("modelo720")
  .description("Generate Modelo 720 fixed-width file from IBKR positions")
  .requiredOption("-i, --input <file>", "IBKR Flex Query XML file")
  .requiredOption("-y, --year <year>", "Tax year", parseInt)
  .requiredOption("--nif <nif>", "NIF del declarante")
  .requiredOption("--name <name>", "Nombre completo (Apellidos, Nombre)")
  .option("-o, --output <file>", "Output file. Defaults to stdout")
  .option("--phone <phone>", "Teléfono de contacto", "")
  .action(async (opts: { input: string; year: number; nif: string; name: string; output?: string; phone: string }) => {
    try {
      const xml = readFileSync(opts.input, "utf-8");
      const statement = parseIbkrFlexXml(xml);

      const currencies = new Set<string>();
      for (const p of statement.openPositions) currencies.add(p.currency);
      currencies.delete("EUR");

      const rateMap = await fetchEcbRates(opts.year, [...currencies]);

      const nameParts = opts.name.split(",").map((s) => s.trim());
      const surname = nameParts[0] ?? "";
      const firstName = nameParts[1] ?? "";

      const content = generateModelo720(statement.openPositions, rateMap, {
        nif: opts.nif,
        surname,
        name: firstName,
        year: opts.year,
        phone: opts.phone,
        contactName: opts.name,
        declarationId: "0000000000001",
        isComplementary: false,
        isReplacement: false,
      });

      if (!content) {
        console.error("Posiciones en el extranjero por debajo de 50.000 EUR. No es necesario presentar Modelo 720.");
        return;
      }

      if (opts.output) {
        writeFileSync(opts.output, content, { encoding: "latin1" });
        console.error(`Modelo 720 guardado en ${opts.output}`);
      } else {
        console.log(content);
      }
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

function formatReport(report: ReturnType<typeof generateTaxReport>) {
  return {
    year: report.year,
    casillas: {
      "0029_dividendos_brutos": report.dividends.grossIncome.toFixed(2),
      "0032_gastos_deducibles_intereses": report.interest.paid.toFixed(2),
      "0033_intereses_cuentas": report.interest.earned.toFixed(2),
      "0327_valor_transmision": report.capitalGains.transmissionValue.toFixed(2),
      "0328_valor_adquisicion": report.capitalGains.acquisitionValue.toFixed(2),
      "0588_deduccion_doble_imposicion": report.doubleTaxation.deduction.toFixed(2),
    },
    resumen: {
      ganancia_neta: report.capitalGains.netGainLoss.toFixed(2),
      perdidas_bloqueadas_antichurning: report.capitalGains.blockedLosses.toFixed(2),
      num_operaciones: report.capitalGains.disposals.length,
      num_dividendos: report.dividends.entries.length,
    },
    doble_imposicion_por_pais: Object.fromEntries(
      Object.entries(report.doubleTaxation.byCountry).map(([country, data]) => [
        country,
        {
          impuesto_pagado: data.taxPaid.toFixed(2),
          deduccion_permitida: data.deductionAllowed.toFixed(2),
        },
      ]),
    ),
    operaciones: report.capitalGains.disposals.map((d) => ({
      isin: d.isin,
      simbolo: d.symbol,
      fecha_venta: d.sellDate,
      fecha_compra: d.acquireDate,
      cantidad: d.quantity.toString(),
      importe_venta_eur: d.proceedsEur.toFixed(2),
      coste_eur: d.costBasisEur.toFixed(2),
      ganancia_eur: d.gainLossEur.toFixed(2),
      dias_tenencia: d.holdingPeriodDays,
      bloqueada_antichurning: d.washSaleBlocked,
    })),
    dividendos: report.dividends.entries.map((d) => ({
      isin: d.isin,
      simbolo: d.symbol,
      fecha: d.payDate,
      bruto_eur: d.grossAmountEur.toFixed(2),
      retencion_eur: d.withholdingTaxEur.toFixed(2),
      pais: d.withholdingCountry,
    })),
  };
}

function printSummary(report: ReturnType<typeof generateTaxReport>) {
  console.error("\n═══════════════════════════════════════════════");
  console.error("  DECLARENTA - Resumen para Modelo 100");
  console.error("═══════════════════════════════════════════════");
  console.error(`  Ejercicio: ${report.year}`);
  console.error("");
  console.error("  GANANCIAS PATRIMONIALES (Base del ahorro)");
  console.error(`    Casilla 0327 (Valor transmisión):  ${report.capitalGains.transmissionValue.toFixed(2)} EUR`);
  console.error(`    Casilla 0328 (Valor adquisición):  ${report.capitalGains.acquisitionValue.toFixed(2)} EUR`);
  console.error(`    Ganancia/Pérdida neta:             ${report.capitalGains.netGainLoss.toFixed(2)} EUR`);
  if (report.capitalGains.blockedLosses.greaterThan(0)) {
    console.error(`    ⚠ Pérdidas bloqueadas (2 meses):   ${report.capitalGains.blockedLosses.toFixed(2)} EUR`);
  }
  console.error("");
  console.error("  RENDIMIENTOS CAPITAL MOBILIARIO");
  console.error(`    Casilla 0029 (Dividendos brutos):  ${report.dividends.grossIncome.toFixed(2)} EUR`);
  console.error(`    Casilla 0033 (Intereses ganados):  ${report.interest.earned.toFixed(2)} EUR`);
  console.error(`    Casilla 0032 (Intereses pagados):  ${report.interest.paid.toFixed(2)} EUR`);
  console.error("");
  console.error("  DOBLE IMPOSICIÓN INTERNACIONAL");
  console.error(`    Casilla 0588 (Deducción):          ${report.doubleTaxation.deduction.toFixed(2)} EUR`);
  console.error("═══════════════════════════════════════════════\n");
}

program.parse();
