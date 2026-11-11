# Family Shop (CJdropshipping) setup guide

Version 1.46.0. Do the topics in order and stop after each one. Nothing here asks you to paste a key into a chat. Keys go only into the Appwrite function settings or a GitHub secret, and each topic says which.

**What this adds.** The shop now has a search bar, department cards and sorting, and two sections: Photo Gifts (made by Printify, unchanged) and Family Shop (bought from CJdropshipping, new). You choose which CJ products appear. Each section has its own cart and its own checkout. Shoppers pay on Square for both.

**What I could and could not test.** The server code has 79 automated tests that run against fake versions of Appwrite, Square, Printify and CJ. The new screens were checked in a headless browser at phone size, in light and dark mode, against fake shop data. Nothing has talked to the real CJ yet. Some CJ field names come from the parts of CJ's documentation I could read, so the first lookup with your own key is the real test. Topic 11 does that without ordering or paying anything.

**One honest gap in this guide.** My notes from before the session reset list 24 topics, but not your exact wording of them. I wrote the 24 topics below from what the work needs. If one of yours is missing, tell me its name and I will add it.

---

## Part 1. Get the new version live

### 1. What you are about to do (read, no action)

You will upload new files to GitHub, create three small database tables, upload a new `shop-api` function, add four settings, connect a CJ account, and test with practice money. Real money and real CJ orders come last (topic 24). Expect two to three hours in total, spread over a few sittings. You can stop at the end of any topic and the app keeps working, because the Family Shop stays closed until CJ is connected.

### 2. What you need before you start

- Your GitHub repository (`FamilyCircle`) open in a browser.
- Your Appwrite Console (nyc region) open and signed in.
- Your Square sandbox account still working from the Photo Gifts setup.
- An email address for a CJdropshipping account.
- A payment method you can add to CJ later (only needed for real orders).

### 3. How the money moves (read, no action)

Square pays you. CJ is paid separately, by you, from your CJ wallet. Square never pays CJ.

Example: a shopper buys a $16.99 blanket with $4.99 shipping. Square collects $21.98 from the shopper and sends it to you, minus Square's fee. After that, the shop creates the order at CJ. CJ's price for the blanket plus shipping might be $12.99. You pay that from your CJ wallet by pressing **Pay supplier** on the order. The difference is yours, before Square's fee.

Two rules protect you. The shop creates the CJ order only after Square confirms the payment. And it will not pay CJ for you unless you turn on `CJ_AUTO_PAY` (topic 7).

### 4. Upload the new site files to GitHub

1. Download the new `family-app` zip I sent you and unzip it on your computer. (On a phone, ask me to send the changed files one at a time instead.)
2. In your repository, upload the unzipped files over the old ones. Keep the folder names.
3. Commit with the message `Family Shop v1.46.0`.

Check: open `https://layahmcfly.github.io/FamilyCircle/` after about two minutes. Open the Shop. You should see a search bar and two tabs, and the Family Shop tab should say "Coming soon". If the old shop shows, hard-refresh the page.

### 5. Add your temporary Appwrite key to GitHub

You need this once, for the table-creating step. It is a temporary key that you delete afterward.

1. Appwrite Console, your project, Overview, API keys, Create API key. Name it `temporary shop tables`. Expiration: 1 day.
2. Give it these scopes: `databases.read`, `tables.read`, `tables.write`, `columns.read`, `columns.write`, `indexes.read`, `indexes.write`.
3. Click Create, then copy the secret. It is shown once.
4. GitHub, your repository, Settings, Secrets and variables, Actions, New repository secret. Name: `APPWRITE_KEY`. Paste the secret. Save.

Check: the secret list shows `APPWRITE_KEY`. Do not paste the key anywhere else.

### 6. Create the new tables

1. GitHub, Actions tab, choose **Add the Family Shop tables (one-time)** in the left list, press **Run workflow**, then **Run workflow** again.
2. Wait for a green check. It takes one to three minutes because Appwrite builds columns one at a time.
3. Open the run and read the log. Lines that say `created` or `exists` are fine.

