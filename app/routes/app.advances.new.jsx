import { useEffect, useState } from "react";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useFetcher, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  ChoiceList,
  InlineGrid,
  InlineStack,
  Layout,
  Page,
  Select,
  Text,
  TextField,
  Thumbnail,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { getSettings, peekNextReceiptNo } from "../models/settings.server";
import { createAdvanceReceipt } from "../models/receipt.server";
import { getCustomerBalance } from "../models/ledger.server";
import { getCustomer } from "../models/customer.server";
import { formatINR, parseAmount, PAYMENT_MODES } from "../utils/money";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const presetCustomerId = url.searchParams.get("customerId");

  const [settings, nextReceiptNo] = await Promise.all([
    getSettings(shop),
    peekNextReceiptNo(shop),
  ]);

  let preset = null;
  if (presetCustomerId) {
    const c = await getCustomer(admin, presetCustomerId);
    if (c) {
      preset = { ...c, balancePaise: await getCustomerBalance(shop, c.id) };
    }
  }

  return json({ settings, nextReceiptNo, preset });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();

  const customerId = String(form.get("customerId") || "").trim();
  const customerName = String(form.get("customerName") || "").trim();
  const rawAmount = form.get("amount");
  const mode = String(form.get("mode") || "CASH");
  const reference = String(form.get("reference") || "").trim();
  const note = String(form.get("note") || "").trim();
  const staffName = String(form.get("staffName") || "").trim();
  const receiptDateRaw = String(form.get("receiptDate") || "").trim();

  const errors = {};
  if (!customerId) errors.customer = "Choose the customer this advance belongs to";

  const parsed = parseAmount(rawAmount);
  if (!parsed.ok) errors.amount = parsed.error;

  // UPI/bank/cheque money is impossible to trace later without a reference.
  if (["UPI", "BANK", "CARD"].includes(mode) && !reference) {
    errors.reference = "Enter the transaction reference for non-cash payments";
  }

  // The field is pre-filled with today, so the common case is "today" and the
  // receipt should carry the real time of day, not midnight. Backdating is
  // still allowed; those get midday UTC, which keeps the printed date stable
  // whichever timezone renders it.
  const isToday = String(form.get("receiptDateIsToday") || "") === "1";
  let receiptDate = new Date();
  if (receiptDateRaw && !isToday) {
    const parsedDate = new Date(`${receiptDateRaw}T12:00:00Z`);
    if (isNaN(parsedDate.getTime())) errors.receiptDate = "Invalid date";
    else if (parsedDate > new Date(Date.now() + 86_400_000)) {
      errors.receiptDate = "Receipt date cannot be in the future";
    } else receiptDate = parsedDate;
  }

  if (Object.keys(errors).length > 0) {
    return json({ errors, values: Object.fromEntries(form) }, { status: 400 });
  }

  // What the advance is against. Purely descriptive — no stock is reserved and
  // no order line is created, whether or not the product exists in Shopify.
  const productChoice = String(form.get("productChoice") || "none");
  const productListed = productChoice === "listed";
  const productTitle =
    (productListed
      ? String(form.get("productTitle") || "")
      : String(form.get("productTitleManual") || "")
    ).trim() || null;

  const receipt = await createAdvanceReceipt(shop, {
    customerId,
    customerName: customerName || "Customer",
    customerPhone: String(form.get("customerPhone") || "").trim() || null,
    customerEmail: String(form.get("customerEmail") || "").trim() || null,
    amountPaise: parsed.paise,
    mode,
    reference,
    note,
    staffName,
    receiptDate,

    productListed: productListed && Boolean(productTitle),
    productId: productListed ? String(form.get("productId") || "").trim() || null : null,
    productVariantId: productListed
      ? String(form.get("productVariantId") || "").trim() || null
      : null,
    productTitle: productChoice === "none" ? null : productTitle,
    productVariantTitle: productListed
      ? String(form.get("productVariantTitle") || "").trim() || null
      : null,
    productSku: productListed ? String(form.get("productSku") || "").trim() || null : null,
    productSpec: productChoice === "none"
      ? null
      : String(form.get("productSpec") || "").trim() || null,
  });

  return redirect(`/app/advances/${receipt.id}?created=1`);
};

