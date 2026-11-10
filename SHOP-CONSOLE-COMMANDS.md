# Shop database: Appwrite Console terminal commands

Use the **Terminal** in the Appwrite Console (the one that says `This is the Appwrite CLI`). Paste **one block at a time**. Each line is one command that starts with `appwrite`. Nothing here is secret. Wait for the prompt to come back after each block. If a line says the item already exists, that is fine; carry on.

Do not paste anything from the guide that is not inside a gray code box. The diagrams in the guide are pictures, not commands.

If a command complains about a flag name, run the same command ending in `--help` to see the exact spelling, and tell me what it shows.


## Block 1: shopCatalog

```
appwrite tablesdb create-table --database-id family --table-id shopCatalog --name shopCatalog --row-security true
appwrite tablesdb create-string-column --database-id family --table-id shopCatalog --key title --size 80 --required true
appwrite tablesdb create-string-column --database-id family --table-id shopCatalog --key blurb --size 300 --required false
appwrite tablesdb create-boolean-column --database-id family --table-id shopCatalog --key enabled --required false
appwrite tablesdb create-integer-column --database-id family --table-id shopCatalog --key blueprintId --required true
appwrite tablesdb create-integer-column --database-id family --table-id shopCatalog --key providerId --required true
appwrite tablesdb create-string-column --database-id family --table-id shopCatalog --key position --size 40 --required true
appwrite tablesdb create-text-column --database-id family --table-id shopCatalog --key variants --required true
appwrite tablesdb create-string-column --database-id family --table-id shopCatalog --key verifiedAt --size 32 --required false
```


## Block 2: shopDesigns

```
appwrite tablesdb create-table --database-id family --table-id shopDesigns --name shopDesigns --row-security true
appwrite tablesdb create-string-column --database-id family --table-id shopDesigns --key ownerId --size 36 --required true
appwrite tablesdb create-string-column --database-id family --table-id shopDesigns --key familyId --size 36 --required true
appwrite tablesdb create-string-column --database-id family --table-id shopDesigns --key postId --size 36 --required true
appwrite tablesdb create-string-column --database-id family --table-id shopDesigns --key productKey --size 40 --required true
appwrite tablesdb create-integer-column --database-id family --table-id shopDesigns --key variantId --required true
appwrite tablesdb create-string-column --database-id family --table-id shopDesigns --key fileId --size 36 --required true
appwrite tablesdb create-string-column --database-id family --table-id shopDesigns --key fileSha --size 64 --required true
appwrite tablesdb create-integer-column --database-id family --table-id shopDesigns --key width --required true
appwrite tablesdb create-integer-column --database-id family --table-id shopDesigns --key height --required true
appwrite tablesdb create-text-column --database-id family --table-id shopDesigns --key spec --required true
appwrite tablesdb create-integer-column --database-id family --table-id shopDesigns --key quantity --required true
appwrite tablesdb create-string-column --database-id family --table-id shopDesigns --key orderId --size 40 --required false
```

Wait about 30 seconds so the columns finish building, then paste the index lines for shopDesigns:

```
appwrite tablesdb create-index --database-id family --table-id shopDesigns --key idx_ownerId --type key --columns ownerId
appwrite tablesdb create-index --database-id family --table-id shopDesigns --key idx_familyId --type key --columns familyId
appwrite tablesdb create-index --database-id family --table-id shopDesigns --key idx_orderId --type key --columns orderId
```


## Block 3: shopOrders

```
appwrite tablesdb create-table --database-id family --table-id shopOrders --name shopOrders --row-security true
appwrite tablesdb create-string-column --database-id family --table-id shopOrders --key ownerId --size 36 --required true
appwrite tablesdb create-string-column --database-id family --table-id shopOrders --key familyId --size 36 --required true
appwrite tablesdb create-string-column --database-id family --table-id shopOrders --key paymentStatus --size 24 --required true
appwrite tablesdb create-string-column --database-id family --table-id shopOrders --key fulfillmentStatus --size 24 --required true
appwrite tablesdb create-text-column --database-id family --table-id shopOrders --key items --required true
appwrite tablesdb create-text-column --database-id family --table-id shopOrders --key address --required true
appwrite tablesdb create-integer-column --database-id family --table-id shopOrders --key subtotalCents --required true
appwrite tablesdb create-integer-column --database-id family --table-id shopOrders --key shippingCents --required true
appwrite tablesdb create-integer-column --database-id family --table-id shopOrders --key taxCents --required false
appwrite tablesdb create-integer-column --database-id family --table-id shopOrders --key totalCents --required true
appwrite tablesdb create-string-column --database-id family --table-id shopOrders --key currency --size 3 --required true
appwrite tablesdb create-string-column --database-id family --table-id shopOrders --key stripeSessionId --size 120 --required false
appwrite tablesdb create-string-column --database-id family --table-id shopOrders --key stripePaymentIntent --size 120 --required false
appwrite tablesdb create-text-column --database-id family --table-id shopOrders --key checkoutUrl --required false
appwrite tablesdb create-string-column --database-id family --table-id shopOrders --key printifyOrderId --size 40 --required false
appwrite tablesdb create-string-column --database-id family --table-id shopOrders --key printifyStatus --size 40 --required false
appwrite tablesdb create-integer-column --database-id family --table-id shopOrders --key printifyCostCents --required false
appwrite tablesdb create-text-column --database-id family --table-id shopOrders --key tracking --required false
appwrite tablesdb create-string-column --database-id family --table-id shopOrders --key lastError --size 600 --required false
appwrite tablesdb create-string-column --database-id family --table-id shopOrders --key consentAt --size 32 --required false
appwrite tablesdb create-integer-column --database-id family --table-id shopOrders --key consentVersion --required false
appwrite tablesdb create-string-column --database-id family --table-id shopOrders --key needsReview --size 24 --required false
appwrite tablesdb create-string-column --database-id family --table-id shopOrders --key paidAt --size 32 --required false
```

