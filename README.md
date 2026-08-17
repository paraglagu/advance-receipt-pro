# Advance Receipt Pro

A Shopify app for taking **advance payments** at the POS counter, issuing a
numbered printed receipt, and drawing that credit down against the customer's
later purchase.

Built as a sibling to `gst-invoice-pro` — same stack (Remix + Polaris + Prisma
on Render), but a separate app with its own database.

---

## The flow it supports

**1. Customer pays upfront.** They hand over ₹15,000 in cash or by UPI against a
tent you'll order in for them.

**2. You take it at the till.** Tap the **Take advance** tile on the POS smart
grid, pick the customer, enter the amount and what it's for. The extension drops
a **non-taxable line** onto the POS cart — "Advance received — Ramesh K,
₹15,000" — and you tender it as Cash or UPI exactly like any other sale.

Because it goes through the POS cart, **the money lands in that day's collections
and the cash drawer**, split by the tender the cashier actually used. Once the
order settles, the app issues receipt `ADV-0001`, credits the customer, and the
receipt prints to the counter printer straight from POS.

You can also record an advance from the admin app when someone pays by bank
transfer or over the phone.

**3. Weeks later, they buy.** You ring up ₹18,500 in POS and tender it as:

```
Advance Adjusted   ₹15,000
UPI                 ₹3,500
```

**4. The app reconciles it automatically.** The order webhook fires, the app sees
the `Advance Adjusted` tender, finds the customer, and draws ₹15,000 from their
oldest unused receipt. Balance goes to ₹0.

On day 30 the `Advance Adjusted` tender shows as **its own line in the day's
collections, not as cash** — so redeeming an advance never inflates that day's
takings. Only the ₹3,500 of genuinely new UPI money counts.

---

## How the money is classified

| | Day 1 (advance taken) | Day 30 (goods sold) |
| --- | --- | --- |
| Cash / UPI collections | **₹15,000** ✓ | ₹3,500 only ✓ |
| Advance Adjusted tender | — | ₹15,000 (not new money) |
| GST charged | none — non-taxable line | full GST on ₹18,500 |
| Gross sales | ₹15,000 ⚠️ see below | ₹18,500 |

**The one wrinkle.** Because the advance goes through the cart to reach the cash
drawer, Shopify counts it in *gross sales* on day 1 as well as counting the real
sale on day 30. The advance line is deliberately titled with the
`Advance received` prefix so it can be filtered out of sales reports, and
**Reports → receipt register** in the app gives you the clean advance figure
independently.

If you'd rather advances never touched revenue at all, the textbook fix is
selling them as Shopify gift cards, which Shopify books as a liability rather
than income. That's a bigger change, parked deliberately.

---

## Refunding an advance

**Yes — full or partial, from Shopify POS, to cash or the original tender.**

The advance is a real POS order, so you refund it the way you refund anything
else at the till:

1. In Shopify POS, open the original advance order (search the customer, or the
   order number on their receipt).
2. Tap **Refund**, and set the amount — the full ₹15,000 or any part of it.
3. Choose how to return it: **Cash** out of the drawer, or **back to the
   original payment method**. If the advance came in on a manual method like
   UPI, POS records the refund against that method and you send the money by UPI
   yourself, the same as any manual-tender refund.

The refund shows in that day's till as money going out, and the
`refunds/create` webhook cuts the customer's credit by the same amount within
seconds. Partial refunds leave the rest of the balance intact and usable.

**What you can't refund is money already spent.** If the customer took a
₹10,000 advance and has already used ₹7,000 against goods, only ₹3,000 is
refundable as cash. If POS refunds more than that, the app caps the ledger
reduction at ₹3,000, never lets the balance go negative, and logs the excess —
that portion has to be handled as a return of the *goods* order instead. This is
tested.

There's also a **Record a refund** action on the receipt screen in the admin
app. That only writes the ledger entry — use it when you returned the money
outside Shopify (a bank transfer, say), not for POS refunds, which are picked up
automatically.

---

# Deployment — start to finish

You need three accounts: **Shopify Partners** (free), **GitHub** (free), and
**Render** (free tier is fine to start). Budget about an hour.

## Step 1 — Push the code to GitHub

From the project folder:

```bash
git init && git add . && git commit -m "Advance Receipt Pro"
```

Create an empty repository on github.com (private is fine), then:

```bash
git remote add origin https://github.com/<you>/advance-receipt-pro.git && git branch -M main && git push -u origin main
```

`.gitignore` already excludes `.env`, `node_modules` and the test scaffolding.

