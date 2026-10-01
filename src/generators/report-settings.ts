/**
 * The profile settings a report was computed with, as one line of text.
 *
 * Monodivisa, titulares and auto-conversions change the figures, so the web
 * Results header and the PDF print this line next to them. The CSV writes the
 * same settings as its own section (see csv.ts).
 */

import type { ReportSettings } from "../types/tax.js";
import type { TranslationKey } from "../i18n/index.js";

type Translate = (key: TranslationKey, params?: Record<string, string>) => string;

export function formatReportSettings(settings: ReportSettings, t: Translate): string {
  const yesNo = (value: boolean) => t(value ? "results.setting_yes" : "results.setting_no");
  return t("results.settings_used", {
    monodivisa: yesNo(settings.monodivisa),
    titulares: String(settings.titulares),
    autoconvert: yesNo(settings.trackAutoConvert),
  });
}

/** True when two settings would produce different figures. */
export function reportSettingsDiffer(a: ReportSettings, b: ReportSettings): boolean {
  return a.monodivisa !== b.monodivisa || a.trackAutoConvert !== b.trackAutoConvert || a.titulares !== b.titulares;
}
