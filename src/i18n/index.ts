/**
 * Type-safe internationalization system for DeclaRenta.
 *
 * Zero dependencies. Supports 5 locales: es, en, ca, eu, gl.
 * Spanish is the default. Locale preference stored in localStorage.
 */

import es, { type TranslationKeys } from "./locales/es.js";
import en from "./locales/en.js";
import ca from "./locales/ca.js";
import eu from "./locales/eu.js";
import gl from "./locales/gl.js";

export type Locale = "es" | "en" | "ca" | "eu" | "gl";
export type TranslationKey = keyof TranslationKeys;

const LOCALES: Record<Locale, TranslationKeys> = { es, en, ca, eu, gl };
const LOCALE_NAMES: Record<Locale, string> = {
  es: "Español",
  en: "English",
  ca: "Català",
  eu: "Euskara",
  gl: "Galego",
};

let currentLocale: Locale = "es";

/**
 * Detect locale from navigator.language, falling back to "es".
 */
export function detectLocale(): Locale {
  if (typeof navigator === "undefined") return "es";
  const lang = navigator.language.toLowerCase();
  if (lang.startsWith("en")) return "en";
  if (lang.startsWith("ca")) return "ca";
  if (lang.startsWith("eu")) return "eu";
  if (lang.startsWith("gl")) return "gl";
  return "es";
}

/**
 * Initialize the i18n system. Call once on app startup.
 */
export function initLocale(): void {
  let saved: string | null = null;
  try { saved = localStorage.getItem("locale"); } catch { /* Node/SSR */ }
  currentLocale = saved && saved in LOCALES ? (saved as Locale) : detectLocale();
}

/**
 * Get the current locale.
 */
export function getCurrentLocale(): Locale {
  return currentLocale;
}

/**
 * Get all available locales with their display names.
 */
export function getLocaleNames(): Record<Locale, string> {
  return LOCALE_NAMES;
}

/**
 * Set the active locale and persist to localStorage.
 * Dispatches a "localechange" CustomEvent on document.
 */
export function setLocale(locale: Locale): void {
  if (!(locale in LOCALES)) return;
  currentLocale = locale;
  try { localStorage.setItem("locale", locale); } catch { /* Node/SSR */ }
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale;
    document.dispatchEvent(new CustomEvent("localechange", { detail: { locale } }));
  }
}

/**
 * Translate a key, with optional interpolation.
 *
 * @example t("results.operations_count", { count: "42" }) → "42 operación(es)"
 */
export function t(key: TranslationKey, params?: Record<string, string>): string {
  const translations = LOCALES[currentLocale] as Record<string, string>;
  let text = translations[key as string] ?? (es as Record<string, string>)[key as string] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v);
    }
  }
  return text;
}
