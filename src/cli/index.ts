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

import { readFileSync, writeFileSync, existsSync } from "fs";
import { Command } from "commander";
import Decimal from "decimal.js";
import { detectBroker, getBroker, brokerParsers } from "../parsers/index.js";
import { parseEtoroXlsx, detectEtoroXlsx } from "../parsers/etoro.js";
import { parseRevolutXlsx, detectRevolutXlsx } from "../parsers/revolut.js";
import type { Statement } from "../types/broker.js";
import type { EcbRateMap } from "../types/ecb.js";
import { fetchEcbRates } from "../engine/ecb.js";
import { buildEcbRateMap, deriveEcbNeeds } from "../engine/ecb-orchestrator.js";
import { buildManualRateMap, coerceManualQuotes } from "../engine/manual-rates.js";
import { generateTaxReport } from "../generators/report.js";
import { generateModelo720 } from "../generators/modelo720.js";
import { validateModelo720Records } from "../generators/modelo720-validator.js";
import { generateD6Report } from "../generators/d6.js";
import { generatePdfReport } from "../generators/pdf.js";
import { formatCsv } from "../generators/csv.js";
import { serializeFxTrace } from "../generators/fx-trace.js";
import { computeCasillaBlocksWithFx } from "../generators/casillas.js";
import { applyLossCarryforward } from "../engine/loss-carryforward.js";
import type { LossCarryforward } from "../types/tax.js";
import { createEmptyStatement, finalizeMergedStatement, mergeStatement } from "../parsers/merge.js";

declare const __PACKAGE_VERSION__: string | undefined;

// In built CLI bundles, tsup injects the package version so the executable does
// not depend on a fragile relative package.json path.
const pkg = { version: typeof __PACKAGE_VERSION__ === "string" ? __PACKAGE_VERSION__ : "dev" };

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
  .description("Convert foreign broker reports (IBKR, Trade Republic, Degiro, eToro, Scalable, Freedom24, Revolut, Lightyear, Coinbase, Binance, Kraken) into Spanish tax declarations (Modelo 100, 720, D-6)")
  .version(pkg.version);

// ---------------------------------------------------------------------------
// Helper: parse and merge broker files
// ---------------------------------------------------------------------------

