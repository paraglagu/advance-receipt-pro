/**
 * Thin wrapper over the Admin GraphQL customer queries.
 * Everything returns the *numeric* customer id, because that's what we store
 * on receipts and ledger rows — GIDs change shape between API versions.
 */

export function numericId(gid) {
  if (!gid) return null;
  const str = String(gid);
  const idx = str.lastIndexOf("/");
  return idx === -1 ? str : str.slice(idx + 1);
}

export function toCustomerGid(id) {
  if (!id) return null;
  return String(id).startsWith("gid://") ? String(id) : `gid://shopify/Customer/${id}`;
}

const CUSTOMER_FIELDS = `
  id
  displayName
  firstName
  lastName
  email
  phone
  numberOfOrders
  defaultAddress { city province zip }
`;

/**
 * POS customers are very often phone-only with no name, so the search covers
 * phone and email as well as name, and the label falls back sensibly.
 */
export async function searchCustomers(admin, term, { first = 20 } = {}) {
  const cleaned = String(term || "").trim();
  const query = cleaned
    ? `first_name:*${cleaned}* OR last_name:*${cleaned}* OR email:*${cleaned}* OR phone:*${cleaned}*`
    : "";

  const response = await admin.graphql(
    `#graphql
     query SearchCustomers($query: String!, $first: Int!) {
       customers(first: $first, query: $query, sortKey: RELEVANCE) {
         edges { node { ${CUSTOMER_FIELDS} } }
       }
     }`,
    { variables: { query, first } },
  );

  const body = await response.json();
  const edges = body?.data?.customers?.edges || [];
  return edges.map((e) => shapeCustomer(e.node));
}

export async function getCustomer(admin, id) {
  const response = await admin.graphql(
    `#graphql
     query GetCustomer($id: ID!) {
       customer(id: $id) { ${CUSTOMER_FIELDS} }
     }`,
    { variables: { id: toCustomerGid(id) } },
  );
  const body = await response.json();
  const node = body?.data?.customer;
  return node ? shapeCustomer(node) : null;
}

function shapeCustomer(node) {
  const name =
    node.displayName?.trim() ||
    [node.firstName, node.lastName].filter(Boolean).join(" ").trim() ||
    node.phone ||
    node.email ||
    "Unnamed customer";

  const place = node.defaultAddress
    ? [node.defaultAddress.city, node.defaultAddress.province].filter(Boolean).join(", ")
    : null;

  return {
    id: numericId(node.id),
    gid: node.id,
    name,
    email: node.email || null,
    phone: node.phone || null,
    orders: Number(node.numberOfOrders || 0),
    place: place || null,
  };
}
