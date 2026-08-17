import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { searchProducts } from "../models/product.server";

/** Resource route used by the product picker on the New advance screen. */
export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const term = new URL(request.url).searchParams.get("q") || "";

  if (term.trim().length < 2) return json({ products: [] });

  const products = await searchProducts(admin, term);
  return json({ products });
};
