# Square for the Photo Gifts shop: setup guide

**Short version.** Square replaces Stripe as the way buyers pay. Buyers still use the same shop screens. At checkout they are sent to a payment page that Square hosts, so card numbers never touch your app. The shop only sends an order to Printify after the server has asked Square for the payment and seen `COMPLETED`, with the right amount, at your location, for an order the app created. A redirect back to your site proves nothing, and neither does a webhook message by itself.

You need three things: five new database columns (Block 7 in `SHOP-CONSOLE-COMMANDS.md`), the new `shop-api.tar.gz`, and the Square setup in Steps 1 to 8 below. Everything is in practice (sandbox) mode until Step 13.

**Version:** 1.29.0. **Files that changed:** `shop.js` (wording and refresh), `config.js` and `index.html` (version only), `SHOP-CONSOLE-COMMANDS.md` (Block 7), `setup/setup-shop.mjs`, and `shop-api` (`src/square.js` is new, `src/stripe.js` is gone, `src/shop.js` and `src/main.js` changed).

---

## How a payment works now

```
Buyer picks photo + product         (app checks membership, photo permission, variant, size, shipping)
   |
   v
shop-api saves an order: "pending_payment"       <- our own record, id = the order id
   |   calls Square: CreatePaymentLink with the order, the price WE calculated, shipping, optional tax
   v
Square returns a link. shop-api checks Square's order total matches ours, or deletes the link.
   |
   v
Browser opens the Square page. Buyer pays there.      (card data stays with Square)
   |
   +--> Square sends a webhook: "payment X changed"     (signed; we verify the signature)
   |       shop-api asks Square for payment X and its order, then checks:
   |       status COMPLETED, our location, our order id, amount, currency, no tip
   v
Only then: order = "paid", Printify order created (held for your approval while you test)
   |
Buyer sees status in My orders. The page also asks Square directly, so a lost webhook does not strand an order.
```

Payment states the buyer can see: waiting for payment, processing, paid, not completed, refunded. Production states come from Printify.

## What I checked against Square's official documentation (November 2026)

- Webhook signature: the header `x-square-hmacsha256-signature` is a base64 HMAC-SHA256 of the notification URL plus the raw request body. I confirmed this in Square's published Node library and my code agrees with it (an automated test compares the two).
- Webhook subscription steps in the Developer Console: Webhooks, Subscriptions, Add subscription, a name, an HTTPS notification URL, an API version, the events; then the subscription's Endpoint Details page has a Signature Key box with a Show button.
- Developer Console: Credentials and Locations are in the left pane of your application, and the Sandbox and Production environments are switched at the top of the application page. The Sandbox has a Default Test Account.
- Sandbox card: Visa `4111 1111 1111 1111`, CVV `111`, any future expiry, a valid postal code.
- Payment link API: `POST /v2/online-checkout/payment-links` with an `order`, `checkout_options` (redirect URL, shipping fee, support email) and `pre_populated_data`; the hosted page URL comes back in `payment_link.url`.
- Payment statuses: `APPROVED`, `PENDING`, `COMPLETED`, `CANCELED`, `FAILED`. Only `COMPLETED` counts as paid.

## What I could NOT confirm. Test these yourself (Steps 8 to 10)

1. **Where Square sends the buyer after paying.** I could not find Square's description of what it does to a `#/orders/...` address (it may append its own query text or drop the part after `#`). If the buyer lands somewhere odd, nothing is lost: **Shop, My orders** re-checks every unpaid order with Square.
2. **Whether the sandbox hosted page accepts the sandbox test cards and sends sandbox webhooks the same way production will.** Square's pages on sandbox payments describe test cards for the payment APIs. They do not describe hosted payment links. Sandbox behaviour can differ from production, so Step 15 (one real small purchase) is the real proof.
3. **Declined-card behaviour.** Square lists `4000 0000 0000 0002` as a declined test card for its payment APIs. Whether the hosted page treats it the same way is unconfirmed.
4. **Whether the Console lets you resend a webhook.** I could not confirm a resend button. Step 10 uses a different check.
5. **Account rules that depend on you.** Whether Square accepts your country, bank and business type, identity checks before live payments, payout timing, and reserves or holds on new accounts are decided on your account. Read them in your Square dashboard before Step 13.

## Public settings and private settings

