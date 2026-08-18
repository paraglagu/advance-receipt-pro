import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  IndexTable,
  InlineStack,
  Layout,
  Page,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import { getSettings } from "../models/settings.server";
import { listProcessedOrders, reconcileOrder } from "../models/allocation.server";
import {
  ORDER_STATUS,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONES,
} from "../utils/domain";
import {
  fetchOrderForReconcile,
  findOrderByName,
  shapeOrderForReconcile,
} from "../models/shopifyOrder.server";
import { formatINR } from "../utils/money";

const STATUS_TONE = ORDER_STATUS_TONES;

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || null;

  const [settings, { total, orders }] = await Promise.all([
    getSettings(session.shop),
    listProcessedOrders(session.shop, { status, limit: 100 }),
  ]);

  return json({ settings, total, orders, status: status || "" });
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  // Anything thrown below would otherwise render Remix's blank "Application
  // Error" box, which tells the merchant nothing and tells us nothing either.
  try {
    return await runAction({ shop, admin, form, intent });
  } catch (e) {
    console.error("[order reconciliation] action failed:", e);
    return json(
      { error: `${e.name || "Error"}: ${e.message}` },
      { status: 500 },
    );
  }
};

async function runAction({ shop, admin, form, intent }) {
  const settings = await getSettings(shop);

  if (intent === "resync") {
    const orderId = String(form.get("orderId") || "");
    const order = await fetchOrderForReconcile(admin, orderId);
    if (!order) return json({ error: "Order not found in Shopify" }, { status: 400 });
    const shaped = shapeOrderForReconcile(order, settings);
    await reconcileOrder(shop, { ...shaped, source: "MANUAL" });
    return json({ ok: `Re-checked ${shaped.orderName}.` });
  }

  if (intent === "lookup") {
    const name = String(form.get("orderName") || "").trim();
    if (!name) return json({ error: "Enter an order number" }, { status: 400 });

    const matches = await findOrderByName(admin, name);
    if (!matches || matches.length === 0) {
      return json({ error: `No order found matching “${name}”` }, { status: 400 });
    }

    const order = await fetchOrderForReconcile(admin, matches[0].id);
    const shaped = shapeOrderForReconcile(order, settings);

    if (shaped.tenderPaise <= 0) {
      return json({
        error: `${shaped.orderName} was not tendered with “${settings.tenderNames}”, so there is nothing to apply. Use the receipt screen to apply an advance manually.`,
      }, { status: 400 });
    }

    await reconcileOrder(shop, { ...shaped, source: "MANUAL" });
    return json({ ok: `${shaped.orderName} reconciled.` });
  }

  return json({ error: "Unknown action" }, { status: 400 });
}

