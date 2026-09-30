import { describe, it, expect } from "vitest";
import { validateModelo720Records, validateModelo720TextFields } from "../../src/generators/modelo720-validator.js";
import { BOE_720, boeGoldenValuesRecord } from "./modelo720-boe-layout.js";

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
    // BOE tail: 432 sign, 433-446 valoración 1 (14), 447 sign, 448-461
    // valoración 2 (14), 462 representación, 463-474 número de valores (12),
    // 475 blank, 476-480 porcentaje, 481-500 blank.
    const v1 = "00000001800000";
    for (let i = 0; i < v1.length; i++) chars[432 + i] = v1[i]!;
    const v2 = "00000000000000";
    for (let i = 0; i < v2.length; i++) chars[447 + i] = v2[i]!;
    const qty = "000000000100";
    for (let i = 0; i < qty.length; i++) chars[462 + i] = qty[i]!;
    const pct = "10000";
    for (let i = 0; i < pct.length; i++) chars[475 + i] = pct[i]!;
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

  it("should detect non-numeric valoración 1", () => {
    const record = buildRecord("2");
    const modified = record.slice(0, 432) + "ABCDEFGHIJKLMN" + record.slice(446);
    const results = validateModelo720Records([modified]);
    expect(results[0]!.errors).toContainEqual(expect.stringContaining("Valoración 1"));
  });

  describe("BOE layout of the type-2 tail (432-500)", () => {
    // Every check below slices at positions from the BOE table in
    // modelo720-boe-layout.ts, never at the generator's own offsets.
    const d = BOE_720.detail;
    function withField(record: string, [from, to]: readonly [number, number], value: string): string {
      return record.slice(0, from - 1) + value + record.slice(to);
    }

    it("accepts a record hand-built from the BOE table", () => {
      const results = validateModelo720Records([boeGoldenValuesRecord()]);
      expect(results[0]!.errors).toEqual([]);
      expect(results[0]!.valid).toBe(true);
    });

    it("rejects the pre-fix layout (15-digit amounts at 433-447 / 449-463, quantity at 465-476)", () => {
      // The layout the generator used to write: every field after 432 sits one
      // or more bytes off the BOE column. The check must be able to go red on it.
      const chars = boeGoldenValuesRecord().split("");
      const legacyTail = " " + "000000005520000" + " " + "000000000000000" + "A" + "000000100000" + " " + "10000" + " ".repeat(18);
      expect(legacyTail).toHaveLength(69);
      for (let i = 0; i < legacyTail.length; i++) chars[431 + i] = legacyTail[i]!;
      const results = validateModelo720Records([chars.join("")]);
      expect(results[0]!.valid).toBe(false);
    });

    it("flags a digit in the valoración 2 sign (447)", () => {
      const record = withField(boeGoldenValuesRecord(), d.valoracion2Sign, "0");
      expect(validateModelo720Records([record])[0]!.errors).toContainEqual(expect.stringContaining("Signo de valoración 2"));
    });

    it("flags a digit in the valoración 1 sign (432)", () => {
      const record = withField(boeGoldenValuesRecord(), d.valoracion1Sign, "0");
      expect(validateModelo720Records([record])[0]!.errors).toContainEqual(expect.stringContaining("Signo de valoración 1"));
    });

    it("flags a space inside valoración 2 (448-461)", () => {
      const record = withField(boeGoldenValuesRecord(), d.valoracion2, " 0000000000000");
      expect(validateModelo720Records([record])[0]!.errors).toContainEqual(expect.stringContaining("Valoración 2"));
    });

    it("flags a V record whose clave de representación (462) is not A or B", () => {
      const record = withField(boeGoldenValuesRecord(), d.claveRepresentacion, "0");
      expect(validateModelo720Records([record])[0]!.errors).toContainEqual(expect.stringContaining("representación"));
    });

    it("flags a letter inside número de valores (463-474)", () => {
      const record = withField(boeGoldenValuesRecord(), d.numeroValores, "0A0000001000");
      expect(validateModelo720Records([record])[0]!.errors).toContainEqual(expect.stringContaining("Número de valores"));
    });

    it("flags a non-numeric porcentaje (476-480)", () => {
      const record = withField(boeGoldenValuesRecord(), d.porcentaje, "0 100");
      expect(validateModelo720Records([record])[0]!.errors).toContainEqual(expect.stringContaining("Porcentaje"));
    });

    it("flags content in the trailing blanks (481-500)", () => {
      const record = withField(boeGoldenValuesRecord(), d.blancos, "00" + " ".repeat(18));
      expect(validateModelo720Records([record])[0]!.errors).toContainEqual(expect.stringContaining("481-500"));
    });
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

  describe("Summary record numeric field validation", () => {
    it("should detect non-numeric suma de valoración 1 in summary record", () => {
      const record = buildRecord("1", { 145: "ABCDEFGHIJKLMNOPQ" });
      const results = validateModelo720Records([record]);
      expect(results[0]!.valid).toBe(false);
      expect(results[0]!.errors).toContainEqual(expect.stringContaining("Suma de valoración 1"));
    });

    it("should detect non-numeric suma de valoración 2 in summary record", () => {
      const record = buildRecord("1", { 163: "ABCDEFGHIJKLMNOPQ" });
      const results = validateModelo720Records([record]);
      expect(results[0]!.valid).toBe(false);
      expect(results[0]!.errors).toContainEqual(expect.stringContaining("Suma de valoración 2"));
    });
  });

  describe("Control-character detection in records", () => {
    it("flags a record containing a control character (LF) as invalid", () => {
      // Inject a newline into the entity-name area (190-230 → index 189).
      const record = buildRecord("2", { 189: "AC\nME" });
      const results = validateModelo720Records([record]);
      expect(results[0]!.valid).toBe(false);
      expect(results[0]!.errors).toContainEqual(expect.stringContaining("caracteres de control"));
    });

    it("does NOT flag a clean record", () => {
      const record = buildRecord("2");
      const results = validateModelo720Records([record]);
      const ctrlErrors = results[0]!.errors.filter((e) => e.includes("caracteres de control"));
      expect(ctrlErrors).toHaveLength(0);
    });
  });
});

describe("validateModelo720TextFields", () => {
  it("flags a text field containing control chars (CR/LF) with a Spanish warning", () => {
    const issues = validateModelo720TextFields([
      { label: "descripción", value: "ACME\r\nCORP" },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("caracteres de control");
    expect(issues[0]).toContain("«descripción»");
  });

  it("flags TAB and DEL control characters", () => {
    expect(validateModelo720TextFields([{ label: "nombre", value: "A\tB" }])).toHaveLength(1);
    expect(validateModelo720TextFields([{ label: "nombre", value: "A\x7FB" }])).toHaveLength(1);
  });

  it("returns no issues for clean text (accents and ñ are allowed)", () => {
    const issues = validateModelo720TextFields([
      { label: "nombre", value: "JOSÉ MUÑOZ PEÑA" },
      { label: "entidad", value: "Société Générale" },
    ]);
    expect(issues).toHaveLength(0);
  });

  it("returns one issue per offending field and skips clean ones", () => {
    const issues = validateModelo720TextFields([
      { label: "campo limpio", value: "OK" },
      { label: "campo sucio", value: "BAD\x01VALUE" },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("«campo sucio»");
  });
});
