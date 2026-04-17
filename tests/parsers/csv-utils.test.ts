import { describe, it, expect } from "vitest";
import {
  detectDelimiter,
  parseCsvLine,
  parseNumber,
  convertDateDMY,
  convertDateDMYSlash,
  convertDateISO,
  findColumn,
  stripBom,
} from "../../src/parsers/csv-utils.js";

describe("detectDelimiter", () => {
  it("should detect semicolon delimiter", () => {
    expect(detectDelimiter("a;b;c;d")).toBe(";");
  });

  it("should detect comma delimiter", () => {
    expect(detectDelimiter("a,b,c,d")).toBe(",");
  });

  it("should prefer semicolons when equal", () => {
    expect(detectDelimiter("a;b,c")).toBe(","); // 1 semicolon vs 1 comma → equal → comma
  });

  it("should handle no delimiters", () => {
    expect(detectDelimiter("abcd")).toBe(","); // default
  });
});

describe("parseCsvLine", () => {
  it("should parse simple comma-separated values", () => {
    expect(parseCsvLine("a,b,c", ",")).toEqual(["a", "b", "c"]);
  });

  it("should parse semicolon-separated values", () => {
    expect(parseCsvLine("a;b;c", ";")).toEqual(["a", "b", "c"]);
  });

  it("should handle quoted fields", () => {
    expect(parseCsvLine('"hello",world', ",")).toEqual(["hello", "world"]);
  });

  it("should handle escaped quotes inside quoted fields", () => {
    expect(parseCsvLine('"he""llo",world', ",")).toEqual(['he"llo', "world"]);
  });

  it("should handle commas inside quoted fields", () => {
    expect(parseCsvLine('"a,b",c', ",")).toEqual(["a,b", "c"]);
  });

  it("should handle empty fields", () => {
    expect(parseCsvLine("a,,c", ",")).toEqual(["a", "", "c"]);
  });

  it("should handle single field", () => {
    expect(parseCsvLine("hello", ",")).toEqual(["hello"]);
  });
});

describe("parseNumber", () => {
  it("should parse EU format (dot thousands, comma decimal)", () => {
    expect(parseNumber("1.234,56")).toBe("1234.56");
  });

  it("should parse negative EU format", () => {
    expect(parseNumber("-175,50")).toBe("-175.50");
  });

  it("should parse US format with comma thousands", () => {
    expect(parseNumber("1,234.56")).toBe("1234.56");
  });

  it("should parse plain number", () => {
    expect(parseNumber("175.50")).toBe("175.50");
  });

  it("should return '0' for empty string", () => {
    expect(parseNumber("")).toBe("0");
    expect(parseNumber("  ")).toBe("0");
  });

  it("should handle comma-only decimal (no thousands)", () => {
    // Line 74-76: lastComma >= 0 && lastDot < 0
    expect(parseNumber("175,50")).toBe("175.50");
    expect(parseNumber("-42,5")).toBe("-42.5");
    expect(parseNumber("0,99")).toBe("0.99");
  });

  it("should handle integer", () => {
    expect(parseNumber("100")).toBe("100");
  });

  it("should handle negative number with no separator", () => {
    expect(parseNumber("-50")).toBe("-50");
  });
});

describe("convertDateDMY", () => {
  it("should convert DD-MM-YYYY to YYYYMMDD", () => {
    expect(convertDateDMY("15-03-2025")).toBe("20250315");
  });

  it("should return input if no match", () => {
    expect(convertDateDMY("2025-03-15")).toBe("2025-03-15");
  });

  it("should trim whitespace", () => {
    expect(convertDateDMY("  15-03-2025  ")).toBe("20250315");
  });
});

describe("convertDateDMYSlash", () => {
  it("should convert DD/MM/YYYY to YYYYMMDD", () => {
    expect(convertDateDMYSlash("15/03/2025")).toBe("20250315");
  });

  it("should handle DD/MM/YYYY HH:MM:SS", () => {
    expect(convertDateDMYSlash("15/03/2025 09:30:00")).toBe("20250315");
  });

  it("should return input if no match", () => {
    expect(convertDateDMYSlash("2025-03-15")).toBe("2025-03-15");
  });
});

describe("convertDateISO", () => {
  it("should convert YYYY-MM-DD to YYYYMMDD", () => {
    expect(convertDateISO("2025-03-15")).toBe("20250315");
  });

  it("should handle already compact format", () => {
    expect(convertDateISO("20250315")).toBe("20250315");
  });
});

describe("findColumn", () => {
  it("should find column by exact name (case-insensitive)", () => {
    expect(findColumn(["Name", "ISIN", "Price"], ["isin"])).toBe(1);
  });

  it("should find column with multiple candidates", () => {
    expect(findColumn(["Fecha", "ISIN", "Precio"], ["price", "precio"])).toBe(2);
  });

  it("should return -1 if not found", () => {
    expect(findColumn(["Name", "ISIN"], ["price"])).toBe(-1);
  });

  it("should handle trimming", () => {
    expect(findColumn(["Name", " ISIN "], ["isin"])).toBe(1);
  });
});

describe("stripBom", () => {
  it("should strip UTF-8 BOM", () => {
    expect(stripBom("\uFEFFhello")).toBe("hello");
  });

  it("should leave non-BOM text unchanged", () => {
    expect(stripBom("hello")).toBe("hello");
  });
});
