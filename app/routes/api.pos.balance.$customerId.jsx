import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getCustomerBalance } from "../models/ledger.server";
import { availablePaise, RECEIPT_STATUS } from "../utils/domain";

/**
 * Advance balance for one customer, for the POS customer-details block.
 *
 * The cashier needs this *before* tendering, because a POS custom payment type
 * has no balance awareness — it will happily mark ₹799 as paid when only ₹10
 * of credit exists.
 */
export const loader = async ({ params, request }) => {
  const { sessionToken, cors } = await authenticate.public.pos(request);
  const shop = sessionToken.dest;

  const customerId = String(params.customerId || "").replace(/^gid.*\//, "");
  if (!customerId) return cors(json({ error: "customerId required" }, { status: 400 }));

  const [balancePaise, receipts] = await Promise.all([
    getCustomerBalance(shop, customerId),
    prisma.advanceReceipt.findMany({
      where: {
        shop,
        customerId,
        status: { in: [RECEIPT_STATUS.OPEN, RECEIPT_STATUS.PARTIAL] },
      },
      orderBy: [{ receiptDate: "asc" }, { createdAt: "asc" }],
      take: 20,
    }),
  ]);

  const open = receipts
    .map((r) => ({
      receiptNo: r.receiptNo,
      availablePaise: availablePaise(r),
      receiptDate: r.receiptDate,
      productTitle: r.productTitle,
    }))
    .filter((r) => r.availablePaise > 0);

  return cors(
    json({
      customerId,
      balancePaise,
      openCount: open.length,
      // FIFO order — the one that will be spent first is at the top.
      openReceipts: open,
    }),
  );
};
