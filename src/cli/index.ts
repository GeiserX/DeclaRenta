/**
 * DeclaRenta CLI.
 *
 * Usage:
 *   declarenta convert --input flex2025.xml --year 2025
 *   declarenta convert --input flex2023.xml --input flex2024.xml --input flex2025.xml --year 2025
 *   declarenta convert --input flex.xml --year 2025 --output report.json
 *   declarenta convert --input flex.xml --year 2025 --format pdf --output report.pdf
 *   declarenta modelo720 --input flex.xml --year 2025 --nif 12345678A
 *   declarenta modelo721 --input positions.json --year 2025 --nif 12345678A
 *   declarenta d6 --input flex.xml --year 2025 --nif 12345678A --name "Apellidos, Nombre"
 */

import { readFileSync, writeFileSync } from "fs";
import { Command } from "commander";
import Decimal from "decimal.js";
import { detectBroker, getBroker, brokerParsers } from "../parsers/index.js";
import { parseEtoroXlsx, detectEtoroXlsx } from "../parsers/etoro.js";
import type { Statement } from "../types/broker.js";
import type { EcbRateMap } from "../types/ecb.js";
import { fetchEcbRates } from "../engine/ecb.js";
import { generateTaxReport } from "../generators/report.js";
import { generateModelo720 } from "../generators/modelo720.js";
import { validateModelo720Records } from "../generators/modelo720-validator.js";
import { generateD6Report } from "../generators/d6.js";
import { generatePdfReport } from "../generators/pdf.js";
import { formatCsv } from "../generators/csv.js";
import { normalizeDate } from "../engine/dates.js";
import { applyLossCarryforward } from "../engine/loss-carryforward.js";
import type { LossCarryforward } from "../types/tax.js";

// Read version from package.json (single source of truth)
const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf-8")) as { version: string };

// Configure Decimal.js for financial precision
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

/** Encode a string to ISO-8859-15 bytes, remapping the 8 codepoints that differ from latin1. */
function encodeISO885915Buffer(str: string): Buffer {
  const ISO_REMAP: Record<number, number> = {
    0x20AC: 0xA4, 0x0160: 0xA6, 0x0161: 0xA8, 0x017D: 0xB4,
    0x017E: 0xB8, 0x0152: 0xBC, 0x0153: 0xBD, 0x0178: 0xBE,
  };
  const bytes = Buffer.alloc(str.length);
  for (let i = 0; i < str.length; i++) {
    const cp = str.charCodeAt(i);
    bytes[i] = ISO_REMAP[cp] ?? (cp <= 0xFF ? cp : 0x3F);
  }
  return bytes;
}

const program = new Command();

program
  .name("declarenta")
  .description("Convert foreign broker reports (IBKR, Degiro, Scalable Capital, eToro, Freedom24) into Spanish tax declarations (Modelo 100, 720, D-6)")
  .version(pkg.version);

// ---------------------------------------------------------------------------
// Helper: parse and merge broker files
// ---------------------------------------------------------------------------

