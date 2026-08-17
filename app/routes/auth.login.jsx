import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import {
  AppProvider,
  Button,
  Card,
  FormLayout,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { login } from "../shopify.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }) => {
  const errors = loginErrorMessage(await login(request));
  return json({ errors, polarisTranslations: {} });
};

export const action = async ({ request }) => {
  const errors = loginErrorMessage(await login(request));
  return json({ errors });
};

function loginErrorMessage(loginErrors) {
  if (loginErrors?.shop === "MISSING_SHOP") {
    return { shop: "Please enter your shop domain to log in" };
  } else if (loginErrors?.shop === "INVALID_SHOP") {
    return { shop: "Please enter a valid shop domain to log in" };
  }
  return {};
}

export default function Auth() {
  const loaderData = useLoaderData();
  const actionData = useActionData();
  const errors = actionData?.errors || loaderData?.errors || {};

  return (
    <AppProvider i18n={{}}>
      <Page>
        <Card>
          <Form method="post">
            <FormLayout>
              <Text variant="headingMd" as="h2">
                Log in to Advance Receipt Pro
              </Text>
              <TextField
                type="text"
                name="shop"
                label="Shop domain"
                helpText="example.myshopify.com"
                autoComplete="on"
                error={errors.shop}
              />
              <Button submit>Log in</Button>
            </FormLayout>
          </Form>
        </Card>
      </Page>
    </AppProvider>
  );
}
