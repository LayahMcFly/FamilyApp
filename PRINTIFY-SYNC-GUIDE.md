# Sync your Printify store products into Family Circle

Make and edit your products in Printify. Family Circle reads them from your own shop and sells them. You do not retype product IDs.

## Two different Printify lists

- **Catalog** (blank products Printify offers, such as "Oval Necklace" or "Mug"). The old "Set up" wizard used this. It has been removed from the owner screen.
- **Your shop's products** (the ones you created, such as "Personalized Photo Oval Necklace"). The new **Sync from Printify** button reads these through `GET /v1/shops/{shop_id}/products.json`.

## What is synced and what stays local

| Comes from Printify on every sync | Stays in Family Circle |
|---|---|
| Title and description | Whether customers can see the product (Show / Hide) |
| Product picture (Printify's mockup) | Which section it sits in (Photo gifts or Jewelry) |
| Printify product ID, blank-product ID and print provider ID | The buyer's photo, designs, carts and orders |
| Sizes and styles that are switched ON in Printify, with their selling prices | Square payments and tax |
| The one print area and its size in pixels (read from Printify's catalog) | Whether orders go to production automatically |

Not copied: the template artwork on your Printify product. Each buyer's own photo is sent with their order instead.

New products start hidden unless you tick "Show NEW products to customers right away". Your Show/Hide and section choices survive later syncs. If you delete a product in Printify, the next sync hides it here (it is never deleted here, and nothing is ever changed or deleted in Printify).

## Drafts and published products

Sync imports both. It applies no filter on Printify's "visible" or "published" field. The product list shows "Printify: draft" or "Printify: published" for information only. A custom site like Family Circle needs no publishing step in Printify: it reads the product list directly. A product is visible to customers only when it is imported, supported (see below) and shown (ON).

## Personalized family photos

An imported product is a template. When a buyer designs one:

1. The photo is checked: it must be their own upload, or a family photo whose owner allowed gift use.
2. The finished design is saved as that buyer's own file, in their own design record.
3. After payment, the server uploads that one image to Printify and creates an order with your product's blank-product ID, print provider, size and the buyer's image. Your Printify product is never edited, so one buyer's photo cannot appear on another buyer's order.

Family Circle does not use Printify's newer "personalization" fields. It sends a finished image.

## Products the photo editor cannot fill

These are flagged in red with the reason and cannot be turned on:

- Prints on more than one area (for example front and back). The editor fills one area.
- No print area saved yet in Printify.
- No variants switched on in Printify.
- Printify's catalog gave no print size for the variants.
- Too many variants to store (switch some off in Printify).

Variants that are unavailable, have no size, or have a price outside $1.00 to $1,000.00 are left out and listed under the product.

## Steps

**1. Verify the correct Printify shop**

1. Open Family Circle, then Manage the shop, then Products.
2. Press **Check Printify connection**.
3. Read the list of your Printify shops with their product counts. The one with an arrow is the shop this site uses. If your products are in a different shop, note its ID.

**2. Check the token permissions**

The same result lists each permission with ✓ or ✗: shops.read, products.read, catalog.read, orders.read, uploads.read, webhooks.read. A ✗ on products.read means the token cannot see your products. The write permissions (orders.write, uploads.write, webhooks.write) cannot be tested without placing an order, so tick every permission when you make a token.

**3. Update the backend configuration, only if step 1 or 2 showed a problem**

1. Appwrite Console, then Functions, then **shop-api**, then **Settings**, then Environment variables.
2. Wrong shop: edit `PRINTIFY_SHOP_ID` and paste the right ID (it is not a secret).
3. Bad token: make a new token in Printify with all permissions ticked, then edit `PRINTIFY_API_TOKEN` (keep it marked secret). Never paste a token into this chat.
4. Press Update, then go to Deployments and **Redeploy**.

**4. Deploy the changes**

1. Upload `shop-api.tar.gz` (version 1.31.0) as a new deployment of shop-api, the same way as last time, and activate it.
2. The website files update by themselves through GitHub. Wait about a minute and hard-refresh. The footer should say 1.31.0.

**5. Sync your products**

1. Manage the shop, then Products, then **Sync from Printify**.
2. It reads your shop 10 products at a time and shows progress. When it finishes, your products appear under "Your Printify store products".
3. If the list is empty you get a specific message: wrong shop, missing permission, no products in that shop, or Printify failing.

**6. Verify an imported product and its variants**

1. Check the title, picture, variant count and price range against Printify.
2. Press **Show to customers**. Pick the right section from the dropdown.
3. Open the Shop page, open the product, and compare each size or style and its price with Printify.
4. A red message under a product explains why it cannot be sold. Fix it in Printify and sync again.

**7. Test customization without paid production**

1. Keep `PRINTIFY_AUTO_SUBMIT=false` and Square in Sandbox. Printify has no practice mode, but with auto-submit off nothing is produced until you approve it.
2. Open a product, add a photo, move and zoom it, and save. This creates no order and no charge.
3. Add to cart, check out, and pay with Square's test card 4111 1111 1111 1111, any future date, CVV 111.
4. In Printify, open Orders. The test order waits there. **Cancel it in Printify** and do not press approve here.


## Cart preview picture (needs one more permission)

When someone adds a design to the cart, the shop asks Printify for a real picture of the product with their photo on it. To do that it makes a temporary product in your Printify shop named **FC preview …**, copies Printify's picture into the buyer's private storage, then deletes the temporary product. It never touches your real products, and the product sync ignores these temporary ones.

This needs the token permission **products.write**. If the cart shows a note starting "Owner:" under a design, make a new token with products.write ticked and update PRINTIFY_API_TOKEN. If you ever see a leftover **FC preview** product in Printify, it is safe to delete. Buying still works if the preview fails; the cart just keeps the flat design picture.

## Photo products and words products

Each product is either **Buyer adds a photo** or **Buyer types words** (an engraved name bar, for example). The sync guesses from the name: anything that mentions a photo is a photo product, and names like "Engraved Name Bar" become words products. If it guessed wrong, change it in the owner page next to the section menu; your choice is kept on every later sync. Shoppers can filter the shop by All, Photo or Words.

For a words product the buyer types up to 40 letters, picks a letter style, and the shop sends Printify an image of those words in black on white, sized to the product's print area. **Not verified:** how Printify's engraving or print provider treats a black-on-white image. Add one to the cart and look at the cart preview picture Printify makes; if the engraving looks wrong, tell me before taking real orders.