Wait about 30 seconds so the columns finish building, then paste the index lines for shopOrders:

```
appwrite tablesdb create-index --database-id family --table-id shopOrders --key idx_ownerId --type key --columns ownerId
appwrite tablesdb create-index --database-id family --table-id shopOrders --key idx_printifyOrderId --type key --columns printifyOrderId
```


## Block 4: shopEvents

```
appwrite tablesdb create-table --database-id family --table-id shopEvents --name shopEvents --row-security true
appwrite tablesdb create-string-column --database-id family --table-id shopEvents --key source --size 12 --required true
appwrite tablesdb create-string-column --database-id family --table-id shopEvents --key eventId --size 80 --required true
appwrite tablesdb create-string-column --database-id family --table-id shopEvents --key type --size 80 --required false
appwrite tablesdb create-string-column --database-id family --table-id shopEvents --key note --size 200 --required false
```


## Block 5: giftPermissions

```
appwrite tablesdb create-table --database-id family --table-id giftPermissions --name giftPermissions --row-security true
appwrite tablesdb create-string-column --database-id family --table-id giftPermissions --key familyId --size 36 --required true
appwrite tablesdb create-string-column --database-id family --table-id giftPermissions --key postId --size 36 --required true
appwrite tablesdb create-string-column --database-id family --table-id giftPermissions --key ownerId --size 36 --required true
appwrite tablesdb create-boolean-column --database-id family --table-id giftPermissions --key allowed --required true
```

Wait about 30 seconds so the columns finish building, then paste the index lines for giftPermissions:

```
appwrite tablesdb create-index --database-id family --table-id giftPermissions --key idx_familyId --type key --columns familyId
appwrite tablesdb create-index --database-id family --table-id giftPermissions --key idx_postId --type key --columns postId
```


## Block 6: one more index (no new bucket)

Your free plan allows only 1 bucket, so gift designs are stored in the existing `family-media` bucket. They are private to each buyer. The family-api cleanup job needs one index to recognise them. Wait for the shopDesigns columns to say Available, then paste:

```
appwrite tablesdb create-index --database-id family --table-id shopDesigns --key idx_fileId --type key --columns fileId
```

Then update the family-api function with the new `family-api.tar.gz` (Deployments, Create deployment, Manual, upload, activate). Do this **before** anyone saves a gift design. Until it is live, the old cleanup could remove design files after an hour.

## Check

In the Console, open Databases, family. You should see five new tables, and and no new bucket (the shop uses family-media). Table permissions must be empty and Row security on for each table.


## Catch-up block (only if the Console shows something missing)

Pasting many lines at once can drop the last line of a block. These re-create the last item of each table. If one already exists you will see an "already exists" error, which is fine. Paste them one at a time, wait for the prompt, then count what the Console shows.

```
appwrite tablesdb create-string-column --database-id family --table-id shopCatalog --key verifiedAt --size 32 --required false
appwrite tablesdb create-string-column --database-id family --table-id shopDesigns --key orderId --size 40 --required false
appwrite tablesdb create-index --database-id family --table-id shopDesigns --key idx_orderId --type key --columns orderId
appwrite tablesdb create-string-column --database-id family --table-id shopOrders --key paidAt --size 32 --required false
appwrite tablesdb create-index --database-id family --table-id shopOrders --key idx_printifyOrderId --type key --columns printifyOrderId
appwrite tablesdb create-string-column --database-id family --table-id shopEvents --key note --size 200 --required false
appwrite tablesdb create-boolean-column --database-id family --table-id giftPermissions --key allowed --required true
appwrite tablesdb create-index --database-id family --table-id giftPermissions --key idx_postId --type key --columns postId
```

Expected counts in Databases, family: shopCatalog 8 columns; shopDesigns 12 columns and 4 indexes (including idx_fileId); shopOrders 23 columns and 2 indexes; shopEvents 4 columns; giftPermissions 4 columns and 2 indexes. Every column and index should say Available.
