import { describe, it, expect } from "vitest";
import { validateModelo720Records } from "../../src/generators/modelo720-validator.js";

/** Build a 500-char record with given content at specific positions */
function buildRecord(type: "1" | "2", overrides: Record<number, string> = {}): string {
  const chars = new Array(500).fill(" ");
  chars[0] = type;
  // Model 720
  chars[1] = "7"; chars[2] = "2"; chars[3] = "0";
  // Year 2025
  chars[4] = "2"; chars[5] = "0"; chars[6] = "2"; chars[7] = "5";
  // NIF 12345678A
  const nif = "12345678A";
  for (let i = 0; i < nif.length; i++) chars[8 + i] = nif[i]!;

  if (type === "2") {
    // Country code at 129-130
    chars[128] = "U"; chars[129] = "S";
    // ID type = 1 (ISIN)
    chars[130] = "1";
    // ISIN US0378331005 (AAPL) at 132-143
    const isin = "US0378331005";
    for (let i = 0; i < isin.length; i++) chars[131 + i] = isin[i]!;
    // Declaration type at position 423
    chars[422] = "A";
    // Acquisition value (positions 433-447): 15 digits
    const acqVal = "000000001500000";
    for (let i = 0; i < acqVal.length; i++) chars[432 + i] = acqVal[i]!;
    // Valuation value (positions 449-463): 15 digits
    const valVal = "000000001800000";
    for (let i = 0; i < valVal.length; i++) chars[448 + i] = valVal[i]!;
    // Quantity (positions 465-476): 12 digits
    const qty = "000000000100";
    for (let i = 0; i < qty.length; i++) chars[464 + i] = qty[i]!;
  }

  if (type === "1") {
    // Detail count (positions 136-144): 9 digits
    const cnt = "000000001";
    for (let i = 0; i < cnt.length; i++) chars[135 + i] = cnt[i]!;
    // Total acquisition (positions 146-162): 17 digits
    const totalAcq = "00000000001500000";
    for (let i = 0; i < totalAcq.length; i++) chars[145 + i] = totalAcq[i]!;
    // Total valuation (positions 164-180): 17 digits
    const totalVal = "00000000001800000";
    for (let i = 0; i < totalVal.length; i++) chars[163 + i] = totalVal[i]!;
  }

  // Apply overrides
  for (const [pos, val] of Object.entries(overrides)) {
    for (let i = 0; i < val.length; i++) {
      chars[Number(pos) + i] = val[i]!;
    }
  }

  return chars.join("");
}

describe("validateModelo720Records", () => {
  it("should pass a valid detail record", () => {
    const record = buildRecord("2");
    const results = validateModelo720Records([record]);
    expect(results).toHaveLength(1);
    expect(results[0]!.valid).toBe(true);
    expect(results[0]!.errors).toHaveLength(0);
  });

  it("should pass a valid summary record", () => {
    const record = buildRecord("1");
    const results = validateModelo720Records([record]);
    expect(results).toHaveLength(1);
    expect(results[0]!.valid).toBe(true);
    expect(results[0]!.errors).toHaveLength(0);
  });

  it("should detect wrong record length", () => {
    const results = validateModelo720Records(["short"]);
    expect(results[0]!.valid).toBe(false);
    expect(results[0]!.errors[0]).toMatch(/Longitud incorrecta.*5.*500/);
  });

  it("should detect invalid register type", () => {
    const record = buildRecord("2");
    const modified = "3" + record.slice(1);
    const results = validateModelo720Records([modified]);
    expect(results[0]!.errors).toContainEqual(expect.stringContaining("Tipo de registro"));
  });

  it("should detect invalid model number", () => {
    const record = buildRecord("2");
    const modified = record.slice(0, 1) + "999" + record.slice(4);
    const results = validateModelo720Records([modified]);
    expect(results[0]!.errors).toContainEqual(expect.stringContaining("modelo"));
  });

  it("should detect non-numeric year", () => {
    const record = buildRecord("2");
    const modified = record.slice(0, 4) + "ABCD" + record.slice(8);
    const results = validateModelo720Records([modified]);
    expect(results[0]!.errors).toContainEqual(expect.stringContaining("Ejercicio"));
  });

  it("should detect invalid NIF format", () => {
    const record = buildRecord("2");
    // Replace NIF (positions 9-17) with invalid value
    const modified = record.slice(0, 8) + "INVALID!!" + record.slice(17);
    const results = validateModelo720Records([modified]);
    expect(results[0]!.errors).toContainEqual(expect.stringContaining("NIF"));
  });

  it("should accept valid NIE format (X/Y/Z prefix)", () => {
    const record = buildRecord("2");
    const modified = record.slice(0, 8) + "X1234567A" + record.slice(17);
    const results = validateModelo720Records([modified]);
    const nifErrors = results[0]!.errors.filter((e) => e.includes("NIF"));
    expect(nifErrors).toHaveLength(0);
  });

  it("should detect invalid country code in detail record", () => {
    const record = buildRecord("2");
    const modified = record.slice(0, 128) + "ZZ" + record.slice(130);
    const results = validateModelo720Records([modified]);
    expect(results[0]!.errors).toContainEqual(expect.stringContaining("país"));
  });

  it("should detect invalid ISIN checksum", () => {
    const record = buildRecord("2");
    // Replace ISIN with one with wrong check digit (US0378331009 — wrong last digit)
    const modified = record.slice(0, 131) + "US0378331009" + record.slice(143);
    const results = validateModelo720Records([modified]);
    expect(results[0]!.errors).toContainEqual(expect.stringContaining("ISIN"));
  });

  it("should detect invalid declaration type", () => {
    const record = buildRecord("2");
    const modified = record.slice(0, 422) + "X" + record.slice(423);
    const results = validateModelo720Records([modified]);
    expect(results[0]!.errors).toContainEqual(expect.stringContaining("declaración"));
  });

  it("should detect non-numeric acquisition value", () => {
    const record = buildRecord("2");
    const modified = record.slice(0, 432) + "ABCDEFGHIJKLMNO" + record.slice(447);
    const results = validateModelo720Records([modified]);
    expect(results[0]!.errors).toContainEqual(expect.stringContaining("adquisición"));
  });

  it("should validate multiple records and return per-record results", () => {
    const valid = buildRecord("2");
    const invalid = "X" + valid.slice(1);
    const results = validateModelo720Records([valid, invalid]);
    expect(results).toHaveLength(2);
    expect(results[0]!.valid).toBe(true);
    expect(results[1]!.valid).toBe(false);
    expect(results[1]!.recordIndex).toBe(1);
  });

  it("should return empty array for no records", () => {
    const results = validateModelo720Records([]);
    expect(results).toHaveLength(0);
  });
});
