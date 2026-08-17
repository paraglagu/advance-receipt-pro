import { numericId } from "./customer.server";

/**
 * Product lookup for the "what is this advance for?" field.
 *
 * Read-only and reference-only: nothing here reserves stock, adjusts inventory
 * or creates an order line. Out-of-stock products are deliberately included —
 * they're the common case, since an advance is usually taken precisely because
 * the item isn't on the shelf.
 */
export async function searchProducts(admin, term, { first = 15 } = {}) {
  const cleaned = String(term || "").trim();
  if (cleaned.length < 2) return [];

  const response = await admin.graphql(
    `#graphql
     query SearchProducts($query: String!, $first: Int!) {
       products(first: $first, query: $query) {
         edges {
           node {
             id
             title
             status
             totalInventory
             vendor
             featuredImage { url }
             variants(first: 25) {
               edges {
                 node { id title sku inventoryQuantity price }
               }
             }
           }
         }
       }
     }`,
    { variables: { query: `title:*${cleaned}* OR sku:*${cleaned}*`, first } },
  );

  const body = await response.json();
  const edges = body?.data?.products?.edges || [];

  return edges.map((e) => {
    const node = e.node;
    const variants = (node.variants?.edges || []).map((v) => ({
      id: numericId(v.node.id),
      title: v.node.title,
      sku: v.node.sku || null,
      inventory: v.node.inventoryQuantity ?? 0,
      price: v.node.price,
    }));

    return {
      id: numericId(node.id),
      title: node.title,
      status: node.status,
      vendor: node.vendor || null,
      totalInventory: node.totalInventory ?? 0,
      image: node.featuredImage?.url || null,
      // A single "Default Title" variant is noise in the picker.
      variants:
        variants.length === 1 && variants[0].title === "Default Title" ? [] : variants,
      defaultVariant: variants[0] || null,
    };
  });
}
