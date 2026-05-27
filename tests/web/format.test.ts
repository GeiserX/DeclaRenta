import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { fmtEur } from "../../src/web/format.js";

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
});
