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

/**
 * A renderable engine/parser message. Mirrors the load-bearing fields of
 * `TaxMessage` (src/types/tax.ts) without importing it, so the i18n layer stays
 * dependency-free. The engine always fills `message`/`hint` with Spanish text —
 * that text is the authoritative FALLBACK whenever the message `id` has no
 * locale key (so an un-migrated message renders byte-identically to before).
 */
export interface LocalizableMessage {
  id: string;
  message: string;
  hint?: string;
  context?: Record<string, string>;
}

/**
 * True when `key` is a real translation key (present in the source-of-truth `es`
 * locale). The `es` object is the canonical key set — every other locale is
 * compile-enforced to match it (`TranslationKeys`), so membership here is the
 * single authority on "is this id something we translate?".
 */
export function isTranslationKey(key: string): key is TranslationKey {
  return Object.prototype.hasOwnProperty.call(es, key);
}

/**
 * Localize an engine/parser message by treating its `id` as a translation key.
 *
 * If `m.id` is a known locale key, returns the active locale's text with the
 * message's `context` interpolated into `{{placeholders}}`. Otherwise returns
 * the engine's pre-rendered Spanish `m.message` UNCHANGED — so a message whose
 * id was never migrated renders exactly as it does today (zero regression).
 *
 * The engine keeps emitting Spanish `message`/`hint`; this is purely a
 * presentation-layer lookup and never alters the emitted message object.
 */
export function localizeMessage(m: LocalizableMessage): string {
  if (isTranslationKey(m.id)) return t(m.id, m.context);
  return m.message;
}

/**
 * Localize a message's hint by treating `${id}.hint` as a translation key.
 *
 * Mirrors {@link localizeMessage}: a known `${id}.hint` key renders the active
 * locale's hint (with `context` interpolated); otherwise the engine's Spanish
 * `m.hint` is returned unchanged. Returns `undefined` when the message has no
 * hint and no hint key exists.
 */
export function localizeHint(m: LocalizableMessage): string | undefined {
  const hintKey = `${m.id}.hint`;
  if (isTranslationKey(hintKey)) return t(hintKey, m.context);
  return m.hint;
}
