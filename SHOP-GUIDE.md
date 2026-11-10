# Photo Gifts shop: design notes and setup guide

Version 1.28.0. The shop is optional. If you skip all of this, the app works as before and the Shop icon simply shows a "not set up yet" message. To hide the icon entirely, set `shopEnabled: false` in `config.js`.

**What is and is not tested.** The server code has 22 automated tests that run against fake versions of Appwrite, Stripe and Printify. The screens were tested in a headless browser at 320, 360 and 390 px wide against a fake server. Nothing has run against a real Printify account, a real Stripe account or your live Appwrite project, and I could not reach those services from where this was built. So the Printify catalog numbers (blueprint, provider, variant, print-area sizes) are **never guessed**: you pick them from Printify's live list inside the app, and the server re-checks every one against Printify before saving. Part E walks you through the first real tests with practice money and no real order.

---

## 1. How people reach the shop (no sixth button)

The bottom bar is unchanged: Home, Videos/Shorts, Create, Family/Family Tree, Profile.

| Where | What it does |
|---|---|
| **Shop** pill in the top bar (bag icon plus the word "Shop", between the wordmark and the bell) | Opens `#/shop`. It is a link with an accessible label, 40 px tall, and shrinks its padding below 360 px. Checked at 320, 360 and 390 px: nothing overlaps. |
| **Make a gift** in the ⋯ menu of any photo | Opens `#/shop/gift/<postId>`, then `#/shop/product/<product>/<postId>` with that photo preselected. The server re-checks the photo when you save the design and again when you pay. |
| **My orders** button on your own profile | Opens `#/orders`. |
| **My orders** and **Cart** buttons inside the shop | Same pages. |

Nothing floats over the feed and there are no banners.

Routes: `#/shop`, `#/shop/product/:key`, `#/shop/product/:key/:postId`, `#/shop/gift/:postId`, `#/shop/cart`, `#/shop/admin`, `#/orders`, `#/orders/:id`, `#/orders/:id/done`. Hash routes keep working under `/FamilyCircle/` on GitHub Pages. Routes contain only random IDs, never file URLs, tokens or addresses. Back buttons stay inside the family you were viewing.

## 2. Where the shop plugs into the existing app

| File | Change |
|---|---|
| `function/` (family-api) | The cleanup job skips gift-design files. New `family-api.tar.gz`. |
| `index.html` | Adds `shop.css` and `shop.js`, bumps `?v=` to 1.28.0. The Content-Security-Policy is unchanged: Stripe's hosted page opens by normal navigation, so no new script or frame sources are needed. |
| `config.js` | Adds `shopEnabled`, `shopFunctionId`, `shopBucketId` (public IDs). Version 1.28.0. |
| `app.js` | `bag` icon; Shop pill in the top bar; "Make a gift" and "Allow gifts with this photo" in the photo ⋯ menu; "My orders" on your profile; a "Let family order gifts with this photo" checkbox (off by default) on the photo Create form; `fetchMedia` accepts an optional bucket; `S.shop` is cleared when you switch family or sign out; one call to `FCShop.install(...)` at startup. |
| `shop.js`, `shop.css` | All shop screens (catalog, designer, cart, orders, owner screen). |
| `shop/function/` | The `shop-api` Appwrite Function. |
| `SHOP-CONSOLE-COMMANDS.md`, `setup/setup-shop.mjs` | Create the shop tables and the private design bucket (Console terminal commands, or the same thing as a script). |

## 3. Architecture

```
Phone (GitHub Pages)                    Appwrite Cloud                           Outside
shop.js  --JWT--> shop-api function --> database `family` (shop tables)
  | draws layout on a canvas            bucket `family-media` (file readable by buyer only)
  | uploads print-ready JPEG ---------> (only the buyer can read it)
  | redirect  --------------------------------------------------------------> Stripe Checkout (card entry)
                                         shop-api <---- webhook (signed) ----- Stripe
                                         shop-api ----- API (token) ---------> Printify (upload, order)
                                         shop-api <---- webhook (signed) ----- Printify (status, tracking)
```

