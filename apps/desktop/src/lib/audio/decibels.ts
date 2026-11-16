/** Digital silence. */
export const SILENCE_DB = Number.NEGATIVE_INFINITY;

const MINUS_SIGN = "−";
const INFINITY_SIGN = "∞";

export interface FormatDbOptions {
  /** Digits after the decimal point. Default 1. */
  decimals?: number;
  /** Append " dB". Default true. */
  unit?: boolean;
  /**
   * `auto` shows "+" for positive values and "−" for negative ones,
   * `negative` only shows "−", `never` shows no sign. Default `auto`.
   */
  sign?: "auto" | "negative" | "never";
  /** At or below this value, show "−∞". Default `-Infinity`. */
  floorDb?: number;
}

/** Formats decibels for display: "−12.3 dB", "+3.0 dB", "−∞ dB". */
export const formatDb = (db: number, options: FormatDbOptions = {}): string => {
  const { decimals = 1, unit = true, sign = "auto", floorDb = SILENCE_DB } = options;
  const suffix = unit ? " dB" : "";

  // No reading yet. Two hyphens rather than a dash: hosts such as Videorc ban
  // the em dash from user-facing copy.
  if (Number.isNaN(db)) {
    return `--${suffix}`;
  }
  if (db === SILENCE_DB || db <= floorDb) {
    const prefix = sign === "never" ? "" : MINUS_SIGN;
    return `${prefix}${INFINITY_SIGN}${suffix}`;
  }

  const rounded = Number(db.toFixed(decimals));
  const magnitude = Math.abs(rounded).toFixed(decimals);

  if (rounded === 0 || sign === "never") {
    return `${magnitude}${suffix}`;
  }
  if (rounded < 0) {
    return `${MINUS_SIGN}${magnitude}${suffix}`;
  }
  const plus = sign === "auto" ? "+" : "";
  return `${plus}${magnitude}${suffix}`;
};
