import { authenticate } from "../shopify.server";
import { getSettings } from "../models/settings.server";
import { syncPosAdvanceRefund } from "../models/receipt.server";
import { reconcileOrder } from "../models/allocation.server";
import {
  advanceRefundPaise,
  fetchOrderForReconcile,
  shapeOrderForReconcile,
} from "../models/shopifyOrder.server";

/**
 * Fires when a refund is processed in POS or admin.
 *
 * Two different things can be refunded and they're handled separately:
 *  - the original advance sale  → give the money back, cut the credit
 *  - a later goods order that was paid with advance credit → the advance-
 *    adjusted tender reverses, so the credit returns to the customer
 *    (handled by reconcileOrder, which nets refunds off the tender).
 */
export const action = async ({ request }) => {
  const { shop, admin, payload, topic } = await authenticate.webhook(request);

  const orderId = payload?.order_id;
  if (!admin || !orderId) return new Response("OK", { status: 200 });

  try {
    const settings = await getSettings(shop);
    const order = await fetchOrderForReconcile(admin, orderId);
    if (!order) return new Response("OK", { status: 200 });

    const shaped = shapeOrderForReconcile(order, settings);

    await syncPosAdvanceRefund(shop, shaped.orderId, advanceRefundPaise(order));

    if (settings.autoApply) {
      await reconcileOrder(shop, { ...shaped, source: "WEBHOOK" });
    }
  } catch (e) {
    console.error(`[webhook ${topic}] refund on order ${orderId} failed:`, e.message);
  }

  return new Response("OK", { status: 200 });
};
