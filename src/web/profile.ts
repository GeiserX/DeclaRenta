/**
 * Fiscal profile form for DeclaRenta.
 *
 * Collects NIF, name, surname, CCAA, phone, and tax year.
 * Persists to localStorage. Used by Modelo 720 and D-6 generators.
 */

import { t } from "../i18n/index.js";

const PROFILE_KEY = "declarenta_profile";

export interface FiscalProfile {
  nif: string;
  apellidos: string;
  nombre: string;
  ccaa: string;
  telefono: string;
  year: number;
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
};

/** Get the current fiscal profile from localStorage */
export function getProfile(): FiscalProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw) return { ...DEFAULT_PROFILE, ...(JSON.parse(raw) as Partial<FiscalProfile>) };
  } catch { /* ignore */ }
  return { ...DEFAULT_PROFILE };
}

/** Save the fiscal profile to localStorage */
export function saveProfile(profile: FiscalProfile): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch { /* localStorage full */ }
}

/** Validate a Spanish NIF/NIE */
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
  return false;
}

/** Check if profile has enough data for 720/D-6 generation */
export function isProfileComplete(): boolean {
  const p = getProfile();
  return p.nif.trim().length > 0 && p.apellidos.trim().length > 0 && p.nombre.trim().length > 0;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Initialize the profile form */
export function initProfile(): void {
  const container = document.getElementById("profile-form-container");
  if (!container) return;

  const profile = getProfile();
  const ccaaOptions = CCAA_LIST.map(
    (c) => `<option value="${esc(c)}"${c === profile.ccaa ? " selected" : ""}>${esc(c)}</option>`,
  ).join("");

  const currentYear = new Date().getFullYear();
  const yearOptions = [currentYear - 1, currentYear, currentYear - 2].map(
    (y) => `<option value="${y}"${y === profile.year ? " selected" : ""}>${y}</option>`,
  ).join("");

  container.innerHTML = `
    <form class="profile-form" id="profile-form" autocomplete="on">
      <label>
        <span>${t("profile.nif_label")}</span>
        <input type="text" id="profile-nif" value="${esc(profile.nif)}" placeholder="12345678A" maxlength="9" autocomplete="off" />
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
      <label>
        <span>${t("config.year_label")}</span>
        <select id="profile-year">
          ${yearOptions}
        </select>
      </label>
    </form>
    <p class="profile-saved-msg" id="profile-saved-msg">${t("profile.saved")}</p>
  `;

  // Auto-save on any input change
  document.getElementById("profile-form")!.addEventListener("input", () => {
    const updated: FiscalProfile = {
      nif: (document.getElementById("profile-nif") as HTMLInputElement).value.trim().toUpperCase(),
      apellidos: (document.getElementById("profile-surname") as HTMLInputElement).value.trim(),
      nombre: (document.getElementById("profile-name") as HTMLInputElement).value.trim(),
      ccaa: (document.getElementById("profile-ccaa") as HTMLSelectElement).value,
      telefono: (document.getElementById("profile-phone") as HTMLInputElement).value.trim(),
      year: parseInt((document.getElementById("profile-year") as HTMLSelectElement).value, 10),
    };
    saveProfile(updated);
    showSavedMessage();
  });
}

let savedTimeout: ReturnType<typeof setTimeout> | null = null;

function showSavedMessage(): void {
  const msg = document.getElementById("profile-saved-msg");
  if (!msg) return;
  msg.classList.add("visible");
  if (savedTimeout) clearTimeout(savedTimeout);
  savedTimeout = setTimeout(() => msg.classList.remove("visible"), 2000);
}