## Step 2 — Create the app in Shopify Partners

1. Go to [partners.shopify.com](https://partners.shopify.com) and sign in (create
   a free Partner account if you don't have one).
2. **Apps → Create app → Create app manually**. Name it `Advance Receipt Pro`.
3. Open the app, go to **Configuration**, and copy the **Client ID** and
   **Client secret**. Keep this tab open — you'll need both in Step 4, and you'll
   come back in Step 5.

## Step 3 — Create the database and web service on Render

1. Go to [render.com](https://render.com), sign in with GitHub, and authorise
   access to your repository.
2. **New → Blueprint**, pick the `advance-receipt-pro` repo. Render reads
   `render.yaml` and proposes a web service plus a Postgres database.
3. Click **Apply**. The first build will **fail** — that's expected, the
   environment variables aren't set yet.
4. Note the service URL Render assigns, e.g.
   `https://advance-receipt-pro.onrender.com`. This is your **app URL**.

> On Render's free tier the service sleeps after inactivity and takes ~30s to
> wake. That's a slow first tap at the till each morning. The cheapest paid
> instance removes it — worth it once staff rely on this.

## Step 4 — Set the environment variables

In Render, open the web service → **Environment** → add:

| Key | Value |
| --- | --- |
| `SHOPIFY_API_KEY` | Client ID from Step 2 |
| `SHOPIFY_API_SECRET` | Client secret from Step 2 |
| `SHOPIFY_APP_URL` | your Render URL, e.g. `https://advance-receipt-pro.onrender.com` |

`DATABASE_URL`, `SCOPES` and `NODE_ENV` come from `render.yaml` — leave them.

Click **Manual Deploy → Deploy latest commit**. The build runs
`prisma migrate deploy`, which creates every table. Wait for **Live**.

## Step 5 — Point the app at your URL

Edit three files with your real Render URL, replacing
`https://advance-receipt-pro.onrender.com`:

- `shopify.app.toml` → `application_url` and all three `redirect_urls`
- `extensions/pos-advance/src/Modal.jsx` → the `APP_URL` constant at the top

Commit and push. Then link and deploy the app config:

```bash
npm install --legacy-peer-deps
```

```bash
npx shopify app config link
```

Pick the app you created in Step 2. This fills in `client_id` in
`shopify.app.toml`. Then:

```bash
npx shopify app deploy
```

This registers the access scopes, the webhook subscriptions, and the POS
extension. Push the config change to GitHub too so Render stays in sync.

## Step 6 — Install it on your store

In the Partner Dashboard: **Apps → Advance Receipt Pro → Test your app →
Select store**, choose `greatoutdoorsindia.com`, and click through the
permission screen. It asks for orders, customers and products (read-only for
products).

The app should now open inside your Shopify admin.

## Step 7 — Create the two payment methods ⚠️ required

In **Shopify admin → Settings → Payments → Manual payment methods → Create
custom payment method**, add:

- **`Advance Adjusted`** — how customers spend their advance. **Without this,
  advances can be recorded but never redeemed.**
- **`UPI`** — if you don't already have it, so UPI advances are tendered as UPI
  rather than cash.

The name must match what's in the app's Settings screen (matching ignores case).

## Step 8 — Fill in Settings

In the app → **Settings**:

- Store name, address, phone, GSTIN — these print on the receipt
- Receipt series — defaults to `ADV-` + 4 digits; add a suffix like `/26-27` if
  you want the financial year on it
- Confirm the tender name matches Step 7
- Default print size — **80mm thermal** for the counter printer

## Step 9 — Put the tile on the POS grid

1. Open the **Shopify POS** app and sign in.
2. On the smart grid, tap **⋯ → Customise grid** (or long-press an empty tile).
3. Add the **Take advance** tile from the app list, and place it where staff can
   reach it.

## Step 10 — Test the whole loop with real money

Do this once end to end before staff use it:

1. **Take an advance.** POS → Take advance → pick a real customer → ₹100 →
   Add to cart → tender as Cash. Check the receipt prints and shows a number
   like `ADV-0001`.
2. **Check the ledger.** App → Customer ledgers → that customer shows ₹100.
3. **Check the till.** POS → today's totals include the ₹100 as cash.
4. **Redeem it.** Ring up a ₹150 item, tender `Advance Adjusted` ₹100 + Cash
   ₹50. The customer's balance should drop to ₹0 within seconds, and the order
   should appear under **Order reconciliation** marked *Applied*.
5. **Refund one.** Take another ₹100 advance, then refund it in POS. Balance
   returns to ₹0 and the cash leaves the drawer.

If step 4 doesn't reconcile, check **Order reconciliation** — it explains why
(usually no customer on the order).

---

## Screens

| Screen | What it's for |
| --- | --- |
| **Dashboard** | Money held on customers' behalf, today's collections, orders needing attention |
| **New advance** | Non-POS capture — bank transfers, phone orders |
| **Receipts** | Every receipt, filterable; click through to print or correct |
| **Customer ledgers** | Balance per customer, with a printable statement |
| **Order reconciliation** | Orders tendered against advances, exceptions, manual re-check |
| **Reports** | Collections by mode, register with CSV export, ageing of unused advances |

---

## The POS extension

`extensions/pos-advance/` — a tile plus a modal, built with Preact and POS web
components. It talks to three endpoints, all authenticated with
`authenticate.public.pos()`:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/pos/customers?q=` | customer search with current advance balance |
| `POST /api/pos/advance` | reserve a pending advance, returns cart line title and price |
| `GET /api/pos/receipt/:id` | poll for confirmation after tendering |

**Pending receipts.** Adding an advance to the cart parks a `PENDING` row with a
placeholder number and **no ledger entry** — no credit exists until the money
does. The order webhook confirms it, assigns the real receipt number, and reads
the payment mode from the tender actually used. Abandon the cart and nothing is
credited and no number is burned, so the series has no gaps. If the cashier
edits the price in the cart, the order wins over the reservation.

### Two things to verify on a real device

The docs wouldn't pin these down, so they're written defensively rather than
guessed:

1. **`APP_URL`** at the top of `src/Modal.jsx` — set in Step 5 above.
2. **The Session API method name.** `sessionToken()` probes the shapes it ships
   as and throws a clear error if none match, rather than failing silently.

The `<s-tile>` / `<s-page>` / `<s-scroll-box>` / `<s-text>` syntax is verbatim
from Shopify's docs. The rest (`s-search-field`, `s-number-field`,
`s-clickable`, `s-banner`, `s-badge`) follow the documented naming convention
but should be checked against a `shopify app generate extension` scaffold. Run
`npx shopify app dev` and preview on a POS device.

---

## Things worth knowing

**The product field never touches inventory.** An advance can be recorded
against a product already in Shopify but out of stock, or against something not
listed at all. Either way it's pure reference data — no stock reserved, no
quantity changed, no order line created. `read_products` is read-only; the app
has no inventory write access.

**Money is stored as integer paise**, never floats. A ledger that drifts a paisa
per transaction is worse than useless, so conversion happens only at the UI
boundary in `app/utils/money.js`.

**Draw-down is FIFO** — the oldest unused receipt is spent first. Releases work
in reverse, freeing the newest allocation first.

**Reconciliation is delta-based, not additive.** Shopify sends `orders/create`,
`orders/paid` and `orders/updated` for the same sale and retries on failure. The
app compares what's currently allocated against what the order now says it
tendered and moves only the difference. Replays settle to the same state instead
of charging the customer twice. Same for refunds.

**Receipt numbers can't collide.** The counter is bumped with a single atomic
`UPDATE`, so two tills saving at the same instant get different numbers.

**Exceptions surface rather than fail silently.** An order tendered against an
advance with no customer attached, or with insufficient credit, lands on the
Order reconciliation screen with an explanation and a Re-check button.

**Uninstalling does not delete receipts.** Only sessions are cleared.

### GST treatment

For a supply of **goods**, GST is not payable when an advance is received — tax
applies when the invoice is raised on the later sale. The advance line is
non-taxable and the receipt is a *receipt voucher*, not a tax invoice. Advances
against **services** are treated differently; check with your accountant.

### Print route access

`/print/receipt/:id` and `/print/statement/:customerId` render outside the
embedded admin so the print dialog works. Receipt URLs use unguessable CUIDs;
statements additionally require a `shop` parameter matching an installed shop.
Neither is behind session auth — treat the URLs as semi-private.

---

## Tests

```bash
npm test
```

Spins up a throwaway SQLite database, exercises the draw-down engine (FIFO
ordering, webhook replay, partial release, cancellation, over-refund and
over-apply guards, tender matching, split tenders, the product field, the full
POS reserve → confirm lifecycle including abandoned carts and price edits, and
POS refunds including the capped-at-unspent case), then restores the Postgres
client. **88 assertions.**

## Local development

```bash
npm run dev
```

Needs `DATABASE_URL` pointing at a Postgres instance and the Shopify CLI logged
in.
