import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { fmtEur, fmtQty, formatDate } from "../../src/web/format.js";

describe("fmtEur — Spanish number formatting", () => {
  it("formats thousands with dot and decimals with comma", () => {
    expect(fmtEur(new Decimal("3301.71"))).toBe("3.301,71");
  });

  it("formats large numbers", () => {
    expect(fmtEur(new Decimal("1234567.89"))).toBe("1.234.567,89");
  });

  it("formats negative numbers correctly", () => {
    expect(fmtEur(new Decimal("-3301.71"))).toBe("-3.301,71");
  });

  it("formats zero", () => {
    expect(fmtEur(new Decimal("0"))).toBe("0,00");
  });

  it("formats small numbers without thousands separator", () => {
    expect(fmtEur(new Decimal("123.45"))).toBe("123,45");
  });

  it("formats numbers under 1", () => {
    expect(fmtEur(new Decimal("0.75"))).toBe("0,75");
  });

  it("accepts plain number type", () => {
    expect(fmtEur(4402.80)).toBe("4.402,80");
  });

  it("respects custom decimal places", () => {
    expect(fmtEur(new Decimal("1234.5678"), 4)).toBe("1.234,5678");
  });

  it("handles negative thousands correctly", () => {
    expect(fmtEur(new Decimal("-12345.67"))).toBe("-12.345,67");
  });

  it("handles zero decimals (no comma)", () => {
    expect(fmtEur(new Decimal("12345"), 0)).toBe("12.345");
  });
});

describe("fmtEur — values that round to zero or sit on a half cent", () => {
  it("never shows a negative zero", () => {
    expect(fmtEur(new Decimal("-0.004"))).toBe("0,00");
    expect(fmtEur(-0.004)).toBe("0,00");
    expect(fmtEur(new Decimal("-0.4"), 0)).toBe("0");
  });

  it("keeps the sign of a real negative amount", () => {
    expect(fmtEur(new Decimal("-0.005"))).toBe("-0,01");
  });

  it("rounds a Number the same way as the same Decimal", () => {
    expect(fmtEur(1.005)).toBe(fmtEur(new Decimal("1.005")));
    expect(fmtEur(1.005)).toBe("1,01");
  });
});

describe("formatDate — every date the UI shows as DD/MM/YYYY", () => {
  it("formats compact broker dates", () => {
    expect(formatDate("20250315")).toBe("15/03/2025");
  });

  it("formats ISO dates (normalizeDate output: dividend pay dates, the review range)", () => {
    expect(formatDate("2025-03-15")).toBe("15/03/2025");
  });

  it("drops the IBKR time component", () => {
    expect(formatDate("20250315;103000")).toBe("15/03/2025");
  });

  it("returns anything that is not a date unchanged", () => {
    expect(formatDate("")).toBe("");
    expect(formatDate("n/a")).toBe("n/a");
  });
});

describe("fmtQty — quantities in Spanish format, never in exponent notation", () => {
  it("writes crypto dust in full", () => {
    expect(fmtQty(new Decimal("5e-8"))).toBe("0,00000005");
    expect(fmtQty(new Decimal("0.0000001"))).toBe("0,0000001");
  });

  it("groups thousands and uses a decimal comma", () => {
    expect(fmtQty(new Decimal("1234.56789"))).toBe("1.234,56789");
  });

  it("shows no trailing zeros and no comma for whole units", () => {
    expect(fmtQty(new Decimal("12.50"))).toBe("12,5");
    expect(fmtQty(new Decimal("10"))).toBe("10");
    expect(fmtQty("1500")).toBe("1.500");
  });

  it("keeps the sign of a short position", () => {
    expect(fmtQty(new Decimal("-2.5"))).toBe("-2,5");
  });
});
