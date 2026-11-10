# Getting your Printify products into Family Circle

**Short version.** Printify products do not appear on their own. You set up each product once in the app's owner screen (**Shop, Manage the shop, Products**). Until a product is set up **and turned on**, family members see "Not available yet". The app has seven slots: Framed photo print, Photo magnet, Photo mug, Photo blanket, Photo puzzle, and **Photo necklace** (new in 1.29.1).

## Before you start (one time)

1. The `shop-api` function is deployed and Ready.
2. These variables are set in Appwrite (Functions, `shop-api`, Settings, Environment variables): `PRINTIFY_API_TOKEN` (secret), `PRINTIFY_SHOP_ID`, `PRINTIFY_WEBHOOK_SECRET` (secret), `SHOP_ADMIN_USER_IDS` (your user ID: Console, Auth, Users, your name, User ID).
3. Your Printify token has the scopes the guide listed in step 5 of `SHOP-GUIDE.md`.

## Step 1. Connect the Printify shop

1. In the app: **Shop**, then **Manage the shop (owner only)**. If it says only the owner can open it, your user ID is wrong in `SHOP_ADMIN_USER_IDS`.
2. In the Status box, find the line **"Printify stores this token can see"**. Copy the number after `id` for the store you want to use.
3. Put that number in `PRINTIFY_SHOP_ID` (Appwrite settings), save, and redeploy `shop-api`.
4. Reopen **Manage the shop**. *Check:* the Printify line shows no red message. A red "did not accept the token" means the token is wrong, expired, or missing scopes.

## Step 2. Set up one product

1. Under **Products**, press **Set up** next to the product (start with *Photo necklace* if that's your first one).
2. **Step 1 of 3:** type a word into the search box (for example `necklace`, `pendant` or `mug`) and press **Search**. Tap the Printify product you want. Printify calls these *blueprints*.
3. **Step 2 of 3:** choose a *print provider*. Prices, locations and production times differ, so compare them in your Printify dashboard first.
4. **Step 3 of 3:** choose the **print area** (usually `front`), tick each variant you want to sell (size, color, chain style), and type **your selling price** for each. Look up Printify's cost for the same variant first, so your price covers cost, shipping you don't pass on, Square's fee and a margin.
5. Tick **Turn this product on for shoppers right away** only when you're ready. Leave it unticked while testing.
6. Press **Check with Printify and save**. The server asks Printify to confirm every variant and print area, and stores the real print-area size.

## Step 3. Turn it on and look at it

1. Back on the Products list, press **Turn on** for the product.
2. As a family member, open a **photo** post, tap its menu, and choose **Make a gift**. The photo's owner must first allow gifts: menu, **Allow gifts with this photo…**.
3. *Check:* the product shows with its "from" price.

## Why you can't see products

| What you see | Cause | Fix |
|---|---|---|
| "Not available yet" | The product isn't set up, or it's saved but OFF | Steps 2 and 3 |
| No "Make a gift" button | The post isn't a photo, or the shop is off in `config.js` | Use a photo post; `shopEnabled` must not be `false` |
| "Allow gifts…" not ticked | The photo's owner hasn't allowed gifts | Tick it on that photo |
| Search finds nothing | Printify rejected the token, or the word is too narrow | Check Step 1; try a shorter word |
| Printify error in the wizard | Token scopes, wrong store ID, or Printify is down | Re-check the token and `PRINTIFY_SHOP_ID` |

## Jewelry (necklaces)

- The **Photo necklace** slot works like the others. You pick a Printify necklace or pendant blueprint, a provider and the variants.
- **Not verified:** I could not test any real Printify jewelry blueprint. Some pendants have small or shaped print areas, or print a design on both sides. The app only supports **one photo on one print area per product**. If the wizard shows a print area that is tiny (it shows the size in pixels next to each variant), the photo may print at low resolution, and the app will warn about it.
- If the blueprint you want is not offered with one clear print area, tell me its name and I'll check how it fits.
- One necklace slot means one blueprint at a time. If you want a separate pendant, bracelet or keychain, ask and I'll add more slots.
