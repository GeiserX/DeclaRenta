import { describe, it, expect } from "vitest";
import { normalizeDate, parseDate, daysBetween } from "../../src/engine/dates.js";

describe("parseDate", () => {
  it("should parse YYYYMMDD format", () => {
    const d = parseDate("20250115");
    expect(d.getUTCFullYear()).toBe(2025);
    expect(d.getUTCMonth()).toBe(0); // January
    expect(d.getUTCDate()).toBe(15);
  });

  it("should parse YYYY-MM-DD format", () => {
    const d = parseDate("2025-09-20");
    expect(d.getUTCFullYear()).toBe(2025);
    expect(d.getUTCMonth()).toBe(8); // September
    expect(d.getUTCDate()).toBe(20);
  });
});

describe("normalizeDate", () => {
  it("should normalize YYYYMMDD to YYYY-MM-DD", () => {
    expect(normalizeDate("20190916")).toBe("2019-09-16");
  });

  it("should pass through YYYY-MM-DD unchanged", () => {
    expect(normalizeDate("2019-09-16")).toBe("2019-09-16");
  });

  it("should strip IBKR semicolon time component", () => {
    expect(normalizeDate("20190916;130630")).toBe("2019-09-16");
  });

  it("should handle IBKR datetime with midnight time", () => {
    expect(normalizeDate("20200101;000000")).toBe("2020-01-01");
  });
});

describe("parseDate with IBKR datetime", () => {
  it("should parse YYYYMMDD;HHMMSS format", () => {
    const d = parseDate("20190916;130630");
    expect(d.getUTCFullYear()).toBe(2019);
    expect(d.getUTCMonth()).toBe(8); // September
    expect(d.getUTCDate()).toBe(16);
  });
});

describe("daysBetween", () => {
  it("should calculate days between YYYYMMDD dates", () => {
    expect(daysBetween("20250115", "20250915")).toBe(243);
  });

  it("should calculate days between YYYY-MM-DD dates", () => {
    expect(daysBetween("2025-01-15", "2025-09-15")).toBe(243);
  });

  it("should handle mixed formats", () => {
    expect(daysBetween("20250115", "2025-09-15")).toBe(243);
  });

  it("should return 0 for same date", () => {
    expect(daysBetween("20250601", "20250601")).toBe(0);
  });
});
