import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Badge,
  Banner,
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
import { getSettings } from "../models/settings.server";
import { dashboardSummary } from "../models/reports.server";
import { listReceipts } from "../models/receipt.server";
import { listCustomerBalances } from "../models/ledger.server";
import { countExceptions } from "../models/allocation.server";
import { formatINR, modeLabel } from "../utils/money";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [settings, summary, recent, balances, exceptions] = await Promise.all([
    getSettings(shop),
    dashboardSummary(shop),
    listReceipts(shop, { limit: 8 }),
    listCustomerBalances(shop, { onlyOutstanding: true }),
    countExceptions(shop),
  ]);

  return json({
    settings,
    summary,
    recent: recent.receipts,
    topCustomers: balances.slice(0, 6),
    customersWithCredit: balances.length,
    exceptions,
    configured: Boolean(settings.storeName),
  });
};

export default function Dashboard() {
  const {
    settings, summary, recent, topCustomers, customersWithCredit, exceptions, configured,
  } = useLoaderData();

  const recentRows = recent.map((r) => [
    r.receiptNo,
    r.customerName,
    modeLabel(r.mode),
    formatINR(r.amountPaise),
    formatINR(r.amountPaise - r.appliedPaise - r.refundedPaise),
    new Date(r.receiptDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
  ]);

  const customerRows = topCustomers.map((c) => [
    c.customerName,
    c.customerPhone || "—",
    formatINR(c.balancePaise),
    new Date(c.lastActivity).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }),
  ]);

  return (
    <Page
      title="Advance receipts"
      primaryAction={{ content: "Take an advance", url: "/app/advances/new" }}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {!configured && (
              <Banner
                tone="warning"
                title="Finish setting up before you print"
                action={{ content: "Open settings", url: "/app/settings" }}
              >
                <Text as="p">
                  Add your store name, address and GSTIN so they appear on printed receipts, and
                  confirm the POS tender name used to redeem advances.
                </Text>
              </Banner>
            )}

            {exceptions > 0 && (
              <Banner
                tone="critical"
                title={`${exceptions} order${exceptions === 1 ? "" : "s"} need attention`}
                action={{ content: "Review orders", url: "/app/orders" }}
              >
                <Text as="p">
                  These were tendered against an advance but couldn’t be matched in full — usually
                  a missing customer on the order, or not enough credit.
                </Text>
              </Banner>
            )}

            <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="300">
              <MetricCard
                label="Held on behalf of customers"
                value={formatINR(summary.outstandingPaise)}
                hint={`${customersWithCredit} customer${customersWithCredit === 1 ? "" : "s"}`}
                tone="success"
              />
              <MetricCard
                label="Collected today"
                value={formatINR(summary.todayPaise)}
                hint={`${summary.todayCount} receipt${summary.todayCount === 1 ? "" : "s"}`}
              />
              <MetricCard
                label="Applied to orders"
                value={formatINR(summary.appliedPaise)}
                hint="Lifetime"
              />
              <MetricCard
                label="Open receipts"
                value={String(summary.openReceiptCount)}
                hint={`of ${summary.receiptCount} issued`}
              />
            </InlineGrid>

            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">Recent receipts</Text>
                  <Button url="/app/advances" variant="plain">View all</Button>
                </InlineStack>
                {recent.length === 0 ? (
                  <EmptyHint
                    title="No advances yet"
                    body="When a customer pays you upfront in cash or by UPI, record it here to issue a numbered receipt."
                    action={{ content: "Take an advance", url: "/app/advances/new" }}
                  />
                ) : (
                  <DataTable
                    columnContentTypes={["text", "text", "text", "numeric", "numeric", "text"]}
                    headings={["Receipt", "Customer", "Mode", "Amount", "Unused", "Date"]}
                    rows={recentRows}
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
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">Largest balances</Text>
                  <Button url="/app/customers" variant="plain">All ledgers</Button>
                </InlineStack>
                {topCustomers.length === 0 ? (
                  <Text as="p" tone="subdued" variant="bodySm">
                    No customer is carrying credit right now.
                  </Text>
                ) : (
                  <DataTable
                    columnContentTypes={["text", "text", "numeric", "text"]}
                    headings={["Customer", "Phone", "Balance", "Last"]}
                    rows={customerRows}
                  />
                )}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Redeeming at POS</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  At checkout, tender the order with the custom payment type
                  {" "}<b>“{settings.tenderNames}”</b> for the amount the customer wants to use.
                  This app draws it from their oldest unused receipt automatically.
                </Text>
                <Badge tone={settings.autoApply ? "success" : "critical"}>
                  {settings.autoApply ? "Auto-apply is on" : "Auto-apply is off"}
                </Badge>
                <Button url="/app/settings" fullWidth>Settings</Button>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function MetricCard({ label, value, hint, tone }) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text as="p" variant="bodySm" tone="subdued">{label}</Text>
        <Text as="p" variant="headingLg" tone={tone}>{value}</Text>
        {hint && <Text as="p" variant="bodySm" tone="subdued">{hint}</Text>}
      </BlockStack>
    </Card>
  );
}

function EmptyHint({ title, body, action }) {
  return (
    <Box padding="500" background="bg-surface-secondary" borderRadius="200">
      <BlockStack gap="200" inlineAlign="center">
        <Text as="p" variant="headingSm">{title}</Text>
        <Text as="p" tone="subdued" variant="bodySm" alignment="center">{body}</Text>
        {action && <Button url={action.url} variant="primary">{action.content}</Button>}
      </BlockStack>
    </Box>
  );
}
