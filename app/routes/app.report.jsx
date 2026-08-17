import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams } from "@remix-run/react";
import {
  BlockStack,
  Box,
  Button,
  Card,
  DataTable,
  InlineGrid,
  InlineStack,
  Layout,
  Page,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import {
  agingBuckets,
  collectionsByMode,
  receiptRegister,
} from "../models/reports.server";
import { productSummary } from "../utils/domain";
import { formatINR, modeLabel, PAYMENT_MODES, toDecimalString } from "../utils/money";
import { csvResponse, toCSV } from "../utils/csv";

function defaultRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return { from: iso(from), to: iso(to) };
}

function iso(d) {
  return new Date(d).toISOString().slice(0, 10);
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);

  const fallback = defaultRange();
  const fromStr = url.searchParams.get("from") || fallback.from;
  const toStr = url.searchParams.get("to") || fallback.to;
  const mode = url.searchParams.get("mode") || null;

  const from = new Date(`${fromStr}T00:00:00`);
  const to = new Date(`${toStr}T23:59:59`);

  const [byMode, register, aging] = await Promise.all([
    collectionsByMode(shop, { from, to }),
    receiptRegister(shop, { from, to, mode }),
    agingBuckets(shop),
  ]);

  if (url.searchParams.get("export") === "csv") {
    const csv = toCSV(
      register.map((r) => ({
        "Receipt no": r.receiptNo,
        Date: iso(r.receiptDate),
        Customer: r.customerName,
        Phone: r.customerPhone || "",
        Mode: modeLabel(r.mode),
        Reference: r.reference || "",
        "Advance against": productSummary(r) || "",
        "Product listed": r.productTitle ? (r.productListed ? "Yes" : "No") : "",
        SKU: r.productSku || "",
        Amount: toDecimalString(r.amountPaise),
        Applied: toDecimalString(r.appliedPaise),
        Refunded: toDecimalString(r.refundedPaise),
        Unused: toDecimalString(
          Math.max(0, r.amountPaise - r.appliedPaise - r.refundedPaise),
        ),
        Status: r.status,
        Note: r.note || "",
      })),
      [
        "Receipt no", "Date", "Customer", "Phone", "Mode", "Reference",
        "Advance against", "Product listed", "SKU",
        "Amount", "Applied", "Refunded", "Unused", "Status", "Note",
      ],
    );
    return csvResponse(csv, `advance-register-${fromStr}-to-${toStr}.csv`);
  }

  const totals = register.reduce(
    (acc, r) => {
      if (r.status !== "VOID") {
        acc.amount += r.amountPaise;
        acc.applied += r.appliedPaise;
        acc.refunded += r.refundedPaise;
      }
      return acc;
    },
    { amount: 0, applied: 0, refunded: 0 },
  );

  return json({
    byMode,
    register,
    aging,
    totals,
    range: { from: fromStr, to: toStr },
    mode: mode || "",
  });
};

export default function ReportPage() {
  const { byMode, register, aging, totals, range, mode } = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);

  const apply = (patch = {}) => {
    const next = new URLSearchParams(searchParams);
    next.set("from", from);
    next.set("to", to);
    Object.entries(patch).forEach(([k, v]) => {
      if (!v) next.delete(k);
      else next.set(k, v);
    });
    next.delete("export");
    setSearchParams(next);
  };

  const exportHref = `/app/report?${new URLSearchParams({
    from: range.from, to: range.to, ...(mode ? { mode } : {}), export: "csv",
  })}`;

  const modeRows = byMode.map((m) => [
    modeLabel(m.mode),
    String(m.count),
    formatINR(m.totalPaise),
  ]);

  const registerRows = register.map((r) => [
    r.receiptNo,
    new Date(r.receiptDate).toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", year: "2-digit",
    }),
    r.customerName,
    modeLabel(r.mode),
    formatINR(r.amountPaise),
    formatINR(Math.max(0, r.amountPaise - r.appliedPaise - r.refundedPaise)),
    r.status === "VOID" ? "Void" : r.status,
  ]);

  const agingRows = aging.buckets.map((b) => [
    b.label,
    String(b.count),
    formatINR(b.totalPaise),
  ]);

  const oldest = aging.rows.slice(0, 10).map((r) => [
    r.receiptNo,
    r.customerName,
    `${r.ageDays} days`,
    formatINR(r.availablePaise),
  ]);

  return (
    <Page
      title="Reports"
      subtitle={`${range.from} to ${range.to}`}
      secondaryActions={[{ content: "Export register (CSV)", url: exportHref, external: true }]}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <InlineStack gap="300" blockAlign="end" wrap>
                <div style={{ minWidth: 160 }}>
                  <TextField label="From" type="date" value={from} onChange={setFrom} autoComplete="off" />
                </div>
                <div style={{ minWidth: 160 }}>
                  <TextField label="To" type="date" value={to} onChange={setTo} autoComplete="off" />
                </div>
                <div style={{ minWidth: 170 }}>
                  <Select
                    label="Mode"
                    options={[{ label: "All modes", value: "" }, ...PAYMENT_MODES]}
                    value={mode}
                    onChange={(v) => apply({ mode: v })}
                  />
                </div>
                <Button variant="primary" onClick={() => apply()}>Apply</Button>
              </InlineStack>
            </Card>

            <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
              <Metric label="Collected in period" value={formatINR(totals.amount)} />
              <Metric label="Applied to orders" value={formatINR(totals.applied)} />
              <Metric label="Refunded" value={formatINR(totals.refunded)} />
            </InlineGrid>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Collections by payment mode</Text>
                {modeRows.length === 0 ? (
                  <Text as="p" tone="subdued">Nothing collected in this period.</Text>
                ) : (
                  <DataTable
                    columnContentTypes={["text", "numeric", "numeric"]}
                    headings={["Mode", "Receipts", "Amount"]}
                    rows={modeRows}
                    totals={["", String(byMode.reduce((s, m) => s + m.count, 0)),
                      formatINR(byMode.reduce((s, m) => s + m.totalPaise, 0))]}
                  />
                )}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">Receipt register</Text>
                  <Button url={exportHref} external variant="plain">Export CSV</Button>
                </InlineStack>
                {registerRows.length === 0 ? (
                  <Text as="p" tone="subdued">No receipts in this period.</Text>
                ) : (
                  <DataTable
                    columnContentTypes={["text", "text", "text", "text", "numeric", "numeric", "text"]}
                    headings={["Receipt", "Date", "Customer", "Mode", "Amount", "Unused", "Status"]}
                    rows={registerRows}
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
                <Text as="h2" variant="headingMd">How old is the money you hold?</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Unused advances by age, across all time — not just the selected period.
                </Text>
                <DataTable
                  columnContentTypes={["text", "numeric", "numeric"]}
                  headings={["Age", "Receipts", "Unused"]}
                  rows={agingRows}
                />
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Oldest unused advances</Text>
                {oldest.length === 0 ? (
                  <Text as="p" tone="subdued" variant="bodySm">Nothing outstanding.</Text>
                ) : (
                  <DataTable
                    columnContentTypes={["text", "text", "text", "numeric"]}
                    headings={["Receipt", "Customer", "Age", "Unused"]}
                    rows={oldest}
                  />
                )}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function Metric({ label, value }) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text as="p" variant="bodySm" tone="subdued">{label}</Text>
        <Text as="p" variant="headingLg">{value}</Text>
      </BlockStack>
    </Card>
  );
}
