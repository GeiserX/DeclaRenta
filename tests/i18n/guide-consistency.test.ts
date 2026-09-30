/**
 * The Renta Web guide exists in five locales plus a spec comment in
 * casillas.ts. They must give the user the same instructions.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import es from "../../src/i18n/locales/es.js";
import en from "../../src/i18n/locales/en.js";
import ca from "../../src/i18n/locales/ca.js";
import eu from "../../src/i18n/locales/eu.js";
import gl from "../../src/i18n/locales/gl.js";

const locales = { es, en, ca, eu, gl };

/** The clave number the text gives for casilla 1626, e.g. "clave <strong>4</strong>" → "4". */
function claveFor1626(text: string): string | undefined {
  const plain = text.replace(/<[^>]+>/g, "");
  const after = plain.slice(plain.indexOf("1626"));
  return after.match(/\b(\d)\b/)?.[1];
}

describe("Renta Web guide consistency", () => {
  it("gives the same clave for casilla 1626 in every locale and in the casillas.ts spec comment", () => {
    // AEAT: clave 4 = otros elementos patrimoniales NO afectos a actividades
    // económicas; clave 5 is the afectos one, wrong for a private investor.
    for (const [name, locale] of Object.entries(locales)) {
      expect(claveFor1626(locale["guide_rw.clave_prereq_hint"]), name).toBe("4");
    }
    const source = readFileSync(new URL("../../src/generators/casillas.ts", import.meta.url), "utf8");
    const specLine = source.split("\n").find((l) => l.includes("1626 ="));
    expect(specLine).toBeDefined();
    expect(claveFor1626(specLine!)).toBe("4");
  });

  it("asks for the security's issuer as «Entidad emisora», never the broker", () => {
    for (const [name, locale] of Object.entries(locales)) {
      const text = locale["guide_rw.entidad_emisora_value"];
      expect(text, name).not.toMatch(/Interactive Brokers|Degiro|eToro/);
      expect(text, name).toContain("Apple");
    }
  });

  it("never points the double-taxation income row at casilla 0029", () => {
    for (const [name, locale] of Object.entries(locales)) {
      expect(locale["guide_rw.dt_campo_hint"], name).toContain("0588");
      expect(locale["guide_rw.dt_campo_hint"], name).not.toContain("0029");
    }
  });
});
