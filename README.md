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

`.gitignore` already excludes `.env`, `node_modules` and the test scaffolding —
expect around 60 files committed.

Now create the repository at [github.com/new](https://github.com/new):

- Name: `advance-receipt-pro` (Private is fine)
- **Leave "Add a README file", ".gitignore" and "Choose a licence" all
  unticked.** Ticking any of them puts a commit on GitHub that your push will
  collide with.

GitHub then shows a "…or push an existing repository from the command line"
box containing your real URL. Use that URL below — **replace `YOUR-USERNAME`
with your actual GitHub username**, don't paste it literally:

```bash
git remote add origin https://github.com/YOUR-USERNAME/advance-receipt-pro.git
```

```bash
git branch -M main && git push -u origin main
```

A browser window opens for GitHub sign-in. If the terminal asks for a
*password* instead, it wants a Personal Access Token — GitHub hasn't accepted
account passwords for git since 2021. Create one at **GitHub → Settings →
Developer settings → Personal access tokens → Tokens (classic)** with the
`repo` scope.

<details>
<summary>If you already ran <code>git remote add</code> with the wrong URL</summary>

`git remote add` fails if a remote called `origin` already exists, so use
`set-url` to correct it rather than adding again:

```bash
git remote set-url origin https://github.com/YOUR-USERNAME/advance-receipt-pro.git
```

Check it took with `git remote -v`, then push.
</details>

## Step 2 — Create the app in Shopify Partners

1. Go to [partners.shopify.com](https://partners.shopify.com) and sign in (create
   a free Partner account if you don't have one).
2. **Apps → Create app → Create app manually**. Name it `Advance Receipt Pro`.
3. Open the app, go to **Configuration**, and copy the **Client ID** and
   **Client secret**. Keep this tab open — you'll need both in Step 4, and you'll
   come back in Step 5.

**You do not set any scopes here.** This app uses Shopify managed installation
(`use_legacy_install_flow = false`), so access scopes are declared in
`shopify.app.toml` and registered by `npx shopify app deploy` in Step 5. If you
go looking for a permissions checklist in the Partner Dashboard, there isn't
one — that's expected.

### What it asks for, and why

The app issues **no GraphQL mutations at all**. It is entirely read-only against
Shopify; everything it writes lives in its own database.

| Scope | Why |
| --- | --- |
| `read_orders` | Read order tenders, line items, refunds and cart attributes — how advances get confirmed, redeemed and refunded |
| `read_customers` | Customer lookup for the picker; ledgers key off the customer id |
| `read_products` | The "what is this advance for?" picker |

**No write scopes, and no inventory access** — the app cannot change stock,
customers, products or orders even if it tried.

The POS extension's cart actions (`addCustomSale`, `setCustomer`) are POS
operations, not Admin API calls, so they need no scope of their own.

**One optional change.** `read_orders` only reaches back **60 days**. If you want
to re-check a reconciliation exception on an older order, swap it for
`read_all_orders` in `shopify.app.toml` before Step 5. Day-to-day reconciliation
is webhook-driven and always recent, so the default is fine for most stores —
`gst-invoice-pro` on this same store already holds `read_all_orders` if you want
the precedent.

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

These are already set to `https://advance-receipt-pro.onrender.com`:

- `shopify.app.toml` → `application_url` and all three `redirect_urls`
- `extensions/pos-advance/src/Modal.jsx` → the `APP_URL` constant at the top
- `.env.example` → `SHOPIFY_APP_URL` (template only; the live value is the
  Render environment variable you set in Step 4)

**If Render gave you a different hostname** — it appends a suffix when the name
is taken, e.g. `advance-receipt-pro-7m8h.onrender.com` — replace the URL in all
of the above. Check with:

```bash
grep -rn "onrender.com" shopify.app.toml extensions/ .env.example
```

Every hit must show the same hostname as your live Render service. A mismatch in
`redirect_urls` breaks the install with an OAuth error; a mismatch in `APP_URL`
makes the POS tile fail to reach the backend.

Then link and deploy the app config:

```bash
npm install --legacy-peer-deps
```

```bash
npx shopify app config link
```

Pick the app you created in Step 2. This fills in `client_id`.

> ⚠️ **`config link` overwrites `shopify.app.toml` with whatever the remote app
> has** — which, for a brand-new app, is nothing. It will blank out `scopes`,
> empty `redirect_urls`, delete every `[[webhooks.subscriptions]]` block and
> reset `api_version`.
>
> **After running it, check the file.** If `scopes = ""` or
> `redirect_urls = [ ]`, restore them (see the committed version in git:
> `git diff shopify.app.toml`, or `git checkout shopify.app.toml` then put the
> new `client_id` back). `config link` pulls; `app deploy` pushes.

With `shopify.app.toml` correct, push it up to Shopify:

```bash
npx shopify app deploy
```

This registers the access scopes, the webhook subscriptions, and the POS
extension.

**Then make sure Render agrees about scopes.** In Render → your service →
Environment, `SCOPES` must match `shopify.app.toml` exactly:

```
read_orders,read_customers,read_products
```

If the app requests different scopes than Shopify granted, the library detects
the mismatch and bounces you through re-authentication on every page load.

Commit and push the config change to GitHub so Render stays in sync.

## Step 6 — Set distribution, then install

### 6a. Choose custom distribution ⚠️ do this before installing

This app is for **one store**, not the public App Store. In the Partner
Dashboard: **Apps → Advance Receipt Pro → Distribution**, choose
**Custom distribution**, and enter your store domain
(`qa0jmi-q7.myshopify.com`).

> **This choice is permanent.** Shopify won't let you switch between custom and
> public distribution afterwards — you'd have to create a new app. Custom is
> correct here.

If you skip this, the app stays on App Store distribution, which can only be
installed on **development** stores. Installing on a live store fails with
*"The installation link for this app is invalid"*, even though the permission
screen renders correctly.

The code must agree: `app/shopify.server.js` sets
`distribution: AppDistribution.SingleMerchant`.

### 6b. Install

Custom distribution gives you a one-click install link on that same
Distribution page. Open it, review the permissions (orders, customers,
products — all read-only) and click **Install**.

The app should now open inside your Shopify admin.

## Step 7 — Create the POS custom payment types ⚠️ required

**This is the POS channel, not the main Payments page.** Shopify keeps two
separate sets of manual payment methods and they do not share entries:

| Where | Used by | Relevant here? |
| --- | --- | --- |
| Settings → Payments → **Manual payment methods** | Online store checkout (bank deposit, money order, COD) | ✗ no |
| **Point of Sale channel → Payment types → Custom payment** | The POS till | ✓ **yes** |

Anything you add under Settings → Payments will never appear at the till, and
POS custom payment types will never appear on the Payments page. If you already
added your manual methods under the POS channel, you're in the right place.

> **The Shopify admin display is misleading — ignore it.** On a POS order the
> payment timeline shows `Gateway: Custom (POS)` for *every* custom payment
> type, with the real name buried in the message ("Paid via Card Payment").
> That looks like the individual names are lost. They aren't: the Admin API
> returns the real name, and that's what this app reads. Verified on live order
> GO#1508:
>
> ```
> gateway:              "Card Payment"
> formattedGateway:     "Card Payment"
> manualPaymentGateway: true
> ```
>
> So a POS custom payment type named `Advance Adjusted` matches correctly. There
> is a regression test pinning this exact shape.

In the **Point of Sale** sales channel settings, add a custom payment type:

- **`Advance Adjusted`** — how customers spend their advance. **Without this,
  advances can be recorded but never redeemed.**
- **`UPI`** — if you don't already have one, so UPI advances are recorded as UPI
  rather than cash.

The name must match the app's **Settings → Custom payment method name(s)**.
Matching ignores case and also succeeds on a partial match, so a till type
called `Advance Adjusted (Store Credit)` still matches `Advance Adjusted`.

### Confirm the real tender name after your first test

The name Shopify records on the transaction isn't always character-for-character
what you typed. After your first test order tendered against the advance, check
what actually landed — in the app, **Order reconciliation** will show the order,
and if it says *Not an advance order* the names don't match.

If they don't match, change the name in the app's Settings to match the till
rather than the other way round; it accepts a comma-separated list, so you can
safely list several spellings.

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

## Troubleshooting

### "The app couldn't be loaded — this app can't load due to an issue with browser cookies"

Shopify shows this generic message whenever the embedded app fails to
authenticate, and cookies are almost never the real cause.

**Look at the browser address bar first** — the admin appends the real reason,
e.g. `?oauth_error=same_site_cookies`. That one specific error means the app is
running the legacy cookie-based OAuth flow inside the iframe. The fix is that
`app/shopify.server.js` must set:

```js
future: { unstable_newEmbeddedAuthStrategy: true }
```

This has to stay in step with `use_legacy_install_flow = false` in
`shopify.app.toml`. The two together mean "Shopify grants the scopes, the app
uses token exchange" — no OAuth redirect and no cookies. The library defaults
this flag to **false**, so it must be set explicitly.

Other causes, in order of likelihood:

1. **Is `shopify.app.toml` intact?** This is the usual culprit right after
   `shopify app config link`, which blanks the file (see Step 5). If
   `scopes = ""` or `redirect_urls = [ ]`, restore them and run
   `npx shopify app deploy`.
2. **Do the redirect URLs match your live hostname?** All three in
   `[auth].redirect_urls` must use the exact Render hostname.
3. **Does Render's `SCOPES` match `shopify.app.toml`?** A mismatch causes an
   endless re-auth loop.
4. **Is the service actually up?** Render's free tier sleeps:
   ```bash
   curl -o /dev/null -w "%{http_code}\n" https://advance-receipt-pro.onrender.com/auth/login
   ```
   `200` means it's serving. Anything else — check Render's logs.
5. **Only then suspect cookies.** Try an incognito window with third-party
   cookies allowed, or a different browser.

After fixing config, reload the app from **Shopify admin → Apps**. Managed
installation will prompt to approve the corrected scopes.

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