Rules the code enforces:

- **Printify and Stripe secrets live only in the `shop-api` function's environment variables.** They are never in GitHub, `config.js`, the browser, or browser storage.
- **Prices come from the shop owner's saved catalog.** The browser sends product, variant and quantity; it never sends a price.
- **Shipping is asked of Printify before payment** and shown with the total. Stripe is charged exactly items plus that shipping.
- **Permission to use a photo** belongs to the person who posted it. The server checks membership in the family, that the photo is in that family, and that the poster allowed gifts. It checks again when the design is saved, when payment is verified, and right before the photo is sent to Printify. If permission was removed in between, the order is held for the owner and nothing is sent.
- **Nothing goes to Printify until Stripe confirms payment.** The Printify order is created only after the server has fetched the Checkout Session from Stripe's API and matched amount, currency and shipping to the saved order. The success redirect alone proves nothing.
- **The print file is frozen.** After the server accepts a design, the file can no longer be replaced or deleted by the buyer. Its SHA-256 is saved and compared again before upload to Printify.
- **Order history belongs to the buyer.** Order rows are readable only by the buyer. Family owners and tree admins get no automatic access. Only user IDs listed in `SHOP_ADMIN_USER_IDS` see the owner screen.
- **Manual approval by default** (`PRINTIFY_AUTO_SUBMIT=false`): the Printify order is created but not sent to production until the shop owner presses **Approve** on the owner screen. Even with auto-submit on, an order with a mismatch, a crop warning or a removed permission is held.

### What stays on the phone, what is shared, and when

- The **layout preview** is drawn on the phone from the print area measurements. It is not a Printify mockup and not a picture of the finished item; the screen says so. I did not use Printify's mockup generator because it would require sending the image to Printify before payment.
- At **Add to cart** the print-ready JPEG (at most 4096 px on the long side, at most about 5 MB) is uploaded to your `family-media` bucket, readable only by that person. Only that person can read it.
- The **photo is sent to Printify only after payment is verified**, as a base64 upload of the print-ready file, not the original. Printify and its print partners then hold it. Their retention is their own policy; this app cannot promise deletion there. Printify's pages are the place to confirm it.
- Consent shown before the first image is prepared: "To create your product, the selected image will be shared with Printify and the fulfillment partners needed to make and deliver it." The cart has a separate checkbox for sharing the delivery name, address, email and phone with Printify and shipping partners. Both boxes are required, and the server refuses a checkout without them.
- Shipping addresses are never placed on profiles or in the feed.
- Photos posted in the family are shrunk to 1600 px on the long side when posted (an existing app setting). A 1600 px photo is enough for a magnet or small print but will show a "low resolution" warning on large products such as a blanket. The warning is honest; the app never upscales silently.

## 4. Files

```
familycircle/
  index.html            (edited)
  config.js             (edited)
  app.js                (edited)
  shop.js               NEW  screens
  shop.css              NEW
  SHOP-GUIDE.md         NEW  this file
  setup/setup-shop.mjs  NEW  tables + bucket
  shop/function/
    package.json
    src/main.js         entry point, reads environment variables, routes webhooks
    src/shop.js         all shop rules (catalog, designs, checkout, fulfillment)
    src/stripe.js       Stripe calls + webhook signature check
    src/printify.js     Printify calls + webhook signature check
    src/images.js       reads JPEG/PNG sizes
    src/util.js
    test/               22 tests
```

## 5. Database (created in step 21)

All tables are in database `family`, have **no table-level permissions** (the browser can never read or write them directly) and Row security on.

