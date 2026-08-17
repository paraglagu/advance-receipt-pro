import prisma from "../db.server";
import { RECEIPT_STATUS } from "./receipt.server";

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/** Money collected in a window, split by payment mode. */
export async function collectionsByMode(shop, { from, to } = {}) {
  const where = { shop, status: { notIn: [RECEIPT_STATUS.VOID, RECEIPT_STATUS.PENDING] } };
  if (from || to) {
    where.receiptDate = {};
    if (from) where.receiptDate.gte = from;
    if (to) where.receiptDate.lte = to;
  }

  const grouped = await prisma.advanceReceipt.groupBy({
    by: ["mode"],
    where,
    _sum: { amountPaise: true },
    _count: { _all: true },
  });

  return grouped
    .map((g) => ({
      mode: g.mode,
      totalPaise: g._sum.amountPaise || 0,
      count: g._count._all,
    }))
    .sort((a, b) => b.totalPaise - a.totalPaise);
}

export async function dashboardSummary(shop) {
  const todayFrom = startOfDay();
  const todayTo = endOfDay();

  const [todayAgg, allAgg, appliedAgg, refundAgg, openCount] = await Promise.all([
    prisma.advanceReceipt.aggregate({
      where: {
        shop,
        status: { notIn: [RECEIPT_STATUS.VOID, RECEIPT_STATUS.PENDING] },
        receiptDate: { gte: todayFrom, lte: todayTo },
      },
      _sum: { amountPaise: true },
      _count: { _all: true },
    }),
    prisma.advanceReceipt.aggregate({
      where: { shop, status: { notIn: [RECEIPT_STATUS.VOID, RECEIPT_STATUS.PENDING] } },
      _sum: { amountPaise: true },
      _count: { _all: true },
    }),
    prisma.advanceReceipt.aggregate({
      where: { shop, status: { notIn: [RECEIPT_STATUS.VOID, RECEIPT_STATUS.PENDING] } },
      _sum: { appliedPaise: true },
    }),
    prisma.advanceReceipt.aggregate({
      where: { shop, status: { notIn: [RECEIPT_STATUS.VOID, RECEIPT_STATUS.PENDING] } },
      _sum: { refundedPaise: true },
    }),
    prisma.advanceReceipt.count({
      where: { shop, status: { in: [RECEIPT_STATUS.OPEN, RECEIPT_STATUS.PARTIAL] } },
    }),
  ]);

  const collected = allAgg._sum.amountPaise || 0;
  const applied = appliedAgg._sum.appliedPaise || 0;
  const refunded = refundAgg._sum.refundedPaise || 0;

  return {
    todayPaise: todayAgg._sum.amountPaise || 0,
    todayCount: todayAgg._count._all,
    collectedPaise: collected,
    receiptCount: allAgg._count._all,
    appliedPaise: applied,
    refundedPaise: refunded,
    outstandingPaise: collected - applied - refunded,
    openReceiptCount: openCount,
  };
}

/** Row-level data for the report screen and its CSV export. */
export async function receiptRegister(shop, { from, to, mode = null } = {}) {
  const where = { shop };
  if (mode) where.mode = mode;
  if (from || to) {
    where.receiptDate = {};
    if (from) where.receiptDate.gte = from;
    if (to) where.receiptDate.lte = to;
  }

  return prisma.advanceReceipt.findMany({
    where,
    orderBy: [{ receiptDate: "asc" }, { createdAt: "asc" }],
  });
}

/** Advances that have sat unused for a long time — worth chasing. */
export async function agingBuckets(shop) {
  const open = await prisma.advanceReceipt.findMany({
    where: { shop, status: { in: [RECEIPT_STATUS.OPEN, RECEIPT_STATUS.PARTIAL] } },
    select: {
      id: true, receiptNo: true, customerId: true, customerName: true,
      amountPaise: true, appliedPaise: true, refundedPaise: true, receiptDate: true,
    },
  });

  const now = Date.now();
  const buckets = [
    { label: "0–30 days", min: 0, max: 30, totalPaise: 0, count: 0 },
    { label: "31–90 days", min: 31, max: 90, totalPaise: 0, count: 0 },
    { label: "91–180 days", min: 91, max: 180, totalPaise: 0, count: 0 },
    { label: "Over 180 days", min: 181, max: Infinity, totalPaise: 0, count: 0 },
  ];

  const rows = [];
  for (const r of open) {
    const available = r.amountPaise - r.appliedPaise - r.refundedPaise;
    if (available <= 0) continue;
    const days = Math.floor((now - new Date(r.receiptDate).getTime()) / 86_400_000);
    const bucket = buckets.find((b) => days >= b.min && days <= b.max);
    if (bucket) {
      bucket.totalPaise += available;
      bucket.count += 1;
    }
    rows.push({ ...r, availablePaise: available, ageDays: days });
  }

  rows.sort((a, b) => b.ageDays - a.ageDays);
  return { buckets, rows };
}

export { startOfDay, endOfDay };
