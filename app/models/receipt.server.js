import { randomUUID } from "crypto";
import prisma from "../db.server";
import { claimNextReceiptNo } from "./settings.server";
import { addLedgerEntry } from "./ledger.server";
import {
  availablePaise,
  deriveStatus,
  LEDGER_TYPES,
  productSummary,
  RECEIPT_STATUS,
} from "../utils/domain";

export { availablePaise, deriveStatus, RECEIPT_STATUS };

export async function createAdvanceReceipt(shop, input) {
  const receiptNo = await claimNextReceiptNo(shop);

  return prisma.$transaction(async (tx) => {
    const receipt = await tx.advanceReceipt.create({
      data: {
        shop,
        receiptNo,
        customerId: input.customerId,
        customerName: input.customerName,
        customerPhone: input.customerPhone || null,
        customerEmail: input.customerEmail || null,
        amountPaise: input.amountPaise,
        mode: input.mode,
        reference: input.reference || null,
        note: input.note || null,
        staffName: input.staffName || null,
        receiptDate: input.receiptDate || new Date(),
        status: RECEIPT_STATUS.OPEN,

        // Reference only — never affects stock.
        productListed: Boolean(input.productListed),
        productId: input.productId || null,
        productVariantId: input.productVariantId || null,
        productTitle: input.productTitle || null,
        productVariantTitle: input.productVariantTitle || null,
        productSku: input.productSku || null,
        productSpec: input.productSpec || null,
      },
    });

    await addLedgerEntry(tx, shop, {
      customerId: receipt.customerId,
      customerName: receipt.customerName,
      type: LEDGER_TYPES.RECEIVED,
      amountPaise: receipt.amountPaise,
      receiptId: receipt.id,
      receiptNo: receipt.receiptNo,
      note: [
        input.reference ? `${input.mode} · ${input.reference}` : input.mode,
        productSummary(receipt),
      ].filter(Boolean).join(" — "),
      entryDate: receipt.receiptDate,
    });

    return receipt;
  });
}

/**
 * Raised by the POS extension when the cashier adds an advance to the cart.
 *
 * No ledger entry and no real receipt number yet — the money hasn't been
 * tendered. If the cashier voids the cart, this row just sits there PENDING
 * and can be swept up, leaving no gap in the receipt series.
 */
export async function reservePosAdvance(shop, input) {
  return prisma.advanceReceipt.create({
    data: {
      shop,
      receiptNo: `PENDING-${randomUUID()}`,
      customerId: input.customerId,
      customerName: input.customerName,
      customerPhone: input.customerPhone || null,
      customerEmail: input.customerEmail || null,
      amountPaise: input.amountPaise,
      mode: input.mode || "OTHER",
      note: input.note || null,
      staffName: input.staffName || null,
      status: RECEIPT_STATUS.PENDING,
      source: "POS",

      productListed: Boolean(input.productListed),
      productId: input.productId || null,
      productVariantId: input.productVariantId || null,
      productTitle: input.productTitle || null,
      productVariantTitle: input.productVariantTitle || null,
      productSku: input.productSku || null,
      productSpec: input.productSpec || null,
    },
  });
}

/**
 * The POS order came through and the money is really in the drawer. Now — and
 * only now — the receipt gets its number and the customer gets their credit.
 *
 * Idempotent: replayed webhooks find a non-PENDING receipt and return it.
 */
export async function confirmPosAdvance(shop, receiptId, {
  orderId,
  orderName,
  mode,
  gateway,
  amountPaise,
  orderDate,
}) {
  const existing = await prisma.advanceReceipt.findUnique({ where: { id: receiptId } });
  if (!existing || existing.shop !== shop) {
    return { ok: false, error: "Receipt not found" };
  }
  if (existing.status !== RECEIPT_STATUS.PENDING) {
    return { ok: true, receipt: existing, alreadyConfirmed: true };
  }

  // Trust the order over the reservation — the cashier may have edited the
  // price in the cart after the line was added.
  const finalPaise = amountPaise > 0 ? amountPaise : existing.amountPaise;
  const receiptNo = await claimNextReceiptNo(shop);
  const receiptDate = orderDate || new Date();

  const receipt = await prisma.$transaction(async (tx) => {
    const updated = await tx.advanceReceipt.update({
      where: { id: receiptId },
      data: {
        receiptNo,
        status: RECEIPT_STATUS.OPEN,
        amountPaise: finalPaise,
        mode: mode || existing.mode,
        posGateway: gateway || null,
        reference: existing.reference || (orderName ? `POS ${orderName}` : null),
        posOrderId: orderId,
        posOrderName: orderName,
        receiptDate,
        confirmedAt: new Date(),
      },
    });

    await addLedgerEntry(tx, shop, {
      customerId: updated.customerId,
      customerName: updated.customerName,
      type: LEDGER_TYPES.RECEIVED,
      amountPaise: finalPaise,
      receiptId: updated.id,
      receiptNo,
      orderId,
      orderName,
      note: [
        `${updated.mode} at POS`,
        orderName,
        productSummary(updated),
      ].filter(Boolean).join(" — "),
      entryDate: receiptDate,
    });

    return updated;
  });

  return { ok: true, receipt };
}