Check in Appwrite, Databases, family: you now see `shopCj`, `shopCjCart` and `shopSettings`. The `shopOrders` table has new columns `supplierOrderId` and `supplierStatus`.

If it fails with a permission message, the key is missing a scope from topic 5. Make a new key with all seven and update the GitHub secret.

**Clean up now.** Delete the key in Appwrite (API keys, the three dots, Delete). Delete the `APPWRITE_KEY` secret in GitHub. Delete the file `.github/workflows/setup-shop-tables.yml` from the repository.

### 7. Upload the new shop-api function and add its settings

1. Appwrite Console, Functions, `shop-api`, Deployments, Create deployment, Manual, upload the new `shop-api.tar.gz`, entrypoint `src/main.js`, activate it. Do not upload it to `family-api`. The two functions are different.
2. Settings, Environment variables. Add these four. Existing settings stay as they are.

| Name | Value to start with | Secret? |
|---|---|---|
| `CJ_API_KEY` | leave empty until topic 10 | Yes |
| `FAMILY_SHOP_ENABLED` | `false` (the Family Shop stays hidden). Set `true` when you want it on | No |
| `CJ_SANDBOX` | `true` | No |
| `CJ_AUTO_PAY` | `false` | No |
| `SHOP_RETURN_POLICY` | Your return and cancellation rules in plain words (see example below) | No |

Example return policy text: `Photo Gifts are made to order and cannot be returned unless damaged or misprinted. Family Shop items can be returned within 14 days if unused. Email us first at help@example.com. We decide refunds case by case.` Write your own. The shop shows exactly what you type on every Family Shop product page, and says "no return policy has been published" if you leave it empty.

3. Save, then redeploy so the settings apply (Deployments, the three dots, Redeploy).

Check: open the Shop. The Family Shop tab still says "Coming soon" because `FAMILY_SHOP_ENABLED` is `false`. That is correct.

---

## Part 2. Connect CJdropshipping

### 8. Create a CJdropshipping account

1. Go to `cjdropshipping.com` and sign up with your email.
2. Verify the email and fill in the profile it asks for.

Check: you can sign in and see the CJ dashboard. CJ's screens change often, so the labels below may look slightly different from what you see. If a label is missing, tell me what your screen shows.

### 9. Get your CJ API key

1. In CJ, open your account area and look for **Authorization** or **API** (in some versions the path is Apps, Install App, then the API app).
2. On the API page choose **Add API** (or **Generate**) for an API Key.
3. Copy the key. It looks like a long string with `@api@` in the middle.

Keep this tab open. You will paste the key into Appwrite in the next topic, not into any chat or document.

### 10. Put the key into the function settings

1. Appwrite Console, Functions, `shop-api`, Settings, Environment variables.
2. Edit `CJ_API_KEY`, paste the key. Also set `FAMILY_SHOP_ENABLED` to `true`. Save and redeploy.

Check: open the Shop. The Family Shop tab no longer says "Coming soon". It says there are no products yet.

If the key is ever pasted somewhere by mistake, go back to CJ, delete that key, make a new one and repeat this topic.

### 11. Test the connection (reads only, nothing is bought)

1. Shop, scroll to the bottom, **Manage Family Shop (owner only)**, or go to `#/shop/admin/cj`.
2. Under Connection, press **Test CJ connection**. Optionally type a CJ SKU in the box first to test reading a product.

You should see a green "Logged in to CJ" line, the Square and CJ modes, and "This test only logs in and reads. It places no order and pays nothing."

What the messages mean:

| Message | What to do |
|---|---|
| CJ did not accept the shop's login | The key was pasted wrong. Redo topic 10. |
| CJ turned off API access for this account | CJ does this after 30 days with no CJ transaction. Place or pay one CJ order, then retry. |
| CJ says we are asking too fast | Wait a minute. Free accounts get one request per second. |
| `CJ_API_KEY is not set` | Redo topic 10, then redeploy. |

