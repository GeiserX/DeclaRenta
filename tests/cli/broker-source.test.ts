/**
 * `declarenta convert` names the broker of each sale and of the lot it consumed.
 * FIFO pools lots per ISIN across every input file, so a share bought at one
 * broker and sold at another shows both. All amounts are in EUR, so no ECB
 * request is made.
 */

import { join } from "path";
import { describe, expect, it } from "vitest";
import { runCli, tempFiles } from "./run-cli.js";

const IBKR_BUY = `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Test" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="U1111111" fromDate="20240101" toDate="20241231" period="">
      <Trades>
        <Trade tradeID="1" accountId="U1111111" symbol="TST" description="TEST SA"
               isin="ES0000000001" assetCategory="STK" currency="EUR"
               tradeDate="20240315" settlementDate="20240318"
               quantity="10" tradePrice="10.00" tradeMoney="100.00"
               proceeds="-100.00" cost="100.00" fifoPnlRealized="0"
               fxRateToBase="1" buySell="BUY" openCloseIndicator="O"
               exchange="BME" ibCommissionCurrency="EUR" ibCommission="0" taxes="0" />
      </Trades>
    </FlexStatement>
  </FlexStatements>
</FlexQueryResponse>
`;

const DEGIRO_SELL = [
  "Fecha,Hora,Producto,ISIN,Bolsa de,Centro de ejecución,Número,Precio,,Valor local,,Valor,,Tipo de cambio,Costes de transacción,,Total,,ID Orden",
  "17-03-2025,10:00,TEST SA,ES0000000001,MAD,XMAD,-10,12.0000,EUR,120.00,EUR,120.00,EUR,,,EUR,120.00,EUR,aaaa1111-2222-3333-4444-555566667777",
  "",
].join("\n");

const dir = tempFiles({ "ibkr.xml": IBKR_BUY, "degiro.csv": DEGIRO_SELL });

describe("declarenta convert: broker of each sale", () => {
  it("names the sale broker and the acquisition broker in the JSON and CSV", () => {
    const args = ["convert", "-i", join(dir, "ibkr.xml"), "-i", join(dir, "degiro.csv"), "-y", "2025"];

    const json = runCli(args);
    expect(json.status).toBe(0);
    const ops = (JSON.parse(json.stdout) as { operaciones: Record<string, unknown>[] }).operaciones;
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ broker_venta: "Degiro", broker_compra: "Interactive Brokers" });

    const csv = runCli([...args, "-f", "csv"]);
    expect(csv.status).toBe(0);
    const row = csv.stdout.split("\n").find((l) => l.startsWith("ES0000000001,"));
    expect(row?.split(",").slice(-2)).toEqual(["Degiro", "Interactive Brokers"]);
  }, 30_000);
});
