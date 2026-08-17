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
import { useState } from "react";
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

export default function SettingsPage() {
  const { settings } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";
  const errors = actionData?.errors || {};

  const [prefix, setPrefix] = useState(settings.receiptPrefix);
  const [suffix, setSuffix] = useState(settings.receiptSuffix);
  const [nextNo, setNextNo] = useState(String(settings.nextReceiptNo));
  const [padding, setPadding] = useState(String(settings.receiptPadding));
  const [pageSize, setPageSize] = useState(settings.pageSize);
  const [showLogo, setShowLogo] = useState(settings.showLogo);
  const [autoApply, setAutoApply] = useState(settings.autoApply);
  const [tenderNames, setTenderNames] = useState(settings.tenderNames);

  const preview = formatReceiptNo(
    { receiptPrefix: prefix, receiptSuffix: suffix, receiptPadding: Number(padding) || 4 },
    Number(nextNo) || 1,
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
                      In Shopify admin go to <b>Settings → Payments → Manual payment methods</b> and
                      add a custom payment method with exactly this name. At the POS till, tender
                      the order with it for the amount the customer wants to use from their advance.
                    </Text>
                  </Banner>
                  <TextField
                    label="Custom payment method name(s)"
                    name="tenderNames"
                    value={tenderNames}
                    onChange={setTenderNames}
                    autoComplete="off"
                    error={errors.tenderNames}
                    helpText="Comma-separate if you use more than one name. Matching ignores case."
                  />
                  <Checkbox
                    label="Apply advances automatically when a matching order comes in"
                    name="autoApply"
                    checked={autoApply}
                    onChange={setAutoApply}
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
                      label="Prefix" name="receiptPrefix" value={prefix}
                      onChange={setPrefix} autoComplete="off"
                    />
                    <TextField
                      label="Next number" name="nextReceiptNo" value={nextNo}
                      onChange={setNextNo} autoComplete="off" type="number"
                      error={errors.nextReceiptNo}
                    />
                    <TextField
                      label="Digits" name="receiptPadding" value={padding}
                      onChange={setPadding} autoComplete="off" type="number"
                      error={errors.receiptPadding}
                    />
                    <TextField
                      label="Suffix" name="receiptSuffix" value={suffix}
                      onChange={setSuffix} autoComplete="off" placeholder="/25-26"
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
                  <TextField label="Store name" name="storeName" defaultValue={settings.storeName || ""} autoComplete="off" />
                  <TextField label="Address" name="storeAddress" defaultValue={settings.storeAddress || ""} autoComplete="off" multiline={2} />
                  <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
                    <TextField label="City" name="storeCity" defaultValue={settings.storeCity || ""} autoComplete="off" />
                    <TextField label="State" name="storeState" defaultValue={settings.storeState || ""} autoComplete="off" />
                    <TextField label="PIN code" name="storePincode" defaultValue={settings.storePincode || ""} autoComplete="off" />
                  </InlineGrid>
                  <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
                    <TextField label="Phone" name="storeTel" defaultValue={settings.storeTel || ""} autoComplete="off" />
                    <TextField label="Email" name="storeEmail" defaultValue={settings.storeEmail || ""} autoComplete="off" />
                    <TextField label="GSTIN" name="storeGstin" defaultValue={settings.storeGstin || ""} autoComplete="off" />
                  </InlineGrid>
                  <TextField
                    label="Logo URL" name="logoUrl" defaultValue={settings.logoUrl || ""}
                    autoComplete="off"
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
                      value={pageSize}
                      onChange={setPageSize}
                    />
                    <Checkbox
                      label="Show logo on receipts"
                      name="showLogo"
                      checked={showLogo}
                      onChange={setShowLogo}
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
                    label="Declaration" name="declarationText"
                    defaultValue={settings.declarationText || ""} autoComplete="off" multiline={2}
                  />
                  <TextField
                    label="Terms" name="termsText"
                    defaultValue={settings.termsText || ""} autoComplete="off" multiline={3}
                  />
                  <TextField
                    label="Footer" name="footerText"
                    defaultValue={settings.footerText || ""} autoComplete="off"
                  />
                  <TextField
                    label="Powered by line" name="poweredByText"
                    defaultValue={settings.poweredByText || ""} autoComplete="off"
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
