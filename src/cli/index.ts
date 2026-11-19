/**
 * DeclaRenta CLI.
 *
 * Usage:
 *   declarenta convert --input flex2025.xml --year 2025
 *   declarenta convert --input flex2023.xml --input flex2024.xml --input flex2025.xml --year 2025
 *   declarenta convert --input flex.xml --year 2025 --output report.json
 *   declarenta convert --input flex.xml --year 2025 --format pdf --output report.pdf
 *   declarenta modelo720 --input flex.xml --year 2025 --nif 12345678A
 *   declarenta modelo720 --input ibkr_cuenta1.xml --input ibkr_cuenta2.xml --year 2025 --nif 12345678A
 *   declarenta d6 --input flex.xml --year 2025 --nif 12345678A --name "Apellidos, Nombre"
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { Command, InvalidArgumentError, Option } from "commander";
import Decimal from "decimal.js";
import { detectBroker, getBroker, brokerParsers } from "../parsers/index.js";
import { parseXlsxExport } from "../parsers/xlsx.js";
import type { Statement } from "../types/broker.js";
import type { EcbRateMap } from "../types/ecb.js";
import { formatDateDmy, positionsDateMismatch } from "../engine/dates.js";
import { buildEcbRateMap, deriveEcbNeeds } from "../engine/ecb-orchestrator.js";
import { buildManualRateMap, coerceManualQuotes } from "../engine/manual-rates.js";
import { isValidIsin } from "../engine/antichurning-window.js";
import { cashAverageOf, heldCashBalances } from "../engine/ecb.js";
import { generateTaxReport, reportOptionsForMethod } from "../generators/report.js";
import {
  checkModelo720Thresholds,
  findModelo720Omissions,
  findUndatedExtinctions,
  generateModelo720,
  modelo720DeclarationId,
  readPrevious720,
  unvaluedCashBalances,
} from "../generators/modelo720.js";
import { validateModelo720Records } from "../generators/modelo720-validator.js";
import { generateD6Report } from "../generators/d6.js";
import { generatePdfReport } from "../generators/pdf.js";
import { formatCsv } from "../generators/csv.js";
import { serializeFxTrace } from "../generators/fx-trace.js";
import { formatReport } from "./format-report.js";
import { computeCasillaBlocksWithFx } from "../generators/casillas.js";
import { applyLossCarryforward } from "../engine/loss-carryforward.js";
import { savingsBalances } from "../engine/taxable-base.js";
import type { FxMethod, LossCarryforward } from "../types/tax.js";
import { createEmptyStatement, finalizeMergedStatement, mergeStatement, yearEndHoldings } from "../parsers/merge.js";

declare const __PACKAGE_VERSION__: string | undefined;

// In built CLI bundles, tsup injects the package version so the executable does
// not depend on a fragile relative package.json path.
const pkg = { version: typeof __PACKAGE_VERSION__ === "string" ? __PACKAGE_VERSION__ : "dev" };

// Configure Decimal.js for financial precision
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

/** Encode a string to ISO-8859-15 bytes, remapping the 8 codepoints that differ from latin1. */
function encodeISO885915Buffer(str: string): Buffer {
  const ISO_REMAP: Record<number, number> = {
    0x20ac: 0xa4,
    0x0160: 0xa6,
    0x0161: 0xa8,
    0x017d: 0xb4,
    0x017e: 0xb8,
    0x0152: 0xbc,
    0x0153: 0xbd,
    0x0178: 0xbe,
  };
  const bytes = Buffer.alloc(str.length);
  for (let i = 0; i < str.length; i++) {
    const cp = str.charCodeAt(i);
    bytes[i] = ISO_REMAP[cp] ?? (cp <= 0xff ? cp : 0x3f);
  }
  return bytes;
}

/**
 * --year: a four-digit year from 1900 to 2999, like the web. parseInt read
 * "2O25" as 2, and the report selects the year by date prefix, so a typo summed
 * every year starting with those digits.
 */
function parseYear(value: string): number {
  const year = /^\d{4}$/.test(value) ? Number(value) : NaN;
  if (!(year >= 1900 && year <= 2999)) {
    throw new InvalidArgumentError("El ejercicio debe ser un año de cuatro cifras entre 1900 y 2999.");
  }
  return year;
}