### 12. Understand CJ's limits and costs

- Free accounts get one API request per second and a daily allowance of "points". A keyword search costs about 50 points, most other calls about 10. Looking up a product by SKU is cheaper than searching.
- CJ's order price and CJ's shipping price are charged to your CJ wallet, separately from Square.
- I could not confirm from CJ's public documentation whether CJ charges anything for API access. Check CJ's own pricing page before you rely on this.

---

## Part 3. Add and price products

### 13. Add your first CJ product

1. `#/shop/admin/cj`, **Add a CJ product**. Type the product's SKU or ID from CJ, then **Look up on CJ**.
2. The editor opens with CJ's own title, pictures, options (variants) and stock by warehouse country.
3. Change the title and description to say what you want shoppers to read. CJ's text is often awkward. Write plain sentences.
4. Choose a department and a warehouse. Each order ships from one warehouse, so items from different warehouses cannot share a cart checkout.
5. Tick **Sell** next to each option you want to offer. Leave the rest off.
6. Leave the status on **Draft** and press **Save product**.

Check: the product appears under Your Family Shop products as DRAFT. Shoppers cannot see it.

You can look the same product up again later. The shop notices it is already saved and updates it. It never adds the same CJ product twice.

### 14. Set prices

Your price is CJ's cost plus a percent, unless you type a price for one option.

Example: CJ cost is $8.00 and you set 100 percent with ".99 endings". The shop works out $16.00, rounds up to the next .99, and shows **$16.99**, a margin of $8.99 before Square's fee and before shipping.

Shipping is separate. The shopper pays CJ's shipping cost at checkout, and you pay CJ the same shipping from your wallet.

The editor shows each option's price and margin live. It refuses to save a published product whose price is at or below CJ's cost.

### 15. Publish, feature and keep it current

1. In the product row press **Publish**. Shoppers can now see it.
2. Press **Feature** to put it in "Picked by the shop owner" at the top. For Photo Gifts, use **Feature on the shop page** on the Printify product in the main owner screen.
3. Press **Check CJ for changes** now and then. It refreshes CJ's cost, stock, pictures and options. It never changes your title, description, department, status or prices. If CJ's cost rose, it tells you, and warns you if a price is now at or below cost.

If CJ removes an option you were selling, the shop stops selling that option. If nothing is left to sell, the product switches itself off.

### 16. The Reunion Supplies department

Reunion Supplies is one of the departments. Use it for items that belong at a family gathering, such as banners, name tags, cups and table decorations.

Do not describe separate items as one kit. If you want to sell a "reunion kit", add it only if CJ lists it as one product with one SKU. Otherwise shoppers would buy several items that ship separately and arrive at different times, and the page would have promised one box.

---

## Part 4. Test safely

### 17. Test with Square practice money and a CJ sandbox order

Set up: Square in sandbox (`SQUARE_ENVIRONMENT=sandbox`), `CJ_SANDBOX=true`. This is the default.

1. Publish one product. Open the Shop as a family member, Family Shop tab, open the product and **Add to Family Shop cart**.
2. Cart, enter an address, tick the delivery box, **Check stock and calculate shipping**. You see the items, CJ's shipping option with the supplier's own estimate, and the total.
3. **Pay securely with Square**. Use Square's test card from the Square sandbox documentation.
4. Open My orders. After payment shows as confirmed, the order says the supplier is getting it ready.
5. In the owner screen, the order shows a CJ order number and "Waiting for you to pay CJ".

Check: the order exists at CJ as a practice order, and your CJ wallet did not change.

What is real and what is mocked here: Square practice payments are Square's real test system. The CJ order uses CJ's `isSandbox` setting on the order. I have not run that setting against CJ myself, so look at the order in your CJ account to confirm it is marked as a sandbox order. If it is not, stop and tell me.

### 18. Why a practice payment cannot cause a real shipment

Two locks, both built in and both tested:

