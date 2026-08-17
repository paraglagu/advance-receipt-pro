import prisma from "../db.server";
import { LEDGER_LABELS, LEDGER_TYPES } from "../utils/domain";

export { LEDGER_LABELS, LEDGER_TYPES };

/** `tx` lets callers enrol this in a surrounding transaction. */
export async function addLedgerEntry(tx, shop, entry) {
  const client = tx || prisma;
  return client.ledgerEntry.create({
    data: {
      shop,
      customerId: entry.customerId,
      customerName: entry.customerName,
      type: entry.type,
      amountPaise: entry.amountPaise,
      receiptId: entry.receiptId ?? null,
      receiptNo: entry.receiptNo ?? null,
      orderId: entry.orderId ?? null,
      orderName: entry.orderName ?? null,
      note: entry.note ?? null,
      entryDate: entry.entryDate ?? new Date(),
    },
  });
}

/** Net credit the customer is still owed, in paise. */
export async function getCustomerBalance(shop, customerId) {
  const agg = await prisma.ledgerEntry.aggregate({
    where: { shop, customerId },
    _sum: { amountPaise: true },
  });
  return agg._sum.amountPaise || 0;
}

/** Full statement, oldest first, with a running balance attached. */
export async function getCustomerStatement(shop, customerId, { from, to } = {}) {
  const where = { shop, customerId };
  if (from || to) {
    where.entryDate = {};
    if (from) where.entryDate.gte = from;
    if (to) where.entryDate.lte = to;
  }

  const entries = await prisma.ledgerEntry.findMany({
    where,
    orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }],
  });

  let running = 0;
  const rows = entries.map((e) => {
    running += e.amountPaise;
    return {
      id: e.id,
      type: e.type,
      label: LEDGER_LABELS[e.type] || e.type,
      amountPaise: e.amountPaise,
      creditPaise: e.amountPaise > 0 ? e.amountPaise : 0,
      debitPaise: e.amountPaise < 0 ? -e.amountPaise : 0,
      balancePaise: running,
      receiptId: e.receiptId,
      receiptNo: e.receiptNo,
      orderId: e.orderId,
      orderName: e.orderName,
      note: e.note,
      entryDate: e.entryDate,
    };
  });

  return { rows, closingPaise: running };
}

/**
 * Every customer who has ever transacted, with their current balance.
 * Grouped in SQL so this stays cheap as the ledger grows.
 */
export async function listCustomerBalances(shop, { onlyOutstanding = false } = {}) {
  const grouped = await prisma.ledgerEntry.groupBy({
    by: ["customerId"],
    where: { shop },
    _sum: { amountPaise: true },
    _max: { entryDate: true },
  });

  const ids = grouped.map((g) => g.customerId);
  if (ids.length === 0) return [];

  // Names live on the receipts; take the most recent spelling we saw.
  const receipts = await prisma.advanceReceipt.findMany({
    where: { shop, customerId: { in: ids } },
    orderBy: { createdAt: "desc" },
    select: { customerId: true, customerName: true, customerPhone: true, customerEmail: true },
  });
  const profile = new Map();
  for (const r of receipts) {
    if (!profile.has(r.customerId)) profile.set(r.customerId, r);
  }

  const rows = grouped.map((g) => {
    const p = profile.get(g.customerId) || {};
    return {
      customerId: g.customerId,
      customerName: p.customerName || "Unknown customer",
      customerPhone: p.customerPhone || null,
      customerEmail: p.customerEmail || null,
      balancePaise: g._sum.amountPaise || 0,
      lastActivity: g._max.entryDate,
    };
  });

  const filtered = onlyOutstanding ? rows.filter((r) => r.balancePaise > 0) : rows;
  return filtered.sort((a, b) => b.balancePaise - a.balancePaise);
}

/** Total money the store is currently holding on customers' behalf. */
export async function getTotalOutstanding(shop) {
  const balances = await listCustomerBalances(shop, { onlyOutstanding: true });
  return balances.reduce((sum, r) => sum + r.balancePaise, 0);
}