/** --titulares: a whole number of holders, at least 1. */
function parseTitulares(value: string): number {
  const n = /^\d+$/.test(value) ? Number(value) : NaN;
  if (!(n >= 1)) {
    throw new InvalidArgumentError("Debe ser un número entero mayor o igual que 1.");
  }
  return n;
}

const BROKER_NAMES = brokerParsers.map((p) => p.name).join(", ");

const program = new Command();

program
  .name("declarenta")
  .description(`Convert foreign broker reports (${BROKER_NAMES}) into Spanish tax declarations (Modelo 100, 720, D-6)`)
  .version(pkg.version);

/**
 * The statement for Modelo 720 and D-6 of `year`: the holdings of the input
 * files that end on 31 December (`yearEndHoldings`, the same as the web), with
 * a warning for each file whose holdings are left out, then the date check.
 */
function yearEndStatement(merged: Statement, year: number): Statement {
  const statement = yearEndHoldings(merged, year);
  for (const m of statement.parserMessages ?? []) {
    if (m.id === "merge.holdings_other_date") console.error(`⚠ ${m.message}`);
  }
  assertYearEndPositions(statement, year);
  return statement;
}

/**
 * Modelo 720 and D-6 declare the holdings at 31 December of the tax year, so
 * refuse open positions from a statement that ends on another date (the same
 * rule as the web sections).
 */
function assertYearEndPositions(statement: Statement, year: number): void {
  const mismatch = positionsDateMismatch(statement, year);
  if (mismatch === true) {
    throw new Error(
      `Las posiciones del fichero son a fecha ${formatDateDmy(statement.toDate)}, no a 31/12/${year}. ` +
        "Este modelo declara lo que tenías a 31 de diciembre, así que no se genera ningún fichero con ellas. " +
        `Descarga un informe que termine el 31/12/${year} (en IBKR, un Flex Query con fecha final 31/12/${year}) y vuelve a ejecutar el comando.`,
    );
  }
  if (mismatch === "unknown") {
    console.error(
      `ℹ El broker no indica a qué fecha corresponden las posiciones. Comprueba que el informe refleje lo que tenías a 31/12/${year}: ` +
        "si lo descargaste más tarde, las posiciones y sus valores pueden no coincidir.",
    );
  }
}

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
    const xlsx = await parseXlsxExport(buf);
    if (xlsx) {
      const { broker, statement } = xlsx;
      mergeStatement(merged, statement, broker);
      brokerNames.push(broker);
      console.error(
        `  [${broker} XLSX] ${file}: ${statement.trades.length} operaciones, ${statement.cashTransactions.length} transacciones`,
      );
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
    mergeStatement(merged, statement, parser.name);
    brokerNames.push(parser.name);

    console.error(
      `  [${parser.name}] ${file}: ${statement.trades.length} operaciones, ${statement.cashTransactions.length} transacciones`,
    );
  }

  return { merged: finalizeMergedStatement(merged), brokerNames };
}

// ---------------------------------------------------------------------------
// Command: convert
// ---------------------------------------------------------------------------

const FX_METHODS: FxMethod[] = ["multidivisa", "tradicional-divisa", "monodivisa"];
const FX_METHOD_NAMES: Record<FxMethod, string> = {
  multidivisa: "Criterio DGT (multidivisa)",
  "tradicional-divisa": "Tradicional con divisa",
  monodivisa: "Tradicional sin divisa (monodivisa)",
};

/**
 * The method of a convert run. `--monodivisa` is an alias of `--fx-method
 * monodivisa`; with an explicit `--fx-method` of another value the pair
 * conflicts, and the CLI stops with exit code 1 (as on every other error).
 */
function resolveFxMethod(fxMethod: FxMethod, monodivisa: boolean, cmd: Command): FxMethod {
  if (!monodivisa) return fxMethod;
  const explicit = cmd.getOptionValueSource("fxMethod") === "cli";
  if (explicit && fxMethod !== "monodivisa") {
    throw new Error(
      `--monodivisa y --fx-method ${fxMethod} se contradicen. Usa solo uno: --fx-method monodivisa equivale a --monodivisa.`,
    );
  }
  return "monodivisa";
}

/**
 * The per-ISIN anti-churning windows of `--antichurning-1y` and
 * `--antichurning-2m` (#452). Values may also be comma-separated. A value that
 * is not an ISIN (shape or check digit), or an ISIN in both flags, stops the run.
 */