async function parseAndMerge(
  inputFiles: string[],
  brokerName?: string,
): Promise<{ merged: Statement; brokerNames: string[] }> {
  const merged: Statement = {
    accountId: "",
    fromDate: "",
    toDate: "",
    period: "",
    trades: [],
    cashTransactions: [],
    corporateActions: [],
    openPositions: [],
    securitiesInfo: [],
  };
  const brokerNames: string[] = [];

  for (const file of inputFiles) {
    // Check for binary XLSX (eToro) first
    const buf = readFileSync(file);
    if (detectEtoroXlsx(buf)) {
      const statement = await parseEtoroXlsx(buf);
      merged.accountId = merged.accountId || statement.accountId;
      merged.trades.push(...statement.trades);
      merged.cashTransactions.push(...statement.cashTransactions);
      merged.corporateActions.push(...statement.corporateActions);
      merged.openPositions = statement.openPositions;
      merged.securitiesInfo.push(...statement.securitiesInfo);
      brokerNames.push("eToro");
      console.error(`  [eToro XLSX] ${file}: ${statement.trades.length} operaciones, ${statement.cashTransactions.length} transacciones`);
      continue;
    }

    const content = buf.toString("utf-8");
    const parser = brokerName ? getBroker(brokerName) : detectBroker(content);
    if (!parser) {
      const available = brokerParsers.map((p) => p.name).join(", ");
      throw new Error(
        brokerName
          ? `Broker desconocido: "${brokerName}". Disponibles: ${available}`
          : `No se pudo detectar el broker del fichero ${file}. Usa --broker para especificarlo. Disponibles: ${available}`,
      );
    }

    const statement = parser.parse(content);
    merged.accountId = merged.accountId || statement.accountId;
    merged.trades.push(...statement.trades);
    merged.cashTransactions.push(...statement.cashTransactions);
    merged.corporateActions.push(...statement.corporateActions);
    merged.openPositions = statement.openPositions;
    merged.securitiesInfo.push(...statement.securitiesInfo);
    brokerNames.push(parser.name);

    console.error(`  [${parser.name}] ${file}: ${statement.trades.length} operaciones, ${statement.cashTransactions.length} transacciones`);
  }

  // Sort trades chronologically for cross-broker FIFO
  merged.trades.sort((a, b) =>
    normalizeDate(a.tradeDate).localeCompare(normalizeDate(b.tradeDate)),
  );

  return { merged, brokerNames };
}

// ---------------------------------------------------------------------------
// Command: convert
// ---------------------------------------------------------------------------