| Table | Columns | Indexes | Row permission |
|---|---|---|---|
| `shopCatalog` (row id = product key: `framed-print`, `magnet`, `mug`, `blanket`, `puzzle`) | title, blurb, enabled, blueprintId, providerId, position, variants (text JSON: id, label, options, priceCents, width, height), verifiedAt | none | none (function only) |
| `shopDesigns` | ownerId, familyId, postId, productKey, variantId, fileId, fileSha, width, height, spec (text), quantity, orderId | ownerId, familyId, orderId | read: the buyer |
| `shopOrders` | ownerId, familyId, paymentStatus, fulfillmentStatus, items (text), address (text), subtotalCents, shippingCents, taxCents, totalCents, currency, stripeSessionId, stripePaymentIntent, checkoutUrl, printifyOrderId, printifyStatus, printifyCostCents, tracking, lastError, consentAt, consentVersion, needsReview, paidAt | ownerId, printifyOrderId | read: the buyer |
| `shopEvents` (row id = hash of provider + event id; used to ignore duplicate webhooks) | source, eventId, type, note | none | none |
| `giftPermissions` (row id = post id) | familyId, postId, ownerId, allowed | familyId, postId | read: the family team |

Gift designs are stored in the existing bucket `family-media` (the free plan allows only 1 bucket). Each design file is created readable only by its owner, and frozen when the design is saved. The `family-api` cleanup job skips files listed in `shopDesigns`; that needs the `idx_fileId` index and the updated family-api code (step 22).

Appwrite limits to be aware of on the free plan: the shop adds 1 function (you will have 2 of 5) and no new bucket or database. The plan allows 1 bucket, which is why designs share `family-media`.

## 6. Environment variables

**Public (safe in `config.js`, which is on GitHub):** `shopEnabled`, `shopFunctionId` (`shop-api`), `shopBucketId` (`family-media`).

**Secret or private: only in the `shop-api` function settings in the Appwrite Console. Never in chat, GitHub or `config.js`:**

| Variable | Required | Meaning |
|---|---|---|
| `STRIPE_SECRET_KEY` | yes | Secret or restricted key. `sk_test_…`/`rk_test_…` for practice, `sk_live_…`/`rk_live_…` for real money. **Secret.** |
| `STRIPE_WEBHOOK_SECRET` | yes | `whsec_…` for the Stripe webhook endpoint. **Secret.** |
| `PRINTIFY_API_TOKEN` | yes | Personal access token. **Secret.** |
| `PRINTIFY_SHOP_ID` | yes | Number of your Printify store. Not secret, but not needed by the browser. |
| `PRINTIFY_WEBHOOK_SECRET` | yes | A long random string you make up (32+ characters). **Secret.** |
| `SHOP_ADMIN_USER_IDS` | yes | Your Appwrite user ID. Comma-separate to add people. |
| `WEBHOOK_BASE_URL` | yes | The function's domain, no trailing slash. Used to register Printify webhooks. |
| `SITE_URL` | default `https://layahmcfly.github.io/FamilyCircle/` | Where Stripe sends people back. |
| `SHOP_SUPPORT_EMAIL` | recommended | Shown to buyers for problems. |
| `SHOP_COUNTRIES` | default `US` | Delivery countries. Start with US only. |
| `PRINTIFY_AUTO_SUBMIT` | default `false` | `true` sends paid orders to production without your approval. |
| `STRIPE_AUTOMATIC_TAX` | default `false` | `true` turns on Stripe Tax (see step 18). |
| `DATABASE_ID`, `SHOP_DESIGN_BUCKET_ID` | defaults `family`, `family-media` | Only change if you renamed them. |

## 7. Order states and retries

Two separate fields, so a payment problem is never confused with a production problem.

- **Payment:** `pending_payment` → `processing` (bank debit still clearing) → `paid`; or `expired`, `payment_failed`. `refunded` is a recorded outcome. A paid order never moves back to an earlier payment state, so late or out-of-order Stripe events cannot undo it.
- **Fulfillment:** `not_started` → `creating` → `created` (Printify order exists, waiting) → `sending` → `in_production` → `shipped` → `delivered`. Side states: `needs_review`, `failed`, `has_issues`, `canceled`. Printify statuses only move forward.

