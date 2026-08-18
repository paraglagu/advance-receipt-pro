import {
  ADVANCE_LINE_PREFIX,
  CART_ATTR_RECEIPT_IDS,
  gatewayToMode,
} from "../utils/domain";
import { toPaise } from "../utils/money";
import { numericId } from "./customer.server";
import { isAdvanceTender } from "./settings.server";

/**
 * Webhook payloads don't carry per-tender amounts, so we go back to the Admin
 * API for the transactions. That's the only place a split payment
 * ("₹15,000 Advance Adjusted + ₹3,500 UPI") is broken down.
 */
export async function fetchOrderForReconcile(admin, orderId) {
  const gid = String(orderId).startsWith("gid://")
    ? String(orderId)
    : `gid://shopify/Order/${orderId}`;

  const response = await admin.graphql(
    `#graphql
     query OrderTenders($id: ID!) {
       order(id: $id) {
         id
         name
         createdAt
         processedAt
         cancelledAt
         displayFinancialStatus
         totalPriceSet { shopMoney { amount currencyCode } }
         customer { id displayName firstName lastName email phone }
         customAttributes { key value }
         lineItems(first: 50) {
           edges {
             node {
               id
               title
               quantity
               originalTotalSet { shopMoney { amount } }
             }
           }
         }
         refunds(first: 30) {
           id
           totalRefundedSet { shopMoney { amount } }
           refundLineItems(first: 50) {
             edges {
               node {
                 quantity
                 subtotalSet { shopMoney { amount } }
                 lineItem { id title }
               }
             }
           }
         }
         transactions(first: 50) {
           id
           kind
           status
           gateway
           formattedGateway
           manualPaymentGateway
           processedAt
           amountSet { shopMoney { amount currencyCode } }
         }
       }
     }`,
    { variables: { id: gid } },
  );

  const body = await response.json();
  return body?.data?.order || null;
}

/**
 * Sums the successful money movements that used one of the configured
 * "advance" tender names. Refunds and voids on that same tender subtract, so
 * a partially refunded order gives credit back automatically.
 */
export function advanceTenderPaise(order, settings) {
  const txns = order?.transactions || [];
  let total = 0;

  for (const t of txns) {
    if (t.status !== "SUCCESS") continue;

    const name = t.formattedGateway || t.gateway;
    if (!isAdvanceTender(settings, name) && !isAdvanceTender(settings, t.gateway)) continue;

    const amount = toPaise(t.amountSet?.shopMoney?.amount);

    if (t.kind === "SALE" || t.kind === "CAPTURE") total += amount;
    else if (t.kind === "REFUND") total -= amount;
    // AUTHORIZATION is not money yet; VOID cancels an authorization we never counted.
  }

  return Math.max(0, total);
}

/**
 * Pending receipt ids the POS extension stamped onto the cart. This is the
 * link between "cashier added an advance to the cart" and "the money actually
 * arrived", and it survives price edits and line reordering.
 */
