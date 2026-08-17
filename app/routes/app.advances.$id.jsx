import { useState } from "react";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  DataTable,
  Divider,
  InlineGrid,
  InlineStack,
  Layout,
  Modal,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { getSettings } from "../models/settings.server";
import { getReceipt, refundReceipt, voidReceipt } from "../models/receipt.server";
import { getCustomerBalance } from "../models/ledger.server";
import { applyReceiptManually, releaseAllocation } from "../models/allocation.server";
import { findOrderByName } from "../models/shopifyOrder.server";
import {
  availablePaise,
  productSummary,
  RECEIPT_STATUS_LABELS as STATUS_LABEL,
  RECEIPT_STATUS_TONES as STATUS_TONE,
} from "../utils/domain";
import { formatINR, modeLabel, parseAmount } from "../utils/money";

export const loader = async ({ params, request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const receipt = await getReceipt(shop, params.id);
  if (!receipt) throw new Response("Receipt not found", { status: 404 });

  const [settings, balancePaise] = await Promise.all([
    getSettings(shop),
    getCustomerBalance(shop, receipt.customerId),
  ]);

  return json({
    receipt,
    settings,
    balancePaise,
    availableOnReceipt: availablePaise(receipt),
  });
};

export const action = async ({ params, request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  if (intent === "void") {
    const result = await voidReceipt(shop, params.id, String(form.get("reason") || ""));
    if (!result.ok) return json({ error: result.error }, { status: 400 });
    return redirect(`/app/advances/${params.id}?voided=1`);
  }

  if (intent === "refund") {
    const parsed = parseAmount(form.get("refundAmount"));
    if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });
    const result = await refundReceipt(shop, params.id, parsed.paise, String(form.get("refundNote") || ""));
    if (!result.ok) return json({ error: result.error }, { status: 400 });
    return redirect(`/app/advances/${params.id}?refunded=1`);
  }

  if (intent === "apply") {
    const orderName = String(form.get("orderName") || "").trim();
    const parsed = parseAmount(form.get("applyAmount"));
    if (!orderName) return json({ error: "Enter the order number" }, { status: 400 });
    if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });

    const matches = await findOrderByName(admin, orderName);
    if (!matches || matches.length === 0) {
      return json({ error: `No order found matching “${orderName}”` }, { status: 400 });
    }
    const order = matches[0];

    const result = await applyReceiptManually(shop, {
      receiptId: params.id,
      orderId: order.id,
      orderName: order.name,
      amountPaise: parsed.paise,
    });
    if (!result.ok) return json({ error: result.error }, { status: 400 });
    return redirect(`/app/advances/${params.id}?applied=1`);
  }

  if (intent === "release") {
    const result = await releaseAllocation(
      shop,
      String(form.get("allocationId")),
      "Released manually from the receipt screen",
    );
    if (!result.ok) return json({ error: result.error }, { status: 400 });
    return redirect(`/app/advances/${params.id}?released=1`);
  }

  return json({ error: "Unknown action" }, { status: 400 });
};

