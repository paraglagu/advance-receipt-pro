import { authenticate } from "../shopify.server";
import { numericId } from "../models/customer.server";
import { releaseOrder } from "../models/allocation.server";

export const action = async ({ request }) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  if (!payload?.id) return new Response("OK", { status: 200 });

  try {
    await releaseOrder(
      shop,
      numericId(payload.id),
      "Order cancelled in Shopify; advance returned to the customer",
    );
  } catch (e) {
    console.error(`[webhook ${topic}] release for order ${payload.id} failed:`, e.message);
  }

  return new Response("OK", { status: 200 });
};
