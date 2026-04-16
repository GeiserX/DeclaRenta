/**
 * Modelo 720 BOE record format validator.
 *
 * Validates the fixed-width text records (500 chars each) against
 * the BOE specification for Modelo 720 foreign asset declarations.
 */

/** Result of validating a single record */
export interface ValidationResult {
  recordIndex: number;
  valid: boolean;
  errors: string[];
}

/** Valid ISO 3166-1 alpha-2 country codes (commonly used in securities) */
const ISO_COUNTRY_CODES = new Set([
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT",
  "AU", "AW", "AX", "AZ", "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI",
  "BJ", "BL", "BM", "BN", "BO", "BR", "BS", "BT", "BV", "BW", "BY", "BZ",
  "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN", "CO",
  "CR", "CU", "CV", "CW", "CX", "CY", "CZ", "DE", "DJ", "DK", "DM", "DO",
  "DZ", "EC", "EE", "EG", "EH", "ER", "ES", "ET", "FI", "FJ", "FK", "FM",
  "FO", "FR", "GA", "GB", "GD", "GE", "GF", "GG", "GH", "GI", "GL", "GM",
  "GN", "GP", "GQ", "GR", "GS", "GT", "GU", "GW", "GY", "HK", "HM", "HN",
  "HR", "HT", "HU", "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS",
  "IT", "JE", "JM", "JO", "JP", "KE", "KG", "KH", "KI", "KM", "KN", "KP",
  "KR", "KW", "KY", "KZ", "LA", "LB", "LC", "LI", "LK", "LR", "LS", "LT",
  "LU", "LV", "LY", "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK", "ML",
  "MM", "MN", "MO", "MP", "MQ", "MR", "MS", "MT", "MU", "MV", "MW", "MX",
  "MY", "MZ", "NA", "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR",
  "NU", "NZ", "OM", "PA", "PE", "PF", "PG", "PH", "PK", "PL", "PM", "PN",
  "PR", "PS", "PT", "PW", "PY", "QA", "RE", "RO", "RS", "RU", "RW", "SA",
  "SB", "SC", "SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN",
  "SO", "SR", "SS", "ST", "SV", "SX", "SY", "SZ", "TC", "TD", "TF", "TG",
  "TH", "TJ", "TK", "TL", "TM", "TN", "TO", "TR", "TT", "TV", "TW", "TZ",
  "UA", "UG", "UM", "US", "UY", "UZ", "VA", "VC", "VE", "VG", "VI", "VN",
  "VU", "WF", "WS", "XK", "YE", "YT", "ZA", "ZM", "ZW",
]);

/**
 * Validate the ISIN check digit using the Luhn algorithm.
 *
 * ISIN format: 2-letter country code + 9-char alphanumeric identifier + 1 check digit.
 * Letters are converted to numbers (A=10, B=11, ..., Z=35) then Luhn is applied.
 */
function validateIsinChecksum(isin: string): boolean {
  if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)) return false;

  // Convert letters to numbers and concatenate digits
  let digits = "";
  for (const ch of isin) {
    if (ch >= "A" && ch <= "Z") {
      digits += (ch.charCodeAt(0) - 55).toString(); // A=10, B=11, ...
    } else {
      digits += ch;
    }
  }

  // Luhn algorithm
  let sum = 0;
  let doubleNext = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = parseInt(digits[i]!, 10);
    if (doubleNext) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    doubleNext = !doubleNext;
  }

  return sum % 10 === 0;
}

/**
 * Check that a substring contains only digits.
 */
function isNumeric(s: string): boolean {
  return /^\d+$/.test(s);
}

/**
 * Validate Modelo 720 fixed-width records against BOE specification.
 *
 * Validates:
 * - Each record is exactly 500 characters
 * - Register type is "1" (summary) or "2" (detail)
 * - Model number is "720"
 * - NIF format (8 digits + letter, or letter + 7 digits + letter)
 * - Numeric fields contain only digits
 * - Country codes are valid ISO 3166-1 alpha-2
 * - ISIN check digit passes Luhn algorithm
 *
 * @param records - Array of fixed-width record strings
 * @returns Validation results per record
 */
