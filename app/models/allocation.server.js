import prisma from "../db.server";
import { addLedgerEntry } from "./ledger.server";
import {
  availablePaise,
  deriveStatus,
  LEDGER_TYPES,
  ORDER_STATUS,
  ORDER_STATUS_LABELS,
  RECEIPT_STATUS,
} from "../utils/domain";

export { ORDER_STATUS, ORDER_STATUS_LABELS };

/**
 * Draws `neededPaise` from the customer's open receipts, oldest first.
 * Returns the amount actually drawn — which can be less than asked for when
 * the customer's credit runs out mid-order.
 */
async function drawDownFIFO(tx, shop, {
  customerId,
  customerName,
  orderId,
  orderName,
  neededPaise,
  source,
  entryDate,
}) {
  const candidates = await tx.advanceReceipt.findMany({
    where: {
      shop,
      customerId,
      status: { in: [RECEIPT_STATUS.OPEN, RECEIPT_STATUS.PARTIAL] },
    },
    orderBy: [{ receiptDate: "asc" }, { createdAt: "asc" }],
  });

  let remaining = neededPaise;
  let drawn = 0;

  for (const receipt of candidates) {
    if (remaining <= 0) break;
    const free = availablePaise(receipt);
    if (free <= 0) continue;

    const take = Math.min(free, remaining);

    await tx.allocation.create({
      data: {
        shop,
        receiptId: receipt.id,
        customerId,
        orderId,
        orderName,
        amountPaise: take,
        source,
      },
    });

    const updated = await tx.advanceReceipt.update({
      where: { id: receipt.id },
      data: { appliedPaise: { increment: take } },
    });
    await tx.advanceReceipt.update({
      where: { id: receipt.id },
      data: { status: deriveStatus(updated) },
    });

    await addLedgerEntry(tx, shop, {
      customerId,
      customerName,
      type: LEDGER_TYPES.APPLIED,
      amountPaise: -take,
      receiptId: receipt.id,
      receiptNo: receipt.receiptNo,
      orderId,
      orderName,
      note: `Applied to ${orderName}`,
      entryDate,
    });

    remaining -= take;
    drawn += take;
  }

  return drawn;
}

/**
 * Gives `amountPaise` back to the customer's receipts, newest allocation
 * first, so the oldest advance stays spent and the newest is freed.
 */
async function releaseFromOrder(tx, shop, { orderId, amountPaise, note }) {
  const active = await tx.allocation.findMany({
    where: { shop, orderId, releasedAt: null },
    orderBy: { createdAt: "desc" },
    include: { receipt: true },
  });

  let remaining = amountPaise;
  let released = 0;

  for (const alloc of active) {
    if (remaining <= 0) break;
    const give = Math.min(alloc.amountPaise, remaining);

    if (give === alloc.amountPaise) {
      await tx.allocation.update({
        where: { id: alloc.id },
        data: { releasedAt: new Date(), releaseNote: note || null },
      });
    } else {
      // Partial release: shrink the allocation so the sum stays truthful.
      await tx.allocation.update({
        where: { id: alloc.id },
        data: { amountPaise: alloc.amountPaise - give },
      });
    }

    const updated = await tx.advanceReceipt.update({
      where: { id: alloc.receiptId },
      data: { appliedPaise: { decrement: give } },
    });
    await tx.advanceReceipt.update({
      where: { id: alloc.receiptId },
      data: { status: deriveStatus(updated) },
    });

    await addLedgerEntry(tx, shop, {
      customerId: alloc.customerId,
      customerName: alloc.receipt.customerName,
      type: LEDGER_TYPES.RELEASED,
      amountPaise: give,
      receiptId: alloc.receiptId,
      receiptNo: alloc.receipt.receiptNo,
      orderId: alloc.orderId,
      orderName: alloc.orderName,
      note: note || `Released from ${alloc.orderName}`,
    });

    remaining -= give;
    released += give;
  }

  return released;
}

/**
 * The single entry point for "this order tendered X against an advance".
 *
 * Deliberately idempotent and delta-based: Shopify delivers orders/create,
 * orders/paid and orders/updated for the same sale, and may redeliver any of
 * them. We compare what's currently allocated to the order against what the
 * order now says it tendered, and move only the difference. Replays therefore
 * settle to the same state instead of double-charging the customer.
 */
