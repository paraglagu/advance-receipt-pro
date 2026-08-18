import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  Checkbox,
  InlineGrid,
  InlineStack,
  Layout,
  Page,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { useCallback, useState } from "react";
import { authenticate } from "../shopify.server";
import { getSettings, saveSettings } from "../models/settings.server";
import { formatReceiptNo } from "../utils/domain";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);
  return json({ settings, shop: session.shop });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const str = (k) => String(form.get(k) ?? "").trim();

  const nextReceiptNo = Number(form.get("nextReceiptNo"));
  const receiptPadding = Number(form.get("receiptPadding"));

  const errors = {};
  if (!Number.isInteger(nextReceiptNo) || nextReceiptNo < 1) {
    errors.nextReceiptNo = "Next number must be a whole number of 1 or more";
  }
  if (!Number.isInteger(receiptPadding) || receiptPadding < 1 || receiptPadding > 10) {
    errors.receiptPadding = "Padding must be between 1 and 10";
  }
  if (!str("tenderNames")) {
    errors.tenderNames = "At least one tender name is required, or advances can never be redeemed";
  }

  if (Object.keys(errors).length > 0) {
    return json({ errors }, { status: 400 });
  }

  await saveSettings(session.shop, {
    storeName: str("storeName") || null,
    storeAddress: str("storeAddress") || null,
    storeCity: str("storeCity") || null,
    storeState: str("storeState") || null,
    storePincode: str("storePincode") || null,
    storeTel: str("storeTel") || null,
    storeEmail: str("storeEmail") || null,
    storeGstin: str("storeGstin") || null,
    logoUrl: str("logoUrl") || null,

    receiptPrefix: str("receiptPrefix"),
    receiptSuffix: str("receiptSuffix"),
    nextReceiptNo,
    receiptPadding,

    pageSize: str("pageSize") || "THERMAL80",
    showLogo: form.get("showLogo") === "on",

    tenderNames: str("tenderNames"),
    autoApply: form.get("autoApply") === "on",

    declarationText: str("declarationText"),
    termsText: str("termsText"),
    footerText: str("footerText"),
    poweredByText: str("poweredByText"),
  });

  return json({ ok: true });
};

/**
 * Every field is controlled from one state object.
 *
 * Polaris TextField has no `defaultValue` — it always renders `value`, so an
 * uncontrolled field sits empty and silently swallows typing.
 */
