/**
 * Exercises the advance draw-down engine against a real database.
 *
 * Run via scripts/run-tests.ps1 — it points Prisma at a throwaway SQLite file,
 * bundles this with esbuild (so the extensionless `.server` imports resolve the
 * same way Remix resolves them), and runs it.
 */
import prisma from "../app/db.server";
import {
  createAdvanceReceipt,
  voidReceipt,
  refundReceipt,
  reservePosAdvance,
  confirmPosAdvance,
  discardPendingAdvance,
  syncPosAdvanceRefund,
  listReceipts,
} from "../app/models/receipt.server";
import { reconcileOrder, releaseOrder, applyReceiptManually } from "../app/models/allocation.server";
import { getCustomerBalance } from "../app/models/ledger.server";
import { isAdvanceTender } from "../app/models/settings.server";
import {
  advanceTenderPaise,
  advanceLinePaise,
  advanceRefundPaise,
  pendingReceiptIds,
  primaryInboundTender,
} from "../app/models/shopifyOrder.server";
import { availablePaise, gatewayToMode, productSummary } from "../app/utils/domain";

const SHOP = "test-shop.myshopify.com";
const CUST = "555001";

let passed = 0;
let failed = 0;

function check(label, actual, expected) {
  const ok = actual === expected;
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}  (${actual})`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}  expected ${expected}, got ${actual}`);
  }
}

async function receiptById(id) {
  return prisma.advanceReceipt.findUnique({ where: { id } });
}

async function reset() {
  await prisma.allocation.deleteMany({});
  await prisma.ledgerEntry.deleteMany({});
  await prisma.processedOrder.deleteMany({});
  await prisma.advanceReceipt.deleteMany({});
  await prisma.advanceSettings.deleteMany({});
}