- If Square is in practice mode and `CJ_SANDBOX` is `false`, the order is held with the message "Square is in test mode, so a real CJ order was blocked". Nothing is sent to CJ.
- If Square is live and `CJ_SANDBOX` is still `true`, the order is held with "CJ is still in sandbox mode". Nothing ships. You fix the setting and press **Retry**.

A paid CJ order also needs you to press **Pay supplier** unless you turn on `CJ_AUTO_PAY`. Leave it off until you trust the process.

### 19. Handle an order: pay, refresh, track

Owner screen, Orders, find the Family Shop order.

1. **Pay supplier (CJ wallet)** takes the cost from your CJ wallet. A confirmation box asks first. Use it only after you have checked the order in CJ and funded the wallet.
2. **Refresh from CJ** reads the order from CJ. Statuses only move forward. "Shipped" appears to the shopper only once CJ gives a tracking number.
3. The shopper sees tracking in My orders. The shop reads CJ when a shopper opens or refreshes the order, and when you press Refresh. It does not use CJ webhooks. CJ only sends one try and turns a webhook off after repeated failures, so I chose checking over webhooks.

### 20. When something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| "It is not certain whether CJ received the order" | The request to CJ timed out. The shop looks up your order number at CJ first, so it will not double-order. | Press **Check CJ for this order**. If CJ has it, the shop links it. If not, press **Retry**. |
| "CJ did not take the payment... wallet balance is too low" | Wallet is empty. | Add funds in CJ, then press **Pay supplier** again. It does not pay twice. |
| "CJ's price is higher than the customer paid" | CJ's cost went up after the shopper paid. The CJ order was made but not paid. | Decide: pay it and absorb the loss, cancel at CJ, or refund the shopper in Square. |
| "CJ canceled this order after the customer paid" | CJ canceled it. | Refund in Square, or place it again. |
| Shopper sees "total changed" | Stock, cost or shipping changed between the quote and the payment. | Nothing. They review the new total and approve it. |
| Order paid, supplier failed | The shopper paid and CJ did not take the order. | Fix the cause (key, wallet) and press **Retry**. The shopper stays paid. The shop never refunds by itself. |
| Same payment arrives twice | Square can send an event more than once. | Nothing. The shop ignores repeats. |

### 21. Refunds, cancellations and returns

- **Refunds** are made by you in Square. The shop notices a refund and will not pay CJ for a refunded order.
- **Cancel at CJ** only works while the order is unpaid at CJ. After you pay CJ, CJ decides.
- **Returns** follow the policy you typed in `SHOP_RETURN_POLICY`, and CJ's own return rules decide whether CJ takes the item back. Read CJ's return terms before you promise anything.
- Split or partial shipments are not tracked one by one. The shopper sees the first tracking number CJ reports.

---

## Part 5. Privacy and security

### 22. What is shared and with whom

| Who | What they receive |
|---|---|
| CJdropshipping and its carriers | Name, delivery address, email, phone (if given), and the items ordered. No photos. |
| Square | Items, amount and the shopper's email for the receipt. |
| Printify (Photo Gifts only) | The print-ready photo, after payment is confirmed, plus delivery details. |
| Your family | Nothing. Orders and addresses are private to the buyer and to you as the shop owner. |

The checkout asks the shopper to tick a box that says exactly this before they can pay.

### 23. Keep the secrets secret

- `CJ_API_KEY`, the Square token and the Printify token live only in the Appwrite function settings.
- CJ's login token is kept in a private database row that no browser can read.
- The temporary keys from topic 5 are deleted.
- Only the user IDs in `SHOP_ADMIN_USER_IDS` can open the owner screens or press any supplier button. The server checks this every time.
- Prices, costs and CJ product numbers always come from the server. The browser cannot send its own price.

---

## Part 6. Go live

### 24. Switch to real payments and real CJ orders

Do this only after topics 17 to 21 worked.