/** Today as YYYY-MM-DD in the *browser's* timezone, for the date input. */
function todayLocalISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function NewAdvancePage() {
  const { settings, nextReceiptNo, preset } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const search = useFetcher();

  const [customer, setCustomer] = useState(preset || null);
  const [term, setTerm] = useState("");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState("CASH");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [staffName, setStaffName] = useState("");
  // Default to today. todayLocalISO() reads the browser clock, so a cashier in
  // IST gets the Indian date rather than the server's UTC date.
  const [receiptDate, setReceiptDate] = useState(() => todayLocalISO());

  // "What is this advance for?" — optional, reference only.
  const [productChoice, setProductChoice] = useState("none");
  const [productTerm, setProductTerm] = useState("");
  const [product, setProduct] = useState(null);
  const [variantId, setVariantId] = useState("");
  const [productTitleManual, setProductTitleManual] = useState("");
  const [productSpec, setProductSpec] = useState("");
  const productSearch = useFetcher();

  const errors = actionData?.errors || {};
  const saving = navigation.state === "submitting";

  // Debounced lookup — cashiers type fast and the Admin API is rate limited.
  useEffect(() => {
    if (term.trim().length < 2) return;
    const t = setTimeout(() => {
      search.load(`/app/customer-search?q=${encodeURIComponent(term)}`);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  useEffect(() => {
    if (productChoice !== "listed" || productTerm.trim().length < 2) return;
    const t = setTimeout(() => {
      productSearch.load(`/app/product-search?q=${encodeURIComponent(productTerm)}`);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productTerm, productChoice]);

  const results = search.data?.customers || [];
  const productResults = productSearch.data?.products || [];
  const parsedPreview = parseAmount(amount);
  const needsReference = ["UPI", "BANK", "CARD"].includes(mode);
  const selectedVariant =
    product?.variants?.find((v) => v.id === variantId) || product?.defaultVariant || null;

  return (
    <Page
      title="New advance receipt"
      subtitle={`Will be issued as ${nextReceiptNo}`}
      backAction={{ content: "Receipts", url: "/app/advances" }}
    >
      <Layout>
        <Layout.Section>
          <Form method="post">
            <BlockStack gap="400">
              {Object.keys(errors).length > 0 && (
                <Banner tone="critical" title="Check the details below">
                  <BlockStack gap="100">
                    {Object.values(errors).map((e, i) => <Text key={i} as="p">{e}</Text>)}
                  </BlockStack>
                </Banner>
              )}

              {/* ---------------- Customer ---------------- */}
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Customer</Text>

                  {customer ? (
                    <Box
                      padding="300"
                      background="bg-surface-secondary"
                      borderRadius="200"
                      borderWidth="025"
                      borderColor="border"
                    >
                      <InlineStack align="space-between" blockAlign="center" gap="300">
                        <BlockStack gap="050">
                          <Text as="p" variant="headingSm">{customer.name}</Text>
                          <Text as="p" tone="subdued" variant="bodySm">
                            {[customer.phone, customer.email, customer.place]
                              .filter(Boolean).join(" · ") || "No contact details on file"}
                          </Text>
                          <InlineStack gap="200">
                            <Badge tone={customer.balancePaise > 0 ? "success" : undefined}>
                              {`Existing credit: ${formatINR(customer.balancePaise || 0)}`}
                            </Badge>
                          </InlineStack>
                        </BlockStack>
                        <Button onClick={() => { setCustomer(null); setTerm(""); }}>
                          Change
                        </Button>
                      </InlineStack>
                    </Box>
                  ) : (
                    <BlockStack gap="300">
                      <TextField
                        label="Search by name, phone or email"
                        value={term}
                        onChange={setTerm}
                        autoComplete="off"
                        placeholder="e.g. 98765 43210"
                        helpText="Type at least 2 characters"
                      />
                      {search.state === "loading" && (
                        <Text as="p" tone="subdued" variant="bodySm">Searching…</Text>
                      )}
                      {results.length > 0 && (
                        <BlockStack gap="200">
                          {results.map((c) => (
                            <Box
                              key={c.id}
                              padding="300"
                              background="bg-surface-secondary"
                              borderRadius="200"
                              borderWidth="025"
                              borderColor="border"
                            >
                              <InlineStack align="space-between" blockAlign="center" gap="300">
                                <BlockStack gap="050">
                                  <Text as="p" variant="bodyMd" fontWeight="semibold">{c.name}</Text>
                                  <Text as="p" tone="subdued" variant="bodySm">
                                    {[c.phone, c.email].filter(Boolean).join(" · ") || "—"}
                                  </Text>
                                  {c.balancePaise > 0 && (
                                    <Text as="p" variant="bodySm" tone="success">
                                      {`Already holds ${formatINR(c.balancePaise)} credit`}
                                    </Text>
                                  )}
                                </BlockStack>
                                <Button onClick={() => setCustomer(c)}>Select</Button>
                              </InlineStack>
                            </Box>
                          ))}
                        </BlockStack>
                      )}
                      {search.state === "idle" && term.trim().length >= 2 && results.length === 0 && (
                        <Banner tone="warning">
                          <Text as="p">
                            No customer matched “{term}”. Create them in Shopify (Customers → Add
                            customer), then come back — an advance must belong to a customer so it
                            can be applied at POS later.
                          </Text>
                        </Banner>
                      )}
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>

              {/* ---------------- Payment ---------------- */}
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Payment received</Text>

                  <InlineGrid columns={{ xs: 1, md: 2 }} gap="300">
                    <TextField
                      label="Amount (₹)"
                      name="amount"
                      value={amount}
                      onChange={setAmount}
                      autoComplete="off"
                      inputMode="decimal"
                      placeholder="0.00"
                      error={errors.amount}
                      prefix="₹"
                      helpText={
                        parsedPreview.ok ? formatINR(parsedPreview.paise) : "Amount collected now"
                      }
                    />
                    <Select
                      label="Mode"
                      name="mode"
                      options={PAYMENT_MODES}
                      value={mode}
                      onChange={setMode}
                    />
                  </InlineGrid>

                  <TextField
                    label={needsReference ? "Transaction reference (required)" : "Reference (optional)"}
                    name="reference"
                    value={reference}
                    onChange={setReference}
                    autoComplete="off"
                    error={errors.reference}
                    placeholder={
                      mode === "UPI" ? "UPI transaction ID" :
                      mode === "BANK" ? "NEFT/IMPS reference" :
                      mode === "CARD" ? "Last 4 digits / approval code" : "Optional"
                    }
                  />

                  <InlineGrid columns={{ xs: 1, md: 2 }} gap="300">
                    <TextField
                      label="Received by (staff)"
                      name="staffName"
                      value={staffName}
                      onChange={setStaffName}
                      autoComplete="off"
                      placeholder="Optional"
                    />
                    <TextField
                      label="Receipt date"
                      name="receiptDate"
                      type="date"
                      value={receiptDate}
                      onChange={setReceiptDate}
                      autoComplete="off"
                      error={errors.receiptDate}
                      helpText="Defaults to today. Change only to backdate."
                    />
                  </InlineGrid>

                  <TextField
                    label="Note"
                    name="note"
                    value={note}
                    onChange={setNote}
                    autoComplete="off"
                    multiline={2}
                    placeholder="e.g. Advance for Quechua tent, size L — to be collected next week"
                  />
                </BlockStack>
              </Card>

              {/* ---------------- What the advance is for ---------------- */}
              <Card>
                <BlockStack gap="300">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">What is this advance for?</Text>
                    <Text as="p" tone="subdued" variant="bodySm">
                      Optional, and for your reference only — recording a product here
                      does <b>not</b> reserve or change stock in any way. It just tells you
                      months later what the customer was waiting for.
                    </Text>
                  </BlockStack>

                  <ChoiceList
                    title="Product"
                    titleHidden
                    choices={[
                      { label: "Not specified", value: "none" },
                      { label: "A product already in Shopify (including out of stock)", value: "listed" },
                      { label: "Something not listed in Shopify yet", value: "unlisted" },
                    ]}
                    selected={[productChoice]}
                    onChange={(v) => {
                      setProductChoice(v[0]);
                      setProduct(null);
                      setVariantId("");
                    }}
                  />

                  {productChoice === "listed" && (
                    <BlockStack gap="300">
                      {product ? (
                        <Box
                          padding="300"
                          background="bg-surface-secondary"
                          borderRadius="200"
                          borderWidth="025"
                          borderColor="border"
                        >
                          <InlineStack align="space-between" blockAlign="center" gap="300">
                            <InlineStack gap="300" blockAlign="center">
                              {product.image && (
                                <Thumbnail source={product.image} alt="" size="small" />
                              )}
                              <BlockStack gap="050">
                                <Text as="p" variant="headingSm">{product.title}</Text>
                                <InlineStack gap="200">
                                  <Badge tone={product.totalInventory > 0 ? "success" : "attention"}>
                                    {product.totalInventory > 0
                                      ? `${product.totalInventory} in stock`
                                      : "Out of stock"}
                                  </Badge>
                                  {product.vendor && (
                                    <Text as="span" tone="subdued" variant="bodySm">
                                      {product.vendor}
                                    </Text>
                                  )}
                                </InlineStack>
                              </BlockStack>
                            </InlineStack>
                            <Button onClick={() => { setProduct(null); setVariantId(""); setProductTerm(""); }}>
                              Change
                            </Button>
                          </InlineStack>
                        </Box>
                      ) : (
                        <BlockStack gap="300">
                          <TextField
                            label="Search products by title or SKU"
                            value={productTerm}
                            onChange={setProductTerm}
                            autoComplete="off"
                            placeholder="e.g. tent, sleeping bag, TENT-BL-L"
                            helpText="Out-of-stock products are included on purpose."
                          />
                          {productSearch.state === "loading" && (
                            <Text as="p" tone="subdued" variant="bodySm">Searching…</Text>
                          )}
                          {productResults.map((p) => (
                            <Box
                              key={p.id}
                              padding="300"
                              background="bg-surface-secondary"
                              borderRadius="200"
                              borderWidth="025"
                              borderColor="border"
                            >
                              <InlineStack align="space-between" blockAlign="center" gap="300">
                                <InlineStack gap="300" blockAlign="center">
                                  {p.image && <Thumbnail source={p.image} alt="" size="small" />}
                                  <BlockStack gap="050">
                                    <Text as="p" variant="bodyMd" fontWeight="semibold">
                                      {p.title}
                                    </Text>
                                    <InlineStack gap="200">
                                      <Badge tone={p.totalInventory > 0 ? "success" : "attention"}>
                                        {p.totalInventory > 0
                                          ? `${p.totalInventory} in stock`
                                          : "Out of stock"}
                                      </Badge>
                                      {p.status !== "ACTIVE" && <Badge>{p.status}</Badge>}
                                    </InlineStack>
                                  </BlockStack>
                                </InlineStack>
                                <Button
                                  onClick={() => {
                                    setProduct(p);
                                    setVariantId(p.variants[0]?.id || p.defaultVariant?.id || "");
                                  }}
                                >
                                  Select
                                </Button>
                              </InlineStack>
                            </Box>
                          ))}
                          {productSearch.state === "idle" &&
                            productTerm.trim().length >= 2 &&
                            productResults.length === 0 && (
                              <Banner tone="info">
                                <Text as="p">
                                  Nothing matched “{productTerm}”. If it isn’t in Shopify yet,
                                  choose “Something not listed in Shopify yet” above and type
                                  the name instead.
                                </Text>
                              </Banner>
                            )}
                        </BlockStack>
                      )}

                      {product && product.variants.length > 0 && (
                        <Select
                          label="Variant"
                          options={product.variants.map((v) => ({
                            label: `${v.title}${v.sku ? ` · ${v.sku}` : ""} — ${
                              v.inventory > 0 ? `${v.inventory} in stock` : "out of stock"
                            }`,
                            value: v.id,
                          }))}
                          value={variantId}
                          onChange={setVariantId}
                        />
                      )}
                    </BlockStack>
                  )}

                  {productChoice === "unlisted" && (
                    <TextField
                      label="Product name"
                      value={productTitleManual}
                      onChange={setProductTitleManual}
                      autoComplete="off"
                      placeholder="e.g. Quechua MH500 trekking pole (to be ordered)"
                      helpText="Free text — this product doesn’t need to exist in Shopify."
                    />
                  )}

                  {productChoice !== "none" && (
                    <TextField
                      label="Size, colour, quantity or other details"
                      value={productSpec}
                      onChange={setProductSpec}
                      autoComplete="off"
                      placeholder="e.g. Size L, blue, 2 pcs — expected by 20 Sep"
                    />
                  )}
                </BlockStack>
              </Card>

              {/* Hidden customer payload */}
              <input type="hidden" name="customerId" value={customer?.id || ""} />
              <input type="hidden" name="customerName" value={customer?.name || ""} />
              <input type="hidden" name="customerPhone" value={customer?.phone || ""} />
              <input type="hidden" name="customerEmail" value={customer?.email || ""} />

              {/* Hidden product payload — reference only, never touches inventory */}
              <input type="hidden" name="productChoice" value={productChoice} />
              <input type="hidden" name="productId" value={product?.id || ""} />
              <input type="hidden" name="productTitle" value={product?.title || ""} />
              <input type="hidden" name="productVariantId" value={selectedVariant?.id || ""} />
              <input type="hidden" name="productVariantTitle" value={selectedVariant?.title || ""} />
              <input type="hidden" name="productSku" value={selectedVariant?.sku || ""} />
              <input type="hidden" name="productTitleManual" value={productTitleManual} />
              <input type="hidden" name="productSpec" value={productSpec} />
              <input
                type="hidden"
                name="receiptDateIsToday"
                value={receiptDate === todayLocalISO() ? "1" : "0"}
              />

              <InlineStack align="end" gap="200">
                <Button url="/app/advances">Cancel</Button>
                <Button
                  submit
                  variant="primary"
                  loading={saving}
                  disabled={!customer || !parsedPreview.ok}
                >
                  Save &amp; print receipt
                </Button>
              </InlineStack>
            </BlockStack>
          </Form>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">How this works</Text>
              <Text as="p" variant="bodySm" tone="subdued">
                1. You collect the money now and hand over this receipt.
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                2. The amount is added to the customer’s credit balance in this app.
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                3. When they buy later, tender that order in POS using the{" "}
                <b>“{settings.tenderNames}”</b> custom payment type. The app draws the amount
                down automatically, oldest receipt first.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
