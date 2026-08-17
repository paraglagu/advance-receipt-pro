import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { reservePosAdvance, discardPendingAdvance } from "../models/receipt.server";
import { advanceLineTitle } from "../utils/domain";
import { parseAmount } from "../utils/money";

/**
 * Reserves an advance for the POS cart.
 *
 * Deliberately does NOT credit the customer — it only parks a PENDING row and
 * hands back the id and the line title. The money isn't in the drawer until
 * the cashier tenders the cart, and the order webhook is what confirms it.
 */
export const action = async ({ request }) => {
  const { sessionToken, cors } = await authenticate.public.pos(request);
  const shop = sessionToken.dest;

  if (request.method !== "POST") {
    return cors(json({ error: "Method not allowed" }, { status: 405 }));
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return cors(json({ error: "Invalid JSON" }, { status: 400 }));
  }

  if (body.intent === "discard") {
    if (!body.receiptId) return cors(json({ error: "receiptId required" }, { status: 400 }));
    const result = await discardPendingAdvance(shop, body.receiptId, "Cancelled at POS");
    return cors(json(result, { status: result.ok ? 200 : 400 }));
  }

  const customerId = String(body.customerId || "").trim();
  if (!customerId) {
    return cors(json({ error: "Choose a customer first" }, { status: 400 }));
  }

  const parsed = parseAmount(body.amount);
  if (!parsed.ok) {
    return cors(json({ error: parsed.error }, { status: 400 }));
  }

  const receipt = await reservePosAdvance(shop, {
    customerId,
    customerName: String(body.customerName || "Customer").trim(),
    customerPhone: body.customerPhone || null,
    customerEmail: body.customerEmail || null,
    amountPaise: parsed.paise,
    note: body.note || null,
    staffName: body.staffName || null,

    productListed: Boolean(body.productId),
    productId: body.productId || null,
    productVariantId: body.productVariantId || null,
    productTitle: body.productTitle || null,
    productVariantTitle: body.productVariantTitle || null,
    productSku: body.productSku || null,
    productSpec: body.productSpec || null,
  });

  return cors(
    json({
      ok: true,
      receiptId: receipt.id,
      lineTitle: advanceLineTitle(receipt.customerName),
      // Rupees as a decimal string — this is what goes into addCustomSale().
      price: (parsed.paise / 100).toFixed(2),
      printPath: `print/receipt/${receipt.id}`,
    }),
  );
};

/** POS extensions preflight before POSTing cross-origin. */
export const loader = async ({ request }) => {
  const { cors } = await authenticate.public.pos(request);
  return cors(json({ ok: true }));
};