/**
 * Mirrors a POS refund of the advance line back onto the receipt.
 *
 * The cashier refunds the original POS order in Shopify POS — to cash, or back
 * to the original tender — and this brings the ledger into line. Delta-based
 * like everything else, so repeated webhooks settle rather than stack.
 *
 * Money already spent on goods can't be handed back as cash, so the refund is
 * capped at the unused portion and the shortfall is reported for the merchant
 * to sort out.
 */
export async function syncPosAdvanceRefund(shop, orderId, targetRefundPaise) {
  const receipts = await prisma.advanceReceipt.findMany({
    where: {
      shop,
      posOrderId: String(orderId),
      status: { notIn: [RECEIPT_STATUS.PENDING, RECEIPT_STATUS.VOID] },
    },
    orderBy: { createdAt: "asc" },
  });
  if (receipts.length === 0) return { ok: true, applied: 0, shortfallPaise: 0 };

  let remaining = Math.max(0, targetRefundPaise);
  let appliedTotal = 0;
  let shortfall = 0;

  for (const receipt of receipts) {
    const refundable = Math.max(0, receipt.amountPaise - receipt.appliedPaise);
    const target = Math.min(remaining, refundable);
    const delta = target - receipt.refundedPaise;

    if (delta !== 0) {
      await prisma.$transaction(async (tx) => {
        const updated = await tx.advanceReceipt.update({
          where: { id: receipt.id },
          data: { refundedPaise: target },
        });
        await tx.advanceReceipt.update({
          where: { id: receipt.id },
          data: { status: deriveStatus(updated) },
        });
        await addLedgerEntry(tx, shop, {
          customerId: receipt.customerId,
          customerName: receipt.customerName,
          type: LEDGER_TYPES.REFUNDED,
          amountPaise: -delta,
          receiptId: receipt.id,
          receiptNo: receipt.receiptNo,
          orderId: String(orderId),
          orderName: receipt.posOrderName,
          note:
            delta > 0
              ? `Refunded at POS on ${receipt.posOrderName || orderId}`
              : `Refund reversed on ${receipt.posOrderName || orderId}`,
        });
      });
    }

    appliedTotal += target;
    remaining -= target;
  }

  if (remaining > 0) {
    // POS gave back more than the customer still had unspent.
    shortfall = remaining;
    console.warn(
      `[refund] Order ${orderId}: POS refunded ${remaining} paise more than the ` +
        `unused advance balance. The excess relates to credit already spent on goods.`,
    );
  }

  return { ok: true, applied: appliedTotal, shortfallPaise: shortfall };
}

/** Cart abandoned, or the POS order was cancelled before it ever settled. */
export async function discardPendingAdvance(shop, receiptId, reason) {
  const existing = await prisma.advanceReceipt.findUnique({ where: { id: receiptId } });
  if (!existing || existing.shop !== shop) return { ok: false, error: "Not found" };
  if (existing.status !== RECEIPT_STATUS.PENDING) {
    return { ok: false, error: "Receipt is no longer pending" };
  }
  await prisma.advanceReceipt.update({
    where: { id: receiptId },
    data: {
      status: RECEIPT_STATUS.VOID,
      voidedAt: new Date(),
      voidReason: reason || "Cart abandoned at POS",
    },
  });
  return { ok: true };
}

/** Housekeeping for pending rows nobody ever tendered. */
export async function listStalePending(shop, olderThanMinutes = 720) {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
  return prisma.advanceReceipt.findMany({
    where: { shop, status: RECEIPT_STATUS.PENDING, createdAt: { lt: cutoff } },
    orderBy: { createdAt: "asc" },
  });
}