export default function OrdersPage() {
  const { settings, total, orders, status } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [orderName, setOrderName] = useState("");

  const busy = navigation.state === "submitting";

  const rows = orders.map((o, index) => (
    <IndexTable.Row id={o.id} key={o.id} position={index}>
      <IndexTable.Cell>
        <Text as="span" fontWeight="semibold">{o.orderName}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <BlockStack gap="050">
          <Text as="span">{o.customerName || "—"}</Text>
          {o.message && (
            <Text as="span" tone="subdued" variant="bodySm">{o.message}</Text>
          )}
        </BlockStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span">
          {o.orderDate
            ? new Date(o.orderDate).toLocaleDateString("en-IN", {
                day: "2-digit", month: "short", year: "2-digit",
              })
            : "—"}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" numeric alignment="end">{formatINR(o.tenderPaise)}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text
          as="span"
          numeric
          alignment="end"
          tone={o.allocatedPaise < o.tenderPaise ? "critical" : undefined}
        >
          {formatINR(o.allocatedPaise)}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={STATUS_TONE[o.status]}>{ORDER_STATUS_LABELS[o.status] || o.status}</Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Form method="post">
          <input type="hidden" name="intent" value="resync" />
          <input type="hidden" name="orderId" value={o.orderId} />
          <Button submit variant="plain" size="slim">Re-check</Button>
        </Form>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page
      title="Order reconciliation"
      subtitle={`${total} order${total === 1 ? "" : "s"} tendered against advances`}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {actionData?.error && (
              <Banner tone="critical" title="Could not reconcile">
                <Text as="p">{actionData.error}</Text>
              </Banner>
            )}
            {actionData?.ok && <Banner tone="success" title={actionData.ok} />}

            {!settings.autoApply && (
              <Banner tone="warning" title="Auto-apply is switched off">
                <Text as="p">
                  New POS orders will not draw down advances until you turn it back on in Settings.
                </Text>
              </Banner>
            )}

            <Card padding="0">
              <Box padding="300" borderBlockEndWidth="025" borderColor="border">
                <InlineStack gap="300" blockAlign="end" wrap>
                  <div style={{ minWidth: 200 }}>
                    <Select
                      label="Status"
                      labelHidden
                      options={[
                        { label: "All except non-advance", value: "" },
                        ...Object.keys(ORDER_STATUS)
                          .filter((k) => k !== "NO_TENDER")
                          .map((k) => ({ label: ORDER_STATUS_LABELS[k], value: k })),
                        { label: "Not an advance order", value: "NO_TENDER" },
                      ]}
                      value={status}
                      onChange={(v) => {
                        const next = new URLSearchParams(searchParams);
                        if (v) next.set("status", v);
                        else next.delete("status");
                        setSearchParams(next);
                      }}
                    />
                  </div>
                </InlineStack>
              </Box>

              {orders.length === 0 ? (
                <Box padding="600">
                  <BlockStack gap="200" inlineAlign="center">
                    <Text as="p" variant="headingSm">Nothing here yet</Text>
                    <Text as="p" tone="subdued" variant="bodySm" alignment="center">
                      Orders appear once a POS sale is tendered with the
                      {" "}“{settings.tenderNames}” payment type.
                    </Text>
                  </BlockStack>
                </Box>
              ) : (
                <IndexTable
                  resourceName={{ singular: "order", plural: "orders" }}
                  itemCount={orders.length}
                  selectable={false}
                  headings={[
                    { title: "Order" },
                    { title: "Customer" },
                    { title: "Date" },
                    { title: "Tendered", alignment: "end" },
                    { title: "Drawn from advances", alignment: "end" },
                    { title: "Status" },
                    { title: "" },
                  ]}
                >
                  {rows}
                </IndexTable>
              )}
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            <Card>
              <Form method="post">
                <input type="hidden" name="intent" value="lookup" />
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Reconcile an order now</Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    If a POS order didn’t come through automatically, pull it in by order number.
                  </Text>
                  <TextField
                    label="Order number"
                    name="orderName"
                    value={orderName}
                    onChange={setOrderName}
                    autoComplete="off"
                    placeholder="#1234"
                  />
                  <Button submit variant="primary" loading={busy} fullWidth>
                    Fetch &amp; reconcile
                  </Button>
                </BlockStack>
              </Form>
            </Card>

            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">What the statuses mean</Text>
                <Meaning tone="success" label="Applied">
                  The advance covered the full amount tendered against it.
                </Meaning>
                <Meaning tone="attention" label="Short">
                  The customer didn’t have enough credit. Collect the shortfall by another mode.
                </Meaning>
                <Meaning tone="critical" label="No customer">
                  The order has no customer attached, so there’s no ledger to draw from. Attach
                  the customer in Shopify, then hit Re-check.
                </Meaning>
                <Meaning tone="critical" label="No balance">
                  The customer had no unused advance at all.
                </Meaning>
                <Meaning tone="warning" label="Released">
                  The order was cancelled and the credit went back to the customer.
                </Meaning>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function Meaning({ tone, label, children }) {
  return (
    <BlockStack gap="100">
      <InlineStack gap="200" blockAlign="center">
        <Badge tone={tone}>{label}</Badge>
      </InlineStack>
      <Text as="p" variant="bodySm" tone="subdued">{children}</Text>
    </BlockStack>
  );
}