export async function reconcileOrder(shop, {
  orderId,
  orderName,
  customerId,
  customerName,
  tenderPaise,
  orderDate,
  source = "WEBHOOK",
}) {
  const activeAgg = await prisma.allocation.aggregate({
    where: { shop, orderId, releasedAt: null },
    _sum: { amountPaise: true },
  });
  const currentPaise = activeAgg._sum.amountPaise || 0;

  // Order no longer uses the advance tender — hand everything back.
  if (tenderPaise <= 0) {
    if (currentPaise > 0) {
      await prisma.$transaction((tx) =>
        releaseFromOrder(tx, shop, {
          orderId,
          amountPaise: currentPaise,
          note: `Advance tender removed from ${orderName}`,
        }),
      );
    }
    return upsertProcessedOrder(shop, {
      orderId, orderName, customerId, customerName, orderDate,
      tenderPaise: 0,
      allocatedPaise: 0,
      status: ORDER_STATUS.NO_TENDER,
      message: currentPaise > 0 ? "Advance tender removed; credit returned" : null,
    });
  }

  if (!customerId) {
    return upsertProcessedOrder(shop, {
      orderId, orderName, customerId: null, customerName: null, orderDate,
      tenderPaise,
      allocatedPaise: 0,
      status: ORDER_STATUS.NO_CUSTOMER,
      message:
        "Order was tendered against an advance but has no customer attached. Attach the customer in Shopify, then reconcile manually.",
    });
  }

  let allocated = currentPaise;

  if (tenderPaise > currentPaise) {
    const needed = tenderPaise - currentPaise;
    const drawn = await prisma.$transaction((tx) =>
      drawDownFIFO(tx, shop, {
        customerId,
        customerName,
        orderId,
        orderName,
        neededPaise: needed,
        source,
        entryDate: orderDate || new Date(),
      }),
    );
    allocated = currentPaise + drawn;
  } else if (tenderPaise < currentPaise) {
    const excess = currentPaise - tenderPaise;
    await prisma.$transaction((tx) =>
      releaseFromOrder(tx, shop, {
        orderId,
        amountPaise: excess,
        note: `Advance tender reduced on ${orderName}`,
      }),
    );
    allocated = tenderPaise;
  }

  let status = ORDER_STATUS.MATCHED;
  let message = null;
  if (allocated <= 0) {
    status = ORDER_STATUS.NO_BALANCE;
    message = "Customer had no open advance to draw from.";
  } else if (allocated < tenderPaise) {
    status = ORDER_STATUS.PARTIAL;
    message = `Only part of the tendered amount was covered by open advances. Shortfall of ${
      ((tenderPaise - allocated) / 100).toFixed(2)
    } needs collecting.`;
  }

  return upsertProcessedOrder(shop, {
    orderId, orderName, customerId, customerName, orderDate,
    tenderPaise,
    allocatedPaise: allocated,
    status,
    message,
  });
}

/** Order cancelled — the customer's credit was never actually spent. */
export async function releaseOrder(shop, orderId, note) {
  const agg = await prisma.allocation.aggregate({
    where: { shop, orderId, releasedAt: null },
    _sum: { amountPaise: true },
  });
  const current = agg._sum.amountPaise || 0;
  if (current > 0) {
    await prisma.$transaction((tx) =>
      releaseFromOrder(tx, shop, { orderId, amountPaise: current, note }),
    );
  }

  const existing = await prisma.processedOrder.findUnique({
    where: { shop_orderId: { shop, orderId } },
  });
  if (existing) {
    await prisma.processedOrder.update({
      where: { shop_orderId: { shop, orderId } },
      data: {
        allocatedPaise: 0,
        status: ORDER_STATUS.RELEASED,
        message: note || "Order cancelled; advance returned to the customer",
      },
    });
  }
  return current;
}