function windowOverridesFromFlags(oneYear: string[] = [], twoMonths: string[] = []): Record<string, 2 | 12> {
  const out = new Map<string, 2 | 12>();
  const add = (values: string[], months: 2 | 12, flag: string): void => {
    for (const value of values.flatMap((v) => v.split(","))) {
      const isin = value.trim().toUpperCase();
      if (isin === "") continue;
      if (!isValidIsin(isin)) {
        throw new Error(`${flag}: «${value.trim()}» no es un ISIN válido (2 letras, 9 letras o cifras y 1 cifra de control, p. ej. GB0007980591).`);
      }
      if (out.has(isin) && out.get(isin) !== months) {
        throw new Error(`El ISIN ${isin} está a la vez en --antichurning-1y y en --antichurning-2m. Ponlo solo en uno.`);
      }
      out.set(isin, months);
    }
  };
  add(oneYear, 12, "--antichurning-1y");
  add(twoMonths, 2, "--antichurning-2m");
  return Object.fromEntries(out);
}

program
  .command("convert")
  .description(`Convert broker reports to Modelo 100 casilla values. Supports: ${BROKER_NAMES}`)
  .requiredOption("-i, --input <files...>", "Broker report file(s). Pass multiple for cross-year FIFO or cross-broker")
  .requiredOption("-y, --year <year>", "Tax year", parseYear)
  .option("-o, --output <file>", "Output file. Defaults to stdout")
  .addOption(new Option("-f, --format <format>", "Output format").choices(["json", "csv", "pdf"]).default("json"))
  .option("-b, --broker <name>", `Broker name. Auto-detected if omitted. Available: ${BROKER_NAMES}`)
  .option("--prior-losses <file>", "JSON file with prior year losses for carryforward (Art. 49 LIRPF)")
  .addOption(
    new Option(
      "--fx-method <method>",
      "Método para acciones en divisa. multidivisa = «Criterio DGT (multidivisa)», el recomendado: ganancia en divisa al tipo del día de venta, y la divisa tributa al cambiarla. tradicional-divisa = «Tradicional con divisa»: compra al tipo del día de compra y venta al del día de venta (Art. 35.1), y tu divisa tributa por FIFO cuando sale de la cuenta. monodivisa = «Tradicional sin divisa (monodivisa)»: la misma valoración de acciones, sin ningún resultado de divisa. Usa el mismo método todos los años",
    )
      .choices(FX_METHODS)
      .default("multidivisa"),
  )
  .option(
    "--monodivisa",
    "Alias de --fx-method monodivisa («Tradicional sin divisa (monodivisa)»): compra al tipo del día de compra y venta al del día de venta (Art. 35.1). No calcula ningún resultado de divisa, tampoco en tus conversiones USD→EUR ni en las automáticas del bróker. Si conviertes divisa, usa --fx-method tradicional-divisa o el método por defecto",
  )
  .option(
    "--skip-auto-convert",
    "No tratar las autoconversiones del bróker (AFx/FXCONV) como conversiones de divisa. Por defecto SÍ se procesan (IBKR no reconvierte a EUR al vender, así que el saldo en divisa es real). Actívalo solo si tu bróker hace round-trip completo y quieres ignorar el efecto divisa.",
  )
  .option(
    "--titulares <n>",
    "Number of account holders. >1 splits all amounts equally per contribuyente (Art. 11.3 LIRPF)",
    parseTitulares,
  )
  .option(
    "--crypto-rates <json>",
    'Manual EUR-per-unit quotes for crypto↔crypto swaps without an ECB rate. Inline JSON or path to a JSON file: [{ "currency": "SOL", "date": "2024-03-01", "eurPerUnit": "120.50" }]',
  )
  .option(
    "--fx-trace [file]",
    "Volcar la traza de movimientos del motor FX (acuñar/aparcar/desaparcar/descartar/convertir) para auditoría. Sin valor → stderr; con ruta → fichero.",
  )
  .addOption(new Option("--fx-trace-format <format>", "Formato de la traza FX").choices(["jsonl", "csv"]).default("jsonl"))
  .option(
    "--antichurning-1y <isins...>",
    "Regla anti-churning: aplica 1 año (art. 33.5.g LIRPF) a estos ISIN, porque no están admitidos a negociación en un mercado regulado del Espacio Económico Europeo ni en un mercado equivalente (p. ej. solo cotizan en Londres desde 2021, en SIX o en OTC Markets). Gana sobre el mercado que muestra IBKR",
  )
  .option(
    "--antichurning-2m <isins...>",
    "Regla anti-churning: aplica 2 meses (art. 33.5.f LIRPF) a estos ISIN, porque están admitidos en un mercado regulado del Espacio Económico Europeo o en uno equivalente (NYSE, Nasdaq, ASX, Bolsa de Hong Kong…). Gana sobre el mercado que muestra IBKR",
  )
  .action(
    async (opts: {
      input: string[];
      year: number;
      output?: string;
      format: string;
      broker?: string;
      priorLosses?: string;
      fxMethod: FxMethod;
      monodivisa?: boolean;
      skipAutoConvert?: boolean;
      titulares?: number;
      cryptoRates?: string;
      fxTrace?: string | boolean;
      fxTraceFormat?: string;
      antichurning1y?: string[];
      antichurning2m?: string[];
    }, cmd: Command) => {
      try {
        const fxMethod = resolveFxMethod(opts.fxMethod, opts.monodivisa === true, cmd);
        const windowMonthsByIsin = windowOverridesFromFlags(opts.antichurning1y, opts.antichurning2m);
        console.error(`DeclaRenta v${pkg.version} - Ejercicio ${opts.year}, ${opts.input.length} fichero(s)...`);
        console.error(`  Método: ${FX_METHOD_NAMES[fxMethod]}`);

        // 1. Parse and merge
        const { merged, brokerNames } = await parseAndMerge(opts.input, opts.broker);
        const uniqueBrokers = [...new Set(brokerNames)];
        console.error(`  Brokers: ${uniqueBrokers.join(", ")}`);
        console.error(`  Total: ${merged.trades.length} operaciones, ${merged.cashTransactions.length} transacciones`);
        const uploadedIsins = new Set([...merged.trades, ...merged.securitiesInfo].map((r) => r.isin.trim().toUpperCase()));
        const unmatched = Object.keys(windowMonthsByIsin).filter((isin) => !uploadedIsins.has(isin));
        if (unmatched.length > 0) {
          console.error(
            `⚠ --antichurning-1y/--antichurning-2m: ningún valor de los ficheros tiene el ISIN ${unmatched.join(", ")}. Ese plazo no cambia nada; revisa que el ISIN esté bien escrito.`,
          );
        }

        // 2. Detect currencies and fetch ECB rates (shared orchestrator: derive
        //    needed (currency, year) pairs → fetch per-year → merge into one map).
        //    Manual opening lots are intentionally WEB-ONLY for now: the browser UI
        //    has the interactive workflow to collect/persist transferred-position
        //    lots, while the CLI currently supports only imported broker data plus
        //    explicit crypto manual quotes.
        const needs = deriveEcbNeeds(merged, opts.year);
        console.error(`  Divisas detectadas: ${needs.currencies.join(", ") || "solo EUR"}`);
        console.error("  Obteniendo tipos de cambio ECB...");

        const allRates = await buildEcbRateMap(needs);
        console.error(
          `  Tipos ECB cargados: ${allRates.size} fechas (${[...needs.years].sort((a, b) => a - b).join(", ")})`,
        );

        // 2b. Parse optional manual crypto rates (--crypto-rates). Inline JSON or
        //     a path to a JSON file. Used as a fallback for crypto↔crypto permutas
        //     that have no ECB rate (Binance Convert, etc.).
        let manualRates: EcbRateMap | undefined;
        if (opts.cryptoRates) {
          let parsed: unknown;
          try {
            const raw = existsSync(opts.cryptoRates) ? readFileSync(opts.cryptoRates, "utf-8") : opts.cryptoRates;
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
        const report = generateTaxReport(merged, allRates, opts.year, {
          ...reportOptionsForMethod(fxMethod),
          trackAutoConvert: !opts.skipAutoConvert,
          titulares: opts.titulares,
          manualRates,
          fxTrace: opts.fxTrace !== undefined && opts.fxTrace !== false,
          windowMonthsByIsin,
        });
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
              console.error(
                'Aviso: se ha omitido una entrada de --prior-losses sin "amount"/"remaining" de tipo cadena.',
              );
              continue;
            }
            if (l.category !== "gains" && l.category !== "income") {
              console.error(
                'Aviso: se ha omitido una entrada de --prior-losses con "category" no válida (debe ser "gains" o "income").',
              );
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
              console.error(
                `Aviso: se ha omitido una entrada de --prior-losses con importes no numéricos (year ${year}).`,
              );
              continue;
            }
            if (!amount.isFinite() || !remaining.isFinite()) {
              console.error(
                `Aviso: se ha omitido una entrada de --prior-losses con importes no finitos (year ${year}).`,
              );
              continue;
            }
            priorLosses.push({ year, amount, remaining, category: l.category });
          }

          const { gains: netGains, income: netIncome } = savingsBalances(report);
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
          // The report is written, but a script must not take it as valid.
          process.exitCode = 1;
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
          console.error(
            '    Ejemplo: --crypto-rates \'[{"currency":"SOL","date":"2024-03-01","eurPerUnit":"120.50"}]\'',
          );
        }

        // 6. Print summary
        printSummary(report);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    },
  );

