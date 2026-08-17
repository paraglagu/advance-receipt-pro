/**
 * All money in this app lives as integer paise. These are the only places
 * where it becomes a float, and they are both boundaries (UI in, UI out).
 */

/** "1,500.50" | 1500.5 | "1500.50" -> 150050 */
export function toPaise(value) {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[,\s₹]/g, ""));
  if (!isFinite(n)) return 0;
  return Math.round(n * 100);
}

/** 150050 -> 1500.5 */
export function fromPaise(paise) {
  return (Number(paise) || 0) / 100;
}

/** 150050 -> "₹1,500.50" */
export function formatINR(paise, { symbol = true } = {}) {
  const value = fromPaise(paise);
  const formatted = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(value));
  const sign = value < 0 ? "-" : "";
  return `${sign}${symbol ? "₹" : ""}${formatted}`;
}

/** 150050 -> "1500.50" — for CSV, where symbols and separators get in the way. */
export function toDecimalString(paise) {
  return (fromPaise(paise)).toFixed(2);
}

/**
 * Rejects the things a cashier actually types wrong. Returns
 * { ok, paise, error }.
 */
export function parseAmount(raw, { min = 1, max = 100_000_000_00 } = {}) {
  if (raw === null || raw === undefined || String(raw).trim() === "") {
    return { ok: false, paise: 0, error: "Enter an amount" };
  }
  const cleaned = String(raw).replace(/[,\s₹]/g, "");
  if (!/^\d*\.?\d*$/.test(cleaned)) {
    return { ok: false, paise: 0, error: "Amount must be a number" };
  }
  const paise = toPaise(cleaned);
  if (paise < min) return { ok: false, paise: 0, error: "Amount must be greater than zero" };
  if (paise > max) return { ok: false, paise: 0, error: "Amount is too large" };
  return { ok: true, paise, error: null };
}

export const PAYMENT_MODES = [
  { label: "Cash", value: "CASH" },
  { label: "UPI", value: "UPI" },
  { label: "Card", value: "CARD" },
  { label: "Bank transfer", value: "BANK" },
  { label: "Other", value: "OTHER" },
];

export function modeLabel(mode) {
  return PAYMENT_MODES.find((m) => m.value === mode)?.label || mode || "—";
}
