// Pure price helpers shared by the SERP client and the product parser.

/**
 * Parse a price as printed ("$1,234.50", "USD 48", "From $48 - $60", 48, "48,00")
 * into integer cents. Returns null when no price can be read. Ranges take the first number.
 */
export function parsePriceToCents(input: unknown): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") {
    return Number.isFinite(input) && input >= 0 ? Math.round(input * 100) : null;
  }
  if (typeof input === "object") {
    const o = input as Record<string, unknown>;
    for (const k of ["value", "amount", "price", "extracted_value"]) {
      if (k in o) {
        const r = parsePriceToCents(o[k]);
        if (r !== null) return r;
      }
    }
    return null;
  }
  if (typeof input !== "string") return null;
  const m = input.match(/\d[\d.,\s]*/);
  if (!m) return null;
  let s = m[0].replace(/\s+/g, "").replace(/[.,]+$/, "");
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    // The later separator is the decimal point.
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    // "48,00" is decimal; "1,234" is thousands.
    s = /,\d{2}$/.test(s) && s.indexOf(",") === lastComma ? s.replace(",", ".") : s.replace(/,/g, "");
  } else if ((s.match(/\./g) ?? []).length > 1) {
    s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}
