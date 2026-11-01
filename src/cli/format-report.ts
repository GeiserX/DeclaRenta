/**
 * The JSON that `declarenta convert` prints (the default `--format json`).
 * Kept out of the CLI entry point, which parses argv on import, so tests can
 * build it from a report computed with an in-memory ECB rate map.
 */

import type { TaxSummary } from "../types/tax.js";
import { computeCasillaBlocksWithFx } from "../generators/casillas.js";

export function formatReport(report: TaxSummary) {
  const blocks = computeCasillaBlocksWithFx(report);
  return {
    year: report.year,
    casillas: {
      "0029_dividendos_brutos": report.dividends.grossIncome.toFixed(2),
      "0597_retenciones_capital_mobiliario": report.dividends.spanishWithholding.toFixed(2),
      intereses_margen_no_deducible_informativo: report.interest.paid.toFixed(2),
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
      broker_venta: d.brokerSource,
      broker_compra: d.acquireBrokerSource,
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
      broker_venta: d.brokerSource,
      broker_compra: d.acquireBrokerSource,
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
