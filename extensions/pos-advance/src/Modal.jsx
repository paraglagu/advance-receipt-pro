import { render } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";

export default async () => {
  render(<Extension />, document.body);
};

const rupees = (paise) =>
  `₹${((paise || 0) / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

// The POS webview has its own origin, so backend calls must be absolute.
// Set this to your deployed app URL (same value as SHOPIFY_APP_URL).
const APP_URL = "https://advance-receipt-pro.onrender.com";

/**
 * Session-token auth against our own backend, matched by
 * `authenticate.public.pos()` in app/routes/api.pos.*.
 *
 * The Session API's exact method name is the one piece of this extension the
 * docs wouldn't confirm, so we probe the couple of shapes it ships as rather
 * than hard-coding a guess that fails silently at the till.
 */
async function sessionToken() {
  const s = globalThis.shopify;
  if (s?.session?.getSessionToken) return s.session.getSessionToken();
  if (s?.session?.token) return s.session.token();
  if (s?.getSessionToken) return s.getSessionToken();
  throw new Error("Could not obtain a session token from the POS host.");
}

async function api(path, options = {}) {
  const token = await sessionToken();
  const base = globalThis.shopify?.environment?.appUrl || APP_URL;
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

const Extension = () => {
  const [step, setStep] = useState("customer"); // customer | amount | done
  const [term, setTerm] = useState("");
  const [customers, setCustomers] = useState([]);
  const [searching, setSearching] = useState(false);
  const [customer, setCustomer] = useState(null);

  const [amount, setAmount] = useState("");
  const [productNote, setProductNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [reserved, setReserved] = useState(null);

  // Debounced customer lookup.
  useEffect(() => {
    if (step !== "customer" || term.trim().length < 2) {
      setCustomers([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const data = await api(`/api/pos/customers?q=${encodeURIComponent(term)}`);
        if (!cancelled) setCustomers(data.customers || []);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [term, step]);

  const addToCart = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const result = await api("/api/pos/advance", {
        method: "POST",
        body: JSON.stringify({
          customerId: customer.id,
          customerName: customer.name,
          customerPhone: customer.phone,
          customerEmail: customer.email,
          amount,
          productTitle: productNote || null,
          productSpec: null,
        }),
      });

      // Attach the customer so the advance lands on their ledger, drop a
      // non-taxable line for the money, and stamp the cart so the order
      // webhook can find this reservation again.
      await shopify.cart.setCustomer({ id: Number(customer.id) });
      await shopify.cart.addCustomSale({
        title: result.lineTitle,
        price: result.price,
        quantity: 1,
        taxable: false,
      });
      await shopify.cart.addCartProperties({
        _advance_receipt_ids: result.receiptId,
      });

      setReserved(result);
      setStep("done");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [customer, amount, productNote]);

  /* ------------------------------ Screens ----------------------------- */

  if (step === "done" && reserved) {
    return (
      <s-page heading="Added to cart">
        <s-scroll-box>
          <s-section heading="Ready to take payment">
            <s-stack direction="block" gap="base">
              <s-text>
                {`${rupees(Math.round(Number(amount) * 100))} for ${customer.name} is on the cart as a non-taxable line.`}
              </s-text>
              <s-banner tone="info">
                <s-text>
                  Close this and tender the cart as Cash or UPI. The receipt number is
                  issued once payment goes through — then print it from the order, or
                  from Receipts in the app.
                </s-text>
              </s-banner>
              <s-button
                variant="primary"
                onClick={() => {
                  shopify.action.dismissModal();
                }}
              >
                Back to cart
              </s-button>
              <s-button
                onClick={async () => {
                  try {
                    await shopify.printing.print(reserved.printPath);
                  } catch (e) {
                    setError(e.message);
                  }
                }}
              >
                Print receipt
              </s-button>
              {error && <s-banner tone="critical"><s-text>{error}</s-text></s-banner>}
            </s-stack>
          </s-section>
        </s-scroll-box>
      </s-page>
    );
  }

  if (step === "amount" && customer) {
    return (
      <s-page heading="Advance amount">
        <s-scroll-box>
          <s-section heading={customer.name}>
            <s-stack direction="block" gap="base">
              <s-text tone="subdued">
                {customer.phone || customer.email || "No contact details"}
              </s-text>
              {customer.balancePaise > 0 && (
                <s-banner tone="info">
                  <s-text>{`Already holds ${rupees(customer.balancePaise)} in advances.`}</s-text>
                </s-banner>
              )}

              <s-number-field
                label="Amount (₹)"
                value={amount}
                onChange={(e) => setAmount(e.currentTarget.value)}
              />

              <s-text-field
                label="What is it for? (optional)"
                value={productNote}
                placeholder="e.g. Quechua MH500 tent, size L"
                onChange={(e) => setProductNote(e.currentTarget.value)}
              />

              {error && <s-banner tone="critical"><s-text>{error}</s-text></s-banner>}

              <s-button
                variant="primary"
                disabled={busy || !(Number(amount) > 0)}
                onClick={addToCart}
              >
                {busy ? "Adding…" : "Add to cart"}
              </s-button>
              <s-button
                onClick={() => {
                  setStep("customer");
                  setCustomer(null);
                  setError(null);
                }}
              >
                Change customer
              </s-button>
            </s-stack>
          </s-section>
        </s-scroll-box>
      </s-page>
    );
  }

  return (
    <s-page heading="Take advance">
      <s-scroll-box>
        <s-section heading="Who is paying?">
          <s-stack direction="block" gap="base">
            <s-search-field
              label="Search by name or phone"
              value={term}
              placeholder="e.g. 98765 43210"
              onChange={(e) => setTerm(e.currentTarget.value)}
            />

            {searching && <s-text tone="subdued">Searching…</s-text>}
            {error && <s-banner tone="critical"><s-text>{error}</s-text></s-banner>}

            {!searching && term.trim().length >= 2 && customers.length === 0 && (
              <s-banner tone="warning">
                <s-text>
                  No customer found. Add them to the cart in POS first — an advance has
                  to belong to a customer so it can be redeemed later.
                </s-text>
              </s-banner>
            )}

            {customers.map((c) => (
              <s-clickable
                key={c.id}
                onClick={() => {
                  setCustomer(c);
                  setStep("amount");
                  setError(null);
                }}
              >
                <s-box padding="base">
                  <s-stack direction="block" gap="tight">
                    <s-text>{c.name}</s-text>
                    <s-text tone="subdued">{c.phone || c.email || "—"}</s-text>
                    {c.balancePaise > 0 && (
                      <s-badge tone="success">{`Credit ${rupees(c.balancePaise)}`}</s-badge>
                    )}
                  </s-stack>
                </s-box>
              </s-clickable>
            ))}
          </s-stack>
        </s-section>
      </s-scroll-box>
    </s-page>
  );
};