export default function ReceiptDetailPage() {
  const { receipt, settings, balancePaise, availableOnReceipt } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();

  const [voidOpen, setVoidOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);

  const busy = navigation.state === "submitting";
  const printUrl = `/print/receipt/${receipt.id}`;
  const isVoid = receipt.status === "VOID";

  const activeAllocations = receipt.allocations.filter((a) => !a.releasedAt);
  const allocRows = receipt.allocations.map((a) => [
    a.orderName,
    new Date(a.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
    a.source === "MANUAL" ? "Manual" : "Automatic",
    formatINR(a.amountPaise),
    a.releasedAt ? <Badge tone="warning" key={a.id}>Released</Badge> : <Badge tone="success" key={a.id}>Applied</Badge>,
    a.releasedAt ? "—" : (
      <Form method="post" key={`f-${a.id}`}>
        <input type="hidden" name="intent" value="release" />
        <input type="hidden" name="allocationId" value={a.id} />
        <Button submit variant="plain" tone="critical" size="slim">Release</Button>
      </Form>
    ),
  ]);

  return (
    <Page
      title={receipt.receiptNo}
      subtitle={`Advance from ${receipt.customerName}`}
      backAction={{ content: "Receipts", url: "/app/advances" }}
      titleMetadata={
        <Badge tone={STATUS_TONE[receipt.status]}>{STATUS_LABEL[receipt.status] || receipt.status}</Badge>
      }
      primaryAction={{
        content: "Print receipt",
        url: printUrl,
        target: "_blank",
      }}
      secondaryActions={[
        {
          content: "Print 80mm",
          url: `${printUrl}?size=THERMAL80`,
          target: "_blank",
        },
        {
          content: "Print A5",
          url: `${printUrl}?size=A5`,
          target: "_blank",
        },
        {
          content: "Customer ledger",
          url: `/app/customers/${receipt.customerId}`,
        },
      ]}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {searchParams.get("created") === "1" && (
              <Banner tone="success" title={`Receipt ${receipt.receiptNo} created`}>
                <BlockStack gap="200">
                  <Text as="p">
                    {formatINR(receipt.amountPaise)} added to {receipt.customerName}’s credit.
                    Print the receipt and hand it over.
                  </Text>
                  <InlineStack gap="200">
                    <Button url={`${printUrl}?auto=1`} target="_blank" variant="primary">
                      Print now
                    </Button>
                    <Button url="/app/advances/new">Take another advance</Button>
                  </InlineStack>
                </BlockStack>
              </Banner>
            )}
            {searchParams.get("applied") === "1" && (
              <Banner tone="success" title="Advance applied to the order" />
            )}
            {searchParams.get("released") === "1" && (
              <Banner tone="info" title="Allocation released — credit is available again" />
            )}
            {searchParams.get("voided") === "1" && (
              <Banner tone="warning" title="Receipt voided" />
            )}
            {searchParams.get("refunded") === "1" && (
              <Banner tone="info" title="Refund recorded" />
            )}
            {actionData?.error && (
              <Banner tone="critical" title="Could not complete that">
                <Text as="p">{actionData.error}</Text>
              </Banner>
            )}
            {isVoid && (
              <Banner tone="critical" title="This receipt is void">
                <Text as="p">{receipt.voidReason || "No reason recorded."}</Text>
              </Banner>
            )}

            <Card>
              <BlockStack gap="400">
                <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
                  <Stat label="Advance received" value={formatINR(receipt.amountPaise)} strong />
                  <Stat label="Used against orders" value={formatINR(receipt.appliedPaise)} />
                  <Stat
                    label="Still available"
                    value={formatINR(availableOnReceipt)}
                    tone={availableOnReceipt > 0 ? "success" : "subdued"}
                    strong
                  />
                </InlineGrid>

                <Divider />

                <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                  <Field label="Receipt number" value={receipt.receiptNo} />
                  <Field
                    label="Date"
                    value={new Date(receipt.receiptDate).toLocaleString("en-IN", {
                      day: "2-digit", month: "short", year: "numeric",
                      hour: "2-digit", minute: "2-digit",
                    })}
                  />
                  <Field label="Payment mode" value={modeLabel(receipt.mode)} />
                  <Field label="Reference" value={receipt.reference || "—"} />
                  <Field label="Received by" value={receipt.staffName || "—"} />
                  <Field label="Refunded" value={formatINR(receipt.refundedPaise)} />
                </InlineGrid>

                {productSummary(receipt) && (
                  <>
                    <Divider />
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" tone="subdued">Advance against</Text>
                      <InlineStack gap="200" blockAlign="center" wrap>
                        <Text as="p" variant="bodyMd">{productSummary(receipt)}</Text>
                        <Badge tone={receipt.productListed ? undefined : "attention"}>
                          {receipt.productListed ? "In Shopify" : "Not listed yet"}
                        </Badge>
                      </InlineStack>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Reference only — no stock was reserved or adjusted.
                      </Text>
                    </BlockStack>
                  </>
                )}

                {receipt.note && (
                  <>
                    <Divider />
                    <Field label="Note" value={receipt.note} />
                  </>
                )}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">Applied to orders</Text>
                  {!isVoid && availableOnReceipt > 0 && (
                    <Button onClick={() => setApplyOpen(true)}>Apply to an order manually</Button>
                  )}
                </InlineStack>

                {receipt.allocations.length === 0 ? (
                  <Box padding="400" background="bg-surface-secondary" borderRadius="200">
                    <BlockStack gap="150" inlineAlign="center">
                      <Text as="p" tone="subdued">Not used yet.</Text>
                      <Text as="p" tone="subdued" variant="bodySm">
                        When the customer buys, tender that POS order with the
                        “{settings.tenderNames}” payment type and it will appear here automatically.
                      </Text>
                    </BlockStack>
                  </Box>
                ) : (
                  <DataTable
                    columnContentTypes={["text", "text", "text", "numeric", "text", "text"]}
                    headings={["Order", "Date", "Source", "Amount", "Status", ""]}
                    rows={allocRows}
                  />
                )}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Customer</Text>
                <BlockStack gap="050">
                  <Text as="p" variant="headingSm">{receipt.customerName}</Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    {[receipt.customerPhone, receipt.customerEmail].filter(Boolean).join(" · ") || "—"}
                  </Text>
                </BlockStack>
                <Divider />
                <Stat
                  label="Total credit balance (all receipts)"
                  value={formatINR(balancePaise)}
                  tone={balancePaise > 0 ? "success" : "subdued"}
                  strong
                />
                <Button url={`/app/customers/${receipt.customerId}`} fullWidth>
                  View full ledger
                </Button>
                <Button url={`/app/advances/new?customerId=${receipt.customerId}`} fullWidth>
                  Take another advance
                </Button>
              </BlockStack>
            </Card>

            {!isVoid && (
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Corrections</Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    Void cancels a receipt keyed in error. Refund records money handed back to
                    the customer.
                  </Text>
                  <Button onClick={() => setRefundOpen(true)} disabled={availableOnReceipt <= 0}>
                    Record a refund
                  </Button>
                  <Button
                    tone="critical"
                    onClick={() => setVoidOpen(true)}
                    disabled={receipt.appliedPaise > 0}
                  >
                    Void this receipt
                  </Button>
                  {receipt.appliedPaise > 0 && (
                    <Text as="p" tone="subdued" variant="bodySm">
                      Already applied to an order — release it above before voiding.
                    </Text>
                  )}
                </BlockStack>
              </Card>
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>

      {/* ---------- Apply manually ---------- */}
      <Modal
        open={applyOpen}
        onClose={() => setApplyOpen(false)}
        title="Apply this advance to an order"
      >
        <Form method="post" onSubmit={() => setApplyOpen(false)}>
          <input type="hidden" name="intent" value="apply" />
          <Modal.Section>
            <BlockStack gap="300">
              <Text as="p" tone="subdued" variant="bodySm">
                Use this when a POS order was rung up without the
                “{settings.tenderNames}” tender. It records the draw-down here; it does not
                change the order in Shopify.
              </Text>
              <TextField label="Order number" name="orderName" autoComplete="off" placeholder="#1234" />
              <TextField
                label="Amount to apply (₹)"
                name="applyAmount"
                autoComplete="off"
                inputMode="decimal"
                prefix="₹"
                helpText={`Up to ${formatINR(availableOnReceipt)} available on this receipt`}
              />
            </BlockStack>
          </Modal.Section>
          <Modal.Section>
            <InlineStack align="end" gap="200">
              <Button onClick={() => setApplyOpen(false)}>Cancel</Button>
              <Button submit variant="primary" loading={busy}>Apply</Button>
            </InlineStack>
          </Modal.Section>
        </Form>
      </Modal>

      {/* ---------- Refund ---------- */}
      <Modal open={refundOpen} onClose={() => setRefundOpen(false)} title="Record a refund">
        <Form method="post" onSubmit={() => setRefundOpen(false)}>
          <input type="hidden" name="intent" value="refund" />
          <Modal.Section>
            <BlockStack gap="300">
              <Text as="p" tone="subdued" variant="bodySm">
                Records cash or a transfer handed back to the customer. Their credit balance
                drops by this amount.
              </Text>
              <TextField
                label="Refund amount (₹)"
                name="refundAmount"
                autoComplete="off"
                inputMode="decimal"
                prefix="₹"
                helpText={`Up to ${formatINR(availableOnReceipt)} unused`}
              />
              <TextField label="Note" name="refundNote" autoComplete="off" placeholder="How it was returned" />
            </BlockStack>
          </Modal.Section>
          <Modal.Section>
            <InlineStack align="end" gap="200">
              <Button onClick={() => setRefundOpen(false)}>Cancel</Button>
              <Button submit variant="primary" loading={busy}>Record refund</Button>
            </InlineStack>
          </Modal.Section>
        </Form>
      </Modal>

      {/* ---------- Void ---------- */}
      <Modal open={voidOpen} onClose={() => setVoidOpen(false)} title="Void this receipt">
        <Form method="post" onSubmit={() => setVoidOpen(false)}>
          <input type="hidden" name="intent" value="void" />
          <Modal.Section>
            <BlockStack gap="300">
              <Banner tone="warning">
                <Text as="p">
                  This cancels {receipt.receiptNo} and removes {formatINR(availableOnReceipt)} from
                  {" "}{receipt.customerName}’s balance. The receipt stays on record, stamped VOID.
                </Text>
              </Banner>
              <TextField label="Reason" name="reason" autoComplete="off" placeholder="e.g. Wrong amount entered" />
            </BlockStack>
          </Modal.Section>
          <Modal.Section>
            <InlineStack align="end" gap="200">
              <Button onClick={() => setVoidOpen(false)}>Cancel</Button>
              <Button submit tone="critical" variant="primary" loading={busy}>Void receipt</Button>
            </InlineStack>
          </Modal.Section>
        </Form>
      </Modal>
    </Page>
  );
}

function Stat({ label, value, tone, strong }) {
  return (
    <BlockStack gap="050">
      <Text as="p" variant="bodySm" tone="subdued">{label}</Text>
      <Text as="p" variant={strong ? "headingLg" : "headingMd"} tone={tone}>{value}</Text>
    </BlockStack>
  );
}

function Field({ label, value }) {
  return (
    <BlockStack gap="050">
      <Text as="p" variant="bodySm" tone="subdued">{label}</Text>
      <Text as="p" variant="bodyMd">{value}</Text>
    </BlockStack>
  );
}