**Public.** These sit in `config.js`, which is on GitHub. They contain no secrets and none of them changed for Square: `shopEnabled`, `shopFunctionId` (`shop-api`), `shopBucketId` (`family-media`).

**Private.** These live only in the `shop-api` function settings in the Appwrite Console. Never paste a secret into chat, GitHub, `config.js` or a screenshot.

| Variable | Needed? | What it is | Secret? |
|---|---|---|---|
| `SQUARE_ACCESS_TOKEN` | yes | The access token for the environment you are using (sandbox first) | **Secret** |
| `SQUARE_ENVIRONMENT` | default `sandbox` | `sandbox` or `production`. Anything else counts as `sandbox` | No |
| `SQUARE_LOCATION_ID` | yes | The ID of the one Square location that takes these payments | No (still keep it out of GitHub) |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | yes | The Signature Key from the webhook subscription | **Secret** |
| `SQUARE_TAX_PERCENT` | optional, default `0` | A flat sales tax percent you choose, for example `6.5` | No |
| `SQUARE_NOTIFICATION_URL` | optional | Only if your webhook URL is not `WEBHOOK_BASE_URL` plus `/webhooks/square` | No |
| `WEBHOOK_BASE_URL` | yes | Your function's address, no trailing slash | No |
| `SITE_URL` | default `https://layahmcfly.github.io/FamilyCircle/` | Where buyers return. Keep the trailing slash | No |
| `SHOP_SUPPORT_EMAIL` | recommended | Shown to buyers and passed to Square as the support address | No |
| `PRINTIFY_API_TOKEN`, `PRINTIFY_WEBHOOK_SECRET` | yes | As before | **Secret** |
| `PRINTIFY_SHOP_ID`, `SHOP_ADMIN_USER_IDS`, `SHOP_COUNTRIES`, `PRINTIFY_AUTO_SUBMIT`, `DATABASE_ID`, `SHOP_DESIGN_BUCKET_ID` | as before | Unchanged | No |

