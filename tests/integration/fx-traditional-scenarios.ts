/**
 * «Tradicional con divisa» scenarios (issue #434) with the figures the spec
 * table expects (stock / FX per year, [1633 / 1637] where given). Rates are EUR
 * per USD. The ids follow the design notes: a-k, i, j from the first research
 * round; l..LA from the judge round; ROT, ROT0, MG, MG0 from the critic round.
 */
import type { Scenario } from "./fx-traditional-harness.js";

export interface Expected {
  /** year → [stock, fx] or [stock, fx, 1633, 1637] (2 decimals). */
  years: Record<number, [string, string] | [string, string, string, string]>;
}

export const SCENARIOS: (Scenario & { expect: Expected })[] = [
  { id: "a", years: [2024], closed: true, ev: [
    { k: "fund", d: "2024-02-01", usd: "2000", r: "0.90" }, { k: "buy", d: "2024-03-01", sym: "AAA", qty: "20", px: "100", r: "0.90" },
    { k: "sell", d: "2024-06-03", sym: "AAA", qty: "20", px: "125", r: "0.85" }, { k: "conv", d: "2024-09-02", usd: "2500", r: "0.80" } ],
    expect: { years: { 2024: ["325.00", "-125.00", "2000.00", "2125.00"] } } },
  { id: "b", years: [2024], closed: true, ev: [
    { k: "fund", d: "2024-02-01", usd: "2000", r: "0.90" }, { k: "buy", d: "2024-03-01", sym: "AAA", qty: "20", px: "100", r: "0.95" },
    { k: "sell", d: "2024-05-02", sym: "AAA", qty: "20", px: "125", r: "0.85" }, { k: "buy", d: "2024-06-03", sym: "BBB", qty: "25", px: "100", r: "0.88" },
    { k: "sell", d: "2024-08-01", sym: "BBB", qty: "25", px: "110", r: "0.92" }, { k: "conv", d: "2024-10-01", usd: "2750", r: "0.80" } ],
    expect: { years: { 2024: ["555.00", "-155.00", "2200.00", "2355.00"] } } },
  { id: "c", years: [2024, 2025], closed: true, ev: [
    { k: "fund", d: "2024-02-01", usd: "2000", r: "0.90" }, { k: "buy", d: "2024-03-01", sym: "AAA", qty: "20", px: "100", r: "0.95" },
    { k: "sell", d: "2024-06-03", sym: "AAA", qty: "10", px: "125", r: "0.85" }, { k: "conv", d: "2024-09-02", usd: "1250", r: "0.80" },
    { k: "sell", d: "2025-03-03", sym: "AAA", qty: "10", px: "130", r: "0.88" }, { k: "conv", d: "2025-06-02", usd: "1300", r: "0.92" } ],
    expect: { years: { 2024: ["112.50", "-12.50", "1000.00", "1012.50"], 2025: ["194.00", "102.00", "1196.00", "1094.00"] } } },
  { id: "d", years: [2024], closed: true, ev: [
    { k: "fund", d: "2024-01-15", usd: "1000", r: "0.90" }, { k: "fund", d: "2024-02-01", usd: "1000", r: "1.00" },
    { k: "buy", d: "2024-03-01", sym: "AAA", qty: "15", px: "100", r: "0.95" }, { k: "sell", d: "2024-06-03", sym: "AAA", qty: "15", px: "120", r: "0.85" },
    { k: "conv", d: "2024-09-02", usd: "2300", r: "0.80" } ],
    expect: { years: { 2024: ["105.00", "-165.00", "1840.00", "2005.00"] } } },
  { id: "e", years: [2024], closed: true, ev: [
    { k: "fund", d: "2024-02-01", usd: "1000", r: "0.90" }, { k: "buy", d: "2024-03-01", sym: "AAA", qty: "10", px: "100", r: "0.92" },
    { k: "div", d: "2024-04-02", usd: "50", r: "0.93" }, { k: "fee", d: "2024-05-02", usd: "10", r: "0.94" },
    { k: "sell", d: "2024-06-03", sym: "AAA", qty: "10", px: "110", r: "0.95" }, { k: "conv", d: "2024-09-02", usd: "1140", r: "1.00" } ],
    expect: { years: { 2024: ["125.00", "77.90", "1149.40", "1071.50"] } } },
  { id: "e2", years: [2024], closed: true, ev: [
    { k: "fund", d: "2024-02-01", usd: "1000", r: "0.90" }, { k: "div", d: "2024-02-15", usd: "500", r: "1.05" },
    { k: "buy", d: "2024-03-01", sym: "AAA", qty: "15", px: "100", r: "0.95" }, { k: "sell", d: "2024-06-03", sym: "AAA", qty: "15", px: "100", r: "0.85" },
    { k: "conv", d: "2024-09-02", usd: "1500", r: "0.80" } ],
    expect: { years: { 2024: ["-150.00", "-75.00", "1200.00", "1275.00"] } } },
  { id: "e3", years: [2024], closed: true, wht: [{ d: "2024-02-15", usd: "15" }], ev: [
    { k: "fund", d: "2024-02-01", usd: "1000", r: "0.90" }, { k: "div", d: "2024-02-15", usd: "100", r: "0.93" },
    { k: "buy", d: "2024-03-01", sym: "AAA", qty: "10", px: "108.5", r: "0.95" }, { k: "sell", d: "2024-06-03", sym: "AAA", qty: "10", px: "120", r: "0.85" },
    { k: "conv", d: "2024-09-02", usd: "1200", r: "0.80" } ],
    expect: { years: { 2024: ["-10.75", "-8.30", "960.00", "968.30"] } } },
  { id: "f", years: [2024], closed: true, ev: [
    { k: "fund", d: "2024-02-01", usd: "2000", r: "0.90" }, { k: "buy", d: "2024-03-01", sym: "AAA", qty: "20", px: "100", r: "0.95" },
    { k: "sell", d: "2024-06-03", sym: "AAA", qty: "20", px: "80", r: "0.85" }, { k: "conv", d: "2024-09-02", usd: "1600", r: "0.80" } ],
    expect: { years: { 2024: ["-540.00", "20.00", "1660.00", "1640.00"] } } },
  { id: "f2", years: [2024], closed: true, ev: [
    { k: "fund", d: "2024-02-01", usd: "2000", r: "0.80" }, { k: "buy", d: "2024-03-01", sym: "AAA", qty: "20", px: "100", r: "0.85" },
    { k: "sell", d: "2024-06-03", sym: "AAA", qty: "20", px: "80", r: "0.95" }, { k: "conv", d: "2024-09-02", usd: "1600", r: "1.00" } ],
    expect: { years: { 2024: ["-180.00", "180.00", "1940.00", "1760.00"] } } },
  // g: 2000 USD deposited with no EUR origin. Total 100 against an economic 200
  // if the deposit cost 0.90: the documented data gap (spec row 14/17).
  { id: "g", years: [2024], closed: true, ev: [
    { k: "dep", d: "2024-02-01", usd: "2000", r: "0.90" }, { k: "buy", d: "2024-03-01", sym: "AAA", qty: "20", px: "100", r: "0.95" },
    { k: "sell", d: "2024-06-03", sym: "AAA", qty: "20", px: "125", r: "0.85" }, { k: "conv", d: "2024-09-02", usd: "2500", r: "0.80" } ],
    expect: { years: { 2024: ["225.00", "-125.00", "2000.00", "2125.00"] } } },
  { id: "h", years: [2024, 2025], closed: true, ev: [
    { k: "fund", d: "2024-02-01", usd: "2000", r: "0.90" }, { k: "buy", d: "2024-03-01", sym: "AAA", qty: "20", px: "100", r: "0.95" },
    { k: "sell", d: "2025-03-03", sym: "AAA", qty: "20", px: "125", r: "0.85" }, { k: "conv", d: "2025-06-02", usd: "2500", r: "0.80" } ],
    expect: { years: { 2024: ["0.00", "0.00"], 2025: ["225.00", "-25.00", "2000.00", "2025.00"] } } },
  { id: "h2", years: [2024, 2025], closed: true, ev: [
    { k: "fund", d: "2024-02-01", usd: "2000", r: "0.90" }, { k: "buy", d: "2024-03-01", sym: "AAA", qty: "20", px: "100", r: "0.95" },
    { k: "sell", d: "2024-06-03", sym: "AAA", qty: "20", px: "125", r: "0.85" }, { k: "conv", d: "2025-06-02", usd: "2500", r: "0.80" } ],
    expect: { years: { 2024: ["225.00", "0.00"], 2025: ["0.00", "-25.00", "2000.00", "2025.00"] } } },
  { id: "i", years: [2024], closed: true, ev: [
    { k: "fund", d: "2024-03-01", usd: "2000", r: "0.95" }, { k: "buy", d: "2024-03-01", sym: "AAA", qty: "20", px: "100", r: "0.95" },
    { k: "sell", d: "2024-06-03", sym: "AAA", qty: "20", px: "125", r: "0.85" }, { k: "conv", d: "2024-06-03", usd: "2500", r: "0.85" } ],
    expect: { years: { 2024: ["225.00", "0.00", "2125.00", "2125.00"] } } },
  { id: "j", years: [2024], closed: false, ev: [
    { k: "fund", d: "2024-02-01", usd: "2000", r: "0.90" }, { k: "buy", d: "2024-03-01", sym: "AAA", qty: "20", px: "100", r: "0.95" },
    { k: "sell", d: "2024-05-02", sym: "AAA", qty: "20", px: "125", r: "0.85" }, { k: "buy", d: "2024-06-03", sym: "BBB", qty: "25", px: "100", r: "0.88" },
    { k: "sell", d: "2024-08-01", sym: "BBB", qty: "25", px: "110", r: "0.92" } ],
    expect: { years: { 2024: ["555.00", "0.00"] } } },
  { id: "k", years: [2020], closed: true, ev: [
    { k: "fund", d: "2020-10-05", usd: "1200", r: "0.8333333333" }, { k: "buy", d: "2020-10-08", sym: "AAA", qty: "10", px: "120", r: "0.7692307692" },
    { k: "sell", d: "2020-10-15", sym: "AAA", qty: "10", px: "120", r: "0.6666666667" }, { k: "conv", d: "2020-10-20", usd: "1200", r: "0.8333333333" } ],
    expect: { years: { 2020: ["-123.08", "123.08", "1000.00", "876.92"] } } },
  { id: "l", years: [2024], closed: true, ev: [
    { k: "fund", d: "2024-02-01", usd: "2000", r: "0.80" }, { k: "buy", d: "2024-03-01", sym: "AAA", qty: "20", px: "100", r: "0.95" },
    { k: "sell", d: "2024-06-03", sym: "AAA", qty: "20", px: "5", r: "0.90" }, { k: "conv", d: "2024-09-02", usd: "100", r: "0.90" } ],
    expect: { years: { 2024: ["-1810.00", "300.00", "1895.00", "1595.00"] } } },
  { id: "z0", years: [2024], closed: true, ev: [
    { k: "fund", d: "2024-02-01", usd: "2000", r: "0.80" }, { k: "buy", d: "2024-03-01", sym: "AAA", qty: "20", px: "100", r: "0.95" },
    { k: "sell", d: "2024-06-03", sym: "AAA", qty: "20", px: "0", r: "0.90" } ],
    expect: { years: { 2024: ["-1900.00", "300.00", "1900.00", "1600.00"] } } },
  { id: "q", years: [2024], closed: true, ev: [
    { k: "fund", d: "2024-01-15", usd: "1000", r: "0.90" }, { k: "buy", d: "2024-02-01", sym: "AAA", qty: "5", px: "100", r: "0.95" },
    { k: "fund", d: "2024-03-01", usd: "1000", r: "1.00" }, { k: "buy", d: "2024-04-01", sym: "AAA", qty: "5", px: "100", r: "0.85" },
    { k: "sell", d: "2024-06-03", sym: "AAA", qty: "7", px: "120", r: "0.88" }, { k: "sell", d: "2024-08-01", sym: "AAA", qty: "3", px: "110", r: "0.92" },
    { k: "conv", d: "2024-09-02", usd: "2170", r: "0.80" } ],
    expect: { years: { 2024: ["142.80", "-306.80", "1736.00", "2042.80"] } } },
  { id: "m2", years: [2024, 2025], closed: true, ev: [
    { k: "fund", d: "2024-01-15", usd: "1000", r: "0.90" }, { k: "fund", d: "2024-01-20", usd: "1000", r: "1.00" },
    { k: "buy", d: "2024-02-01", sym: "AAA", qty: "10", px: "100", r: "0.95" }, { k: "buy", d: "2024-03-01", sym: "AAA", qty: "10", px: "100", r: "0.92" },
    { k: "sell", d: "2024-06-03", sym: "AAA", qty: "15", px: "120", r: "0.85" }, { k: "sell", d: "2025-03-03", sym: "AAA", qty: "5", px: "110", r: "0.88" },
    { k: "conv", d: "2025-06-02", usd: "2350", r: "0.80" } ],
    expect: { years: { 2024: ["120.00", "0.00"], 2025: ["24.00", "-164.00", "1880.00", "2044.00"] } } },
  // r / y: the sale trades on 2024-12-30 and settles 2025-01-02. R0 puts every
  // FX consequence on the trade date, so in 2024.
  { id: "r", years: [2024, 2025], closed: true, settle: { "2024-12-30": "2025-01-02" }, ev: [
    { k: "fund", d: "2024-02-01", usd: "2000", r: "0.90" }, { k: "buy", d: "2024-03-01", sym: "AAA", qty: "20", px: "100", r: "0.95" },
    { k: "sell", d: "2024-12-30", sym: "AAA", qty: "20", px: "80", r: "0.85" }, { k: "fee", d: "2025-01-02", usd: "0", r: "0.86" },
    { k: "conv", d: "2025-06-02", usd: "1600", r: "0.80" } ],
    expect: { years: { 2024: ["-540.00", "20.00", "380.00", "360.00"], 2025: ["0.00", "0.00", "1280.00", "1280.00"] } } },
  { id: "y", years: [2024, 2025], closed: true, settle: { "2024-12-30": "2025-01-02" }, ev: [
    { k: "fund", d: "2024-02-01", usd: "2000", r: "0.90" }, { k: "buy", d: "2024-03-01", sym: "AAA", qty: "20", px: "100", r: "0.95" },
    { k: "sell", d: "2024-12-30", sym: "AAA", qty: "20", px: "125", r: "0.85" }, { k: "fee", d: "2025-01-02", usd: "0", r: "0.86" },
    { k: "conv", d: "2025-06-02", usd: "2500", r: "0.80" } ],
    expect: { years: { 2024: ["225.00", "0.00"], 2025: ["0.00", "-25.00", "2000.00", "2025.00"] } } },
  { id: "s", years: [2023, 2024, 2025], closed: true, ev: [
    { k: "fund", d: "2023-02-01", usd: "2000", r: "0.90" }, { k: "buy", d: "2023-03-01", sym: "AAA", qty: "20", px: "100", r: "0.95" },
    { k: "sell", d: "2024-05-02", sym: "AAA", qty: "20", px: "125", r: "0.85" }, { k: "buy", d: "2024-06-03", sym: "BBB", qty: "25", px: "100", r: "0.88" },
    { k: "sell", d: "2025-08-01", sym: "BBB", qty: "25", px: "110", r: "0.92" }, { k: "conv", d: "2025-10-01", usd: "2750", r: "0.80" } ],
    expect: { years: { 2023: ["0.00", "0.00"], 2024: ["225.00", "0.00"], 2025: ["330.00", "-155.00", "2200.00", "2355.00"] } } },
  { id: "t", years: [2024], closed: true, ev: [
    { k: "fund", d: "2024-02-01", usd: "1000", r: "0.50" }, { k: "buy", d: "2024-03-01", sym: "AAA", qty: "10", px: "100", r: "1.20" },
    { k: "sell", d: "2024-06-03", sym: "AAA", qty: "10", px: "110", r: "0.60" }, { k: "conv", d: "2024-09-02", usd: "1100", r: "0.60" } ],
    expect: { years: { 2024: ["-540.00", "700.00", "1860.00", "1160.00"] } } },
  { id: "W", years: [2023, 2024, 2025], closed: true, ev: [
    { k: "fund", d: "2023-02-01", usd: "2000", r: "0.90" }, { k: "buy", d: "2023-03-01", sym: "AAA", qty: "20", px: "100", r: "1.00" },
    { k: "sell", d: "2024-05-02", sym: "AAA", qty: "20", px: "100", r: "0.95" }, { k: "buy", d: "2024-06-03", sym: "BBB", qty: "20", px: "100", r: "0.92" },
    { k: "sell", d: "2025-08-01", sym: "BBB", qty: "20", px: "100", r: "0.88" }, { k: "conv", d: "2025-10-01", usd: "2000", r: "0.88" } ],
    expect: { years: { 2023: ["0.00", "0.00"], 2024: ["-100.00", "0.00"], 2025: ["-80.00", "140.00", "1760.00", "1620.00"] } } },
  // A9: same-day convert and buy, stock T+1, FX T+2 (US since 2024-05-28); same on the sale side.
  { id: "A9", years: [2024], closed: true, settle: { "2024-03-01": "SPLIT", "2024-06-03": "SPLIT" }, ev: [
    { k: "fund", d: "2024-03-01", usd: "2000", r: "0.95" }, { k: "buy", d: "2024-03-01", sym: "AAA", qty: "20", px: "100", r: "0.95" },
    { k: "fee", d: "2024-03-04", usd: "0", r: "0.95" }, { k: "fee", d: "2024-03-05", usd: "0", r: "0.95" },
    { k: "sell", d: "2024-06-03", sym: "AAA", qty: "20", px: "125", r: "0.85" }, { k: "conv", d: "2024-06-03", usd: "2500", r: "0.85" },
    { k: "fee", d: "2024-06-04", usd: "0", r: "0.85" }, { k: "fee", d: "2024-06-05", usd: "0", r: "0.85" } ],
    expect: { years: { 2024: ["225.00", "0.00", "2125.00", "2125.00"] } } },
  // A2b: two buys whose settlement order is the reverse of their trade order.
  { id: "A2b", years: [2024, 2025], closed: true, settle: { "2024-03-01": "2024-03-06", "2024-03-04": "2024-03-05" }, ev: [
    { k: "fund", d: "2024-02-01", usd: "1000", r: "0.90" }, { k: "fund", d: "2024-02-02", usd: "1000", r: "1.00" },
    { k: "buy", d: "2024-03-01", sym: "AAA", qty: "10", px: "100", r: "0.95" }, { k: "buy", d: "2024-03-04", sym: "AAA", qty: "10", px: "100", r: "0.80" },
    { k: "fee", d: "2024-03-05", usd: "0", r: "0.86" }, { k: "fee", d: "2024-03-06", usd: "0", r: "0.87" },
    { k: "sell", d: "2024-06-03", sym: "AAA", qty: "10", px: "120", r: "0.88" }, { k: "conv", d: "2024-09-02", usd: "1200", r: "0.80" },
    { k: "sell", d: "2025-03-03", sym: "AAA", qty: "10", px: "120", r: "0.92" }, { k: "conv", d: "2025-06-02", usd: "1200", r: "0.80" } ],
    expect: { years: { 2024: ["106.00", "-46.00", "960.00", "1006.00"], 2025: ["304.00", "-344.00", "960.00", "1304.00"] } } },
  { id: "A8", years: [2024, 2025], closed: true, ev: [
    { k: "fund", d: "2024-01-15", usd: "1000", r: "0.80" }, { k: "fund", d: "2024-01-20", usd: "1000", r: "1.00" },
    { k: "buy", d: "2024-03-01", sym: "AAA", qty: "20", px: "100", r: "0.95" }, { k: "sell", d: "2024-06-03", sym: "AAA", qty: "20", px: "50", r: "0.90" },
    { k: "conv", d: "2025-06-02", usd: "1000", r: "0.90" } ],
    expect: { years: { 2024: ["-1000.00", "-50.00", "950.00", "1000.00"], 2025: ["0.00", "150.00", "900.00", "750.00"] } } },
  { id: "A3", years: [2024], closed: true, ev: [
    { k: "fund", d: "2024-02-01", usd: "1000", r: "0.90" }, { k: "dep", d: "2024-02-02", usd: "1000", r: "0.95" },
    { k: "buy", d: "2024-03-01", sym: "AAA", qty: "20", px: "100", r: "0.95" }, { k: "sell", d: "2024-06-03", sym: "AAA", qty: "20", px: "75", r: "0.85" },
    { k: "conv", d: "2024-09-02", usd: "1500", r: "0.80" } ],
    expect: { years: { 2024: ["-625.00", "-25.00", "1200.00", "1225.00"] } } },
  // LA: AFx-style loss, funding at r_b. The lost dollars have a zero FX
  // difference, so no lost-dollar row is booked (graft 2).
  { id: "LA", years: [2024], closed: true, ev: [
    { k: "fund", d: "2024-03-01", usd: "2000", r: "0.95" }, { k: "buy", d: "2024-03-01", sym: "AAA", qty: "20", px: "100", r: "0.95" },
    { k: "sell", d: "2024-06-03", sym: "AAA", qty: "20", px: "80", r: "0.85" }, { k: "conv", d: "2024-06-03", usd: "1600", r: "0.85" } ],
    expect: { years: { 2024: ["-540.00", "0.00", "1360.00", "1360.00"] } } },
  // ROT: same-day rotation, sell AAA and buy BBB on the same trade date (critic G1).
  { id: "ROT", years: [2024], closed: true, ev: [
    { k: "fund", d: "2024-02-01", usd: "2000", r: "0.90" }, { k: "buy", d: "2024-03-01", sym: "AAA", qty: "20", px: "100", r: "0.95" },
    { k: "buy", d: "2024-05-02", sym: "BBB", qty: "25", px: "100", r: "0.85" }, { k: "sell", d: "2024-05-02", sym: "AAA", qty: "20", px: "125", r: "0.85" },
    { k: "sell", d: "2024-08-01", sym: "BBB", qty: "25", px: "110", r: "0.92" }, { k: "conv", d: "2024-10-01", usd: "2750", r: "0.80" } ],
    expect: { years: { 2024: ["630.00", "-230.00"] } } },
  { id: "ROT0", years: [2024], closed: true, ev: [
    { k: "fund", d: "2024-02-01", usd: "2000", r: "0.90" }, { k: "buy", d: "2024-03-01", sym: "AAA", qty: "20", px: "100", r: "0.95" },
    { k: "sell", d: "2024-05-02", sym: "AAA", qty: "20", px: "125", r: "0.85" }, { k: "buy", d: "2024-05-03", sym: "BBB", qty: "25", px: "100", r: "0.85" },
    { k: "sell", d: "2024-08-01", sym: "BBB", qty: "25", px: "110", r: "0.92" }, { k: "conv", d: "2024-10-01", usd: "2750", r: "0.80" } ],
    expect: { years: { 2024: ["630.00", "-230.00"] } } },
  // MG: buy first with an empty pool, fund EUR→USD 3 days later (critic G2).
  { id: "MG", years: [2024], closed: true, ev: [
    { k: "buy", d: "2024-03-01", sym: "AAA", qty: "20", px: "100", r: "0.95" }, { k: "fund", d: "2024-03-04", usd: "2000", r: "0.96" },
    { k: "sell", d: "2024-06-03", sym: "AAA", qty: "20", px: "125", r: "0.85" }, { k: "conv", d: "2024-09-02", usd: "2500", r: "0.80" } ],
    expect: { years: { 2024: ["225.00", "-145.00"] } } },
  { id: "MG0", years: [2024], closed: true, ev: [
    { k: "fund", d: "2024-02-29", usd: "2000", r: "0.96" }, { k: "buy", d: "2024-03-01", sym: "AAA", qty: "20", px: "100", r: "0.95" },
    { k: "sell", d: "2024-06-03", sym: "AAA", qty: "20", px: "125", r: "0.85" }, { k: "conv", d: "2024-09-02", usd: "2500", r: "0.80" } ],
    expect: { years: { 2024: ["225.00", "-145.00"] } } },
];