async function parseAndMerge(
  inputFiles: string[],
  brokerName?: string,
): Promise<{ merged: Statement; brokerNames: string[] }> {
  const merged = createEmptyStatement();
  const brokerNames: string[] = [];

  for (const file of inputFiles) {
    // Check for binary XLSX (Revolut, eToro) first
    const buf = readFileSync(file);
    if (await detectRevolutXlsx(buf)) {
      const statement = await parseRevolutXlsx(buf);
      mergeStatement(merged, statement);
      brokerNames.push("Revolut");
      console.error(`  [Revolut XLSX] ${file}: ${statement.trades.length} operaciones, ${statement.cashTransactions.length} transacciones`);
      continue;
    }
    if (await detectEtoroXlsx(buf)) {
      const statement = await parseEtoroXlsx(buf);
      mergeStatement(merged, statement);
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
    mergeStatement(merged, statement);
    brokerNames.push(parser.name);

    console.error(`  [${parser.name}] ${file}: ${statement.trades.length} operaciones, ${statement.cashTransactions.length} transacciones`);
  }

  return { merged: finalizeMergedStatement(merged), brokerNames };
}

// ---------------------------------------------------------------------------
// Command: convert
// ---------------------------------------------------------------------------

program
  .command("convert")
  .description("Convert broker reports to Modelo 100 casilla values. Supports: IBKR, Trade Republic, Degiro, eToro, Scalable, Freedom24, Revolut, Lightyear, Coinbase, Binance, Kraken")
  .requiredOption("-i, --input <files...>", "Broker report file(s). Pass multiple for cross-year FIFO or cross-broker")
  .requiredOption("-y, --year <year>", "Tax year", parseInt)
  .option("-o, --output <file>", "Output file. Defaults to stdout")
  .option("-f, --format <format>", "Output format: json, csv, or pdf", "json")
  .option("-b, --broker <name>", `Broker name. Auto-detected if omitted. Available: ${brokerParsers.map((p) => p.name).join(", ")}`)
  .option("--prior-losses <file>", "JSON file with prior year losses for carryforward (Art. 49 LIRPF)")
  .option("--monodivisa", "Disable FX FIFO engine — treat all as EUR (like Autodeclaro/Taxdown)")
  .option("--titulares <n>", "Number of account holders. >1 splits all amounts equally per contribuyente (Art. 11.3 LIRPF)", parseInt)
  .option("--crypto-rates <json>", "Manual EUR-per-unit quotes for crypto↔crypto swaps without an ECB rate. Inline JSON or path to a JSON file: [{ \"currency\": \"SOL\", \"date\": \"2024-03-01\", \"eurPerUnit\": \"120.50\" }]")
  .option("--fx-trace [file]", "Volcar la traza de movimientos del motor FX (acuñar/aparcar/desaparcar/descartar/convertir) para auditoría. Sin valor → stderr; con ruta → fichero.")
  .option("--fx-trace-format <format>", "Formato de la traza FX: jsonl o csv", "jsonl")
  .action(async (opts: { input: string[]; year: number; output?: string; format: string; broker?: string; priorLosses?: string; monodivisa?: boolean; titulares?: number; cryptoRates?: string; fxTrace?: string | boolean; fxTraceFormat?: string }) => {
    try {
      console.error(`DeclaRenta v${pkg.version} - Ejercicio ${opts.year}, ${opts.input.length} fichero(s)...`);

      // 1. Parse and merge
      const { merged, brokerNames } = await parseAndMerge(opts.input, opts.broker);
      const uniqueBrokers = [...new Set(brokerNames)];
      console.error(`  Brokers: ${uniqueBrokers.join(", ")}`);
      console.error(`  Total: ${merged.trades.length} operaciones, ${merged.cashTransactions.length} transacciones`);

      // 2. Detect currencies and fetch ECB rates (shared orchestrator: derive
      //    needed (currency, year) pairs → fetch per-year → merge into one map).
      const needs = deriveEcbNeeds(merged, opts.year);
      console.error(`  Divisas detectadas: ${needs.currencies.join(", ") || "solo EUR"}`);
      console.error("  Obteniendo tipos de cambio ECB...");

      const allRates = await buildEcbRateMap(needs);
      console.error(`  Tipos ECB cargados: ${allRates.size} fechas (${[...needs.years].sort((a, b) => a - b).join(", ")})`);

      // 2b. Parse optional manual crypto rates (--crypto-rates). Inline JSON or
      //     a path to a JSON file. Used as a fallback for crypto↔crypto permutas
      //     that have no ECB rate (Binance Convert, etc.).
      let manualRates: EcbRateMap | undefined;
      if (opts.cryptoRates) {
        let parsed: unknown;
        try {
          const raw = existsSync(opts.cryptoRates)
            ? readFileSync(opts.cryptoRates, "utf-8")
            : opts.cryptoRates;
          parsed = JSON.parse(raw);
        } catch {
          console.error("Error: --crypto-rates no es JSON válido ni un fichero JSON legible.");
          process.exit(1);
        }
        if (!Array.isArray(parsed)) {
          console.error("Error: --crypto-rates debe ser un array de { currency, date, eurPerUnit }.");
          process.exit(1);
        }
        manualRates = buildManualRateMap(coerceManualQuotes(parsed));
        const loaded = [...manualRates.values()].reduce((n, m) => n + m.size, 0);
        console.error(`  Tipos manuales crypto cargados: ${loaded}`);
      }

      // 3. Generate tax report
      const report = generateTaxReport(merged, allRates, opts.year, { skipFx: opts.monodivisa, titulares: opts.titulares, manualRates, fxTrace: opts.fxTrace !== undefined && opts.fxTrace !== false });
      if (opts.titulares && opts.titulares > 1) {
        console.error(`  Titulares: ${opts.titulares} (importes divididos por contribuyente)`);
      }

      // 3b. Apply loss carryforward if prior losses provided
      if (opts.priorLosses) {
        // Parse + validate exactly like --crypto-rates above: never trust the
        // file's shape. A bad entry is dropped with a warning; an unparseable
        // amount/remaining can't reach new Decimal() unguarded (it would throw
        // outside this block and abort with a cryptic stack instead of a clear
        // Spanish message).
        let parsedLosses: unknown;
        try {
          parsedLosses = JSON.parse(readFileSync(opts.priorLosses, "utf-8"));
        } catch {
          console.error(`Error: No se pudo leer el archivo ${opts.priorLosses}: JSON inválido.`);
          process.exit(1);
        }
        if (!Array.isArray(parsedLosses)) {
          console.error("Error: --prior-losses debe ser un array de { year, amount, remaining, category }.");
          process.exit(1);
        }

        const priorLosses: LossCarryforward[] = [];
        for (const raw of parsedLosses as unknown[]) {
          if (raw == null || typeof raw !== "object") {
            console.error("Aviso: se ha omitido una entrada de --prior-losses con formato no válido.");
            continue;
          }
          const l = raw as Record<string, unknown>;
          if (typeof l.amount !== "string" || typeof l.remaining !== "string") {
            console.error("Aviso: se ha omitido una entrada de --prior-losses sin \"amount\"/\"remaining\" de tipo cadena.");
            continue;
          }
          if (l.category !== "gains" && l.category !== "income") {
            console.error('Aviso: se ha omitido una entrada de --prior-losses con "category" no válida (debe ser "gains" o "income").');
            continue;
          }
          const year = typeof l.year === "number" && Number.isFinite(l.year) ? l.year : NaN;
          if (Number.isNaN(year)) {
            console.error('Aviso: se ha omitido una entrada de --prior-losses con "year" no numérico.');
            continue;
          }
          let amount: Decimal;
          let remaining: Decimal;
          try {
            amount = new Decimal(l.amount);
            remaining = new Decimal(l.remaining);
          } catch {
            console.error(`Aviso: se ha omitido una entrada de --prior-losses con importes no numéricos (year ${year}).`);
            continue;
          }
          if (!amount.isFinite() || !remaining.isFinite()) {
            console.error(`Aviso: se ha omitido una entrada de --prior-losses con importes no finitos (year ${year}).`);
            continue;
          }
          priorLosses.push({ year, amount, remaining, category: l.category });
        }

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

      // 4b. Emit FX-FIFO movement trace if requested (--fx-trace). With a path →
      //     fichero; sin valor (boolean true) → stderr, so it never corrupts a
      //     JSON/CSV stdout payload. Con --monodivisa el motor FX no se ejecuta,
      //     así que report.fxTrace queda indefinido → se informa "sin movimientos".
      if (opts.fxTrace !== undefined && opts.fxTrace !== false) {
        if (!report.fxTrace || report.fxTrace.length === 0) {
          console.error("(sin movimientos FX que trazar)");
        } else {
          const fmt = opts.fxTraceFormat === "csv" ? "csv" : "jsonl";
          const traceStr = serializeFxTrace(report.fxTrace, fmt);
          if (typeof opts.fxTrace === "string") {
            writeFileSync(opts.fxTrace, traceStr);
            console.error(`\nTraza FX guardada en ${opts.fxTrace} (${report.fxTrace.length} movimientos)`);
          } else {
            console.error(`\n--- Traza FX (${report.fxTrace.length} movimientos) ---`);
            process.stderr.write(traceStr + "\n");
          }
        }
      }

      // 5. Print messages (three-tier)
      const msgs = report.messages;
      const errors = msgs.filter((m) => m.severity === "error");
      const warnings = msgs.filter((m) => m.severity === "warning");
      const infos = msgs.filter((m) => m.severity === "info");

      if (errors.length > 0) {
        console.error(`\n⛔ ${errors.length} error(es):`);
        for (const e of errors) {
          console.error(`  ${e.message}`);
          if (e.hint) console.error(`    → ${e.hint}`);
        }
      }
      if (warnings.length > 0) {
        console.error(`\n⚠ ${warnings.length} aviso(s):`);
        for (const w of warnings) {
          console.error(`  ${w.message}`);
          if (w.hint) console.error(`    → ${w.hint}`);
        }
      }
      if (infos.length > 0) {
        console.error(`\nℹ ${infos.length} nota(s) informativas:`);
        for (const i of infos) {
          console.error(`  ${i.message}`);
          if (i.hint) console.error(`    → ${i.hint}`);
        }
      }

      // 5b. Surface unresolved crypto↔crypto valuations (no ECB rate, no
      //     cross-leg). Show only identifying fields, never financial totals.
      const unresolved = report.unresolvedCryptoValuations;
      if (unresolved && unresolved.length > 0) {
        console.error(`\n🪙 ${unresolved.length} permuta(s) crypto sin valoración en EUR:`);
        for (const u of unresolved) {
          console.error(`  ${u.symbol} — ${u.quantity} ${u.currency} @ ${u.date}`);
        }
        console.error("  → Aporta el valor en EUR por unidad con --crypto-rates");
        console.error('    Ejemplo: --crypto-rates \'[{"currency":"SOL","date":"2024-03-01","eurPerUnit":"120.50"}]\'');
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
        let prev: string;
        try {
          prev = readFileSync(opts.previous720, "utf-8");
        } catch {
          console.error(`Error: No se pudo leer el archivo ${opts.previous720}.`);
          process.exit(1);
        }
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
        let prevJson: { positions?: Array<{ isin: string }> };
        try {
          prevJson = JSON.parse(readFileSync(opts.previousD6, "utf-8")) as { positions?: Array<{ isin: string }> };
        } catch {
          console.error(`Error: No se pudo leer el archivo ${opts.previousD6}: JSON inválido.`);
          process.exit(1);
        }
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
  const blocks = computeCasillaBlocksWithFx(report);
  return {
    year: report.year,
    casillas: {
      "0029_dividendos_brutos": report.dividends.grossIncome.toFixed(2),
      "intereses_margen_no_deducible_informativo": report.interest.paid.toFixed(2),
      "0027_intereses_cuentas": report.interest.earned.toFixed(2),
      "0304_ganancias_no_derivadas_transmision_base_general": report.generalGains.total.toFixed(2),
      // Acciones negociadas en mercados regulados (Art. 37.1.a LIRPF)
      "0328_valor_transmision_acciones": blocks.listedShares.transmissionValue.toFixed(2),
      "0331_valor_adquisicion_acciones": blocks.listedShares.acquisitionValue.toFixed(2),
      // Otros elementos patrimoniales: opciones/cripto/fondos (Art. 37.1.m) + divisa (Art. 33.1)
      "1633_valor_transmision_otros": blocks.otherElements.transmissionValue.toFixed(2),
      "1637_valor_adquisicion_otros": blocks.otherElements.acquisitionValue.toFixed(2),
      "0588_deduccion_doble_imposicion": report.doubleTaxation.deduction.toFixed(2),
    },
    resumen: {
      ganancia_neta: report.capitalGains.netGainLoss.toFixed(2),
      perdidas_bloqueadas_antichurning: report.capitalGains.blockedLosses.toFixed(2),
      perdidas_reintegradas_antichurning: report.capitalGains.reintegratedLosses.toFixed(2),
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
      lote_fifo: d.lotId,
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
  const blocks = computeCasillaBlocksWithFx(report);
  if (blocks.listedShares.count > 0) {
    console.error("  ACCIONES NEGOCIADAS — mercados regulados (Art. 37.1.a)");
    console.error(`    Casilla 0328 (Valor transmisión):  ${blocks.listedShares.transmissionValue.toFixed(2)} EUR`);
    console.error(`    Casilla 0331 (Valor adquisición):  ${blocks.listedShares.acquisitionValue.toFixed(2)} EUR`);
    console.error(`    Ganancia/Pérdida neta:             ${blocks.listedShares.netGainLoss.toFixed(2)} EUR`);
  }
  if (blocks.otherElements.count > 0) {
    console.error("");
    console.error("  OTROS ELEMENTOS PATRIMONIALES — opciones/cripto/fondos (Art. 37.1.m) + divisa (Art. 33.1)");
    console.error(`    Casilla 1633 (Valor transmisión):  ${blocks.otherElements.transmissionValue.toFixed(2)} EUR`);
    console.error(`    Casilla 1637 (Valor adquisición):  ${blocks.otherElements.acquisitionValue.toFixed(2)} EUR`);
    console.error(`    Ganancia/Pérdida neta:             ${blocks.otherElements.netGainLoss.toFixed(2)} EUR`);
  }
  if (report.capitalGains.blockedLosses.greaterThan(0)) {
    console.error(`    ⚠ Pérdidas bloqueadas (2 meses):   ${report.capitalGains.blockedLosses.toFixed(2)} EUR`);
  }
  if (report.capitalGains.reintegratedLosses.greaterThan(0)) {
    console.error(`    ↩ Pérdidas reintegradas (diferidas de años anteriores): ${report.capitalGains.reintegratedLosses.toFixed(2)} EUR`);
  }
  console.error("");
  console.error("  RENDIMIENTOS CAPITAL MOBILIARIO");
  console.error(`    Casilla 0029 (Dividendos brutos):  ${report.dividends.grossIncome.toFixed(2)} EUR`);
  console.error(`    Casilla 0027 (Intereses ganados):  ${report.interest.earned.toFixed(2)} EUR`);
  console.error(`    Intereses margen (no deducible, informativo):   ${report.interest.paid.toFixed(2)} EUR`);
  if (report.generalGains.total.greaterThan(0)) {
    console.error("");
    console.error("  GANANCIAS PATRIMONIALES NO DERIVADAS DE TRANSMISIÓN (base general)");
    console.error(`    Casilla 0304 (airdrops/comisiones referidos):   ${report.generalGains.total.toFixed(2)} EUR`);
  }
  console.error("");
  console.error("  DOBLE IMPOSICIÓN INTERNACIONAL");
  console.error(`    Casilla 0588 (Deducción):          ${report.doubleTaxation.deduction.toFixed(2)} EUR`);
  console.error("═══════════════════════════════════════════════\n");
}

program.parse();
