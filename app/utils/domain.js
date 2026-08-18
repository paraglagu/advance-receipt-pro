/**
 * Pure domain vocabulary — no database, no Shopify, no `.server` imports.
 *
 * This file exists because Remix bundles route components for the browser.
 * Anything a component renders (status labels, tones, derived amounts) has to
 * live outside the `.server` modules, or the build fails with
 * "Server-only module referenced by client".
 */

/* ----------------------------- Receipts ----------------------------- */

export const RECEIPT_STATUS = {
  PENDING: "PENDING",
  OPEN: "OPEN",
  PARTIAL: "PARTIAL",
  CONSUMED: "CONSUMED",
  REFUNDED: "REFUNDED",
  VOID: "VOID",
};

export const RECEIPT_STATUS_LABELS = {
  PENDING: "Awaiting payment",
  OPEN: "Unused",
  PARTIAL: "Partly used",
  CONSUMED: "Fully used",
  REFUNDED: "Refunded",
  VOID: "Void",
};

export const RECEIPT_STATUS_TONES = {
  PENDING: "info",
  OPEN: "success",
  PARTIAL: "attention",
  CONSUMED: undefined,
  REFUNDED: "warning",
  VOID: "critical",
};

/** Placeholder number held by a POS receipt until the cashier tenders it. */
export function isPendingReceiptNo(receiptNo) {
  return String(receiptNo || "").startsWith("PENDING-");
}

/** Unused credit left on a single receipt, in paise. */
export function availablePaise(receipt) {
  if (receipt.status === RECEIPT_STATUS.VOID) return 0;
  if (receipt.status === RECEIPT_STATUS.PENDING) return 0;
  return Math.max(
    0,
    receipt.amountPaise - receipt.appliedPaise - receipt.refundedPaise,
  );
}

/** Derives status from the numbers, so status can never disagree with them. */
export function deriveStatus(receipt) {
  if (receipt.status === RECEIPT_STATUS.VOID) return RECEIPT_STATUS.VOID;
  if (receipt.status === RECEIPT_STATUS.PENDING) return RECEIPT_STATUS.PENDING;
  const used = receipt.appliedPaise + receipt.refundedPaise;
  if (receipt.refundedPaise >= receipt.amountPaise) return RECEIPT_STATUS.REFUNDED;
  if (used >= receipt.amountPaise) return RECEIPT_STATUS.CONSUMED;
  if (used > 0) return RECEIPT_STATUS.PARTIAL;
  return RECEIPT_STATUS.OPEN;
}

/* ------------------------------ Ledger ------------------------------ */

export const LEDGER_TYPES = {
  RECEIVED: "ADVANCE_RECEIVED",
  APPLIED: "ADVANCE_APPLIED",
  RELEASED: "ADVANCE_RELEASED",
  REFUNDED: "ADVANCE_REFUNDED",
  VOIDED: "ADVANCE_VOIDED",
  ADJUSTMENT: "ADJUSTMENT",
};

export const LEDGER_LABELS = {
  ADVANCE_RECEIVED: "Advance received",
  ADVANCE_APPLIED: "Applied to order",
  ADVANCE_RELEASED: "Released (order cancelled)",
  ADVANCE_REFUNDED: "Refunded to customer",
  ADVANCE_VOIDED: "Receipt voided",
  ADJUSTMENT: "Manual adjustment",
};

/* ------------------------- Order reconciliation ---------------------- */

export const ORDER_STATUS = {
  MATCHED: "MATCHED",         // advance covered the whole tendered amount
  PARTIAL: "PARTIAL",         // customer had some credit, but not enough
  NO_CUSTOMER: "NO_CUSTOMER", // tendered against advance but no customer on the order
  NO_BALANCE: "NO_BALANCE",   // customer had no open advance at all
  NO_TENDER: "NO_TENDER",     // order didn't use the advance tender
  RELEASED: "RELEASED",       // order cancelled, credit returned
};