**Delete these Stripe variables** when Square works: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_AUTOMATIC_TAX`. The new code ignores them.

---

# Setup steps

Each step says where to go, what to do, what to copy, where to paste it, whether it is secret, and how to check it.

## Step 1. Square seller account

- **Where:** squareup.com. If you cannot sign in to an existing account, use the sign-in help there first.
- **Do:** sign in or create an account. Use the business or personal details that match the bank account you want payouts in.
- **Copy:** nothing.
- **Check:** you can open your Square Dashboard.
- **Before you go live (Step 13), read in the Dashboard:** which countries and banks Square supports for you, any identity verification it asks for, how long first payouts take, and whether it holds funds on new accounts.

## Step 2. Developer application

- **Where:** developer.squareup.com/apps (the Developer Console), signed in with the same Square login.
- **Do:** create a new application. Name it "Family Circle shop". The Console's button label for this may differ from what I write, so look for the option to create an application.
- **Copy:** nothing yet.
- **Check:** the application appears on the Applications page. Choose Open on it.

## Step 3. Sandbox credentials and the location ID

- **Where:** your application, left pane, **Credentials**. Switch the environment toggle at the top of the application page to **Sandbox**.
- **Do:** find the Sandbox access token. Square's docs say it is also reachable through the **Default Test Account** in the Sandbox test accounts section.
- **Copy:** the Sandbox access token. **Secret.** Put it in your password manager now. You will paste it only into Appwrite (Step 4).
- **Where for the location:** left pane, **Locations**, with the toggle still on Sandbox. It lists the locations of the test account.
- **Copy:** the Location ID of the location you will use. Not secret.
- **Check:** the Sandbox token and the Sandbox location belong to the same test account. A token from one environment never works against the other environment's data.

## Step 4. Put the secrets in the backend (never in chat or GitHub)

- **Where:** Appwrite Console, Functions, `shop-api`, Settings, Environment variables.
- **Do:** add or edit these. Mark the secret ones as secret if the Console offers it.
  - `SQUARE_ENVIRONMENT` = `sandbox`
  - `SQUARE_ACCESS_TOKEN` = the Sandbox token from Step 3 (secret)
  - `SQUARE_LOCATION_ID` = the Sandbox location ID
  - `SQUARE_TAX_PERCENT` = leave out for now
  - `PRINTIFY_AUTO_SUBMIT` = `false`
  - `SQUARE_WEBHOOK_SIGNATURE_KEY` waits until Step 6.
- **Check:** after Step 5 the owner screen's Status box shows "Square mode: SANDBOX (practice)" and the location name. If it says Square said no, the token, the environment and the location do not belong together.

## Step 5. Deploy the new function

1. **Add the new database columns first.** Console terminal, paste Block 7 from `SHOP-CONSOLE-COMMANDS.md`. Wait until Databases, family, shopOrders shows 28 columns, all Available.
2. **Upload the function.** Console, Functions, `shop-api`, Deployments, Create deployment, Manual, upload `shop-api.tar.gz`, activate after the build shows Ready.
3. **Copy the function address.** Domains tab, the address ending in `.appwrite.run` or similar. **Not secret.** Set `WEBHOOK_BASE_URL` to it (no trailing slash).
4. **Update the site.** Upload or push the new site files (version 1.29.0). If the page looks old, hard-refresh.
5. **Check:** open the shop, then **Manage the shop**. You should see "Square mode: SANDBOX", the Square location, and a line that starts "The Square webhook subscription must use exactly this URL:". Copy that URL for Step 6.

## Step 6. Webhook subscription and signature key

- **Where:** developer.squareup.com/apps, your application, left pane, under **Webhooks** choose **Subscriptions**, then **Add subscription**. Make sure the environment toggle is on **Sandbox**.
- **Do:** give it a name ("Family Circle shop sandbox"). Paste the notification URL from the owner screen exactly as shown. It ends in `/webhooks/square`. It must be HTTPS. Pick the newest API version offered that lists the events below, tick **`payment.created`, `payment.updated`, `refund.created`, `refund.updated`**, then Save.
- **Copy:** open the subscription's Endpoint Details page and choose **Show** in the **Signature Key** box. Copy the key. **Secret.**
- **Paste:** into `SQUARE_WEBHOOK_SIGNATURE_KEY` in the Appwrite function settings. Redeploy or save as your Console requires.
- **Why exactly:** the signature covers the URL as well as the body. One extra slash, a different capital letter, or `http` instead of `https` makes every message fail with `bad_signature`.
- **Check:** pay once in Step 9. Appwrite, Databases, family, shopEvents should gain a row with source `square` and a type such as `payment.updated`.

## Step 7. Connect the frontend to the checkout function

Nothing new to paste. The app already calls `shop-api` by the ID in `config.js` (`shopFunctionId`). Check that the shop's pay button now says **Pay securely with Square** and that the cart note says you pay on Square's page. If it still says Stripe, the old site files are cached. Hard-refresh and confirm the footer version is 1.29.0.

## Step 8. Return address (GitHub Pages and the hash router)

- The server sends buyers back to `SITE_URL` plus `#/orders/<order id>/done`. With the default `SITE_URL`, that is `https://layahmcfly.github.io/FamilyCircle/#/orders/<id>/done`. The `/FamilyCircle/` part and the `#/` router are kept.
- A fragment (the part after `#`) is handled by the browser. Servers never see it. Square's documentation does not say how it treats one, so test it in Step 9 and watch the address bar after you return.
- **If you return to the app's home screen instead of the order page:** open **Shop, My orders**. Orders that are still unpaid are re-checked with Square on that screen (up to three at a time), so a paid order turns paid there.
- **Check:** after a test payment the order page shows "Payment confirmed" within about 40 seconds (the page asks Square every 3 seconds for a short while).

## Step 9. Test success, cancel and failure (sandbox)

Use the shop as a family member who owns a photo with gifts allowed. Do all of this with `PRINTIFY_AUTO_SUBMIT=false`.

1. **Success.** Make a cart, calculate the total, tick both boxes, press Pay securely with Square. On Square's page use Visa `4111 1111 1111 1111`, CVV `111`, any future expiry, and a valid postal code. *Check:* you return to the app, the order says Payment confirmed, and the owner screen shows the order as paid, with a Printify order created and **waiting for your approval**.
2. **Cancel.** Start another checkout and close the Square tab without paying. *Check:* the order stays "Waiting for payment". Press **Cancel this unpaid order**. It becomes closed, the design returns to your cart, and nothing reaches Printify.
3. **Failure.** Start a checkout and try card `4000 0000 0000 0002`. Square documents it as a declined card for its payment APIs, so the hosted page may or may not treat it the same way. *Check, whichever happens:* an unpaid order never creates a Printify order, and the Square page stays open for another try.
4. **Missed webhook.** Pay, then immediately open **Shop, My orders** and press **Refresh status** inside the order. Even without a webhook, the order should turn paid, because the server asks Square.

