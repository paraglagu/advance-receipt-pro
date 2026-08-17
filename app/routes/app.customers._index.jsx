import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useSearchParams } from "@remix-run/react";
import {
  BlockStack,
  Box,
  Button,
  Card,
  IndexTable,
  InlineStack,
  Page,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import { listCustomerBalances } from "../models/ledger.server";
import { formatINR } from "../utils/money";
import { toCSV, csvResponse } from "../utils/csv";
import { toDecimalString } from "../utils/money";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);

  const filter = url.searchParams.get("filter") || "outstanding";
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();

  let rows = await listCustomerBalances(session.shop, {
    onlyOutstanding: filter === "outstanding",
  });

  if (q) {
    rows = rows.filter(
      (r) =>
        r.customerName.toLowerCase().includes(q) ||
        (r.customerPhone || "").includes(q) ||
        (r.customerEmail || "").toLowerCase().includes(q),
    );
  }

  if (url.searchParams.get("export") === "csv") {
    const csv = toCSV(
      rows.map((r) => ({
        Customer: r.customerName,
        Phone: r.customerPhone || "",
        Email: r.customerEmail || "",
        Balance: toDecimalString(r.balancePaise),
        "Last activity": new Date(r.lastActivity).toISOString().slice(0, 10),
      })),
      ["Customer", "Phone", "Email", "Balance", "Last activity"],
    );
    return csvResponse(csv, `advance-balances-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  const totalPaise = rows.reduce((s, r) => s + Math.max(0, r.balancePaise), 0);
  return json({ rows, totalPaise, filter, q: url.searchParams.get("q") || "" });
};

export default function CustomerLedgersPage() {
  const { rows, totalPaise, filter, q } = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [query, setQuery] = useState(q);

  const update = (patch) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(patch).forEach(([k, v]) => {
      if (!v) next.delete(k);
      else next.set(k, v);
    });
    setSearchParams(next);
  };

  const exportHref = `/app/customers?${new URLSearchParams({
    ...Object.fromEntries(searchParams),
    export: "csv",
  })}`;

  const tableRows = rows.map((r, index) => (
    <IndexTable.Row
      id={r.customerId}
      key={r.customerId}
      position={index}
      onClick={() => navigate(`/app/customers/${r.customerId}`)}
    >
      <IndexTable.Cell>
        <Text as="span" fontWeight="semibold">{r.customerName}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span">{r.customerPhone || "—"}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" tone="subdued">{r.customerEmail || "—"}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text
          as="span"
          numeric
          alignment="end"
          tone={r.balancePaise > 0 ? "success" : "subdued"}
          fontWeight="semibold"
        >
          {formatINR(r.balancePaise)}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span">
          {new Date(r.lastActivity).toLocaleDateString("en-IN", {
            day: "2-digit", month: "short", year: "2-digit",
          })}
        </Text>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page
      title="Customer ledgers"
      subtitle={`${formatINR(totalPaise)} held across ${rows.length} customer${rows.length === 1 ? "" : "s"}`}
      primaryAction={{ content: "Take an advance", url: "/app/advances/new" }}
      secondaryActions={[{ content: "Export CSV", url: exportHref, external: true }]}
    >
      <Card padding="0">
        <Box padding="300" borderBlockEndWidth="025" borderColor="border">
          <InlineStack gap="300" blockAlign="end" wrap>
            <div style={{ flex: "1 1 260px", minWidth: 220 }}>
              <TextField
                label="Search"
                labelHidden
                value={query}
                onChange={setQuery}
                placeholder="Search by name, phone or email"
                autoComplete="off"
                clearButton
                onClearButtonClick={() => { setQuery(""); update({ q: null }); }}
              />
            </div>
            <Button onClick={() => update({ q: query || null })}>Search</Button>
            <div style={{ minWidth: 190 }}>
              <Select
                label="Show"
                labelHidden
                options={[
                  { label: "With credit remaining", value: "outstanding" },
                  { label: "All customers ever", value: "all" },
                ]}
                value={filter}
                onChange={(v) => update({ filter: v })}
              />
            </div>
          </InlineStack>
        </Box>

        {rows.length === 0 ? (
          <Box padding="600">
            <BlockStack gap="200" inlineAlign="center">
              <Text as="p" variant="headingSm">Nothing to show</Text>
              <Text as="p" tone="subdued" variant="bodySm">
                No customer is carrying an advance balance right now.
              </Text>
              <Button url="/app/advances/new" variant="primary">Take an advance</Button>
            </BlockStack>
          </Box>
        ) : (
          <IndexTable
            resourceName={{ singular: "customer", plural: "customers" }}
            itemCount={rows.length}
            selectable={false}
            headings={[
              { title: "Customer" },
              { title: "Phone" },
              { title: "Email" },
              { title: "Credit balance", alignment: "end" },
              { title: "Last activity" },
            ]}
          >
            {tableRows}
          </IndexTable>
        )}
      </Card>
    </Page>
  );
}