Safety behavior:

- **Double taps and retries.** The browser makes one request ID per cart; the order row ID is derived from it, so a second tap returns the same order and the same Stripe page instead of making another. Stripe is called with an idempotency key. The Printify order uses the app's order ID as its `external_id`; a repeat gets Printify's 409 and the server adopts the existing order.
- **Webhooks.** Stripe and Printify signatures are verified against the raw request body (Stripe also rejects timestamps more than 5 minutes old). Each event is recorded once in `shopEvents`. Stripe is also asked directly for the session, so a forged or replayed event cannot mark an order paid.
- **Paid, then Printify fails.** The order stays `paid`, fulfillment becomes `failed`, the buyer sees "we're sorting something out", and the owner screen shows the reason and a **Retry** button. There is no automatic refund and no automatic resubmission loop. Printify may retry or block webhook delivery for an hour after three failures, so **Refresh from Printify** on the owner screen is the catch-up button.
- **Cancellations and refunds.** An unpaid order can be canceled by the buyer (the Stripe page is expired). After payment, only the owner decides: **Cancel at Printify** works only before production starts, and it does **not** refund the buyer. Refunds are done by you in the Stripe dashboard. The buyer sees "contact the shop owner" with the support email. Decide your own refund policy and write it down before going live.
- **Raw provider errors are never shown to buyers.**

## 8. Honest limitations and unfinished work

1. Untested against live Stripe, Printify and Appwrite. Expect to fix small things in Part E.
2. No Printify mockups. Layout preview only.
3. One photo per product, one product line per design. No collages, no text-only products.
4. US delivery, USD, one shipping method (Printify's standard rate). Other countries need `SHOP_COUNTRIES` and a check of tax and customs rules first.
5. Taxes are off by default. Stripe Tax is supported but needs setup and you are responsible for registrations (step 18).
6. No refund button. Refunds are manual in Stripe. The app records `refunded` only if the owner extends it later.
7. Photos are stored at 1600 px, so large products will warn about resolution.
8. "Framed photo print": the app designs the picture only; frame and size are variant choices from Printify. The frame itself is never edited.
9. Cached shop data is held in memory only and cleared on sign-out or family switch. The Stripe redirect leaves the app, so after paying, the buyer returns by Stripe's link to `#/orders/<id>/done`.
10. Money is stored in cents and assumed to be USD. Printify returns amounts in cents; confirm with your first test order.
11. The tests use fake Stripe, Printify and Appwrite. Passing them shows the logic is consistent, not that the live services behave identically.

## 9. What it really costs

- **Appwrite, GitHub Pages:** free tiers cover this at family scale.
- **Stripe:** no monthly fee. A fee on each payment (check the current US card rate at stripe.com/pricing; as of this writing it is a percentage plus a fixed amount per charge). Stripe Tax, if you use it, has its own extra fee. Refunds may not return Stripe's fee.
- **Printify:** the free plan has no monthly fee. You pay Printify the production cost plus shipping for each order, charged to the payment method or balance on your Printify account when the order goes to production. Paid Printify plans give discounts but are optional. Check printify.com/pricing.
- **You are the merchant.** Customers pay Stripe; Stripe pays you later on its payout schedule (new accounts often wait longer for the first payout); Printify charges you separately. If you price too low, you lose money on every order. Set each price above Printify's cost for that variant, plus shipping you do not pass on, plus Stripe's fee, plus a margin. Sales tax, returns and misprints are yours to handle.

---

# Setup guide

Do the parts in order. Every step says **Where**, **Do**, **Copy** (what to save), **Secret?**, **Check**, and **If it fails**. Keep secrets in a password manager, never in chat or in a file you commit.

## Part A. Printify (steps 1–10)

**1. Create the account.** *Where:* printify.com. *Do:* Sign up and confirm your email. *Secret?* No. *Check:* you reach the Printify dashboard. *If it fails:* check spam for the confirmation email.

**2. Add a store for API orders.** *Where:* Printify dashboard, My Stores / Add new store. *Do:* choose the option for **manual orders or API** (Printify words this differently from time to time). Name it "Family Circle gifts". Do not connect a sales channel like Etsy. *Copy:* nothing yet. *Check:* the store appears in your store list. *If it fails:* Printify support can say which store type accepts orders from the API.

**3. Set order approval to manual.** *Where:* the store's settings, order approval (Printify's help article "How do I set up store details and order approval settings?" shows the page). *Do:* choose manual approval so orders wait for you. *Secret?* No. *Check:* the setting is saved. Printify says API orders arrive "On hold" and then follow these settings.

