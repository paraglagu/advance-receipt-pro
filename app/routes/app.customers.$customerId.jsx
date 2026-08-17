import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  DataTable,
  InlineGrid,
  InlineStack,
  Layout,
  Page,
  Text,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getCustomerStatement } from "../models/ledger.server";
import { listReceipts } from "../models/receipt.server";
import { LEDGER_LABELS } from "../utils/domain";
import { formatINR, modeLabel } from "../utils/money";

export const loader = async ({ params, request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const customerId = params.customerId;

  const url = new URL(request.url);
  const from = url.searchParams.get("from") ? new Date(url.searchParams.get("from")) : null;
  const to = url.searchParams.get("to") ? new Date(`${url.searchParams.get("to")}T23:59:59`) : null;

  const [{ rows, closingPaise }, receiptPage, profile] = await Promise.all([
    getCustomerStatement(shop, customerId, { from, to }),
    listReceipts(shop, { customerId, limit: 100 }),
    prisma.advanceReceipt.findFirst({
      where: { shop, customerId },
      orderBy: { createdAt: "desc" },
      select: { customerName: true, customerPhone: true, customerEmail: true },
    }),
  ]);

  if (!profile && rows.length === 0) {
    throw new Response("No ledger for this customer", { status: 404 });
  }

  const receipts = receiptPage.receipts;
  const totals = receipts.reduce(
    (acc, r) => {
      if (r.status === "VOID") return acc;
      acc.received += r.amountPaise;
      acc.applied += r.appliedPaise;
      acc.refunded += r.refundedPaise;
      return acc;
    },
    { received: 0, applied: 0, refunded: 0 },
  );

  return json({
    shop,
    customerId,
    profile: profile || { customerName: "Customer", customerPhone: null, customerEmail: null },
    rows,
    closingPaise,
    receipts,
    totals,
  });
};

export default function CustomerLedgerPage() {
  const { shop, customerId, profile, rows, closingPaise, receipts, totals } = useLoaderData();

  const statementUrl = `/print/statement/${customerId}?shop=${encodeURIComponent(shop)}`;

  const ledgerRows = rows
    .slice()
    .reverse()
    .map((r) => [
      new Date(r.entryDate).toLocaleDateString("en-IN", {
        day: "2-digit", month: "short", year: "2-digit",
      }),
      LEDGER_LABELS[r.type] || r.type,
      [r.receiptNo, r.orderName].filter(Boolean).join(" · ") || "—",
      r.creditPaise ? formatINR(r.creditPaise) : "",
      r.debitPaise ? formatINR(r.debitPaise) : "",
      formatINR(r.balancePaise),
    ]);

  const receiptRows = receipts.map((r) => [
    r.receiptNo,
    new Date(r.receiptDate).toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", year: "2-digit",
    }),
    modeLabel(r.mode),
    formatINR(r.amountPaise),
    formatINR(Math.max(0, r.amountPaise - r.appliedPaise - r.refundedPaise)),
  ]);

  return (
    <Page
      title={profile.customerName}
      subtitle={[profile.customerPhone, profile.customerEmail].filter(Boolean).join(" · ") || "Advance ledger"}
      backAction={{ content: "Customer ledgers", url: "/app/customers" }}
      titleMetadata={
        <Badge tone={closingPaise > 0 ? "success" : undefined}>
          {formatINR(closingPaise)}
        </Badge>
      }
      primaryAction={{
        content: "Take an advance",
        url: `/app/advances/new?customerId=${customerId}`,
      }}
      secondaryActions={[
        { content: "Print statement", url: statementUrl, target: "_blank" },
      ]}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <InlineGrid columns={{ xs: 1, sm: 4 }} gap="400">
                <Stat label="Total received" value={formatINR(totals.received)} />
                <Stat label="Applied to orders" value={formatINR(totals.applied)} />
                <Stat label="Refunded" value={formatINR(totals.refunded)} />
                <Stat
                  label="Credit balance"
                  value={formatINR(closingPaise)}
                  tone={closingPaise > 0 ? "success" : "subdued"}
                  strong
                />
              </InlineGrid>
            </Card>

            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">Ledger</Text>
                  <Button url={statementUrl} target="_blank" variant="plain">
                    Print statement
                  </Button>
                </InlineStack>
                {ledgerRows.length === 0 ? (
                  <Text as="p" tone="subdued">No transactions yet.</Text>
                ) : (
                  <DataTable
                    columnContentTypes={["text", "text", "text", "numeric", "numeric", "numeric"]}
                    headings={["Date", "Particulars", "Reference", "Credit", "Debit", "Balance"]}
                    rows={ledgerRows}
                  />
                )}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Receipts issued</Text>
                {receiptRows.length === 0 ? (
                  <Text as="p" tone="subdued">None.</Text>
                ) : (
                  <DataTable
                    columnContentTypes={["text", "text", "text", "numeric", "numeric"]}
                    headings={["Receipt", "Date", "Mode", "Amount", "Unused"]}
                    rows={receiptRows}
                  />
                )}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Credit available</Text>
              <Text as="p" variant="heading2xl" tone={closingPaise > 0 ? "success" : "subdued"}>
                {formatINR(closingPaise)}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Tender this amount in POS using your advance payment type and it will be drawn
                from the oldest unused receipt first.
              </Text>
              <Box paddingBlockStart="200">
                <Button url={statementUrl} target="_blank" fullWidth>
                  Print statement for customer
                </Button>
              </Box>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
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