## Step 10. Duplicate webhook deliveries

Square can deliver the same event more than once. The shop records each event ID once, in `shopEvents`, and ignores repeats. I could not confirm a resend button in the Console, so check it this way:

1. After a paid test order, open Databases, family, shopEvents. Each event ID appears once.
2. Press **Check payment with Square** (owner screen) or **Refresh status** five times. *Check:* the order still has exactly one `printifyOrderId`, and Printify's dashboard shows one order for it.
3. The automated tests send the same event twice, an older status after a newer one, and a repeat after a refund. They pass, which shows the logic is consistent. It does not prove Square's live delivery.

## Step 11. Make sure test payments cannot start paid Printify production

- Printify has no sandbox. A sandbox Square payment still creates a **real Printify order**, because that is the only way to test the whole chain. It is created and **held**. Printify does not make it until the shop approves it, and while `PRINTIFY_AUTO_SUBMIT=false` the shop approves nothing by itself.
- **Check before every test session:** the owner screen's Status box says "Orders go to production: only after YOU approve them". Never press **Approve and send to production** on a test order.
- **After testing:** for each test order press **Cancel at Printify** in the owner screen (Printify accepts this only before production starts). Also look at the Printify dashboard for leftover test orders.
- **Another guard:** the server accepts a payment only when it belongs to `SQUARE_LOCATION_ID` and to an order the app created. A sandbox payment cannot be mistaken for a real one, because the sandbox token and the production token talk to different Square systems. Check the Square mode line in the owner screen whenever you switch.

## Step 12. Family isolation and private orders

1. Sign in as a second family member. Paste the first member's order URL (`#/orders/<id>`). *Check:* "Order not found". Nobody else in the family sees an order. Neither do tree admins.
2. As the second member, open **Shop, My orders**. *Check:* only their own orders appear.
3. Sign in as a person from a different family. *Check:* they cannot open the shop catalog for your family and cannot use your photos.
4. Orders and delivery addresses are shown only to the buyer and to the shop owner (the user ID in `SHOP_ADMIN_USER_IDS`).

## Step 13. Production credentials and webhooks

Do this only after Steps 9 to 12 pass and you have read your account's terms (Step 1).

1. In the Developer Console, switch the toggle to **Production**. Open **Credentials** and copy the Production access token (**secret**). Open **Locations** and copy the production Location ID.
2. Create a **new** subscription in Production with the same notification URL and the same four events. Copy its Signature Key (**secret**). Square's documentation does not say whether the same subscription can serve both environments, so use a separate one and expect a different key.
3. In the Appwrite function settings change `SQUARE_ENVIRONMENT` to `production`, then replace `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID` and `SQUARE_WEBHOOK_SIGNATURE_KEY` with the production values. Save and redeploy.
4. Delete the Stripe variables.
5. **Check:** the owner screen says "Square mode: PRODUCTION (real money)" and shows your real location. Keep `PRINTIFY_AUTO_SUBMIT=false` until Step 15 is done.
6. If anything about the sandbox subscription is left over, delete it so old test events stop arriving.

## Step 14. Fees, billing and manual approval

- **Square fees.** Square's public fee page lists 2.9% + 30¢ for online payments. The same page shows another rate (3.3% + 30¢) without saying who it applies to. I could not tell which one your account gets. Check the fee rate in your own Square dashboard. Refunds: the page I read lists no refund fee, but check dispute and chargeback fees there too.
- **Printify bills you separately.** Printify charges the payment method or balance on your Printify account when you **approve** an order. Square never pays Printify. Buyers pay Square. Square pays your bank on its payout schedule. Printify charges you on approval. A gap between the two is normal: you can approve an order before the Square money has reached your bank.
- **Example (made-up Printify cost).** A $30.00 print plus $4.99 shipping is $34.99. At 2.9% + 30¢ Square keeps about $1.31, leaving $33.68. If Printify charges $15.00 for the print and $4.00 for shipping, you keep about $14.68 before taxes you owe. Use your own numbers from your Printify dashboard.
- **Manual approval.** While `PRINTIFY_AUTO_SUBMIT=false`, every paid order waits in the owner screen. Before you press **Approve and send to production**, check that the order is paid, not refunded, the photo looks right, and Printify's cost is below what the buyer paid for items plus shipping. The server blocks approval of an order that Square shows as refunded, even if the refund message has not arrived yet.