export function validateModelo720Records(records: string[]): ValidationResult[] {
  return records.map((record, index) => {
    const errors: string[] = [];

    // 1. Length check: exactly 500 characters
    if (record.length !== 500) {
      errors.push(`Longitud incorrecta: ${record.length} caracteres (esperados 500)`);
    }

    // Even if length is wrong, validate what we can
    const len = record.length;

    // 2. Register type (position 1): must be "1" or "2"
    if (len >= 1) {
      const registerType = record[0];
      if (registerType !== "1" && registerType !== "2") {
        errors.push(`Tipo de registro inválido: "${registerType}" (esperado "1" o "2")`);
      }
    }

    // 3. Model number (positions 2-4): must be "720"
    if (len >= 4) {
      const model = record.slice(1, 4);
      if (model !== "720") {
        errors.push(`Número de modelo inválido: "${model}" (esperado "720")`);
      }
    }

    // 4. Year (positions 5-8): 4 digits
    if (len >= 8) {
      const year = record.slice(4, 8);
      if (!isNumeric(year)) {
        errors.push(`Ejercicio inválido: "${year}" (debe ser numérico)`);
      }
    }

    // 5. NIF (positions 9-17): validate format
    if (len >= 17) {
      const nif = record.slice(8, 17).trim();
      if (nif.length > 0) {
        // Spanish NIF: 8 digits + letter, or letter + 7 digits + letter (NIE)
        const nifValid = /^\d{8}[A-Z]$/.test(nif) || /^[XYZ]\d{7}[A-Z]$/.test(nif);
        if (!nifValid) {
          errors.push(`Formato de NIF inválido: "${nif}"`);
        }
      }
    }

    // For detail records (type "2"), validate additional fields
    if (len >= 1 && record[0] === "2") {
      // Country code (positions 129-130)
      if (len >= 130) {
        const country = record.slice(128, 130);
        if (country.trim().length > 0 && !ISO_COUNTRY_CODES.has(country)) {
          errors.push(`Código de país ISO inválido: "${country}"`);
        }
      }

      // ID type (position 131): should be "1" for ISIN
      if (len >= 131) {
        const idType = record[130];
        if (idType === "1") {
          // ISIN (positions 132-143): validate Luhn checksum
          if (len >= 143) {
            const isin = record.slice(131, 143).trim();
            if (isin.length === 12 && !validateIsinChecksum(isin)) {
              errors.push(`ISIN con dígito de control inválido (Luhn): "${isin}"`);
            }
          }
        }
      }

      // Numeric fields validation
      // Acquisition value (positions 433-447): 15 digits
      if (len >= 447) {
        const acqValue = record.slice(432, 447);
        if (!isNumeric(acqValue)) {
          errors.push(`Valor de adquisición no numérico: "${acqValue}"`);
        }
      }

      // Valuation value (positions 449-463): 15 digits
      if (len >= 463) {
        const valValue = record.slice(448, 463);
        if (!isNumeric(valValue)) {
          errors.push(`Valor de valoración no numérico: "${valValue}"`);
        }
      }

      // Quantity (positions 465-476): 12 digits
      if (len >= 476) {
        const qty = record.slice(464, 476);
        if (!isNumeric(qty)) {
          errors.push(`Cantidad no numérica: "${qty}"`);
        }
      }

      // Declaration type (position 423): A, M, or C
      if (len >= 423) {
        const declType = record[422];
        if (declType !== "A" && declType !== "M" && declType !== "C") {
          errors.push(`Tipo de declaración inválido: "${declType}" (esperado A, M o C)`);
        }
      }
    }

    // For summary records (type "1"), validate numeric totals
    if (len >= 1 && record[0] === "1") {
      // Detail count (positions 136-144): 9 digits
      if (len >= 144) {
        const detailCount = record.slice(135, 144);
        if (!isNumeric(detailCount)) {
          errors.push(`Número de registros no numérico: "${detailCount}"`);
        }
      }

      // Total acquisition (positions 146-162): 17 digits
      if (len >= 162) {
        const totalAcq = record.slice(145, 162);
        if (!isNumeric(totalAcq)) {
          errors.push(`Total adquisición no numérico: "${totalAcq}"`);
        }
      }

      // Total valuation (positions 164-180): 17 digits
      if (len >= 180) {
        const totalVal = record.slice(163, 180);
        if (!isNumeric(totalVal)) {
          errors.push(`Total valoración no numérico: "${totalVal}"`);
        }
      }
    }

    return {
      recordIndex: index,
      valid: errors.length === 0,
      errors,
    };
  });
}