async function main() {
  await reset();

  console.log("\n— FIFO draw-down across two receipts —");

  // Oldest first: ₹10,000 on 1 Jun, then ₹5,000 on 10 Jun.
  const r1 = await createAdvanceReceipt(SHOP, {
    customerId: CUST, customerName: "Ramesh K",
    amountPaise: 1_000_000, mode: "CASH",
    receiptDate: new Date("2026-06-01T10:00:00Z"),
  });
  const r2 = await createAdvanceReceipt(SHOP, {
    customerId: CUST, customerName: "Ramesh K",
    amountPaise: 500_000, mode: "UPI", reference: "UPI-4823",
    receiptDate: new Date("2026-06-10T10:00:00Z"),
  });

  check("receipt numbers increment", `${r1.receiptNo},${r2.receiptNo}`, "ADV-0001,ADV-0002");
  check("balance after two advances", await getCustomerBalance(SHOP, CUST), 1_500_000);

  // Order tenders ₹12,000 against the advance.
  await reconcileOrder(SHOP, {
    orderId: "1001", orderName: "#1001",
    customerId: CUST, customerName: "Ramesh K",
    tenderPaise: 1_200_000,
    orderDate: new Date("2026-06-15T10:00:00Z"),
  });

  check("balance after ₹12,000 order", await getCustomerBalance(SHOP, CUST), 300_000);
  check("oldest receipt fully consumed", (await receiptById(r1.id)).status, "CONSUMED");
  check("oldest receipt applied", (await receiptById(r1.id)).appliedPaise, 1_000_000);
  check("newer receipt partly used", (await receiptById(r2.id)).status, "PARTIAL");
  check("newer receipt applied", (await receiptById(r2.id)).appliedPaise, 200_000);

  const po = await prisma.processedOrder.findUnique({
    where: { shop_orderId: { shop: SHOP, orderId: "1001" } },
  });
  check("order marked matched", po.status, "MATCHED");

  console.log("\n— webhook replay must not double-charge —");

  // Shopify delivers orders/create, then orders/paid, then a retry.
  for (let i = 0; i < 3; i++) {
    await reconcileOrder(SHOP, {
      orderId: "1001", orderName: "#1001",
      customerId: CUST, customerName: "Ramesh K",
      tenderPaise: 1_200_000,
      orderDate: new Date("2026-06-15T10:00:00Z"),
    });
  }
  check("balance unchanged after 3 replays", await getCustomerBalance(SHOP, CUST), 300_000);
  const allocSum = await prisma.allocation.aggregate({
    where: { shop: SHOP, orderId: "1001", releasedAt: null },
    _sum: { amountPaise: true },
  });
  check("allocations still total ₹12,000", allocSum._sum.amountPaise, 1_200_000);

  console.log("\n— tender reduced on the order (partial refund) —");

  await reconcileOrder(SHOP, {
    orderId: "1001", orderName: "#1001",
    customerId: CUST, customerName: "Ramesh K",
    tenderPaise: 800_000,
    orderDate: new Date("2026-06-15T10:00:00Z"),
  });
  check("balance after tender cut to ₹8,000", await getCustomerBalance(SHOP, CUST), 700_000);
  check("newest receipt freed first", (await receiptById(r2.id)).appliedPaise, 0);
  check("oldest receipt still bears the ₹8,000", (await receiptById(r1.id)).appliedPaise, 800_000);
  check("oldest receipt back to partial", (await receiptById(r1.id)).status, "PARTIAL");

  console.log("\n— customer has less credit than the order tenders —");

  await reconcileOrder(SHOP, {
    orderId: "1002", orderName: "#1002",
    customerId: CUST, customerName: "Ramesh K",
    tenderPaise: 2_000_000,
    orderDate: new Date("2026-06-20T10:00:00Z"),
  });
  check("balance drained to zero", await getCustomerBalance(SHOP, CUST), 0);
  const po2 = await prisma.processedOrder.findUnique({
    where: { shop_orderId: { shop: SHOP, orderId: "1002" } },
  });
  check("shortfall flagged as PARTIAL", po2.status, "PARTIAL");
  check("only what was available got drawn", po2.allocatedPaise, 700_000);

  console.log("\n— order cancelled, credit returns —");

  await releaseOrder(SHOP, "1002", "Order cancelled");
  check("balance restored after cancel", await getCustomerBalance(SHOP, CUST), 700_000);
  const po2b = await prisma.processedOrder.findUnique({
    where: { shop_orderId: { shop: SHOP, orderId: "1002" } },
  });
  check("order marked released", po2b.status, "RELEASED");

  console.log("\n— order with no customer attached —");

  await reconcileOrder(SHOP, {
    orderId: "1003", orderName: "#1003",
    customerId: null, customerName: null,
    tenderPaise: 500_000,
    orderDate: new Date("2026-06-21T10:00:00Z"),
  });
  const po3 = await prisma.processedOrder.findUnique({
    where: { shop_orderId: { shop: SHOP, orderId: "1003" } },
  });
  check("flagged for manual attention", po3.status, "NO_CUSTOMER");
  check("nothing drawn from anyone", po3.allocatedPaise, 0);

  console.log("\n— guards on void and refund —");

  const voidUsed = await voidReceipt(SHOP, r1.id, "oops");
  check("cannot void a spent receipt", voidUsed.ok, false);

  const r3 = await createAdvanceReceipt(SHOP, {
    customerId: "555002", customerName: "Sunita M",
    amountPaise: 300_000, mode: "CASH",
  });
  const voidClean = await voidReceipt(SHOP, r3.id, "wrong amount");
  check("can void an unused receipt", voidClean.ok, true);
  check("voided receipt removes credit", await getCustomerBalance(SHOP, "555002"), 0);

  const r4 = await createAdvanceReceipt(SHOP, {
    customerId: "555003", customerName: "Anil P",
    amountPaise: 400_000, mode: "CASH",
  });
  const overRefund = await refundReceipt(SHOP, r4.id, 500_000, "too much");
  check("cannot over-refund", overRefund.ok, false);
  const okRefund = await refundReceipt(SHOP, r4.id, 150_000, "part cash back");
  check("partial refund accepted", okRefund.ok, true);
  check("balance after partial refund", await getCustomerBalance(SHOP, "555003"), 250_000);
  check("receipt back to partial", (await receiptById(r4.id)).status, "PARTIAL");

  console.log("\n— manual application —");

  const manual = await applyReceiptManually(SHOP, {
    receiptId: r4.id, orderId: "1004", orderName: "#1004", amountPaise: 250_000,
  });
  check("manual apply accepted", manual.ok, true);
  check("balance zero after manual apply", await getCustomerBalance(SHOP, "555003"), 0);
  check("receipt now consumed", (await receiptById(r4.id)).status, "CONSUMED");

  const tooMuch = await applyReceiptManually(SHOP, {
    receiptId: r4.id, orderId: "1005", orderName: "#1005", amountPaise: 100,
  });
  check("cannot apply beyond the receipt", tooMuch.ok, false);

  console.log("\n— tender name matching —");

  const settings = { tenderNames: "Advance Adjusted, Store Credit" };
  check("exact match", isAdvanceTender(settings, "Advance Adjusted"), true);
  check("case insensitive", isAdvanceTender(settings, "advance adjusted"), true);
  check("second name", isAdvanceTender(settings, "Store Credit"), true);
  check("unrelated gateway ignored", isAdvanceTender(settings, "Cash"), false);
  check("empty gateway ignored", isAdvanceTender(settings, null), false);

  console.log("\n— reading split tenders off an order —");

  const order = {
    transactions: [
      { status: "SUCCESS", kind: "SALE", gateway: "Advance Adjusted", formattedGateway: "Advance Adjusted", amountSet: { shopMoney: { amount: "15000.00" } } },
      { status: "SUCCESS", kind: "SALE", gateway: "cash", formattedGateway: "Cash", amountSet: { shopMoney: { amount: "3500.00" } } },
      { status: "FAILURE", kind: "SALE", gateway: "Advance Adjusted", formattedGateway: "Advance Adjusted", amountSet: { shopMoney: { amount: "9999.00" } } },
    ],
  };
  check("only the advance tender counts", advanceTenderPaise(order, settings), 1_500_000);

  const refunded = {
    transactions: [
      ...order.transactions,
      { status: "SUCCESS", kind: "REFUND", gateway: "Advance Adjusted", formattedGateway: "Advance Adjusted", amountSet: { shopMoney: { amount: "5000.00" } } },
    ],
  };
  check("refund on that tender subtracts", advanceTenderPaise(refunded, settings), 1_000_000);

  console.log("\n— product reference (must not touch inventory) —");

  const pListed = await createAdvanceReceipt(SHOP, {
    customerId: "555004", customerName: "Meera J",
    amountPaise: 200_000, mode: "CASH",
    productListed: true,
    productId: "8217008209954",
    productVariantId: "44790106521634",
    productTitle: "2-in-1 Bicycle-cum-Head Light",
    productVariantTitle: "Black",
    productSku: "BIKE-LIGHT-BLK",
    productSpec: "2 pcs",
  });
  check("listed product flagged", pListed.productListed, true);
  check("product id stored", pListed.productId, "8217008209954");
  check(
    "summary reads well",
    productSummary(pListed),
    "2-in-1 Bicycle-cum-Head Light — Black (2 pcs, SKU BIKE-LIGHT-BLK)",
  );

  const pUnlisted = await createAdvanceReceipt(SHOP, {
    customerId: "555005", customerName: "Vikram S",
    amountPaise: 300_000, mode: "UPI", reference: "UPI-9001",
    productListed: false,
    productTitle: "Quechua MH500 trekking pole",
    productSpec: "Size L, to be ordered",
  });
  check("unlisted product flagged", pUnlisted.productListed, false);
  check("no shopify id for unlisted", pUnlisted.productId, null);
  check(
    "unlisted summary",
    productSummary(pUnlisted),
    "Quechua MH500 trekking pole (Size L, to be ordered)",
  );

  const pNone = await createAdvanceReceipt(SHOP, {
    customerId: "555006", customerName: "No Product",
    amountPaise: 100_000, mode: "CASH",
  });
  check("no product recorded", productSummary(pNone), null);
  check("product field optional", pNone.productTitle, null);

  check(
    "Default Title variant suppressed",
    productSummary({ productTitle: "Headlamp", productVariantTitle: "Default Title" }),
    "Headlamp",
  );

  // The whole point: recording a product changes nothing about stock.
  check(
    "product reference creates no allocation",
    await prisma.allocation.count({ where: { shop: SHOP, customerId: "555004" } }),
    0,
  );
  check(
    "credit still intact for product receipt",
    await getCustomerBalance(SHOP, "555004"),
    200_000,
  );

  console.log("\n— POS capture: reserve, then confirm on payment —");

  const posSettings = { tenderNames: "Advance Adjusted" };

  const pending = await reservePosAdvance(SHOP, {
    customerId: "555010", customerName: "Deepak R",
    amountPaise: 1_500_000,
    productTitle: "Quechua MH500 tent",
  });
  check("reserved as pending", pending.status, "PENDING");
  check("no real receipt number yet", pending.receiptNo.startsWith("PENDING-"), true);
  check("pending gives no credit", await getCustomerBalance(SHOP, "555010"), 0);
  check("pending is not spendable", availablePaise(pending), 0);

  // The cashier tenders the cart: ₹15,000 by UPI.
  const posOrder = {
    id: "gid://shopify/Order/2001",
    name: "#2001",
    processedAt: "2026-06-25T10:00:00Z",
    customAttributes: [{ key: "_advance_receipt_ids", value: pending.id }],
    lineItems: {
      edges: [
        { node: { title: `Advance received — Deepak R`, quantity: 1,
                  originalTotalSet: { shopMoney: { amount: "15000.00" } } } },
      ],
    },
    transactions: [
      { status: "SUCCESS", kind: "SALE", gateway: "UPI", formattedGateway: "UPI",
        amountSet: { shopMoney: { amount: "15000.00" } } },
    ],
  };

  check("reads the reservation off the cart", pendingReceiptIds(posOrder)[0], pending.id);
  check("reads the advance line total", advanceLinePaise(posOrder), 1_500_000);
  check("detects how they paid", primaryInboundTender(posOrder, posSettings).mode, "UPI");

  const confirm = await confirmPosAdvance(SHOP, pending.id, {
    orderId: "2001", orderName: "#2001",
    mode: "UPI", gateway: "UPI",
    amountPaise: 1_500_000,
    orderDate: new Date("2026-06-25T10:00:00Z"),
  });
  check("confirmed", confirm.ok, true);
  check("real receipt number issued", confirm.receipt.receiptNo.startsWith("ADV-"), true);
  check("now open", confirm.receipt.status, "OPEN");
  check("mode taken from the till", confirm.receipt.mode, "UPI");
  check("credit granted on payment", await getCustomerBalance(SHOP, "555010"), 1_500_000);

  // Webhook replay: orders/create then orders/paid then a retry.
  await confirmPosAdvance(SHOP, pending.id, {
    orderId: "2001", orderName: "#2001", mode: "UPI", amountPaise: 1_500_000,
  });
  check("replay does not double-credit", await getCustomerBalance(SHOP, "555010"), 1_500_000);

  console.log("\n— POS capture: cashier edits the price in the cart —");

  const edited = await reservePosAdvance(SHOP, {
    customerId: "555011", customerName: "Priya N", amountPaise: 500_000,
  });
  await confirmPosAdvance(SHOP, edited.id, {
    orderId: "2002", orderName: "#2002", mode: "CASH",
    amountPaise: 750_000, // cashier changed it at the till
  });
  check("order wins over the reservation", await getCustomerBalance(SHOP, "555011"), 750_000);

  console.log("\n— POS capture: cart abandoned —");

  const abandoned = await reservePosAdvance(SHOP, {
    customerId: "555012", customerName: "Ghost", amountPaise: 900_000,
  });
  const discarded = await discardPendingAdvance(SHOP, abandoned.id, "Cart cleared");
  check("pending discarded", discarded.ok, true);
  check("abandoned cart grants nothing", await getCustomerBalance(SHOP, "555012"), 0);
  check(
    "receipt series not burned by abandonment",
    (await receiptById(abandoned.id)).receiptNo.startsWith("PENDING-"),
    true,
  );

  console.log("\n— POS capture: split tender attribution —");

  const split = {
    transactions: [
      { status: "SUCCESS", kind: "SALE", gateway: "Cash", formattedGateway: "Cash",
        amountSet: { shopMoney: { amount: "2000.00" } } },
      { status: "SUCCESS", kind: "SALE", gateway: "UPI", formattedGateway: "UPI",
        amountSet: { shopMoney: { amount: "13000.00" } } },
      { status: "SUCCESS", kind: "SALE", gateway: "Advance Adjusted",
        formattedGateway: "Advance Adjusted",
        amountSet: { shopMoney: { amount: "5000.00" } } },
    ],
  };
  check("largest inbound tender wins", primaryInboundTender(split, posSettings).mode, "UPI");
  check(
    "advance-adjusted is never treated as money in",
    primaryInboundTender(
      { transactions: [split.transactions[2]] }, posSettings,
    ).mode,
    "OTHER",
  );

  check("gateway naming: PhonePe", gatewayToMode("PhonePe"), "UPI");
  check("gateway naming: Cash on hand", gatewayToMode("Cash on hand"), "CASH");
  check("gateway naming: unknown", gatewayToMode("Barter"), "OTHER");

  console.log("\n— refunding an advance through POS —");

  const refundable = await reservePosAdvance(SHOP, {
    customerId: "555020", customerName: "Refund Case", amountPaise: 1_000_000,
  });
  await confirmPosAdvance(SHOP, refundable.id, {
    orderId: "3001", orderName: "#3001", mode: "CASH", amountPaise: 1_000_000,
  });
  check("credit before refund", await getCustomerBalance(SHOP, "555020"), 1_000_000);

  // Cashier refunds ₹4,000 of the advance line in POS.
  await syncPosAdvanceRefund(SHOP, "3001", 400_000);
  check("partial refund cuts credit", await getCustomerBalance(SHOP, "555020"), 600_000);
  check("receipt shows refunded", (await receiptById(refundable.id)).refundedPaise, 400_000);
  check("receipt is partial", (await receiptById(refundable.id)).status, "PARTIAL");

  // Webhook replay must not stack refunds.
  await syncPosAdvanceRefund(SHOP, "3001", 400_000);
  await syncPosAdvanceRefund(SHOP, "3001", 400_000);
  check("refund replay is idempotent", await getCustomerBalance(SHOP, "555020"), 600_000);

  // Refund the rest.
  await syncPosAdvanceRefund(SHOP, "3001", 1_000_000);
  check("full refund empties credit", await getCustomerBalance(SHOP, "555020"), 0);
  check("receipt fully refunded", (await receiptById(refundable.id)).status, "REFUNDED");

  console.log("\n— refund capped at what is still unspent —");

  const spent = await reservePosAdvance(SHOP, {
    customerId: "555021", customerName: "Already Spent", amountPaise: 1_000_000,
  });
  await confirmPosAdvance(SHOP, spent.id, {
    orderId: "3002", orderName: "#3002", mode: "UPI", amountPaise: 1_000_000,
  });
  // Customer spends ₹7,000 on goods.
  await reconcileOrder(SHOP, {
    orderId: "3050", orderName: "#3050",
    customerId: "555021", customerName: "Already Spent",
    tenderPaise: 700_000,
  });
  check("credit after spending", await getCustomerBalance(SHOP, "555021"), 300_000);

  // POS refunds the whole original ₹10,000 — but only ₹3,000 was still unspent.
  const capped = await syncPosAdvanceRefund(SHOP, "3002", 1_000_000);
  check("refund capped to unspent", capped.applied, 300_000);
  check("shortfall reported", capped.shortfallPaise, 700_000);
  check("balance never goes negative", await getCustomerBalance(SHOP, "555021"), 0);

  console.log("\n— reading refunds off the order —");

  const advOrder = {
    lineItems: { edges: [{ node: { title: "Advance received — Deepak R" } }] },
    refunds: [{
      totalRefundedSet: { shopMoney: { amount: "4000.00" } },
      refundLineItems: {
        edges: [{ node: {
          subtotalSet: { shopMoney: { amount: "4000.00" } },
          lineItem: { title: "Advance received — Deepak R" },
        } }],
      },
    }],
  };
  check("line-level refund read", advanceRefundPaise(advOrder), 400_000);

  // The shape a real order in this store produced: refund with no line items.
  const orderLevel = {
    lineItems: { edges: [{ node: { title: "Advance received — Deepak R" } }] },
    refunds: [{
      totalRefundedSet: { shopMoney: { amount: "1499.00" } },
      refundLineItems: { edges: [] },
    }],
  };
  check("order-level refund attributed", advanceRefundPaise(orderLevel), 149_900);

  // Same shape, but the order also sold goods — must NOT assume it's advance.
  const mixed = {
    lineItems: {
      edges: [
        { node: { title: "Advance received — Deepak R" } },
        { node: { title: "CTR Trekking Shoes" } },
      ],
    },
    refunds: [{
      totalRefundedSet: { shopMoney: { amount: "1699.00" } },
      refundLineItems: { edges: [] },
    }],
  };
  check("ambiguous refund not attributed", advanceRefundPaise(mixed), 0);

  const goodsOnly = {
    lineItems: { edges: [{ node: { title: "CTR Trekking Shoes" } }] },
    refunds: [{
      totalRefundedSet: { shopMoney: { amount: "1699.00" } },
      refundLineItems: {
        edges: [{ node: {
          subtotalSet: { shopMoney: { amount: "1699.00" } },
          lineItem: { title: "CTR Trekking Shoes" },
        } }],
      },
    }],
  };
  check("goods refund ignored", advanceRefundPaise(goodsOnly), 0);

  console.log("\n— pending receipts stay out of the register —");

  const stillPending = await reservePosAdvance(SHOP, {
    customerId: "555013", customerName: "In Progress", amountPaise: 100_000,
  });
  const register = await listReceipts(SHOP, { limit: 500 });
  check(
    "pending hidden from the receipts list",
    register.receipts.some((r) => r.id === stillPending.id),
    false,
  );

  console.log(`\n${passed} passed, ${failed} failed\n`);
  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