1. Fund your CJ wallet with a small amount.
2. Finish the Square production steps from `SQUARE-GUIDE.md` (production token, location, webhook) and set `SQUARE_ENVIRONMENT=production`.
3. Set `CJ_SANDBOX=false`. Redeploy.
4. Place one real order yourself, for the cheapest item, shipped to you.
5. **Approval gate:** the order will wait in "Waiting for you to pay CJ". Check its cost in CJ. Pressing **Pay supplier** spends real money from your wallet. Only press it if you agree to that cost.
6. Watch it ship. Check tracking in My orders.
7. Keep `CJ_AUTO_PAY=false` for the first few real orders.

Remember CJ's 30-day rule: if you make no CJ transaction for 30 days, CJ turns API access off. If the shop goes quiet, expect to place a small order to turn it back on.

---

## Checklists

### Shop redesign checklist

- [ ] Search bar at the top of the Shop. Typing filters the section you are in.
- [ ] Photo Gifts and Family Shop tabs. Switching tabs keeps each section's own search and filters.
- [ ] Departments show only categories that have products, with real counts.
- [ ] "Picked by the shop owner" shows only products you featured.
- [ ] Sort: featured, price low to high, price high to low, name.
- [ ] Pages of 12 with Previous and Next.
- [ ] Empty, loading and error messages appear (try a search for `zzzz`).
- [ ] Two carts: Photo Gifts cart and Family Shop cart, each keeps its items.
- [ ] The five bottom buttons and the header Shop button are unchanged.
- [ ] "Make a gift" on a photo still opens Photo Gifts.
- [ ] Nothing is hidden behind the bottom bar. Scroll to the end of each page.

### CJ setup checklist

- [ ] New site files live (topic 4).
- [ ] Three tables and two order columns exist (topic 6).
- [ ] Temporary key and secret deleted, workflow file removed.
- [ ] New `shop-api` uploaded to the right function and redeployed.
- [ ] `CJ_API_KEY`, `CJ_SANDBOX=true`, `CJ_AUTO_PAY=false`, `SHOP_RETURN_POLICY` set.
- [ ] "Test CJ connection" is green.
- [ ] One product added, priced, published.

### Privacy and security checklist

- [ ] No key was pasted into a chat, an email or a document.
- [ ] The checkout shows the delivery sharing text and requires the tick.
- [ ] No photos are sent for Family Shop items.
- [ ] A second family member cannot open your order (try it with another account).
- [ ] Only your user ID is in `SHOP_ADMIN_USER_IDS`.

### Safe test checklist

- [ ] Square is in sandbox and `CJ_SANDBOX=true`.
- [ ] A practice payment creates a CJ order marked as a sandbox order in your CJ account.
- [ ] Your CJ wallet balance did not change.
- [ ] You made no paid CJ order without reading its cost first.

### Live-launch checklist

- [ ] Square production token, location and webhook done.
- [ ] `SQUARE_ENVIRONMENT=production` and `CJ_SANDBOX=false`.
- [ ] CJ wallet funded.
- [ ] Return policy text is final.
- [ ] One real sample order placed, checked, paid at CJ on your say-so, and tracked.
- [ ] `CJ_AUTO_PAY` still `false`.

### Known limitations and costs

- The CJ code is tested against a fake CJ, not the real one. The first real lookup and sandbox order are the real tests.
- Some CJ field names come from partial documentation. If a lookup shows missing prices or pictures, tell me what CJ returned.
- CJ's documentation does not say exactly what happens when the wallet balance is too low. The shop treats any payment refusal as "needs your attention" and never retries blindly.
- No webhooks from CJ. Status updates when someone opens the order or you press Refresh.
- Split and partial shipments are not tracked individually.
- One warehouse per checkout.
- Shipping uses the cheapest option CJ lists. The delivery time shown is CJ's estimate.
- Costs you will see: Square's fee on each payment, CJ's order and shipping prices from your wallet, possibly CJ API fees (unconfirmed), and Appwrite usage within your plan.
- The redesigned screens were checked with fake shop data. Look at them on your own phone and tell me what feels wrong.
