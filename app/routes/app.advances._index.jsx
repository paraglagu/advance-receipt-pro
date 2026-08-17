import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useSearchParams } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  IndexTable,
  InlineStack,
  Page,
  Pagination,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { useCallback, useState } from "react";
import { authenticate } from "../shopify.server";
import { listReceipts } from "../models/receipt.server";
import { productSummary } from "../utils/domain";
import { formatINR, modeLabel, PAYMENT_MODES } from "../utils/money";

const PAGE_SIZE = 25;

const STATUS_TONE = {
  OPEN: "success",
  PARTIAL: "attention",
  CONSUMED: undefined,
  REFUNDED: "warning",
  VOID: "critical",
};
const STATUS_LABEL = {
  OPEN: "Unused",
  PARTIAL: "Partly used",
  CONSUMED: "Fully used",
  REFUNDED: "Refunded",
  VOID: "Void",
};

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);

  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const status = url.searchParams.get("status") || null;
  const mode = url.searchParams.get("mode") || null;
  const search = url.searchParams.get("q") || null;

  const { total, receipts } = await listReceipts(session.shop, {
    page,
    limit: PAGE_SIZE,
    status,
    mode,
    search,
  });

  return json({ total, receipts, page, pageSize: PAGE_SIZE });
};

export default function AdvancesListPage() {
  const { total, receipts, page, pageSize } = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [query, setQuery] = useState(searchParams.get("q") || "");
  const status = searchParams.get("status");
  const payMode = searchParams.get("mode");

  const update = useCallback(
    (patch) => {
      const next = new URLSearchParams(searchParams);
      Object.entries(patch).forEach(([k, v]) => {
        if (v === null || v === undefined || v === "") next.delete(k);
        else next.set(k, v);
      });
      if (!("page" in patch)) next.delete("page");
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const rows = receipts.map((r, index) => {
    const unused = r.amountPaise - r.appliedPaise - r.refundedPaise;
    return (
      <IndexTable.Row id={r.id} key={r.id} position={index}
        onClick={() => navigate(`/app/advances/${r.id}`)}
      >
        <IndexTable.Cell>
          <Text as="span" fontWeight="semibold">{r.receiptNo}</Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <BlockStack gap="050">
            <Text as="span">{r.customerName}</Text>
            {r.customerPhone && (
              <Text as="span" tone="subdued" variant="bodySm">{r.customerPhone}</Text>
            )}
          </BlockStack>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span">
            {new Date(r.receiptDate).toLocaleDateString("en-IN", {
              day: "2-digit", month: "short", year: "2-digit",
            })}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <BlockStack gap="050">
            <Text as="span">{modeLabel(r.mode)}</Text>
            {r.reference && (
              <Text as="span" tone="subdued" variant="bodySm">{r.reference}</Text>
            )}
          </BlockStack>
        </IndexTable.Cell>
        <IndexTable.Cell>
          {productSummary(r) ? (
            <BlockStack gap="050">
              <Text as="span" variant="bodySm">{productSummary(r)}</Text>
              {!r.productListed && (
                <Text as="span" tone="subdued" variant="bodySm">Not listed yet</Text>
              )}
            </BlockStack>
          ) : (
            <Text as="span" tone="subdued">—</Text>
          )}
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" numeric alignment="end">{formatINR(r.amountPaise)}</Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" numeric alignment="end" tone={unused > 0 ? "success" : "subdued"}>
            {formatINR(Math.max(0, unused))}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status] || r.status}</Badge>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <Page
      title="Advance receipts"
      subtitle={`${total} receipt${total === 1 ? "" : "s"}`}
      primaryAction={{ content: "Take an advance", url: "/app/advances/new" }}
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
                placeholder="Search receipt no, customer, phone or reference"
                autoComplete="off"
                clearButton
                onClearButtonClick={() => { setQuery(""); update({ q: null }); }}
              />
            </div>
            <Button onClick={() => update({ q: query || null })}>Search</Button>
            <div style={{ minWidth: 150 }}>
              <Select
                label="Status"
                labelHidden
                options={[
                  { label: "All statuses", value: "" },
                  ...Object.keys(STATUS_LABEL).map((k) => ({ label: STATUS_LABEL[k], value: k })),
                ]}
                value={status || ""}
                onChange={(v) => update({ status: v || null })}
              />
            </div>
            <div style={{ minWidth: 150 }}>
              <Select
                label="Mode"
                labelHidden
                options={[{ label: "All modes", value: "" }, ...PAYMENT_MODES]}
                value={payMode || ""}
                onChange={(v) => update({ mode: v || null })}
              />
            </div>
            {(status || payMode || searchParams.get("q")) && (
              <Button
                variant="plain"
                onClick={() => { setQuery(""); setSearchParams(new URLSearchParams()); }}
              >
                Clear
              </Button>
            )}
          </InlineStack>
        </Box>

        {receipts.length === 0 ? (
          <Box padding="600">
            <BlockStack gap="200" inlineAlign="center">
              <Text as="p" variant="headingSm">No receipts match</Text>
              <Text as="p" tone="subdued" variant="bodySm">
                Try clearing the filters, or record a new advance.
              </Text>
              <Button url="/app/advances/new" variant="primary">Take an advance</Button>
            </BlockStack>
          </Box>
        ) : (
          <IndexTable
            resourceName={{ singular: "receipt", plural: "receipts" }}
            itemCount={receipts.length}
            selectable={false}
            headings={[
              { title: "Receipt" },
              { title: "Customer" },
              { title: "Date" },
              { title: "Mode" },
              { title: "For" },
              { title: "Amount", alignment: "end" },
              { title: "Unused", alignment: "end" },
              { title: "Status" },
            ]}
          >
            {rows}
          </IndexTable>
        )}

        {totalPages > 1 && (
          <Box padding="300">
            <InlineStack align="center">
              <Pagination
                hasPrevious={page > 1}
                onPrevious={() => update({ page: String(page - 1) })}
                hasNext={page < totalPages}
                onNext={() => update({ page: String(page + 1) })}
                label={`Page ${page} of ${totalPages}`}
              />
            </InlineStack>
          </Box>
        )}
      </Card>
    </Page>
  );
}
