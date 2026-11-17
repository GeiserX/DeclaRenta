/**
 * Fiscal profile for DeclaRenta.
 *
 * The form collects personal data only: NIF, name, surname, CCAA and phone,
 * used by the Modelo 720 and D-6 generators. The stored profile also keeps the
 * settings chosen elsewhere: the year (from the data and the results year
 * select), and the FX method, titulares and auto-conversions (chosen on the
 * Modelo 100 review step). Persists to localStorage.
 */

import type { FxMethod } from "../types/tax.js";
import { t } from "../i18n/index.js";
import { esc } from "./esc.js";
import { clearLocalData } from "./storage.js";
import { DEFAULT_FX_METHOD, isFxMethod } from "./fx-method.js";

const PROFILE_KEY = "declarenta_profile";

export interface FiscalProfile {
  nif: string;
  apellidos: string;
  nombre: string;
  ccaa: string;
  telefono: string;
  year: number;
  /**
   * How foreign-currency shares and currency are valued (#434). Stored next to
   * the old `monodivisa` boolean, which saveProfile still writes as a mirror
   * (`fxMethod === "monodivisa"`) so an older cached app version reads it.
   */
  fxMethod: FxMethod;
  /** Procesar autoconversiones del bróker (AFx/FXCONV). Default true (rigor máximo). false = opt-out (se ignoran). */
  trackAutoConvert: boolean;
  /** Número de titulares de la cuenta. 1 = individual. >1 reparte los importes a partes iguales por contribuyente (Art. 11.3 LIRPF). */
  titulares: number;
}

const CCAA_LIST = [
  "Andalucía", "Aragón", "Asturias", "Canarias", "Cantabria",
  "Castilla y León", "Castilla-La Mancha", "Cataluña", "Ceuta",
  "Comunidad Valenciana", "Extremadura", "Galicia", "Islas Baleares",
  "La Rioja", "Madrid", "Melilla", "Murcia", "Navarra", "País Vasco",
];

const DEFAULT_PROFILE: FiscalProfile = {
  nif: "",
  apellidos: "",
  nombre: "",
  ccaa: "",
  telefono: "",
  year: new Date().getFullYear() - 1,
  fxMethod: DEFAULT_FX_METHOD,
  trackAutoConvert: true,
  titulares: 1,
};

/** Get the current fiscal profile from localStorage */
export function getProfile(): FiscalProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw) {
      // Copy only known fields from untrusted parsed JSON. Blind spreading would
      // let crafted keys like __proto__/constructor/prototype pollute the object.
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const profile: FiscalProfile = { ...DEFAULT_PROFILE };
      if (typeof parsed.nif === "string") profile.nif = parsed.nif;
      if (typeof parsed.apellidos === "string") profile.apellidos = parsed.apellidos;
      if (typeof parsed.nombre === "string") profile.nombre = parsed.nombre;
      if (typeof parsed.ccaa === "string") profile.ccaa = parsed.ccaa;
      if (typeof parsed.telefono === "string") profile.telefono = parsed.telefono;
      if (typeof parsed.year === "number" && Number.isInteger(parsed.year)) profile.year = parsed.year;
      // A known method wins. Otherwise migrate the old boolean: true was the
      // monodivisa method, anything else the default.
      if (isFxMethod(parsed.fxMethod)) profile.fxMethod = parsed.fxMethod;
      else if (parsed.monodivisa === true) profile.fxMethod = "monodivisa";
      if (typeof parsed.trackAutoConvert === "boolean") profile.trackAutoConvert = parsed.trackAutoConvert;
      if (typeof parsed.titulares === "number" && Number.isInteger(parsed.titulares) && parsed.titulares >= 1) {
        profile.titulares = parsed.titulares;
      }
      return profile;
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_PROFILE };
}

/**
 * Save the fiscal profile to localStorage and announce it with a
 * `profilechange` event on `document`. The stored JSON also carries the old
 * `monodivisa` boolean, mirrored from `fxMethod`, for older app versions.
 */
export function saveProfile(profile: FiscalProfile): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ ...profile, monodivisa: profile.fxMethod === "monodivisa" }));
  } catch { /* localStorage full */ }
  if (typeof document !== "undefined") {
    document.dispatchEvent(new CustomEvent<FiscalProfile>("profilechange", { detail: profile }));
  }
}

/** Validate a Spanish personal NIF: DNI, NIE (X/Y/Z) or K/L/M */
export function validateNif(value: string): boolean {
  const trimmed = value.trim().toUpperCase();
  if (!trimmed) return false;
  const NIF_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";
  // NIF: 8 digits + letter
  const nifMatch = trimmed.match(/^(\d{8})([A-Z])$/);
  if (nifMatch) {
    return nifMatch[2] === NIF_LETTERS[parseInt(nifMatch[1]!) % 23];
  }
  // NIE: X/Y/Z + 7 digits + letter
  const nieMatch = trimmed.match(/^([XYZ])(\d{7})([A-Z])$/);
  if (nieMatch) {
    const prefix = { X: "0", Y: "1", Z: "2" }[nieMatch[1]!]!;
    return nieMatch[3] === NIF_LETTERS[parseInt(prefix + nieMatch[2]!) % 23];
  }
  // K/L/M: personal NIFs the AEAT issues to people without a DNI or NIE
  // (K: Spaniards under 14, L: Spaniards living abroad, M: foreigners without
  // a NIE). Letter + 7 digits + control character. Sources disagree on how
  // that control character is computed, so accept on format only rather than
  // lock out a valid NIF.
  return /^[KLM]\d{7}[A-Z0-9]$/.test(trimmed);
}