**4. Add a payment method.** *Where:* Printify billing. *Do:* add the card you will use to pay for production. *Check:* it shows as active. Printify charges when an order goes to production. You will not be charged by the tests in Part E, because you will not approve those orders.

**5. Generate the access token.** *Where:* Printify, My Profile, Connections. *Do:* generate a personal access token with exactly these scopes: `shops.read`, `catalog.read`, `print_providers.read`, `uploads.read`, `uploads.write`, `orders.read`, `orders.write`, `webhooks.read`, `webhooks.write`. Leave out `shops.manage`, `products.*`. *Copy:* the token, shown only once. *Secret?* **Yes.** *Check:* the token appears in the list. Tokens last one year (Printify's documentation); put a reminder in your calendar for 11 months. *If it fails:* generate a new one and delete the old one.

**6. Store the token safely.** *Do:* paste it into your password manager under "Printify API token". Do not paste it anywhere else yet.

**7. Find the Printify store ID.** You will see it inside the app in step 28 (the owner screen lists the stores your token can see). Skip for now.

**8. Learn the products before choosing.** *Where:* Printify catalog. *Do:* browse Framed posters, Magnets, Mugs, Blankets, Puzzles. Note one or two print providers per product: location, production time, cost. The app lets you choose provider and variants in step 29. Prefer providers in the US, since delivery is US-only at first.

**9. Check each product's price.** *Do:* write down Printify's cost for each size you want to sell and the shipping cost for it. You need these for prices in step 29.

**10. Order a sample the normal way (optional but wise).** *Where:* Printify dashboard. *Do:* order one real mug or magnet with a family photo to see the real quality and delivery time. *Check:* the product matches what you will describe to family.

## Part B. Payments with Stripe (steps 11–19)

**11. Create the account.** *Where:* stripe.com. *Do:* sign up, confirm email. *Check:* you reach the dashboard.

**12. Use test mode first.** *Where:* the Stripe dashboard; look for the Test mode (or Sandbox) switch. *Do:* switch it on. Test and live have separate keys and separate webhooks, so you will repeat steps 13–14 later for live (step 52). *Check:* the dashboard shows a test banner.

**13. Create a key.** *Where:* Developers, API keys. *Do:* the simplest is the **Secret key** (`sk_test_…`). Better: **Create restricted key**, and give it write access to **Checkout Sessions** only. *Copy:* the key. *Secret?* **Yes.** *Check:* it begins with `sk_test_` or `rk_test_`. *If you use a restricted key and checkout fails with a permission message,* the message names the missing permission; add exactly that.

**14. Webhook endpoint (do this after step 24, when you have the function address).** *Where:* Developers, Webhooks, Add endpoint. *Do:* URL = `<function address>/webhooks/stripe`. Select events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`. *Copy:* the **Signing secret** (`whsec_…`). *Secret?* **Yes.** *Check:* the endpoint shows as enabled.

**15. Business details for live mode.** *Where:* Stripe, Activate account. *Do:* later, in step 51. Test mode needs none of it.

**16. Understand the money flow.** Customers pay on Stripe's page. Stripe keeps its fee and pays the rest to your bank on its schedule. Separately, Printify charges you for production and shipping when you approve an order. The app shows the buyer items plus shipping. Taxes are separate (step 18).

**17. Decide on prices.** For each variant: price ≥ Printify cost + shipping you absorb + Stripe fee + margin. Prices are entered in step 29.

**18. Decide on sales tax.** By default the app adds no tax. If you are required to collect sales tax, you can switch on Stripe Tax: in Stripe, Tax, set your business address and registrations, then set `STRIPE_AUTOMATIC_TAX=true` in step 25. With it on, Stripe asks for the delivery address on its page and the server checks it matches the address the buyer typed; a mismatch holds the order. I cannot tell you whether you owe tax; ask a tax professional or your state's revenue department, because family-run shops can still be sellers.

**19. Save what you need.** You should now have in your password manager: Stripe test key, (later) Stripe signing secret, Printify token.

## Part C. Appwrite (steps 20–30)

**20. Open the Appwrite Console terminal.** *Where:* the same Terminal in the Console you used for the earlier column commands (it greets you with "This is the Appwrite CLI"). Only text inside a gray code box is a command. The diagrams in this guide are pictures, so never paste those.

**21. Create the tables.** *Where:* that terminal. *Do:* open `SHOP-CONSOLE-COMMANDS.md` and paste Blocks 1 to 5 one at a time, waiting for the prompt after each. Where a block says to wait 30 seconds, do that before pasting the index lines. *Secret?* No. No API key is needed, because the Console terminal is already signed in as you. *Check:* Databases, family, lists shopCatalog, shopDesigns, shopOrders, shopEvents and giftPermissions. *If it fails:* "already exists" is fine. A message about a flag name means to add `--help` to that command and tell me what it prints.

**22. Add one index and update family-api (no new bucket).** *Why:* the free plan allows 1 bucket, so gift designs live in `family-media`, in files only their owner can read. The family-api cleanup job deletes unattached files after an hour, so it must be taught to skip gift designs. *Do:* paste Block 6 in `SHOP-CONSOLE-COMMANDS.md`, then upload the new `family-api.tar.gz` to the `family-api` function (Deployments, Create deployment, Manual, activate). *Check:* the index says Available and the new deployment is active. Do this before saving any gift design.

**23. Create the function.** *Where:* Console, Functions, Create function, Manual. *Do:* Name `shop-api`, **Function ID `shop-api`** (type it exactly), Runtime Node.js 22 or newest, Entrypoint `src/main.js`, Build command `npm install`. *Settings:* **Timeout 30 seconds**. **Execute access:** add **Any**. (Stripe and Printify have no login. The function refuses every request that has neither a valid signature nor a signed-in verified family member.) **Scopes:** `users.read`, `rows.read`, `rows.write`, `files.read`, `files.write`. Nothing else. *Check:* the function is listed.

**24. Upload the code.** *Where:* shop-api, Deployments, Create deployment, Manual. *Do:* upload `shop-api.tar.gz` (sent with this update), activate after the build finishes. Then open the **Domains** tab and copy the function's address (it ends in `.appwrite.run` or similar). *Copy:* that address. *Secret?* No. *Check:* deployment status "Ready". Now go back and do step 14.

**25. Add the variables.** *Where:* shop-api, Settings, Environment variables. *Do:* add every variable in section 6. For the first run: `STRIPE_SECRET_KEY` (test), `STRIPE_WEBHOOK_SECRET` (test), `PRINTIFY_API_TOKEN`, `PRINTIFY_SHOP_ID` (leave a placeholder `0` until step 28), `PRINTIFY_WEBHOOK_SECRET` (a long random string you make up), `SHOP_ADMIN_USER_IDS`, `WEBHOOK_BASE_URL` (step 24 address), `SHOP_SUPPORT_EMAIL`, `PRINTIFY_AUTO_SUBMIT=false`. *Where to find your user ID:* Console, Auth, Users, click your name, User ID. *Secret?* Mark secret ones as secret if the Console offers it. *After changing variables, redeploy* (Deployments, redeploy) so they apply.

**26. Push the site update.** See Part D.

**27. Open the owner screen.** In the app: Shop, then "Manage the shop (owner only)". *Check:* the Status box lists each setting as ✓. *If it says "Only the shop owner can open this page":* your user ID is wrong in step 25.

**28. Fix the Printify store ID.** The Status box lists the Printify stores your token can see, with ids. Copy the id of "Family Circle gifts" into `PRINTIFY_SHOP_ID`, save, redeploy, reopen the owner screen. *If the list says Printify did not accept the token:* check scopes (step 5) and that you pasted the whole token.

**29. Set up products.** *Where:* owner screen, Products, Set up. *Do:* search the catalog by name, pick the blueprint, pick a provider, tick the variants to sell, choose the print area, type your price for each (this is where step 9 and 17 pay off), leave "turn on" unticked for now, and press **Check with Printify and save**. The server re-checks each variant and print area with Printify and stores the real print-area size. Repeat for each product. Anything you do not set up shows to family as "Not available yet". For the framed print, the frame and size options appear as option buttons; pick only variants that are real frames.

**30. Register Printify webhooks.** *Where:* owner screen, **Register Printify order webhooks**. *Check:* it says "Registered". These tell the app when an order ships, so tracking appears in My orders.

## Part D. GitHub Pages (steps 31–38)

**31.** Unzip the update into your local `FamilyCircle` folder, or use the files I committed to the repository (the shop files are in the `main` branch of `LayahMcFly/FamilyCircle` after this update).

**32.** Confirm `config.js` says `version: "1.28.0"`, `shopFunctionId: "shop-api"`, `shopBucketId: "family-media"`. These are public.

**33.** Confirm no secret is in any file: search the folder for `sk_`, `rk_`, `whsec_`, and your Printify token. The only places they should exist are your password manager and the function's variables.

**34.** Commit and push to `main`.

**35.** *Where:* GitHub, repository, Actions or Settings, Pages. *Check:* the deploy finishes with a green check (a minute or two).

**36.** Open `https://layahmcfly.github.io/FamilyCircle/` and hard-refresh (the footer should show v1.28.0). If it still shows the old version, close the tab and reopen it.

**37.** Click **Shop** in the top bar. *Check:* you see the product cards. A "not set up yet" message means steps 23–25 are incomplete.

**38.** Open a photo's ⋯ menu. *Check:* "Make a gift" and, on your own photos, "Allow gifts with this photo…".

## Part E. Safe testing (steps 39–49)

Everything here uses Stripe test mode and `PRINTIFY_AUTO_SUBMIT=false`. Printify has no sandbox. The only Printify protection is that you do not approve test orders, and that orders you create are cancelled at Printify before production. Know the four levels: (a) automated tests with fake services (already passing), (b) Stripe test mode with fake cards, (c) a real Printify order that exists but is not approved, (d) real production.

**39. Allow a photo.** Post a photo, tick "Let family order gifts with this photo", or use ⋯, Allow gifts. *Check:* a second family member sees "Make a gift" work; a third photo you did not allow shows "has not allowed it".

**40. Design a mug.** Choose the photo, move it with your finger, zoom, add a caption. *Check:* the dashed blue safe-area line, the "outside the print area" percentage, and the resolution message update live. "Show whole photo" shows everything with white edges instead of cropping. Tick the three boxes. The first time, the consent sentence appears.

**41. Add to cart.** *Check:* the cart shows your design and the quantity. Try Remove and quantity.

**42. Enter a US address and press Calculate.** *Check:* a shipping line from Printify and a total appear. *If it says shipping is unavailable:* the provider may not ship to that state, or the Printify token scope is wrong.

**43. Pay with a test card.** Tick both permission boxes, press Pay. On Stripe's page use card `4242 4242 4242 4242`, any future date, any 3 digits. *Check:* you return to the app on "Payment confirmed". The page refreshes itself for up to about 40 seconds.

**44. Look at the owner screen.** *Check:* the order shows `paid` and a fulfillment of `created`, with the Printify cost. In the Printify dashboard the order appears, on hold. **Do not approve it.**

**45. Test failures.** Stripe test card `4000 0000 0000 0002` (declined) should leave the order unpaid and show nothing sent. Close the Stripe page without paying, then **Cancel this unpaid order**.

**46. Test duplicates.** Double-tap Pay. *Check:* only one order. In Stripe, Developers, Webhooks, open your endpoint and use **Resend** on an event. *Check:* no second Printify order.

**47. Test permission removal.** Pay for a second test order, then (as the poster) turn off gifts for that photo before pressing Approve. *Check:* the order is held with a clear note and nothing is sent.

**48. Clean up.** In the owner screen use **Cancel at Printify** for each test order (works before production). Cancelling does not refund; test-mode Stripe payments are not real money.

**49. Try an iPhone and an Android phone, and dark mode.** Look especially at the designer: dragging should move the photo and not scroll the page.

## Part F. Going live (steps 50–56)

**50. Decide policies.** Write down: who handles refunds, how long you will wait for a reply, what you do when a print is bad. Put the support email in `SHOP_SUPPORT_EMAIL`.

**51. Activate Stripe.** *Where:* Stripe, Activate account. *Do:* give the business and bank details Stripe asks for. *Check:* the dashboard allows live mode.

**52. Live keys.** Turn Test mode off. Repeat steps 13 and 14 for live: a live key and a **new** webhook endpoint (same URL, same four events) with its own signing secret. Replace `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in the function, then redeploy. *Check:* the owner screen says "Stripe mode: LIVE".

**53. Check Printify billing.** Confirm the card on your Printify account is current and that approval is still manual.

**54. Place one real order yourself** (a magnet is cheapest). Approve it on the owner screen. *Check:* it moves to `in_production`, then `shipped` with a tracking link in My orders. Compare the arrived item to the layout preview.

**55. Open the shop to the family.** Tell them it is optional, and that nothing is shared until they order and that photos are only usable if the poster allowed it.

**56. Review weekly at first.** Open the owner screen: look for orders marked failed or held, check your Printify balance against Stripe payouts, and put your Printify token expiry date on your calendar. Turn `PRINTIFY_AUTO_SUBMIT` on only after several clean orders, and only if you are comfortable that held orders will still wait for you.

## Common errors

| Message | Likely cause | Fix |
|---|---|---|
| "The shop did not answer" | Function not deployed, wrong ID, or still building | Steps 23–24; `shopFunctionId` must equal the Function ID |
| "Only the shop owner can open this page" | `SHOP_ADMIN_USER_IDS` wrong | Step 25 |
| Pay button says Stripe could not start | Stripe key missing/wrong mode | Steps 13, 25, redeploy |
| Paid but stays on "confirming" | Webhook not reaching the function | Step 14 URL and events, signing secret; use **Refresh status** |
| Paid, fulfillment `failed` | Printify rejected the order | Read the note on the owner screen, fix, press **Retry** |
| "does not match the print area" | Product size changed in Printify after the design was made | Remake the design |
| No tracking after shipping | Printify webhooks not registered | Step 30, then **Refresh from Printify** |

Sources: [Printify developer documentation](https://developers.printify.com/) (token scopes, one-year token life) and [Printify help: orders submitted through the API](https://help.printify.com/hc/en-us/articles/4483629894289-How-do-orders-and-products-submitted-through-API-look-like-inside-my-account) (API orders arrive on hold, then follow your approval settings). Stripe Checkout and webhook behavior is from Stripe's documentation as checked earlier in this project, and the signature code was compared with Stripe's official library in a test.
