import { authenticate } from "../shopify.server";
import { getSettings } from "../models/settings.server";
import { reconcileOrder, releaseOrder } from "../models/allocation.server";
import {
  confirmPosAdvance,
  discardPendingAdvance,
  syncPosAdvanceRefund,
} from "../models/receipt.server";
import {
  advanceLinePaise,
  advanceRefundPaise,
  fetchOrderForReconcile,
  pendingReceiptIds,
  primaryInboundTender,
  shapeOrderForReconcile,
} from "../models/shopifyOrder.server";

export const action = async ({ request }) => {
  const { shop, admin, payload, topic } = await authenticate.webhook(request);

  if (!admin || !payload?.id) return new Response("OK", { status: 200 });

  try {
    const settings = await getSettings(shop);
    const order = await fetchOrderForReconcile(admin, payload.id);
    if (!order) return new Response("OK", { status: 200 });

    const shaped = shapeOrderForReconcile(order, settings);

    // 1. Advances *taken* on this order: the cashier rang one up at the till
    //    and the money is now really in the drawer. Confirm them first so the
    //    credit exists before anything tries to spend it.
    const reserved = pendingReceiptIds(order);
    if (reserved.length > 0) {
      if (shaped.cancelled) {
        for (const id of reserved) {
          await discardPendingAdvance(shop, id, `POS order ${shaped.orderName} cancelled`);
        }
      } else {
        const { gateway, mode } = primaryInboundTender(order, settings);
        const linePaise = advanceLinePaise(order);
        // One advance per cart is the norm; split evenly if a cashier rang up
        // several, so the total still reconciles to the line.
        const perReceipt = reserved.length > 0 ? Math.floor(linePaise / reserved.length) : 0;

        for (const id of reserved) {
          await confirmPosAdvance(shop, id, {
            orderId: shaped.orderId,
            orderName: shaped.orderName,
            mode,
            gateway,
            amountPaise: reserved.length === 1 ? linePaise : perReceipt,
            orderDate: shaped.orderDate,
          });
        }
      }
    }

    // 2. Advances *refunded* on this order — the cashier gave money back out
    //    of the till against the original advance sale.
    await syncPosAdvanceRefund(shop, shaped.orderId, advanceRefundPaise(order));

    // 3. Advances *spent* on this order via the adjusted tender.
    if (shaped.cancelled) {
      await releaseOrder(shop, shaped.orderId, "Order cancelled");
    } else if (settings.autoApply) {
      await reconcileOrder(shop, { ...shaped, source: "WEBHOOK" });
    }
  } catch (e) {
    // Never 500 a webhook — Shopify will retry and we'd rather log and move on.
    console.error(`[webhook ${topic}] order ${payload.id} failed:`, e.message);
  }

  return new Response("OK", { status: 200 });
};