// ---------------------------------------------------------------------------
// Command: modelo720
// ---------------------------------------------------------------------------

program
  .command("modelo720")
  .description("Generate Modelo 720 fixed-width file from broker positions")
  .requiredOption("-i, --input <files...>", "Broker report file(s). Pass one per broker: the 50,000 EUR threshold applies to the total")
  .requiredOption("-y, --year <year>", "Tax year", parseYear)
  .requiredOption("--nif <nif>", "NIF del declarante")
  .requiredOption("--name <name>", "Nombre completo (Apellidos, Nombre)")
  .option("-o, --output <file>", "Output file. Defaults to stdout")
  .option("-b, --broker <name>", `Broker name. Auto-detected if omitted. Available: ${BROKER_NAMES}`)
  .option("--phone <phone>", "Teléfono de contacto", "")
  .option("--previous-720 <file>", "Previous year 720 output file (to determine A/M/C types)")
  .option("--titulares <n>", "Number of holders sharing every asset: each declares 100/n % with the full value", parseTitulares)
  .option("--declaration-id <id>", "Número identificativo (13 digits starting with 720). Defaults to a new one")
  .action(
    async (opts: {
      input: string[];
      year: number;
      nif: string;
      name: string;
      output?: string;
      broker?: string;
      phone: string;
      previous720?: string;
      titulares?: number;
      declarationId?: string;
    }) => {
      try {
        const { merged } = await parseAndMerge(opts.input, opts.broker);
        const statement = yearEndStatement(merged, opts.year);

        // Rates for every year with a trade: the FIFO run dates the lots held at
        // 31 December and the sales that ended a previously declared holding.
        // The needs include the currencies of positions and cash balances.
        const rateMap = await buildEcbRateMap({ statement, year: opts.year });
        const report = generateTaxReport(statement, rateMap, opts.year);

        const nameParts = opts.name.split(",").map((s) => s.trim());
        const surname = nameParts[0] ?? "";
        const firstName = nameParts[1] ?? "";

        if (opts.declarationId !== undefined && !/^720\d{10}$/.test(opts.declarationId)) {
          throw new Error(`--declaration-id debe tener 13 dígitos y empezar por 720: "${opts.declarationId}"`);
        }
        if (opts.titulares !== undefined && !(Number.isInteger(opts.titulares) && opts.titulares >= 1)) {
          throw new Error("--titulares debe ser un número entero mayor o igual que 1");
        }

        // Securities (V/I records) and account codes (C records) from last year's 720 file
        let previous: ReturnType<typeof readPrevious720> | undefined;
        if (opts.previous720) {
          let prev: string;
          try {
            prev = readFileSync(opts.previous720, "utf-8");
          } catch {
            console.error(`Error: No se pudo leer el archivo ${opts.previous720}.`);
            process.exit(1);
          }
          previous = readPrevious720(prev);
        }

        const config720 = {
          nif: opts.nif,
          surname,
          name: firstName,
          year: opts.year,
          phone: opts.phone,
          contactName: opts.name,
          declarationId: opts.declarationId ?? modelo720DeclarationId(),
          isComplementary: false,
          isReplacement: false,
          previousYearSecurities: previous?.securities,
          previousYearAccounts: previous?.accounts,
          titulares: opts.titulares,
        };
        const disposals = report.capitalGains.disposals;
        const output720 = generateModelo720(
          statement.openPositions,
          rateMap,
          config720,
          report.yearEndLots,
          statement.cashBalances,
          disposals,
        );

        // Assets the file cannot carry: the user declares them by hand.
        const omissions = findModelo720Omissions(statement.openPositions, rateMap, config720, statement.cashBalances, disposals);
        for (const o of omissions) {
          const what = o.kind === "position"
            ? `Posición ${o.position.symbol || o.position.description}`
            : o.kind === "cash"
              ? `Cuenta ${o.cashBalance.accountId || "(sin número)"} en ${o.cashBalance.currency}`
              : `Baja de ${o.security.isin} (declarado en el Modelo 720 anterior con clave «${o.security.claveSubclave}» y país «${o.security.country}»)`;
          const why = {
            no_isin: "no tiene ISIN (el fichero pediría «Z» más el país del emisor)",
            no_country: "no tiene un código de país válido",
            quantity_unknown: "no tiene un número de valores válido (falta, no se lee o es un 0 junto a un valor; tómalo del extracto de fin de año del bróker)",
            quantity_below_hundredth: "tiene un número de valores inferior a 0,01, y el fichero solo admite dos decimales (escribiría 0)",
            no_account: "no tiene número de cuenta",
            invalid_code: "tiene una clave, subclave o país que el fichero no admite",
          }[o.reason];
          console.error(`⚠ ${what} ${why}: no se incluye en el fichero. Decláralo a mano en el formulario del Modelo 720.`);
        }

        for (const { isin, missing } of findUndatedExtinctions(statement.openPositions, config720, disposals)) {
          console.error(
            missing === "extinctionDate"
              ? `⚠ ${isin} figuraba en el 720 anterior y ya no está en cartera, pero no hay ninguna venta en ${opts.year} de las acciones declaradas. ` +
                  "Su registro de extinción (C) sale sin fecha de extinción y con valoración 0: complétalos antes de presentar."
              : `⚠ ${isin} figuraba en el 720 anterior y se vendió en ${opts.year}, pero los datos no incluyen su compra. ` +
                  "Su registro de extinción (C) sale sin fecha de adquisición: complétala antes de presentar.",
          );
        }

        const unvaluedCash = unvaluedCashBalances(statement.cashBalances, rateMap, opts.year);
        const missingAverage = heldCashBalances(statement.cashBalances).filter(
          (cb) => !unvaluedCash.includes(cb) && cashAverageOf(cb) === null,
        );
        if (missingAverage.length > 0) {
          console.error(
            `Aviso: ${missingAverage.length} saldo(s) en efectivo sin media del cuarto trimestre (${missingAverage.map((cb) => cb.currency).join(", ")}). Cuentan para el umbral de 50.000 EUR, pero no se incluyen en el fichero: decláralos a mano con su saldo medio.`,
          );
        }

        const thresholds = checkModelo720Thresholds(statement.openPositions, rateMap, opts.year, statement.cashBalances);
        if (thresholds.values.unvalued > 0) {
          console.error(
            `Aviso: ${thresholds.values.unvalued} posición(es) en valores sin precio de mercado o sin tipo de cambio al cierre del ejercicio. No cuentan para el umbral de 50.000 EUR ni se incluyen en el fichero: calcula su valor en euros y decláralas a mano.`,
          );
        }
        // A cash balance with no number, or in a currency with no year-end
        // rate, is unknown, never 0 EUR (#470).
        if (unvaluedCash.length > 0) {
          console.error(
            `Aviso: ${unvaluedCash.length} saldo(s) en efectivo sin valorar en euros (${unvaluedCash.map((cb) => `${cb.accountId} (${cb.currency})`).join(", ")}): el archivo no trae un saldo final legible o no hay tipo de cambio del BCE para su divisa. No cuentan como 0 EUR ni se incluyen en el fichero: toma su saldo en euros del extracto de fin de año del bróker y decláralos a mano.`,
          );
        }

        if (!output720) {
          if (omissions.length > 0) {
            console.error("No se ha generado ningún registro. Revisa los avisos anteriores antes de concluir que no debes presentar el Modelo 720.");
          } else if (thresholds.accounts.exceeds) {
            console.error("Tus cuentas superan 50.000 EUR, pero ninguna trae la media del cuarto trimestre, así que no se ha generado el fichero. Declara esas cuentas a mano en el Modelo 720.");
          } else if (thresholds.values.unvalued > 0 || thresholds.accounts.unvalued > 0) {
            console.error("No se ha generado ningún registro. Valora las posiciones y los saldos de los avisos anteriores antes de concluir que no debes presentar el Modelo 720.");
          } else {
            console.error("Posiciones en el extranjero por debajo de 50.000 EUR. No es necesario presentar Modelo 720.");
          }
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
    },
  );

// ---------------------------------------------------------------------------
// Command: d6
// ---------------------------------------------------------------------------

program
  .command("d6")
  .description("Generate Modelo D-6 AFORIX guide from broker positions")
  .requiredOption("-i, --input <files...>", "Broker report file(s)")
  .requiredOption("-y, --year <year>", "Tax year", parseYear)
  .requiredOption("--nif <nif>", "NIF del declarante")
  .requiredOption("--name <name>", "Nombre completo (Apellidos, Nombre)")
  .option("-o, --output <file>", "Output file. Defaults to stdout")
  .addOption(new Option("-f, --format <format>", "Output format").choices(["json", "text"]).default("text"))
  .option("-b, --broker <name>", `Broker name. Auto-detected if omitted. Available: ${BROKER_NAMES}`)
  .option("--previous-d6 <file>", "Previous year D-6 JSON output file (to generate cancellations)")
  .action(
    async (opts: {
      input: string[];
      year: number;
      nif: string;
      name: string;
      output?: string;
      format: string;
      broker?: string;
      previousD6?: string;
    }) => {
      try {
        const { merged } = await parseAndMerge(opts.input, opts.broker);
        const statement = yearEndStatement(merged, opts.year);

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

        // Same rate set as the web D-6 (shared orchestrator), positions included.
        const rateMap = await buildEcbRateMap({ statement, year: opts.year });
        const report = generateD6Report(
          statement.openPositions,
          rateMap,
          opts.year,
          opts.name,
          opts.nif,
          previousYearIsins,
        );

        if (report.unvaluedCount > 0) {
          console.error(
            `Aviso: ${report.unvaluedCount} posición(es) extranjera(s) sin precio de mercado, sin número de títulos válido o sin tipo de cambio al cierre del ejercicio. No se incluyen en las posiciones de la guía, que las nombra: completa su valor en euros y su número de títulos y decláralas a mano.`,
          );
        }
        // Positions declared last year and sold since must still be cancelled.
        if (report.positions.length === 0 && report.cancelled.length === 0) {
          if (report.unvaluedCount === 0) console.error("No se encontraron posiciones extranjeras. No es necesario presentar D-6.");
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
    },
  );

// ---------------------------------------------------------------------------
// Command: modelo721
// ---------------------------------------------------------------------------

// The official Modelo 721 is an XML file (Orden HFP/886/2023) that the CLI does
// not generate, so the command fails instead of exiting 0 with no output. Any
// options are accepted so an existing script reaches this message.
program
  .command("modelo721")
  .description("Not available in the CLI: review Modelo 721 in the web app")
  .allowUnknownOption()
  .allowExcessArguments()
  .action(() => {
    console.error("Error: el Modelo 721 no está disponible en la CLI y no se ha generado ningún fichero.");
    console.error(
      "  El formato oficial es XML (Orden HFP/886/2023). Revisa tus criptomonedas en la sección Modelo 721 de https://declarenta.com.",
    );
    process.exit(1);
  });

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

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
    console.error(`    ⚠ Pérdidas bloqueadas (anti-churning): ${report.capitalGains.blockedLosses.toFixed(2)} EUR`);
  }
  if (report.capitalGains.reintegratedLosses.greaterThan(0)) {
    console.error(
      `    ↩ Pérdidas diferidas integradas (transmisión definitiva): ${report.capitalGains.reintegratedLosses.toFixed(2)} EUR`,
    );
  }
  console.error("");
  console.error("  RENDIMIENTOS CAPITAL MOBILIARIO");
  console.error(`    Casilla 0029 (Dividendos brutos):  ${report.dividends.grossIncome.toFixed(2)} EUR`);
  console.error(`    Casilla 0597 (Retenciones cap. mob.): ${report.dividends.spanishWithholding.toFixed(2)} EUR`);
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
