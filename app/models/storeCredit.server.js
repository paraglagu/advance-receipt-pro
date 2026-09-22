import { getCustomerBalance } from "./ledger.server";
import { getSettings } from "./settings.server";
import { toCustomerGid } from "./customer.server";
import { toPaise } from "../utils/money";

/**
 * Mirrors each customer's advance balance into their Shopify store credit
 * account, purely so the cashier can SEE it in POS when they add the customer.
 *
 * Payment still goes through the "Advance Adjusted" manual tender, which costs
 * nothing. Redeeming native store credit would attract a third-party
 * transaction fee on this shop (created after 12 May 2025, Basic plan), so the
 * mirror is for visibility only.
 *
 * This app's own ledger is the source of truth. The mirror is always driven
 * from it as a *delta to the target balance*, never as a running total, so:
 *   - it is idempotent — running it twice changes nothing the second time
 *   - it self-heals — any drift, from whatever cause, corrects on the next run
 *   - a failure is never fatal; the ledger stands on its own
 */

const CURRENCY = "INR";

/** Reads the customer's Shopify store credit account, if they have one. */
export async function readShopifyStoreCredit(admin, customerId) {
  const response = await admin.graphql(
    `#graphql
     query CustomerStoreCredit($id: ID!) {
       customer(id: $id) {
         id
         storeCreditAccounts(first: 10) {
           edges { node { id balance { amount currencyCode } } }
         }
       }
     }`,
    { variables: { id: toCustomerGid(customerId) } },
  );

  const body = await response.json();
  if (body?.errors?.length) {
    throw new Error(body.errors.map((e) => e.message).join("; "));
  }

  const edges = body?.data?.customer?.storeCreditAccounts?.edges || [];
  // A customer can hold accounts in several currencies; only ours matters.
  const match =
    edges.find((e) => e.node.balance?.currencyCode === CURRENCY) || edges[0];

  return {
    accountId: match?.node?.id || null,
    balancePaise: match ? toPaise(match.node.balance?.amount) : 0,
  };
}

async function creditCustomer(admin, customerId, paise) {
  const response = await admin.graphql(
    `#graphql
     mutation CreditStoreCredit($id: ID!, $creditInput: StoreCreditAccountCreditInput!) {
       storeCreditAccountCredit(id: $id, creditInput: $creditInput) {
         storeCreditAccountTransaction {
           account { id balance { amount currencyCode } }
         }
         userErrors { message field }
       }
     }`,
    {
      variables: {
        // Passing the customer id creates the account if they don't have one.
        id: toCustomerGid(customerId),
        creditInput: {
          creditAmount: { amount: (paise / 100).toFixed(2), currencyCode: CURRENCY },
        },
      },
    },
  );

  const body = await response.json();
  const errors = body?.data?.storeCreditAccountCredit?.userErrors || [];
  if (errors.length) throw new Error(errors.map((e) => e.message).join("; "));
  if (body?.errors?.length) {
    throw new Error(body.errors.map((e) => e.message).join("; "));
  }
}

async function debitAccount(admin, accountId, paise) {
  const response = await admin.graphql(
    `#graphql
     mutation DebitStoreCredit($id: ID!, $debitInput: StoreCreditAccountDebitInput!) {
       storeCreditAccountDebit(id: $id, debitInput: $debitInput) {
         storeCreditAccountTransaction {
           account { id balance { amount currencyCode } }
         }
         userErrors { message field }
       }
     }`,
    {
      variables: {
        // Debit works on the ACCOUNT id, unlike credit which takes the customer.
        id: accountId,
        debitInput: {
          debitAmount: { amount: (paise / 100).toFixed(2), currencyCode: CURRENCY },
        },
      },
    },
  );

  const body = await response.json();
  const errors = body?.data?.storeCreditAccountDebit?.userErrors || [];
  if (errors.length) throw new Error(errors.map((e) => e.message).join("; "));
  if (body?.errors?.length) {
    throw new Error(body.errors.map((e) => e.message).join("; "));
  }
}

/**
 * Brings Shopify's store credit into line with our ledger for one customer.
 * Returns what it did, for logging and tests.
 */
export async function syncStoreCredit(admin, shop, customerId, { enabled = true } = {}) {
  if (!enabled) return { skipped: "disabled" };
  if (!admin || !customerId) return { skipped: "no-admin-or-customer" };

  try {
    const target = await getCustomerBalance(shop, customerId);
    const { accountId, balancePaise: current } = await readShopifyStoreCredit(
      admin,
      customerId,
    );

    const delta = target - current;
    if (delta === 0) return { ok: true, action: "none", targetPaise: target };

    if (delta > 0) {
      await creditCustomer(admin, customerId, delta);
      return { ok: true, action: "credit", deltaPaise: delta, targetPaise: target };
    }

    if (!accountId) {
      // Nothing to debit from — Shopify is already at zero.
      return { ok: true, action: "none", targetPaise: target };
    }
    // Never try to debit more than Shopify actually holds.
    const debit = Math.min(-delta, current);
    if (debit <= 0) return { ok: true, action: "none", targetPaise: target };

    await debitAccount(admin, accountId, debit);
    return { ok: true, action: "debit", deltaPaise: -debit, targetPaise: target };
  } catch (e) {
    // Visibility is a convenience. Losing it must never break taking money,
    // and the next sync will correct whatever this run missed.
    console.error(
      `[store credit] sync failed for customer ${customerId} on ${shop}:`,
      e.message,
    );
    return { ok: false, error: e.message };
  }
}

/** Convenience wrapper that respects the shop's mirrorStoreCredit setting. */
export async function syncStoreCreditForShop(admin, shop, customerId) {
  if (!customerId) return { skipped: "no-customer" };
  const settings = await getSettings(shop);
  return syncStoreCredit(admin, shop, customerId, {
    enabled: settings.mirrorStoreCredit,
  });
}
