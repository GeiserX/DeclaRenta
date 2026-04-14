import { describe, it, expect } from "vitest";
import { parseDate, daysBetween } from "../../src/engine/dates.js";

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