## Step 15. Optional: one real sample purchase

Do this only if you want proof that production behaves like the sandbox. It costs real money.

1. **Know the costs first:** the price you set, plus about $0.30 and 2.9% for Square (more if your account has the other rate), plus Printify's charge when you approve. Printify's charge for one print plus shipping is likely to be most of the price you set. Check whether a Square refund returns the fee (look in your account's terms).
2. Buy one item yourself, to your own address, with a card you control.
3. *Check:* the order turns paid, a Printify order appears and waits. Approve it only if you want the physical item.
4. If you do not want it, press **Cancel at Printify**, then refund the payment in the Square Dashboard.
5. *Check:* after the refund the order shows Refunded in the app (usually within a minute; press **Check for refunds in Square** if not).

## Step 16. Troubleshooting

| What you see | Likely cause | What to do |
|---|---|---|
| Pay button says payments are not set up | `SQUARE_ACCESS_TOKEN` or `SQUARE_LOCATION_ID` is missing | Step 4, then redeploy |
| Pay button says payment could not be started | Square refused the request, or its answer did not match our price | Owner screen: is the location line red? Check token, environment and location belong together. Function logs show the Square error code only |
| Owner screen: "Square said no (401 ...)" | Wrong token, or a sandbox token with `SQUARE_ENVIRONMENT=production` (or the reverse) | Re-copy the token for the matching environment |
| Owner screen: "Square said no (404 ...)" or a location error | Location ID from a different environment or account | Copy it again from Locations with the right toggle |
| Orders stay "Waiting for payment" after paying | Webhook not arriving or failing | Check the subscription is in the same environment, uses the exact URL, and has the four events. Open the order and press Refresh status. Look for `bad_signature` in the function's executions |
| Webhook shows `bad_signature` | URL differs from `WEBHOOK_BASE_URL` plus `/webhooks/square`, wrong key, or key from another subscription | Copy the URL from the owner screen again. Re-copy the Signature Key. Set `SQUARE_NOTIFICATION_URL` only if you must use a different address |
| Webhook returns `not_configured` (503) | Signature key, location, token or `WEBHOOK_BASE_URL` missing | Step 4 and 6 |
| Order is paid but marked held with "did not match" | Amount, currency, tip, or order differed from what we saved | Compare in the Square Dashboard. Nothing was sent to production. Refund or retry from the owner screen |
| Buyer paid but returned to the home page | Square did not keep the part of the address after `#` | Shop, My orders re-checks Square (Step 8) |
| Payment received but Printify order failed | Printify error | Owner screen: **Retry creating the Printify order**. The photo is not uploaded twice. If it cannot be fixed, refund in Square |
| Old order shows "stripe (old order)" | It was paid with Stripe before this change | See "Old Stripe orders" |
| Webhooks arrive after a long delay | Square or your function was slow | Nothing breaks. Events are safe to repeat and arrive in any order |

---

# Checklists

## Migration checklist

1. Nothing is deleted. Old Stripe orders stay in the table.
2. Run Block 7 (five new columns). Wait for 28 columns, all Available.
3. Deploy the new `shop-api.tar.gz`. Deploy the site at 1.29.0.
4. Set the Square sandbox variables (Step 4) and the webhook (Step 6).
5. Test Steps 9 to 12.
6. Remove the Stripe variables after you go live (Step 13) and cancel nothing else yet: Stripe is only needed if an old order needs a refund.
7. In the Stripe dashboard, delete the old webhook endpoint. The new function answers `/webhooks/stripe` with a "gone" message, so a leftover endpoint would only produce errors.

## Safe testing checklist (repeat each time)

- [ ] Owner screen says "Square mode: SANDBOX".
- [ ] "Orders go to production: only after YOU approve them".
- [ ] No test order has been approved.
- [ ] Test orders are cancelled at Printify afterwards.
- [ ] A second family member cannot open your order.
- [ ] One paid order has exactly one Printify order.
- [ ] A refunded order cannot be approved.

## Live-launch checklist

- [ ] Steps 9 to 12 passed in the sandbox.
- [ ] Square account is verified for live payments, and the payout bank is correct.
- [ ] You read your Square fee rate, payout timing and any holds.
- [ ] Production token, location and signature key are in the function settings, and the owner screen shows PRODUCTION with the right location.
- [ ] The production webhook subscription has the exact URL and the four events.
- [ ] Prices cover Printify cost, shipping you absorb, Square's fee and margin.
- [ ] Sales tax decision made (see below).
- [ ] `PRINTIFY_AUTO_SUBMIT` is still `false`.
- [ ] Optional: Step 15 sample purchase done.
- [ ] You know where your Printify billing method is set and its balance.
- [ ] The Stripe variables are deleted.

---

# What happens when something goes wrong

**Payment succeeded but Printify failed.** The order shows paid with fulfillment "failed". The shop does not refund anything by itself. Press **Retry creating the Printify order** (the same Printify `external_id` is used, so a second attempt cannot create a duplicate). If it cannot be fixed, refund the payment in the Square Dashboard. The app then shows Refunded.

**A refund in Square.** You issue refunds in Square. The app learns about them from `refund.created` and `refund.updated` messages and then asks Square for the refund. It records a refund only when Square says the refund is `COMPLETED`. A partial refund marks the order "partially refunded", and the shop does not send it to production automatically. A full refund of an order that has not shipped marks it for review with a note to cancel the Printify order. The shop does not cancel Printify orders for you, because Printify accepts that only before production starts.

**An unpaid order.** Square's payment links do not expire by themselves. The shop closes an unpaid order after 35 minutes (when the buyer next opens their cart), asks Square one last time whether it was paid, and deletes the link. If someone pays a closed order anyway, the payment is recorded, the order is held for review and nothing is sent to production. You then decide whether to fulfill or refund.

**A second payment for one order.** It is recorded with a note. Refund the extra payment in Square.

**Payments that are not from the shop.** Anything from your Square account that is not tied to an order the app created at your configured location is ignored.

## Old Stripe orders

Orders paid through Stripe before this change remain in the table. They are read-only. The shop never calls Stripe again, so the app cannot refund them or check them. Their Stripe reference shows in the owner screen as "Stripe ref". To refund one, open that payment in the Stripe dashboard (if you can sign in) or ask Stripe support. The old `stripeSessionId` and `stripePaymentIntent` columns stay in the table for this reason.

## Sales tax

`SQUARE_TAX_PERCENT` adds one flat percentage to the whole order (items and shipping) on Square's page. It is not worked out per destination. Tax rules differ by state and by product, and you are responsible for deciding whether to collect and file. Leave it unset until you know what applies. Ask a tax professional. Without it, the total the buyer sees is items plus shipping.

## Honest limitations

1. **Untested against live Square, Printify and Appwrite.** The 33 automated tests use fake versions of all three. They show the logic is consistent. They do not show that Square's real pages and messages behave the same.
2. The sandbox may differ from production (Steps 8, 9 and 15 are how you find out).
3. The return address behaviour (hash and query text) is unconfirmed.
4. No Square-collected shipping address. The app collects the address first so shipping can be priced from Printify before payment.
5. Tax is a flat percentage, not destination-based.
6. Refunds are made by you in Square. The app records them. There is no refund button.
7. Partial refunds stop automatic fulfillment and need your decision.
8. A payment link has no expiry of its own. Our 35-minute cleanup runs when the buyer opens their cart, so an abandoned order can stay open until then.
9. A slow Printify call during a webhook could pass the function's 30-second limit. The webhook answers an error and Square retries later. Repeats are safe.
10. Old Stripe orders can be refunded only in Stripe.
11. Fee figures and payout rules come from Square's public pages. Your account may differ.
12. Single merchant only: one Square account and one location, yours.

## Sources

- [Square: validate webhook notifications](https://developer.squareup.com/docs/webhooks/step3validate)
- [Square: subscribe to event notifications](https://developer.squareup.com/docs/webhooks/step2subscribe)
- [Square: Developer Console](https://developer.squareup.com/docs/devtools/developer-dashboard)
- [Square: Sandbox payments (test card values)](https://developer.squareup.com/docs/devtools/sandbox/payments)
- [Square: fees](https://squareup.com/payments/our-fees)
- [Printify developer documentation](https://developers.printify.com/)