export const ORDER_STATUS_LABELS = {
  MATCHED: "Applied",
  PARTIAL: "Short",
  NO_CUSTOMER: "No customer",
  NO_BALANCE: "No balance",
  NO_TENDER: "Not an advance order",
  RELEASED: "Released",
};

export const ORDER_STATUS_TONES = {
  MATCHED: "success",
  PARTIAL: "attention",
  NO_CUSTOMER: "critical",
  NO_BALANCE: "critical",
  NO_TENDER: undefined,
  RELEASED: "warning",
};

/* ------------------------- POS advance capture ----------------------- */

/**
 * The cart attribute the POS extension writes so the order webhook can find
 * the pending receipts it belongs to. Underscore-prefixed so Shopify keeps it
 * out of customer-facing order displays.
 */
export const CART_ATTR_RECEIPT_IDS = "_advance_receipt_ids";

/** Title of the custom-sale line the extension drops into the POS cart. */
export const ADVANCE_LINE_PREFIX = "Advance received";

export function advanceLineTitle(customerName) {
  return customerName
    ? `${ADVANCE_LINE_PREFIX} — ${customerName}`
    : ADVANCE_LINE_PREFIX;
}

/**
 * Maps whatever POS called the tender onto our payment modes. Merchants name
 * their manual methods freely ("UPI", "PhonePe", "Google Pay"), so this is
 * deliberately fuzzy and falls back to OTHER rather than guessing wrong.
 */
export function gatewayToMode(gateway) {
  const g = String(gateway || "").toLowerCase();
  if (!g) return "OTHER";
  if (g.includes("cash")) return "CASH";
  if (
    g.includes("upi") || g.includes("phonepe") || g.includes("gpay") ||
    g.includes("google pay") || g.includes("paytm") || g.includes("bhim") ||
    g.includes("qr")
  ) return "UPI";
  if (g.includes("card") || g.includes("credit") || g.includes("debit")) return "CARD";
  if (g.includes("bank") || g.includes("neft") || g.includes("imps") || g.includes("transfer")) {
    return "BANK";
  }
  return "OTHER";
}

/* ---------------------------- Product ref ---------------------------- */

/**
 * One human-readable line for what an advance is against, e.g.
 * "Quechua MH100 Tent — Blue / L (SKU TENT-BL-L)" or a hand-typed
 * "Trek 900 sleeping bag, -5°C". Returns null when nothing was recorded.
 */
export function productSummary(receipt) {
  if (!receipt?.productTitle) return null;
  const variant =
    receipt.productVariantTitle && receipt.productVariantTitle !== "Default Title"
      ? receipt.productVariantTitle
      : null;
  const head = [receipt.productTitle, variant].filter(Boolean).join(" — ");
  const tail = [
    receipt.productSpec || null,
    receipt.productSku ? `SKU ${receipt.productSku}` : null,
  ].filter(Boolean);
  return tail.length ? `${head} (${tail.join(", ")})` : head;
}

/* --------------------------- Receipt numbers ------------------------- */

/**
 * Indian financial year for a date, as "26-27" (1 April – 31 March).
 * Receipt series conventionally restart each FY.
 */
export function indianFinancialYear(date = new Date()) {
  const d = new Date(date);
  const year = d.getFullYear();
  // getMonth() is 0-indexed, so April is 3.
  const startYear = d.getMonth() >= 3 ? year : year - 1;
  const twoDigit = (y) => String(y % 100).padStart(2, "0");
  return `${twoDigit(startYear)}-${twoDigit(startYear + 1)}`;
}

/** e.g. "ADV-26-27-" → receipts read ADV-26-27-0001, ADV-26-27-0002, … */
export function suggestedReceiptPrefix(date = new Date()) {
  return `ADV-${indianFinancialYear(date)}-`;
}

export function formatReceiptNo(settings, n) {
  const padded = String(n).padStart(settings.receiptPadding || 4, "0");
  return `${settings.receiptPrefix || ""}${padded}${settings.receiptSuffix || ""}`;
}