export function pendingReceiptIds(order) {
  const attr = (order?.customAttributes || []).find(
    (a) => a.key === CART_ATTR_RECEIPT_IDS,
  );
  if (!attr?.value) return [];
  return String(attr.value)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Total of the advance line(s) as actually rung up, in paise. */
export function advanceLinePaise(order) {
  const edges = order?.lineItems?.edges || [];
  return edges
    .filter((e) => String(e.node.title || "").startsWith(ADVANCE_LINE_PREFIX))
    .reduce((sum, e) => sum + toPaise(e.node.originalTotalSet?.shopMoney?.amount), 0);
}

/**
 * How the customer actually paid the advance. Ignores the advance-adjusted
 * tender, since that's credit being spent rather than money coming in.
 */
export function primaryInboundTender(order, settings) {
  const txns = (order?.transactions || []).filter(
    (t) => t.status === "SUCCESS" && (t.kind === "SALE" || t.kind === "CAPTURE"),
  );

  const inbound = txns.filter((t) => {
    const name = t.formattedGateway || t.gateway;
    return !isAdvanceTender(settings, name) && !isAdvanceTender(settings, t.gateway);
  });

  if (inbound.length === 0) return { gateway: null, mode: "OTHER" };

  // Split payment — attribute the advance to whichever tender brought most in.
  const biggest = inbound.reduce((best, t) =>
    toPaise(t.amountSet?.shopMoney?.amount) > toPaise(best.amountSet?.shopMoney?.amount)
      ? t
      : best,
  );
  const gateway = biggest.formattedGateway || biggest.gateway;
  return { gateway, mode: gatewayToMode(gateway) };
}

/**
 * How much of this order's refunds relate to the advance line — i.e. money
 * handed back to the customer out of their advance.
 *
 * Two shapes occur in practice, and real orders in this store show both:
 *  - a normal refund with refundLineItems naming the line, and
 *  - an order-level refund with NO refundLineItems, just a total. When the
 *    order is nothing but advance lines, that total is all advance.
 */
export function advanceRefundPaise(order) {
  const refunds = order?.refunds || [];
  if (refunds.length === 0) return 0;

  const lineEdges = order?.lineItems?.edges || [];
  const orderIsOnlyAdvance =
    lineEdges.length > 0 &&
    lineEdges.every((e) => String(e.node.title || "").startsWith(ADVANCE_LINE_PREFIX));

  let total = 0;

  for (const refund of refunds) {
    const items = refund.refundLineItems?.edges || [];

    if (items.length === 0) {
      // No line detail. Only safe to attribute if there's nothing else it
      // could belong to.
      if (orderIsOnlyAdvance) {
        total += toPaise(refund.totalRefundedSet?.shopMoney?.amount);
      }
      continue;
    }

    for (const e of items) {
      if (String(e.node.lineItem?.title || "").startsWith(ADVANCE_LINE_PREFIX)) {
        total += toPaise(e.node.subtotalSet?.shopMoney?.amount);
      }
    }
  }

  return Math.max(0, total);
}

export function shapeOrderForReconcile(order, settings) {
  const customer = order?.customer;
  const customerName =
    customer?.displayName?.trim() ||
    [customer?.firstName, customer?.lastName].filter(Boolean).join(" ").trim() ||
    customer?.phone ||
    customer?.email ||
    null;

  return {
    orderId: numericId(order.id),
    orderName: order.name,
    customerId: customer?.id ? numericId(customer.id) : null,
    customerName,
    tenderPaise: advanceTenderPaise(order, settings),
    orderDate: order.processedAt || order.createdAt ? new Date(order.processedAt || order.createdAt) : null,
    cancelled: Boolean(order.cancelledAt),
  };
}

/** Used by the manual-reconcile screen to look an order up by name (#1234). */
export async function findOrderByName(admin, name) {
  const cleaned = String(name || "").trim().replace(/^#/, "");
  if (!cleaned) return null;

  const response = await admin.graphql(
    `#graphql
     query FindOrder($query: String!) {
       orders(first: 5, query: $query) {
         edges {
           node {
             id
             name
             createdAt
             processedAt
             totalPriceSet { shopMoney { amount currencyCode } }
             customer { id displayName firstName lastName email phone }
           }
         }
       }
     }`,
    { variables: { query: `name:${cleaned}` } },
  );

  const body = await response.json();
  const edges = body?.data?.orders?.edges || [];
  return edges.map((e) => ({
    id: numericId(e.node.id),
    name: e.node.name,
    date: e.node.processedAt || e.node.createdAt,
    totalPaise: toPaise(e.node.totalPriceSet?.shopMoney?.amount),
    customerId: e.node.customer?.id ? numericId(e.node.customer.id) : null,
    customerName:
      e.node.customer?.displayName ||
      e.node.customer?.phone ||
      e.node.customer?.email ||
      null,
  }));
}
