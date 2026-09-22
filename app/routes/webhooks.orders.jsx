import { authenticate } from "../shopify.server";
import { getSettings } from "../models/settings.server";
import { reconcileOrder, releaseOrder } from "../models/allocation.server";
import {
  confirmPosAdvance,
  createPosAdvanceFromOrder,
  discardPendingAdvance,
  syncPosAdvanceRefund,
} from "../models/receipt.server";
import { syncStoreCreditForShop } from "../models/storeCredit.server";
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

    // 2. An advance rung up by hand with POS's own "Add custom sale", with no
    //    extension to tag the cart. The order's own line is the only evidence.
    if (reserved.length === 0 && !shaped.cancelled) {
      const linePaise = advanceLinePaise(order);
      if (linePaise > 0) {
        const { gateway, mode } = primaryInboundTender(order, settings);
        const result = await createPosAdvanceFromOrder(shop, {
          orderId: shaped.orderId,
          orderName: shaped.orderName,
          customerId: shaped.customerId,
          customerName: shaped.customerName,
          customerPhone: order.customer?.phone || null,
          customerEmail: order.customer?.email || null,
          amountPaise: linePaise,
          mode,
          gateway,
          orderDate: shaped.orderDate,
        });
        if (!result.ok) {
          console.warn(
            `[webhook] ${shaped.orderName} has an advance line but ${result.error}`,
          );
        }
      }
    }

    // 3. Advances *refunded* on this order — the cashier gave money back out
    //    of the till against the original advance sale.
    await syncPosAdvanceRefund(shop, shaped.orderId, advanceRefundPaise(order));

    // 4. Advances *spent* on this order via the adjusted tender.
    if (shaped.cancelled) {
      await releaseOrder(shop, shaped.orderId, "Order cancelled");
    } else if (settings.autoApply) {
      await reconcileOrder(shop, { ...shaped, source: "WEBHOOK" });
    }

    // 5. Mirror the resulting balance into Shopify store credit so the cashier
    //    sees it in POS next time. Never fatal — the ledger stands alone.
    await syncStoreCreditForShop(admin, shop, shaped.customerId);
  } catch (e) {
    // Never 500 a webhook — Shopify will retry and we'd rather log and move on.
    console.error(`[webhook ${topic}] order ${payload.id} failed:`, e.message);
  }

  return new Response("OK", { status: 200 });
};