/** Merchant picks a specific receipt and a specific order in the UI. */
export async function applyReceiptManually(shop, { receiptId, orderId, orderName, amountPaise }) {
  const receipt = await prisma.advanceReceipt.findUnique({ where: { id: receiptId } });
  if (!receipt || receipt.shop !== shop) return { ok: false, error: "Receipt not found" };
  if (receipt.status === RECEIPT_STATUS.VOID) return { ok: false, error: "Receipt is void" };

  const free = availablePaise(receipt);
  if (amountPaise <= 0) return { ok: false, error: "Amount must be greater than zero" };
  if (amountPaise > free) {
    return { ok: false, error: "Amount exceeds the unused balance on this receipt" };
  }

  await prisma.$transaction(async (tx) => {
    await tx.allocation.create({
      data: {
        shop,
        receiptId: receipt.id,
        customerId: receipt.customerId,
        orderId,
        orderName,
        amountPaise,
        source: "MANUAL",
      },
    });
    const updated = await tx.advanceReceipt.update({
      where: { id: receipt.id },
      data: { appliedPaise: { increment: amountPaise } },
    });
    await tx.advanceReceipt.update({
      where: { id: receipt.id },
      data: { status: deriveStatus(updated) },
    });
    await addLedgerEntry(tx, shop, {
      customerId: receipt.customerId,
      customerName: receipt.customerName,
      type: LEDGER_TYPES.APPLIED,
      amountPaise: -amountPaise,
      receiptId: receipt.id,
      receiptNo: receipt.receiptNo,
      orderId,
      orderName,
      note: `Manually applied to ${orderName}`,
    });
  });

  return { ok: true };
}

/** Undo one allocation from the receipt detail screen. */
export async function releaseAllocation(shop, allocationId, note) {
  const alloc = await prisma.allocation.findUnique({
    where: { id: allocationId },
    include: { receipt: true },
  });
  if (!alloc || alloc.shop !== shop) return { ok: false, error: "Allocation not found" };
  if (alloc.releasedAt) return { ok: false, error: "Already released" };

  await prisma.$transaction(async (tx) => {
    await tx.allocation.update({
      where: { id: alloc.id },
      data: { releasedAt: new Date(), releaseNote: note || null },
    });
    const updated = await tx.advanceReceipt.update({
      where: { id: alloc.receiptId },
      data: { appliedPaise: { decrement: alloc.amountPaise } },
    });
    await tx.advanceReceipt.update({
      where: { id: alloc.receiptId },
      data: { status: deriveStatus(updated) },
    });
    await addLedgerEntry(tx, shop, {
      customerId: alloc.customerId,
      customerName: alloc.receipt.customerName,
      type: LEDGER_TYPES.RELEASED,
      amountPaise: alloc.amountPaise,
      receiptId: alloc.receiptId,
      receiptNo: alloc.receipt.receiptNo,
      orderId: alloc.orderId,
      orderName: alloc.orderName,
      note: note || `Released from ${alloc.orderName}`,
    });
  });

  return { ok: true };
}

async function upsertProcessedOrder(shop, data) {
  const payload = {
    orderName: data.orderName,
    customerId: data.customerId ?? null,
    customerName: data.customerName ?? null,
    tenderPaise: data.tenderPaise,
    allocatedPaise: data.allocatedPaise,
    status: data.status,
    message: data.message ?? null,
    orderDate: data.orderDate ?? null,
  };
  return prisma.processedOrder.upsert({
    where: { shop_orderId: { shop, orderId: data.orderId } },
    update: payload,
    create: { shop, orderId: data.orderId, ...payload },
  });
}

export async function listProcessedOrders(shop, { page = 1, limit = 50, status = null } = {}) {
  const where = { shop };
  if (status) where.status = status;
  else where.status = { not: ORDER_STATUS.NO_TENDER };

  const [total, orders] = await Promise.all([
    prisma.processedOrder.count({ where }),
    prisma.processedOrder.findMany({
      where,
      orderBy: { processedAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);
  return { total, orders, page, limit };
}

/** Orders the merchant needs to look at by hand. */
export async function countExceptions(shop) {
  return prisma.processedOrder.count({
    where: {
      shop,
      status: { in: [ORDER_STATUS.NO_CUSTOMER, ORDER_STATUS.NO_BALANCE, ORDER_STATUS.PARTIAL] },
    },
  });
}
