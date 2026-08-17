import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getCustomerBalance } from "../models/ledger.server";
import { isPendingReceiptNo } from "../utils/domain";

/**
 * Lets the POS extension poll for confirmation after the cashier tenders the
 * cart. The webhook does the confirming; this just reports whether it landed,
 * so the till can show the real receipt number and offer to print.
 */
export const loader = async ({ params, request }) => {
  const { sessionToken, cors } = await authenticate.public.pos(request);
  const shop = sessionToken.dest;

  const receipt = await prisma.advanceReceipt.findUnique({ where: { id: params.id } });
  if (!receipt || receipt.shop !== shop) {
    return cors(json({ error: "Not found" }, { status: 404 }));
  }

  const confirmed = receipt.status !== "PENDING" && !isPendingReceiptNo(receipt.receiptNo);

  return cors(
    json({
      confirmed,
      status: receipt.status,
      receiptNo: confirmed ? receipt.receiptNo : null,
      amountPaise: receipt.amountPaise,
      customerName: receipt.customerName,
      balancePaise: confirmed ? await getCustomerBalance(shop, receipt.customerId) : null,
      printPath: `print/receipt/${receipt.id}`,
    }),
  );
};