/** Check if profile has enough data for 720/D-6 generation. The NIF must be valid, not just filled in. */
export function isProfileComplete(): boolean {
  const p = getProfile();
  return validateNif(p.nif) && p.apellidos.trim().length > 0 && p.nombre.trim().length > 0;
}

/** Initialize the profile form */
export function initProfile(): void {
  const container = document.getElementById("profile-form-container");
  if (!container) return;

  const profile = getProfile();
  const ccaaOptions = CCAA_LIST.map(
    (c) => `<option value="${esc(c)}"${c === profile.ccaa ? " selected" : ""}>${esc(c)}</option>`,
  ).join("");

  container.innerHTML = `
    <form class="profile-form" id="profile-form" autocomplete="on">
      <fieldset class="profile-group">
        <legend class="profile-group-title">${t("profile.section_personal")}</legend>
        <div class="profile-grid">
          <label>
            <span>${t("profile.nif_label")}</span>
            <input type="text" id="profile-nif" value="${esc(profile.nif)}" placeholder="${t("profile.nif_placeholder")}" maxlength="9" autocomplete="off" aria-describedby="profile-nif-error" />
            <small class="profile-field-error" id="profile-nif-error" role="alert" hidden>${t("profile.nif_invalid")}</small>
          </label>
          <label>
            <span>${t("profile.surname_label")}</span>
            <input type="text" id="profile-surname" value="${esc(profile.apellidos)}" placeholder="${t("profile.surname_placeholder")}" autocomplete="family-name" />
          </label>
          <label>
            <span>${t("profile.name_label")}</span>
            <input type="text" id="profile-name" value="${esc(profile.nombre)}" placeholder="${t("profile.name_placeholder")}" autocomplete="given-name" />
          </label>
          <label>
            <span>${t("profile.ccaa_label")}</span>
            <select id="profile-ccaa">
              <option value="">—</option>
              ${ccaaOptions}
            </select>
          </label>
          <label>
            <span>${t("profile.phone_label")}</span>
            <input type="tel" id="profile-phone" value="${esc(profile.telefono)}" placeholder="${t("profile.phone_placeholder")}" maxlength="15" autocomplete="tel" />
          </label>
        </div>
      </fieldset>

      <p class="profile-moved-note">${esc(t("profile.method_moved"))} <a href="#renta" class="profile-moved-link">${esc(t("profile.go_to_renta"))}</a></p>

      <div class="profile-actions">
        <p class="profile-save-status" id="profile-save-status" role="status" aria-live="polite">${esc(t("profile.autosave"))}</p>
        <button type="button" class="btn-small btn-danger" id="profile-clear-btn">${t("profile.clear_btn")}</button>
      </div>
    </form>
  `;

  // The form holds the personal data only; the other stored settings (year,
  // method, titulares, auto-conversions) are read back so an edit keeps them.
  function collectProfile(): FiscalProfile {
    return {
      ...getProfile(),
      nif: (document.getElementById("profile-nif") as HTMLInputElement).value.trim().toUpperCase(),
      apellidos: (document.getElementById("profile-surname") as HTMLInputElement).value.trim(),
      nombre: (document.getElementById("profile-name") as HTMLInputElement).value.trim(),
      ccaa: (document.getElementById("profile-ccaa") as HTMLSelectElement).value,
      telefono: (document.getElementById("profile-phone") as HTMLInputElement).value.trim(),
    };
  }

  // Flag a NIF/NIE with a wrong control letter. Checked when the field is left,
  // not on every keystroke, so a half-typed NIF isn't flagged; typing it right
  // clears the flag at once.
  const nifInput = document.getElementById("profile-nif") as HTMLInputElement;
  const nifError = document.getElementById("profile-nif-error") as HTMLElement;
  function checkNif(): void {
    const value = nifInput.value.trim();
    const invalid = value !== "" && !validateNif(value);
    nifError.hidden = !invalid;
    if (invalid) nifInput.setAttribute("aria-invalid", "true");
    else nifInput.removeAttribute("aria-invalid");
  }
  checkNif();
  nifInput.addEventListener("change", checkNif);
  nifInput.addEventListener("input", () => {
    if (validateNif(nifInput.value)) checkNif();
  });

  // Auto-save on any input change, and say so in the status line.
  document.getElementById("profile-form")!.addEventListener("input", () => {
    saveProfile(collectProfile());
    showSavedStatus();
  });

  // Delete everything stored in this browser, then reload so no screen keeps
  // showing the old NIF, name or reports.
  document.getElementById("profile-clear-btn")!.addEventListener("click", () => {
    if (!confirm(t("profile.clear_confirm"))) return;
    clearLocalData();
    location.reload();
  });

  // Enter in a field submits the form: everything is already saved, so only
  // check the NIF and confirm.
  document.getElementById("profile-form")!.addEventListener("submit", (e) => {
    e.preventDefault();
    saveProfile(collectProfile());
    checkNif();
    showSavedStatus();
  });
}

/** Swap the status line to «Perfil guardado» after an edit. */
function showSavedStatus(): void {
  const status = document.getElementById("profile-save-status");
  if (!status) return;
  status.textContent = t("profile.saved");
  status.classList.add("saved");
}
