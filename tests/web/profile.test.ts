import { describe, it, expect, beforeEach } from "vitest";
import { validateNif, getProfile, saveProfile, isProfileComplete } from "../../src/web/profile.js";

beforeEach(() => {
  const store: Record<string, string> = {};
  globalThis.localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => { store[key] = val; },
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    removeItem: (key: string) => { delete store[key]; },
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    clear: () => { Object.keys(store).forEach((k) => { delete store[k]; }); },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  } as Storage;
});

describe("validateNif", () => {
  it("should accept valid NIF 12345678Z", () => {
    expect(validateNif("12345678Z")).toBe(true);
  });

  it("should accept valid NIF lowercase 12345678z", () => {
    expect(validateNif("12345678z")).toBe(true);
  });

  it("should reject NIF with wrong letter", () => {
    expect(validateNif("12345678A")).toBe(false);
  });

  it("should accept valid NIE X1234567L", () => {
    // X->0, 01234567 % 23 = 1234567 % 23 = 19, NIF_LETTERS[19] = "L"
    expect(validateNif("X1234567L")).toBe(true);
  });

  it("should accept valid NIE Y1234567X", () => {
    // Y->1, 11234567 % 23 = 10, NIF_LETTERS[10] = "X"
    expect(validateNif("Y1234567X")).toBe(true);
  });

  it("should accept valid NIE Z1234567R", () => {
    // Z->2, 21234567 % 23 = 1, NIF_LETTERS[1] = "R"
    expect(validateNif("Z1234567R")).toBe(true);
  });

  it("should reject NIE with wrong letter", () => {
    expect(validateNif("X1234567A")).toBe(false);
  });

  it("should reject empty string", () => {
    expect(validateNif("")).toBe(false);
  });

  it("should reject whitespace only", () => {
    expect(validateNif("   ")).toBe(false);
  });

  it("should reject random text", () => {
    expect(validateNif("ABCDEFGHI")).toBe(false);
  });

  it("should reject short string", () => {
    expect(validateNif("123")).toBe(false);
  });
});

describe("getProfile / saveProfile", () => {
  it("should return defaults when no stored data", () => {
    const profile = getProfile();
    expect(profile.nif).toBe("");
    expect(profile.apellidos).toBe("");
    expect(profile.nombre).toBe("");
    expect(profile.ccaa).toBe("");
    expect(profile.telefono).toBe("");
    expect(profile.year).toBe(new Date().getFullYear());
  });

  it("should round-trip via saveProfile then getProfile", () => {
    const data = {
      nif: "12345678Z",
      apellidos: "Garcia",
      nombre: "Juan",
      ccaa: "Madrid",
      telefono: "600123456",
      year: 2025,
    };
    saveProfile(data);
    expect(getProfile()).toEqual(data);
  });

  it("should merge partial stored JSON with defaults", () => {
    localStorage.setItem("declarenta_profile", JSON.stringify({ nif: "12345678Z" }));
    const profile = getProfile();
    expect(profile.nif).toBe("12345678Z");
    expect(profile.apellidos).toBe("");
    expect(profile.year).toBe(new Date().getFullYear());
  });

  it("should return defaults when stored JSON is corrupted", () => {
    localStorage.setItem("declarenta_profile", "not-json{{{");
    const profile = getProfile();
    expect(profile.nif).toBe("");
    expect(profile.year).toBe(new Date().getFullYear());
  });
});

describe("isProfileComplete", () => {
  it("should return false when no profile stored", () => {
    expect(isProfileComplete()).toBe(false);
  });

  it("should return true when nif + apellidos + nombre are set", () => {
    saveProfile({
      nif: "12345678Z",
      apellidos: "Garcia",
      nombre: "Juan",
      ccaa: "",
      telefono: "",
      year: 2025,
    });
    expect(isProfileComplete()).toBe(true);
  });

  it("should return false when nif is empty", () => {
    saveProfile({
      nif: "",
      apellidos: "Garcia",
      nombre: "Juan",
      ccaa: "",
      telefono: "",
      year: 2025,
    });
    expect(isProfileComplete()).toBe(false);
  });

  it("should return false when apellidos is empty", () => {
    saveProfile({
      nif: "12345678Z",
      apellidos: "",
      nombre: "Juan",
      ccaa: "",
      telefono: "",
      year: 2025,
    });
    expect(isProfileComplete()).toBe(false);
  });

  it("should return false when nombre is empty", () => {
    saveProfile({
      nif: "12345678Z",
      apellidos: "Garcia",
      nombre: "",
      ccaa: "",
      telefono: "",
      year: 2025,
    });
    expect(isProfileComplete()).toBe(false);
  });

  it("should return false when nombre is whitespace only", () => {
    saveProfile({
      nif: "12345678Z",
      apellidos: "Garcia",
      nombre: "   ",
      ccaa: "",
      telefono: "",
      year: 2025,
    });
    expect(isProfileComplete()).toBe(false);
  });
});