export async function getReceipt(shop, id) {
  const receipt = await prisma.advanceReceipt.findUnique({
    where: { id },
    include: {
      allocations: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!receipt || receipt.shop !== shop) return null;
  return receipt;
}

/** For the print route, which authenticates by receipt id alone. */
export async function getReceiptById(id) {
  return prisma.advanceReceipt.findUnique({
    where: { id },
    include: { allocations: { orderBy: { createdAt: "desc" } } },
  });
}

export async function listReceipts(shop, {
  page = 1,
  limit = 50,
  status = null,
  includePending = false,
  customerId = null,
  mode = null,
  search = null,
  from = null,
  to = null,
} = {}) {
  const where = { shop };
  if (status) where.status = status;
  // A pending receipt is a cart in progress, not a document — keep it out of
  // the register unless it's asked for explicitly.
  else if (!includePending) where.status = { not: RECEIPT_STATUS.PENDING };
  if (customerId) where.customerId = customerId;
  if (mode) where.mode = mode;
  if (from || to) {
    where.receiptDate = {};
    if (from) where.receiptDate.gte = from;
    if (to) where.receiptDate.lte = to;
  }
  if (search) {
    where.OR = [
      { receiptNo: { contains: search, mode: "insensitive" } },
      { customerName: { contains: search, mode: "insensitive" } },
      { customerPhone: { contains: search } },
      { customerEmail: { contains: search, mode: "insensitive" } },
      { reference: { contains: search, mode: "insensitive" } },
    ];
  }

  const [total, receipts] = await Promise.all([
    prisma.advanceReceipt.count({ where }),
    prisma.advanceReceipt.findMany({
      where,
      orderBy: [{ receiptDate: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return { total, receipts, page, limit };
}

/** Open receipts for one customer, oldest first — the FIFO queue. */
export async function getOpenReceipts(shop, customerId) {
  const receipts = await prisma.advanceReceipt.findMany({
    where: {
      shop,
      customerId,
      status: { in: [RECEIPT_STATUS.OPEN, RECEIPT_STATUS.PARTIAL] },
    },
    orderBy: [{ receiptDate: "asc" }, { createdAt: "asc" }],
  });
  return receipts.filter((r) => availablePaise(r) > 0);
}

/**
 * Voids an unused receipt (cashier keyed the wrong amount or customer).
 * Refuses once any part has been spent — that has to be unwound from the
 * order side first, otherwise the ledger would silently lose money.
 */
export async function voidReceipt(shop, id, reason) {
  const receipt = await getReceipt(shop, id);
  if (!receipt) return { ok: false, error: "Receipt not found" };
  if (receipt.status === RECEIPT_STATUS.VOID) {
    return { ok: false, error: "Receipt is already void" };
  }
  if (receipt.appliedPaise > 0) {
    return {
      ok: false,
      error:
        "This receipt has already been applied to an order. Release it from the order first, then void.",
    };
  }

  const reversal = availablePaise(receipt);

  await prisma.$transaction(async (tx) => {
    await tx.advanceReceipt.update({
      where: { id },
      data: {
        status: RECEIPT_STATUS.VOID,
        voidedAt: new Date(),
        voidReason: reason || null,
      },
    });
    await addLedgerEntry(tx, shop, {
      customerId: receipt.customerId,
      customerName: receipt.customerName,
      type: LEDGER_TYPES.VOIDED,
      amountPaise: -reversal,
      receiptId: receipt.id,
      receiptNo: receipt.receiptNo,
      note: reason || "Receipt voided",
    });
  });

  return { ok: true };
}

/** Cash handed back to the customer against an unspent advance. */
export async function refundReceipt(shop, id, refundPaise, note) {
  const receipt = await getReceipt(shop, id);
  if (!receipt) return { ok: false, error: "Receipt not found" };
  if (receipt.status === RECEIPT_STATUS.VOID) {
    return { ok: false, error: "Receipt is void" };
  }

  const available = availablePaise(receipt);
  if (refundPaise <= 0) return { ok: false, error: "Refund must be greater than zero" };
  if (refundPaise > available) {
    return { ok: false, error: "Refund exceeds the unused balance on this receipt" };
  }

  await prisma.$transaction(async (tx) => {
    const updated = await tx.advanceReceipt.update({
      where: { id },
      data: { refundedPaise: { increment: refundPaise } },
    });
    await tx.advanceReceipt.update({
      where: { id },
      data: { status: deriveStatus(updated) },
    });
    await addLedgerEntry(tx, shop, {
      customerId: receipt.customerId,
      customerName: receipt.customerName,
      type: LEDGER_TYPES.REFUNDED,
      amountPaise: -refundPaise,
      receiptId: receipt.id,
      receiptNo: receipt.receiptNo,
      note: note || "Refunded to customer",
    });
  });

  return { ok: true };
}
