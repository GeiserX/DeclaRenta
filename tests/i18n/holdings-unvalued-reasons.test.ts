/**
 * Issue #470: the «sin valorar» banners of the 720, the 721 and the D-6 give
 * the reason. Since the rounds of #470 a holding becomes unvalued in more ways
 * than «no price or no rate»: a value that is no number or too big for the 720
 * field (12 integer digits in euros), a quantity and a value of opposite
 * signs, or a file that gives neither the quantity nor the value (a 0 that no
 * value confirms). Each banner must name every reason, in the 5 locales.
 */

import { afterEach, describe, expect, it } from "vitest";
import { setLocale, t } from "../../src/i18n/index.js";

const KEYS = ["m720.positions_unvalued", "m721.positions_unvalued", "d6.positions_unvalued"] as const;

/** One fragment per reason, per locale: price or rate, value (no number or 12 digits), opposite signs, the unconfirmed 0. */
const REASONS = {
  es: ["tipo de cambio", "no es un número", "12 cifras enteras", "signos contrarios", "un 0 que"],
  en: ["exchange rate", "not a number", "12 integer digits", "opposite signs", "a 0 that"],
  ca: ["tipus de canvi", "no és un número", "12 xifres enteres", "signes contraris", "un 0 que"],
  eu: ["kanbio-tasa", "ez da zenbaki bat", "12 zifra oso", "zeinu kontrakoak", "0 bat"],
  gl: ["tipo de cambio", "non é un número", "12 cifras enteiras", "signos contrarios", "un 0 que"],
} as const;

afterEach(async () => {
  await setLocale("es");
});

describe("#470 the unvalued banners say every reason a holding is unvalued", () => {
  for (const [locale, fragments] of Object.entries(REASONS) as [keyof typeof REASONS, readonly string[]][]) {
    it(`${locale}: each of the three banners names every reason`, async () => {
      await setLocale(locale);
      for (const key of KEYS) {
        const text = t(key, { count: "2" });
        expect(text).toMatch(/^2 /);
        expect(text).not.toContain("{{");
        for (const fragment of fragments) expect(text, `${locale} ${key}`).toContain(fragment);
      }
      // The D-6 also names a share count too big for the 720's field (10 integer digits).
      expect(t("d6.positions_unvalued", { count: "2" })).toContain(D6_COUNT_TOO_BIG[locale]);
    });
  }
});

/** The D-6's own reason: a share count with more than 10 integer digits. */
const D6_COUNT_TOO_BIG = {
  es: "más de 10 cifras enteras",
  en: "more than 10 integer digits",
  ca: "més de 10 xifres enteres",
  eu: "10 zifra oso baino gehiago",
  gl: "máis de 10 cifras enteiras",
} as const;