program
  .command("convert")
  .description("Convert broker reports to Modelo 100 casilla values. Supports: IBKR, Degiro, Scalable Capital, eToro, Freedom24")
  .requiredOption("-i, --input <files...>", "Broker report file(s). Pass multiple for cross-year FIFO or cross-broker")
  .requiredOption("-y, --year <year>", "Tax year", parseInt)
  .option("-o, --output <file>", "Output file. Defaults to stdout")
  .option("-f, --format <format>", "Output format: json, csv, or pdf", "json")
  .option("-b, --broker <name>", `Broker name. Auto-detected if omitted. Available: ${brokerParsers.map((p) => p.name).join(", ")}`)
  .option("--prior-losses <file>", "JSON file with prior year losses for carryforward (Art. 49 LIRPF)")
  .action(async (opts: { input: string[]; year: number; output?: string; format: string; broker?: string; priorLosses?: string }) => {
    try {
      console.error(`DeclaRenta v${pkg.version} - Ejercicio ${opts.year}, ${opts.input.length} fichero(s)...`);

      // 1. Parse and merge
      const { merged, brokerNames } = await parseAndMerge(opts.input, opts.broker);
      const uniqueBrokers = [...new Set(brokerNames)];
      console.error(`  Brokers: ${uniqueBrokers.join(", ")}`);
      console.error(`  Total: ${merged.trades.length} operaciones, ${merged.cashTransactions.length} transacciones`);

      // 2. Detect currencies and fetch ECB rates
      const currencies = new Set<string>();
      for (const t of merged.trades) currencies.add(t.currency);
      for (const c of merged.cashTransactions) currencies.add(c.currency);
      currencies.delete("EUR");

      console.error(`  Divisas detectadas: ${[...currencies].join(", ") || "solo EUR"}`);
      console.error("  Obteniendo tipos de cambio ECB...");

      const years = new Set(merged.trades.map((t) => parseInt(t.tradeDate.slice(0, 4))));
      years.add(opts.year);
      // Fetch previous year for the earliest trade year so the 10-day lookback
      // can find late-December rates for early-January trades (e.g. Jan 1-2).
      const minYear = Math.min(...years);
      years.add(minYear - 1);
      const allRates: EcbRateMap = new Map();
      for (const yr of years) {
        const rates = await fetchEcbRates(yr, [...currencies]);
        for (const [date, ratesByDate] of rates) {
          allRates.set(date, ratesByDate);
        }
      }
      console.error(`  Tipos ECB cargados: ${allRates.size} fechas (${[...years].sort().join(", ")})`);

      // 3. Generate tax report
      const report = generateTaxReport(merged, allRates, opts.year);

      // 3b. Apply loss carryforward if prior losses provided
      if (opts.priorLosses) {
        const priorData = JSON.parse(readFileSync(opts.priorLosses, "utf-8")) as Array<{
          year: number; amount: string; remaining: string; category: "gains" | "income";
        }>;
        const priorLosses: LossCarryforward[] = priorData.map((l) => ({
          year: l.year,
          amount: new Decimal(l.amount),
          remaining: new Decimal(l.remaining),
          category: l.category,
        }));

        const netGains = report.capitalGains.netGainLoss;
        const netIncome = report.dividends.grossIncome.plus(report.interest.earned);
        const carryResult = applyLossCarryforward(opts.year, netGains, netIncome, priorLosses);

        // Log carryforward details
        for (const detail of carryResult.details) {
          console.error(`  ${detail}`);
        }
        if (carryResult.totalCompensated.greaterThan(0)) {
          console.error(`  Total compensado: ${carryResult.totalCompensated.toFixed(2)} EUR`);
        }
      }

      // 4. Format output
      if (opts.format === "pdf") {
        const pdfBuffer = await generatePdfReport(report);
        if (opts.output) {
          writeFileSync(opts.output, pdfBuffer);
          console.error(`\nPDF guardado en ${opts.output}`);
        } else {
          process.stdout.write(pdfBuffer);
        }
      } else if (opts.format === "csv") {
        const csv = formatCsv(report);
        if (opts.output) {
          writeFileSync(opts.output, csv);
          console.error(`\nCSV guardado en ${opts.output}`);
        } else {
          console.log(csv);
        }
      } else {
        const output = formatReport(report);
        if (opts.output) {
          writeFileSync(opts.output, JSON.stringify(output, null, 2));
          console.error(`\nInforme guardado en ${opts.output}`);
        } else {
          console.log(JSON.stringify(output, null, 2));
        }
      }

      // 5. Print warnings
      if (report.warnings.length > 0) {
        console.error(`\n⚠ ${report.warnings.length} advertencia(s):`);
        for (const w of report.warnings) {
          console.error(`  ${w}`);
        }
      }

      // 6. Print summary
      printSummary(report);
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// Command: modelo720
// ---------------------------------------------------------------------------

program
  .command("modelo720")
  .description("Generate Modelo 720 fixed-width file from broker positions")
  .requiredOption("-i, --input <file>", "Broker report file")
  .requiredOption("-y, --year <year>", "Tax year", parseInt)
  .requiredOption("--nif <nif>", "NIF del declarante")
  .requiredOption("--name <name>", "Nombre completo (Apellidos, Nombre)")
  .option("-o, --output <file>", "Output file. Defaults to stdout")
  .option("--phone <phone>", "Teléfono de contacto", "")
  .option("--previous-720 <file>", "Previous year 720 output file (to determine A/M/C types)")
  .action(async (opts: { input: string; year: number; nif: string; name: string; output?: string; phone: string; previous720?: string }) => {
    try {
      const content = readFileSync(opts.input, "utf-8");
      const parser = detectBroker(content);
      if (!parser) {
        throw new Error(`No se pudo detectar el broker del fichero ${opts.input}. Formatos soportados: ${brokerParsers.map((p) => `${p.name} (${p.formats.join(", ")})`).join("; ")}`);
      }
      const statement = parser.parse(content);

      const currencies = new Set<string>();
      for (const p of statement.openPositions) currencies.add(p.currency);
      currencies.delete("EUR");

      const rateMap = await fetchEcbRates(opts.year, [...currencies]);

      const nameParts = opts.name.split(",").map((s) => s.trim());
      const surname = nameParts[0] ?? "";
      const firstName = nameParts[1] ?? "";

      // Extract ISINs from previous year's 720 file (detail records start with "2", ISIN at positions 131-142)
      let previousYearIsins: string[] | undefined;
      if (opts.previous720) {
        const prev = readFileSync(opts.previous720, "utf-8");
        previousYearIsins = prev.split("\n")
          .filter((line) => line.startsWith("2"))
          .map((line) => line.slice(131, 143).trim())
          .filter((isin) => isin.length > 0);
      }

      const output720 = generateModelo720(statement.openPositions, rateMap, {
        nif: opts.nif,
        surname,
        name: firstName,
        year: opts.year,
        phone: opts.phone,
        contactName: opts.name,
        declarationId: "0000000000001",
        isComplementary: false,
        isReplacement: false,
        previousYearIsins,
      }, undefined, statement.cashBalances);

      if (!output720) {
        console.error("Posiciones en el extranjero por debajo de 50.000 EUR. No es necesario presentar Modelo 720.");
        return;
      }

      // Validate generated records against BOE format specification
      const records = output720.split("\n");
      const validationResults = validateModelo720Records(records);
      const invalidRecords = validationResults.filter((r) => !r.valid);
      if (invalidRecords.length > 0) {
        console.error(`\n⚠ ${invalidRecords.length} registro(s) con errores de formato:`);
        for (const r of invalidRecords) {
          for (const e of r.errors) {
            console.error(`  Registro ${r.recordIndex}: ${e}`);
          }
        }
        throw new Error("Modelo 720 generado con errores de formato.");
      }
      console.error(`✓ ${records.length} registro(s) validados correctamente.`);

      const iso885915Buf = encodeISO885915Buffer(output720);
      if (opts.output) {
        writeFileSync(opts.output, iso885915Buf);
        console.error(`Modelo 720 guardado en ${opts.output}`);
      } else {
        process.stdout.write(iso885915Buf);
      }
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// Command: d6
// ---------------------------------------------------------------------------

program
  .command("d6")
  .description("Generate Modelo D-6 AFORIX guide from broker positions")
  .requiredOption("-i, --input <file>", "Broker report file")
  .requiredOption("-y, --year <year>", "Tax year", parseInt)
  .requiredOption("--nif <nif>", "NIF del declarante")
  .requiredOption("--name <name>", "Nombre completo (Apellidos, Nombre)")
  .option("-o, --output <file>", "Output file. Defaults to stdout")
  .option("-f, --format <format>", "Output format: json or text", "text")
  .option("--previous-d6 <file>", "Previous year D-6 JSON output file (to generate cancellations)")
  .action(async (opts: { input: string; year: number; nif: string; name: string; output?: string; format: string; previousD6?: string }) => {
    try {
      const content = readFileSync(opts.input, "utf-8");
      const parser = detectBroker(content);
      if (!parser) {
        throw new Error(`No se pudo detectar el broker del fichero ${opts.input}. Formatos soportados: ${brokerParsers.map((p) => `${p.name} (${p.formats.join(", ")})`).join("; ")}`);
      }
      const statement = parser.parse(content);

      const currencies = new Set<string>();
      for (const p of statement.openPositions) currencies.add(p.currency);
      currencies.delete("EUR");

      // Extract ISINs from previous year's D-6 JSON output
      let previousYearIsins: string[] | undefined;
      if (opts.previousD6) {
        const prevJson = JSON.parse(readFileSync(opts.previousD6, "utf-8")) as { positions?: Array<{ isin: string }> };
        previousYearIsins = (prevJson.positions ?? []).map((p) => p.isin);
      }

      const rateMap = await fetchEcbRates(opts.year, [...currencies]);
      const report = generateD6Report(statement.openPositions, rateMap, opts.year, opts.name, opts.nif, previousYearIsins);

      if (report.positions.length === 0) {
        console.error("No se encontraron posiciones extranjeras. No es necesario presentar D-6.");
        return;
      }

      if (opts.format === "json") {
        const json = JSON.stringify(report, null, 2);
        if (opts.output) {
          writeFileSync(opts.output, json);
          console.error(`D-6 JSON guardado en ${opts.output}`);
        } else {
          console.log(json);
        }
      } else {
        const text = report.guide.join("\n");
        if (opts.output) {
          writeFileSync(opts.output, text);
          console.error(`D-6 guía guardada en ${opts.output}`);
        } else {
          console.log(text);
        }
      }
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// Command: modelo721
// ---------------------------------------------------------------------------

program
  .command("modelo721")
  .description("Generate Modelo 721 file for crypto assets (stub — real format is XML per Orden HFP/886/2023)")
  .requiredOption("-i, --input <file>", "JSON file with crypto positions")
  .requiredOption("-y, --year <year>", "Tax year", parseInt)
  .requiredOption("--nif <nif>", "NIF del declarante")
  .requiredOption("--name <name>", "Nombre completo (Apellidos, Nombre)")
  .option("-o, --output <file>", "Output file. Defaults to stdout")
  .option("--phone <phone>", "Teléfono de contacto", "")
  .action(() => {
    try {
      console.error("⚠ Modelo 721 es un stub: no hay parsers de crypto todavía.");
      console.error("  El fichero de entrada debe ser un JSON con las posiciones manualmente.");
      console.error("  Formato esperado: [{ assetId, description, exchangeName, countryCode, quantity, valuationEur, acquisitionCostEur }]");
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function formatReport(report: ReturnType<typeof generateTaxReport>) {
  return {
    year: report.year,
    casillas: {
      "0029_dividendos_brutos": report.dividends.grossIncome.toFixed(2),
      "intereses_margen_no_deducible_informativo": report.interest.paid.toFixed(2),
      "0033_intereses_cuentas": report.interest.earned.toFixed(2),
      "0327_valor_transmision": report.capitalGains.transmissionValue.toFixed(2),
      "0328_valor_adquisicion": report.capitalGains.acquisitionValue.toFixed(2),
      "1626_valor_transmision_fx": report.fxGains.transmissionValue.toFixed(2),
      "1631_valor_adquisicion_fx": report.fxGains.acquisitionValue.toFixed(2),
      "0588_deduccion_doble_imposicion": report.doubleTaxation.deduction.toFixed(2),
    },
    resumen: {
      ganancia_neta: report.capitalGains.netGainLoss.toFixed(2),
      perdidas_bloqueadas_antichurning: report.capitalGains.blockedLosses.toFixed(2),
      ganancia_neta_fx: report.fxGains.netGainLoss.toFixed(2),
      num_operaciones: report.capitalGains.disposals.length,
      num_operaciones_fx: report.fxGains.disposals.length,
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
      divisa: d.currency,
      tipo_ecb_compra: d.acquireEcbRate.toFixed(6),
      tipo_ecb_venta: d.sellEcbRate.toFixed(6),
      bloqueada_antichurning: d.washSaleBlocked,
    })),
    operaciones_fx: report.fxGains.disposals.map((d) => ({
      divisa: d.currency,
      fecha_venta: d.disposeDate,
      fecha_compra: d.acquireDate,
      cantidad: d.quantity.toString(),
      importe_venta_eur: d.proceedsEur.toFixed(2),
      coste_eur: d.costBasisEur.toFixed(2),
      ganancia_eur: d.gainLossEur.toFixed(2),
      dias_tenencia: d.holdingPeriodDays,
      origen: d.trigger,
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
  if (report.fxGains.disposals.length > 0) {
    console.error("");
    console.error("  GANANCIAS FX — MONEDA EXTRANJERA (Art. 37.1.l)");
    console.error(`    Casilla 1626 (Valor transmisión):  ${report.fxGains.transmissionValue.toFixed(2)} EUR`);
    console.error(`    Casilla 1631 (Valor adquisición):  ${report.fxGains.acquisitionValue.toFixed(2)} EUR`);
    console.error(`    Ganancia/Pérdida neta FX:          ${report.fxGains.netGainLoss.toFixed(2)} EUR`);
  }
  console.error("");
  console.error("  RENDIMIENTOS CAPITAL MOBILIARIO");
  console.error(`    Casilla 0029 (Dividendos brutos):  ${report.dividends.grossIncome.toFixed(2)} EUR`);
  console.error(`    Casilla 0033 (Intereses ganados):  ${report.interest.earned.toFixed(2)} EUR`);
  console.error(`    Intereses margen (no deducible, informativo):   ${report.interest.paid.toFixed(2)} EUR`);
  console.error("");
  console.error("  DOBLE IMPOSICIÓN INTERNACIONAL");
  console.error(`    Casilla 0588 (Deducción):          ${report.doubleTaxation.deduction.toFixed(2)} EUR`);
  console.error("═══════════════════════════════════════════════\n");
}

program.parse();
