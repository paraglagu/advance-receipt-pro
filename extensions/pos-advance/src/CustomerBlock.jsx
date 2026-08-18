import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

export default async () => {
  render(<Extension />, document.body);
};

// Must match APP_URL in Modal.jsx — your deployed app URL.
const APP_URL = "https://advance-receipt-pro.onrender.com";

const rupees = (paise) =>
  `₹${((paise || 0) / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/** The Session API's exact shape isn't documented; probe rather than guess. */
async function sessionToken() {
  const s = globalThis.shopify;
  if (s?.session?.getSessionToken) return s.session.getSessionToken();
  if (s?.session?.token) return s.session.token();
  if (s?.getSessionToken) return s.getSessionToken();
  throw new Error("No session token available from the POS host.");
}

/**
 * The customer whose screen we're rendering on. POS exposes this differently
 * across versions, so read whichever shape is present instead of assuming one.
 */
function currentCustomerId() {
  const s = globalThis.shopify;
  const raw =
    s?.customer?.id ??
    s?.data?.customer?.id ??
    s?.target?.customer?.id ??
    null;
  if (!raw) return null;
  // Accept either a numeric id or a GID.
  return String(raw).replace(/^gid:\/\/shopify\/Customer\//, "");
}

const Extension = () => {
  const [state, setState] = useState({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const customerId = currentCustomerId();
        if (!customerId) {
          if (!cancelled) setState({ status: "no-customer" });
          return;
        }

        const token = await sessionToken();
        const base = globalThis.shopify?.environment?.appUrl || APP_URL;
        const response = await fetch(`${base}/api/pos/balance/${customerId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || `Failed (${response.status})`);

        if (!cancelled) setState({ status: "ready", data: body });
      } catch (e) {
        if (!cancelled) setState({ status: "error", message: e.message });
      }
    })();

    return () => { cancelled = true; };
  }, []);

  if (state.status === "loading") {
    return (
      <s-section heading="Advance balance">
        <s-text tone="subdued">Checking…</s-text>
      </s-section>
    );
  }

  // Nothing useful to say without a customer — stay quiet rather than shout.
  if (state.status === "no-customer") return null;

  if (state.status === "error") {
    return (
      <s-section heading="Advance balance">
        <s-text tone="critical">{`Couldn't load: ${state.message}`}</s-text>
      </s-section>
    );
  }

  const { balancePaise, openReceipts, openCount } = state.data;

  if (!balancePaise || balancePaise <= 0) {
    return (
      <s-section heading="Advance balance">
        <s-stack direction="block" gap="tight">
          <s-text tone="subdued">No advance balance.</s-text>
          <s-text tone="subdued">
            Do not tender this order with Advance Adjusted.
          </s-text>
        </s-stack>
      </s-section>
    );
  }

  return (
    <s-section heading="Advance balance">
      <s-stack direction="block" gap="base">
        <s-text>{rupees(balancePaise)}</s-text>

        <s-banner tone="warning">
          <s-text>
            {`Tender at most ${rupees(balancePaise)} as "Advance Adjusted". POS will let you mark more than this as paid — it won't check. Collect anything above it by cash, UPI or card.`}
          </s-text>
        </s-banner>

        {openCount > 0 && (
          <s-stack direction="block" gap="tight">
            <s-text tone="subdued">
              {`${openCount} unused receipt${openCount === 1 ? "" : "s"} — spent oldest first:`}
            </s-text>
            {openReceipts.slice(0, 5).map((r) => (
              <s-text key={r.receiptNo} tone="subdued">
                {`${r.receiptNo} · ${rupees(r.availablePaise)}${r.productTitle ? ` · ${r.productTitle}` : ""}`}
              </s-text>
            ))}
          </s-stack>
        )}
      </s-stack>
    </s-section>
  );
};
