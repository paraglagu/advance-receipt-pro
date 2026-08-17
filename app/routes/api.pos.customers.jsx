import { json } from "@remix-run/node";
import { authenticate, unauthenticated } from "../shopify.server";
import { searchCustomers } from "../models/customer.server";
import { getCustomerBalance } from "../models/ledger.server";

/**
 * Customer lookup for the POS extension, with each customer's current advance
 * balance attached so the cashier can see it before taking more money.
 */
export const loader = async ({ request }) => {
  const { sessionToken, cors } = await authenticate.public.pos(request);
  const shop = sessionToken.dest;

  const term = new URL(request.url).searchParams.get("q") || "";
  if (term.trim().length < 2) return cors(json({ customers: [] }));

  // The session token proves who's calling; the Admin API call needs the
  // shop's stored offline token.
  const { admin } = await unauthenticated.admin(shop);

  const customers = await searchCustomers(admin, term, { first: 15 });
  const withBalances = await Promise.all(
    customers.map(async (c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      balancePaise: await getCustomerBalance(shop, c.id),
    })),
  );

  return cors(json({ customers: withBalances }));
};
