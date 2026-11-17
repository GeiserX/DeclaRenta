/**
 * The profile settings a report was computed with, as one line of text.
 *
 * The fiscal method, titulares and auto-conversions change the figures, so the
 * web Results header and the PDF print this line next to them. The CSV writes
 * the same settings as its own section (see csv.ts).
 */

import { fxMethodOf, type FxMethod, type ReportSettings } from "../types/tax.js";
import type { TranslationKey } from "../i18n/index.js";

type Translate = (key: TranslationKey, params?: Record<string, string>) => string;

/** Translation key of each method's name («Criterio DGT (multidivisa)», …). */
export const FX_METHOD_NAME_KEY: Record<FxMethod, TranslationKey> = {
  multidivisa: "report.fx_method_name.multidivisa",
  "tradicional-divisa": "report.fx_method_name.tradicional-divisa",
  monodivisa: "report.fx_method_name.monodivisa",
};

/**
 * The settings line. It prints the method NAME for all three methods, so a
 * «Tradicional con divisa» report never reads as "monodivisa no" (issue #434).
 */
export function formatReportSettings(settings: ReportSettings, t: Translate): string {
  const yesNo = (value: boolean) => t(value ? "results.setting_yes" : "results.setting_no");
  return t("report.settings_line", {
    method: t(FX_METHOD_NAME_KEY[fxMethodOf(settings)]),
    titulares: String(settings.titulares),
    autoconvert: yesNo(settings.trackAutoConvert),
  });
}

/** True when two settings would produce different figures. */
export function reportSettingsDiffer(a: ReportSettings, b: ReportSettings): boolean {
  return (
    fxMethodOf(a) !== fxMethodOf(b) || a.trackAutoConvert !== b.trackAutoConvert || a.titulares !== b.titulares
  );
}
