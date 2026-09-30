/**
 * Modelo 720 record positions copied from the BOE record design (Orden
 * HAP/72/2013, BOE-A-2013-954, Anexo II), NOT from the generator. Tests slice
 * generated records with this table so a generator and validator that agree
 * with each other but not with the BOE cannot both stay green.
 *
 * Positions are 1-indexed and inclusive, as printed in the BOE.
 */
export const BOE_720 = {
  summary: {
    nombre: [18, 57],
    telefono: [59, 67],
    contacto: [68, 107],
    numeroDeclaracion: [108, 120],
    suma1Sign: [145, 145],
    suma1: [146, 162],
    suma2Sign: [163, 163],
    suma2: [164, 180],
  },
  detail: {
    nombre: [36, 75],
    claveBien: [102, 102],
    claveSubclave: [102, 103],
    pais: [129, 130],
    claveIdentificacion: [131, 131],
    isin: [132, 143],
    claveCuenta: [144, 144],
    bic: [145, 155],
    codigoCuenta: [156, 189],
    entidad: [190, 230],
    origen: [423, 423],
    fechaExtincion: [424, 431],
    valoracion1Sign: [432, 432],
    valoracion1: [433, 446],
    valoracion2Sign: [447, 447],
    valoracion2: [448, 461],
    claveRepresentacion: [462, 462],
    numeroValores: [463, 474],
    claveInmueble: [475, 475],
    porcentaje: [476, 480],
    blancos: [481, 500],
  },
} as const;

type Range = readonly [number, number];

/** Slice a record at a 1-indexed inclusive BOE range. */
export function boeField(record: string, [from, to]: Range): string {
  return record.slice(from - 1, to);
}

/** Write `value` into `chars` at a 1-indexed inclusive BOE range (must fit exactly). */
function put(chars: string[], [from, to]: Range, value: string): void {
  if (value.length !== to - from + 1) {
    throw new Error(`fixture: "${value}" does not fit ${from}-${to}`);
  }
  for (let i = 0; i < value.length; i++) chars[from - 1 + i] = value[i]!;
}

/**
 * A hand-built type-2 "V" record laid out by the BOE table: one holding worth
 * 55,200.00 EUR on 31 December, 100 securities in book-entry form, 100 %.
 */
export function boeGoldenValuesRecord(): string {
  const chars = new Array<string>(500).fill(" ");
  put(chars, [1, 1], "2");
  put(chars, [2, 4], "720");
  put(chars, [5, 8], "2025");
  put(chars, [9, 17], "12345678A");
  put(chars, [18, 26], "12345678A");
  put(chars, [76, 76], "1");
  put(chars, BOE_720.detail.claveBien, "V");
  put(chars, [129, 130], "US");
  put(chars, [131, 131], "1");
  put(chars, [132, 143], "US0378331005");
  put(chars, BOE_720.detail.origen, "A");
  put(chars, BOE_720.detail.valoracion1Sign, " ");
  put(chars, BOE_720.detail.valoracion1, "00000005520000");
  put(chars, BOE_720.detail.valoracion2Sign, " ");
  put(chars, BOE_720.detail.valoracion2, "00000000000000");
  put(chars, BOE_720.detail.claveRepresentacion, "A");
  put(chars, BOE_720.detail.numeroValores, "000000010000");
  put(chars, BOE_720.detail.porcentaje, "10000");
  return chars.join("");
}
