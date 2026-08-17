import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { searchCustomers } from "../models/customer.server";
import { getCustomerBalance } from "../models/ledger.server";

/** Resource route used by the customer picker on the New advance screen. */
export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const term = new URL(request.url).searchParams.get("q") || "";

  if (term.trim().length < 2) return json({ customers: [] });

  const customers = await searchCustomers(admin, term);
  const withBalances = await Promise.all(
    customers.map(async (c) => ({
      ...c,
      balancePaise: await getCustomerBalance(session.shop, c.id),
    })),
  );

  return json({ customers: withBalances });
};