export default function SettingsPage() {
  const { settings } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";
  const errors = actionData?.errors || {};

  const [form, setForm] = useState(() => ({
    storeName: settings.storeName || "",
    storeAddress: settings.storeAddress || "",
    storeCity: settings.storeCity || "",
    storeState: settings.storeState || "",
    storePincode: settings.storePincode || "",
    storeTel: settings.storeTel || "",
    storeEmail: settings.storeEmail || "",
    storeGstin: settings.storeGstin || "",
    logoUrl: settings.logoUrl || "",

    receiptPrefix: settings.receiptPrefix || "",
    receiptSuffix: settings.receiptSuffix || "",
    nextReceiptNo: String(settings.nextReceiptNo ?? 1),
    receiptPadding: String(settings.receiptPadding ?? 4),

    pageSize: settings.pageSize || "THERMAL80",
    showLogo: Boolean(settings.showLogo),

    tenderNames: settings.tenderNames || "",
    autoApply: Boolean(settings.autoApply),

    declarationText: settings.declarationText || "",
    termsText: settings.termsText || "",
    footerText: settings.footerText || "",
    poweredByText: settings.poweredByText || "",
  }));

  const set = useCallback(
    (key) => (value) => setForm((prev) => ({ ...prev, [key]: value })),
    [],
  );

  const preview = formatReceiptNo(
    {
      receiptPrefix: form.receiptPrefix,
      receiptSuffix: form.receiptSuffix,
      receiptPadding: Number(form.receiptPadding) || 4,
    },
    Number(form.nextReceiptNo) || 1,
  );

  return (
    <Page title="Settings">
      <Form method="post">
        <Layout>
          <Layout.Section>
            <BlockStack gap="400">
              {actionData?.ok && <Banner tone="success" title="Settings saved" />}
              {Object.keys(errors).length > 0 && (
                <Banner tone="critical" title="Fix these first">
                  <BlockStack gap="100">
                    {Object.values(errors).map((e, i) => <Text as="p" key={i}>{e}</Text>)}
                  </BlockStack>
                </Banner>
              )}

              {/* ---------- POS redemption ---------- */}
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Redeeming advances at POS</Text>
                  <Banner tone="info">
                    <Text as="p">
                      Add this as a <b>custom payment type in your Point of Sale
                      channel settings</b> — not under Settings → Payments, which only
                      covers online checkout and never reaches the till. At the POS
                      till, tender the order with it for the amount the customer wants
                      to use from their advance.
                    </Text>
                  </Banner>
                  <TextField
                    label="Custom payment method name(s)"
                    name="tenderNames"
                    value={form.tenderNames}
                    onChange={set("tenderNames")}
                    autoComplete="off"
                    error={errors.tenderNames}
                    helpText="Comma-separate if you use more than one name. Matching ignores case."
                  />
                  <Checkbox
                    label="Apply advances automatically when a matching order comes in"
                    name="autoApply"
                    checked={form.autoApply}
                    onChange={set("autoApply")}
                    helpText="Turn off only if you want to reconcile every order by hand."
                  />
                </BlockStack>
              </Card>

              {/* ---------- Receipt series ---------- */}
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Receipt number series</Text>
                  <InlineGrid columns={{ xs: 1, sm: 4 }} gap="300">
                    <TextField
                      label="Prefix" name="receiptPrefix"
                      value={form.receiptPrefix} onChange={set("receiptPrefix")}
                      autoComplete="off"
                    />
                    <TextField
                      label="Next number" name="nextReceiptNo" type="number"
                      value={form.nextReceiptNo} onChange={set("nextReceiptNo")}
                      autoComplete="off" error={errors.nextReceiptNo}
                    />
                    <TextField
                      label="Digits" name="receiptPadding" type="number"
                      value={form.receiptPadding} onChange={set("receiptPadding")}
                      autoComplete="off" error={errors.receiptPadding}
                    />
                    <TextField
                      label="Suffix" name="receiptSuffix" placeholder="/26-27"
                      value={form.receiptSuffix} onChange={set("receiptSuffix")}
                      autoComplete="off"
                    />
                  </InlineGrid>
                  <Text as="p" tone="subdued" variant="bodySm">
                    Next receipt will be issued as <b>{preview}</b>. Numbers are never reused, and
                    two tills saving at the same moment can’t collide.
                  </Text>
                </BlockStack>
              </Card>

              {/* ---------- Store identity ---------- */}
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Store details on the receipt</Text>
                  <TextField
                    label="Store name" name="storeName"
                    value={form.storeName} onChange={set("storeName")} autoComplete="off"
                  />
                  <TextField
                    label="Address" name="storeAddress" multiline={2}
                    value={form.storeAddress} onChange={set("storeAddress")} autoComplete="off"
                  />
                  <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
                    <TextField
                      label="City" name="storeCity"
                      value={form.storeCity} onChange={set("storeCity")} autoComplete="off"
                    />
                    <TextField
                      label="State" name="storeState"
                      value={form.storeState} onChange={set("storeState")} autoComplete="off"
                    />
                    <TextField
                      label="PIN code" name="storePincode"
                      value={form.storePincode} onChange={set("storePincode")} autoComplete="off"
                    />
                  </InlineGrid>
                  <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
                    <TextField
                      label="Phone" name="storeTel"
                      value={form.storeTel} onChange={set("storeTel")} autoComplete="off"
                    />
                    <TextField
                      label="Email" name="storeEmail"
                      value={form.storeEmail} onChange={set("storeEmail")} autoComplete="off"
                    />
                    <TextField
                      label="GSTIN" name="storeGstin"
                      value={form.storeGstin} onChange={set("storeGstin")} autoComplete="off"
                    />
                  </InlineGrid>
                  <TextField
                    label="Logo URL" name="logoUrl"
                    value={form.logoUrl} onChange={set("logoUrl")} autoComplete="off"
                    helpText="A public image URL. Upload to Shopify Files and paste the link."
                  />
                </BlockStack>
              </Card>

              {/* ---------- Print ---------- */}
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Printing</Text>
                  <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                    <Select
                      label="Default receipt size"
                      name="pageSize"
                      options={[
                        { label: "80mm thermal roll (counter printer)", value: "THERMAL80" },
                        { label: "A5 voucher", value: "A5" },
                        { label: "A4 voucher", value: "A4" },
                      ]}
                      value={form.pageSize}
                      onChange={set("pageSize")}
                    />
                    <Checkbox
                      label="Show logo on receipts"
                      name="showLogo"
                      checked={form.showLogo}
                      onChange={set("showLogo")}
                    />
                  </InlineGrid>
                  <Text as="p" tone="subdued" variant="bodySm">
                    You can always override the size from the print screen.
                  </Text>
                </BlockStack>
              </Card>

              {/* ---------- Wording ---------- */}
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Receipt wording</Text>
                  <TextField
                    label="Declaration" name="declarationText" multiline={2}
                    value={form.declarationText} onChange={set("declarationText")}
                    autoComplete="off"
                  />
                  <TextField
                    label="Terms" name="termsText" multiline={3}
                    value={form.termsText} onChange={set("termsText")}
                    autoComplete="off"
                  />
                  <TextField
                    label="Footer" name="footerText"
                    value={form.footerText} onChange={set("footerText")}
                    autoComplete="off"
                  />
                  <TextField
                    label="Powered by line" name="poweredByText"
                    value={form.poweredByText} onChange={set("poweredByText")}
                    autoComplete="off"
                  />
                </BlockStack>
              </Card>

              <InlineStack align="end">
                <Button submit variant="primary" loading={saving}>Save settings</Button>
              </InlineStack>
            </BlockStack>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">A note on GST</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  For a supply of <b>goods</b>, GST is not payable at the time of receiving an
                  advance — tax applies when the invoice is raised on the later sale. So this
                  document is a receipt voucher, not a tax invoice, and shows no GST breakdown.
                  Your existing GST invoice app still handles the actual sale.
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  If you ever take advances against <b>services</b>, the treatment differs — check
                  with your accountant.
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Form>
    </Page>
  );
}
