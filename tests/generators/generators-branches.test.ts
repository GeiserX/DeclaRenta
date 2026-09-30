import { describe, it, expect } from "vitest";
import { validateModelo720Records } from "../../src/generators/modelo720-validator.js";

describe("modelo720-validator - additional branches", () => {
  it("should validate record shorter than 500 chars but still check fields", () => {
    // 100-char record — short but still has type and model
    const record = "2720" + "2025" + "12345678A" + " ".repeat(83);
    const results = validateModelo720Records([record]);
    expect(results[0].valid).toBe(false);
    expect(results[0].errors.some((e) => e.includes("Longitud incorrecta"))).toBe(true);
  });

  it("should validate record with invalid register type", () => {
    const record = "3" + "720" + "2025" + "12345678A" + " ".repeat(487);
    const results = validateModelo720Records([record]);
    expect(results[0].errors.some((e) => e.includes("Tipo de registro inválido"))).toBe(true);
  });

  it("should validate record with invalid model number", () => {
    const record = "1" + "721" + "2025" + "12345678A" + " ".repeat(487);
    const results = validateModelo720Records([record]);
    expect(results[0].errors.some((e) => e.includes("Número de modelo inválido"))).toBe(true);
  });

  it("should validate record with non-numeric year", () => {
    const record = "1" + "720" + "ABCD" + "12345678A" + " ".repeat(487);
    const results = validateModelo720Records([record]);
    expect(results[0].errors.some((e) => e.includes("Ejercicio inválido"))).toBe(true);
  });

  it("should validate NIE format (starts with X/Y/Z)", () => {
    const record = "1" + "720" + "2025" + "X1234567A" + " ".repeat(487);
    const results = validateModelo720Records([record]);
    // NIE format should be valid
    expect(results[0].errors.filter((e) => e.includes("NIF")).length).toBe(0);
  });

  it("should reject invalid NIF format", () => {
    const record = "1" + "720" + "2025" + "AAAA1234B" + " ".repeat(487);
    const results = validateModelo720Records([record]);
    expect(results[0].errors.some((e) => e.includes("Formato de NIF inválido"))).toBe(true);
  });

  it("should validate detail record (type 2) with all fields", () => {
    // Build a 500-char type-2 record with valid structure
    const record = new Array(501).join(" ");
    const arr = record.split("");
    arr[0] = "2"; // type
    arr[1] = "7"; arr[2] = "2"; arr[3] = "0"; // model
    arr[4] = "2"; arr[5] = "0"; arr[6] = "2"; arr[7] = "5"; // year
    // NIF positions 9-17 (indices 8-16)
    "12345678A".split("").forEach((c, i) => arr[8 + i] = c);
    // Clave V, subclave 1 at positions 102-103 (indices 101-102)
    arr[101] = "V"; arr[102] = "1";
    // Country code at positions 129-130 (indices 128-129)
    arr[128] = "U"; arr[129] = "S";
    // ID type at position 131 (index 130)
    arr[130] = "1";
    // ISIN at positions 132-143 (indices 131-142)
    "US0378331005".split("").forEach((c, i) => arr[131 + i] = c);
    // Declaration type at position 423 (index 422)
    arr[422] = "A";
    // Valoración 1 at positions 433-446 (indices 432-445): 14 digits
    "00000000175500".split("").forEach((c, i) => arr[432 + i] = c);
    // Valoración 2 at positions 448-461 (indices 447-460): 14 digits
    "00000000195000".split("").forEach((c, i) => arr[447 + i] = c);
    // Clave de representación at position 462 (index 461)
    arr[461] = "A";
    // Número de valores at positions 463-474 (indices 462-473): 12 digits
    "000000000010".split("").forEach((c, i) => arr[462 + i] = c);
    "10000".split("").forEach((c, i) => arr[475 + i] = c);

    const validRecord = arr.join("");
    const results = validateModelo720Records([validRecord]);
    expect(results[0].valid).toBe(true);
    expect(results[0].errors).toHaveLength(0);
  });

  it("should detect invalid country code in detail record", () => {
    const record = new Array(501).join(" ");
    const arr = record.split("");
    arr[0] = "2";
    arr[1] = "7"; arr[2] = "2"; arr[3] = "0";
    arr[4] = "2"; arr[5] = "0"; arr[6] = "2"; arr[7] = "5";
    "12345678A".split("").forEach((c, i) => arr[8 + i] = c);
    // Invalid country code
    arr[128] = "Z"; arr[129] = "Z";
    arr[130] = "0"; // non-ISIN id type
    arr[422] = "A";
    "00000000175500".split("").forEach((c, i) => arr[432 + i] = c);
    "00000000195000".split("").forEach((c, i) => arr[447 + i] = c);
    "000000000010".split("").forEach((c, i) => arr[462 + i] = c);
    "10000".split("").forEach((c, i) => arr[475 + i] = c);
    const results = validateModelo720Records([arr.join("")]);
    expect(results[0].errors.some((e) => e.includes("Código de país ISO inválido"))).toBe(true);
  });

  it("should detect non-numeric acquisition value", () => {
    const record = new Array(501).join(" ");
    const arr = record.split("");
    arr[0] = "2";
    arr[1] = "7"; arr[2] = "2"; arr[3] = "0";
    arr[4] = "2"; arr[5] = "0"; arr[6] = "2"; arr[7] = "5";
    "12345678A".split("").forEach((c, i) => arr[8 + i] = c);
    arr[128] = "U"; arr[129] = "S";
    arr[130] = "0";
    arr[422] = "A";
    // Non-numeric valoración 1
    "ABCDEFGHIJKLMN".split("").forEach((c, i) => arr[432 + i] = c);
    "00000000195000".split("").forEach((c, i) => arr[447 + i] = c);
    "000000000010".split("").forEach((c, i) => arr[462 + i] = c);
    "10000".split("").forEach((c, i) => arr[475 + i] = c);
    const results = validateModelo720Records([arr.join("")]);
    expect(results[0].errors.some((e) => e.includes("Valoración 1 no numérica"))).toBe(true);
  });

  it("should detect non-numeric valuation value", () => {
    const record = new Array(501).join(" ");
    const arr = record.split("");
    arr[0] = "2";
    arr[1] = "7"; arr[2] = "2"; arr[3] = "0";
    arr[4] = "2"; arr[5] = "0"; arr[6] = "2"; arr[7] = "5";
    "12345678A".split("").forEach((c, i) => arr[8 + i] = c);
    arr[128] = "U"; arr[129] = "S";
    arr[130] = "0";
    arr[422] = "A";
    "00000000175500".split("").forEach((c, i) => arr[432 + i] = c);
    "ABCDEFGHIJKLMN".split("").forEach((c, i) => arr[447 + i] = c);
    "000000000010".split("").forEach((c, i) => arr[462 + i] = c);
    "10000".split("").forEach((c, i) => arr[475 + i] = c);
    const results = validateModelo720Records([arr.join("")]);
    expect(results[0].errors.some((e) => e.includes("Valoración 2 no numérica"))).toBe(true);
  });

  it("should detect non-numeric quantity", () => {
    const record = new Array(501).join(" ");
    const arr = record.split("");
    arr[0] = "2";
    arr[1] = "7"; arr[2] = "2"; arr[3] = "0";
    arr[4] = "2"; arr[5] = "0"; arr[6] = "2"; arr[7] = "5";
    "12345678A".split("").forEach((c, i) => arr[8 + i] = c);
    arr[128] = "U"; arr[129] = "S";
    arr[130] = "0";
    arr[422] = "A";
    "00000000175500".split("").forEach((c, i) => arr[432 + i] = c);
    "00000000195000".split("").forEach((c, i) => arr[447 + i] = c);
    "ABCDEFGHIJKL".split("").forEach((c, i) => arr[462 + i] = c);
    "10000".split("").forEach((c, i) => arr[475 + i] = c);
    const results = validateModelo720Records([arr.join("")]);
    expect(results[0].errors.some((e) => e.includes("Número de valores no numérico"))).toBe(true);
  });

  it("should detect invalid declaration type in detail record", () => {
    const record = new Array(501).join(" ");
    const arr = record.split("");
    arr[0] = "2";
    arr[1] = "7"; arr[2] = "2"; arr[3] = "0";
    arr[4] = "2"; arr[5] = "0"; arr[6] = "2"; arr[7] = "5";
    "12345678A".split("").forEach((c, i) => arr[8 + i] = c);
    arr[128] = "U"; arr[129] = "S";
    arr[130] = "0";
    arr[422] = "X"; // invalid
    "00000000175500".split("").forEach((c, i) => arr[432 + i] = c);
    "00000000195000".split("").forEach((c, i) => arr[447 + i] = c);
    "000000000010".split("").forEach((c, i) => arr[462 + i] = c);
    "10000".split("").forEach((c, i) => arr[475 + i] = c);
    const results = validateModelo720Records([arr.join("")]);
    expect(results[0].errors.some((e) => e.includes("Tipo de declaración inválido"))).toBe(true);
  });

  it("should validate summary record (type 1) with non-numeric totals", () => {
    const record = new Array(501).join(" ");
    const arr = record.split("");
    arr[0] = "1"; // summary type
    arr[1] = "7"; arr[2] = "2"; arr[3] = "0";
    arr[4] = "2"; arr[5] = "0"; arr[6] = "2"; arr[7] = "5";
    "12345678A".split("").forEach((c, i) => arr[8 + i] = c);
    // Detail count at positions 136-144 (indices 135-143): non-numeric
    "ABCDEFGHI".split("").forEach((c, i) => arr[135 + i] = c);
    // Suma de valoración 1 at positions 146-162 (indices 145-161): non-numeric
    "ABCDEFGHIJKLMNOPQ".split("").forEach((c, i) => arr[145 + i] = c);
    // Suma de valoración 2 at positions 164-180 (indices 163-179): non-numeric
    "ABCDEFGHIJKLMNOPQ".split("").forEach((c, i) => arr[163 + i] = c);
    const results = validateModelo720Records([arr.join("")]);
    expect(results[0].errors.some((e) => e.includes("Número de registros no numérico"))).toBe(true);
    expect(results[0].errors.some((e) => e.includes("Suma de valoración 1 no numérica"))).toBe(true);
    expect(results[0].errors.some((e) => e.includes("Suma de valoración 2 no numérica"))).toBe(true);
  });

  it("should validate ISIN checksum (Luhn) on detail record with id type 1", () => {
    const record = new Array(501).join(" ");
    const arr = record.split("");
    arr[0] = "2";
    arr[1] = "7"; arr[2] = "2"; arr[3] = "0";
    arr[4] = "2"; arr[5] = "0"; arr[6] = "2"; arr[7] = "5";
    "12345678A".split("").forEach((c, i) => arr[8 + i] = c);
    arr[128] = "U"; arr[129] = "S";
    arr[130] = "1"; // ISIN type
    // Invalid ISIN checksum
    "US0378331009".split("").forEach((c, i) => arr[131 + i] = c);
    arr[422] = "A";
    "00000000175500".split("").forEach((c, i) => arr[432 + i] = c);
    "00000000195000".split("").forEach((c, i) => arr[447 + i] = c);
    "000000000010".split("").forEach((c, i) => arr[462 + i] = c);
    "10000".split("").forEach((c, i) => arr[475 + i] = c);
    const results = validateModelo720Records([arr.join("")]);
    expect(results[0].errors.some((e) => e.includes("ISIN con dígito de control inválido"))).toBe(true);
  });

  it("should pass valid ISIN checksum (US0378331005 = AAPL)", () => {
    const record = new Array(501).join(" ");
    const arr = record.split("");
    arr[0] = "2";
    arr[1] = "7"; arr[2] = "2"; arr[3] = "0";
    arr[4] = "2"; arr[5] = "0"; arr[6] = "2"; arr[7] = "5";
    "12345678A".split("").forEach((c, i) => arr[8 + i] = c);
    arr[128] = "U"; arr[129] = "S";
    arr[130] = "1"; // ISIN type
    "US0378331005".split("").forEach((c, i) => arr[131 + i] = c);
    arr[422] = "A";
    "00000000175500".split("").forEach((c, i) => arr[432 + i] = c);
    "00000000195000".split("").forEach((c, i) => arr[447 + i] = c);
    "000000000010".split("").forEach((c, i) => arr[462 + i] = c);
    "10000".split("").forEach((c, i) => arr[475 + i] = c);
    const results = validateModelo720Records([arr.join("")]);
    expect(results[0].errors.filter((e) => e.includes("ISIN"))).toHaveLength(0);
  });
});
