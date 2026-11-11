# Family Shop (CJ): reference for the build

Version 1.46.0. This is the technical companion to `CJ-GUIDE.md`. You do not need it to set the shop up.

## What changed, by file

| File | Status | What |
|---|---|---|
| `shop.js` | changed | Search, departments, featured row, sort, filters, pages; Family Shop item page, cart and checkout; owner screen for CJ products; CJ buttons on orders; featured toggle for Photo Gifts |
| `shop.css` | changed | Styles for the above, using the app's theme variables (light and dark) |
| `shop/function/src/cj.js` | new | The only code that talks to CJ: login and token refresh, 1.1 second pacing, product, search, shipping, order create, pay, detail, cancel. Order create and pay are never retried |
| `shop/function/src/cjShop.js` | new | Family Shop logic: products, pricing rule, sync, cart, quote, checkout, fulfillment, status sync, owner order buttons |
| `shop/function/src/shop.js` | changed | Plugs CJ in. `fulfill` hands CJ orders to `cjShop`. Admin buttons refuse the wrong supplier. Shared Square step moved into `beginSquare` |
| `shop/function/src/main.js` | changed | Reads `CJ_*` settings, stores CJ's login token in a private row |
| `shop/function/src/suppliers.js` | unchanged | Decides which supplier an order or product belongs to |
| `shop/function/test/*.test.js` | changed | 79 tests, including a fake CJ |
| `setup/setup-shop.mjs` | changed | Creates the new tables and columns. Safe to run twice |
| `.github/workflows/setup-shop-tables.yml` | new, temporary | One-click run of the setup script. Delete after use |
| `CJ-GUIDE.md`, `CJ-REFERENCE.md` | new | These docs |

## Database

New and changed tables. Table permissions are empty on purpose: browsers cannot read or write them. Only `shop-api` (using its own key) can.

| Table | Fields | Indexes | Row permissions |
|---|---|---|---|
| `shopCj` | pid, sku, supplier, title, description, category, status (draft, published, disabled), featured, fromCountry, supplierData (CJ's facts as JSON: title, images, variants with cost and stock), retail (your pricing rule, typed prices, chosen options), lastSyncAt, syncNote | pid, status | none (server only) |
| `shopCjCart` | ownerId, familyId, productId, vid, quantity | ownerId | buyer can read |
| `shopSettings` | value (JSON). Row `cj` holds CJ's login token. Row `featured` holds featured Photo Gifts keys | none | none (server only) |
| `shopOrders` (new columns) | supplierOrderId, supplierStatus. Also creates the Square columns if a fresh database lacks them | existing | buyer can read |

Why supplier facts and your edits are separate: `supplierData` is rewritten by a sync. `title`, `description`, `category`, `status`, `featured` and `retail` are never rewritten by a sync. A test checks this.

## Settings (function `shop-api`)

| Name | Needed | Secret | Default | Meaning |
|---|---|---|---|---|
| `CJ_API_KEY` | for the Family Shop | yes | none | CJ login key |
| `CJ_SANDBOX` | no | no | `true` | Send CJ orders as sandbox orders |
| `CJ_AUTO_PAY` | no | no | `false` | Pay CJ from the wallet right after a customer pays |
| `SHOP_RETURN_POLICY` | recommended | no | empty | Shown on Family Shop product pages |
| existing | | | | `SQUARE_*`, `PRINTIFY_*`, `SHOP_ADMIN_USER_IDS`, `WEBHOOK_BASE_URL`, `SHOP_SUPPORT_EMAIL` unchanged |

Nothing CJ-related goes in `config.js`, GitHub, the browser, or logs.

## Routes (hash routing, `/FamilyCircle/` base path kept)

| Route | Screen |
|---|---|
| `#/shop` | Landing with search, tabs, departments, featured, results |
| `#/shop/product/<key>[/<postId>]` | Photo Gifts product and designer (unchanged) |
| `#/shop/gift/<postId>` | "Make a gift" from a photo (unchanged) |
| `#/shop/item/<id>` | Family Shop product page |
| `#/shop/cart` | Photo Gifts cart |
| `#/shop/cart/family` | Family Shop cart and checkout |
| `#/shop/admin` | Owner screen (Photo Gifts, orders) |
| `#/shop/admin/cj` | Owner screen for CJ products |
| `#/orders`, `#/orders/<id>` | My orders |

## Carts, checkout and order states

Two carts, two checkouts. A Photo Gifts cart and a Family Shop cart never merge. The server refuses a checkout that mixes suppliers, and a Photo Gifts payment can never create a CJ order (tested).

Family Shop checkout, in order:

1. Quote: the server asks CJ again for each variant's stock and cost, and for shipping to the address. It prices from your saved prices, never from the browser.
2. Checkout: the browser sends the total it showed. If the server's total differs, it answers `total_changed` with the new quote and creates nothing.
3. A Square payment link is created for items plus shipping (plus your flat tax if set).
4. Square confirms payment to the server (the server asks Square, it does not believe a redirect). Only then does the order go to CJ, create-only.
5. You pay CJ from the wallet (button, or `CJ_AUTO_PAY`).

Two separate states are stored per order:

- Payment: `pending_payment`, `processing`, `paid`, `partially_refunded`, `refunded`, `expired`, `payment_failed`.
- Fulfillment: `not_started`, `creating`, `created` (at CJ, not paid), `sending` (paid at CJ), `in_production`, `shipped`, `delivered`, `needs_review`, `failed`, `canceled`.

Fulfillment only moves forward, except into `needs_review`. "Shipped" needs a tracking number.

## Safety rules the code enforces

- Real CJ order while Square is in practice mode: blocked and held.
- CJ in sandbox while Square is live: held.
- CJ cost above what the customer paid: held, not paid.
- Uncertain create (timeout): looked up by our order number at CJ before anything else. Never retried on its own.
- Duplicate create: CJ rejects a repeated order number, and the order number is our order ID.
- Customer refunded in Square: paying CJ is refused.
- CJ cancels a paid order: held for you.
- Wallet too low or any pay refusal: held with a plain message; paying again never double-pays.

## Not done

- No CJ webhooks (polling instead).
- No per-package tracking for split shipments.
- No multi-warehouse checkout.
- No CJ-side return handling.
- Not tested against the real CJ. Fake CJ only.
