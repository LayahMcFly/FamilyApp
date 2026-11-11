# Optional home address: what it does and how to set it up

**Short version:** every member can save one optional address. It is private by default. They can choose which of their families may see it. Nobody can read it straight from the database, because it lives in a table that has no permissions at all. Only the `family-api` function can open it, and it checks who is asking every time.

Shared with family does not mean public on the internet. Only confirmed members of the families the owner ticked can see it.

## How access works

| Person | Can they see the address? |
|---|---|
| The owner | Yes, in Settings, Privacy and personal information. Can edit or delete it. |
| A member of a family the owner ticked | Yes, on the owner's profile, only while they are still a confirmed member of that family. |
| A member of a family the owner did not tick | No. |
| A family owner or tree admin of a family the owner did not tick | No. Being an admin gives nothing extra. |
| A family owner or tree admin of a family the owner did tick | Yes, as an ordinary member of that family. |
| Someone who was removed from the family, or never accepted the invitation | No, the next time they ask. |
| A signed-out visitor | No. |
| Anyone calling Appwrite directly with the row id | No. The row has no permissions. |

- Choosing **Only me** removes everyone's access straight away. Unticking one family removes that family only.
- A family joined later is never added automatically.
- If the owner leaves a family, that family can no longer see the address.
- Nothing is saved in localStorage, sessionStorage or any offline cache. The address is in the page only while it is on screen.
- Shared addresses are never in posts, notifications, search, activity or any profile list. Only the Address card on a profile asks for it, and only when the server allows it.
- The address is never added to a person in the family tree. The feature is for signed-in members and their own details only.
- Saving an address does not send it to Printify, Square or the shop. In the cart, **Use my saved address** fills the delivery form only when tapped. Every line stays visible and editable, and nothing goes to the shop until Pay. Shop delivery addresses are never shown to relatives.
- Deleting the saved address does not delete delivery details kept separately for orders already placed. It also cannot erase copies someone already made (a screenshot, for example).

## Google Maps (free, no key)

The buttons build ordinary Google Maps links at the moment of the tap. Nothing is stored, and Google is not contacted before the tap or while typing.

- Open in Google Maps: `https://www.google.com/maps/search/?api=1&query=<address>`
- Get directions: `https://www.google.com/maps/dir/?api=1&destination=<address>` (no origin, so Google Maps lets the viewer choose where to start; it may offer the device location, which is Google Maps asking, not Family Circle)
- Copy address: copies the text on that device only.

Google's Maps URLs page (developers.google.com/maps/documentation/urls/guide) says no API key is needed, spaces may be `%20` or `+`, and a URL is limited to 2,048 characters. If an address would be longer, the app asks the person to use Copy address.

## The table

**Table ID:** `addresses` (type it exactly) in the `family` database.

| Column key | Type | Size | Required | Notes |
|---|---|---|---|---|
| `ownerId` | String | 36 | Yes | The owner's user id. Set by the server from the verified login, never from the request. |
| `line1` | String | 200 | Yes | Address line 1 |
| `line2` | String | 200 | No | Apartment, unit |
| `city` | String | 120 | No | City or locality |
| `region` | String | 120 | No | State, province or region |
| `postal` | String | 40 | No | ZIP or postal code |
| `country` | String | 100 | Yes | Free text, so any country works |
| `sharedWith` | String | 2000 | No | A list of family ids the owner picked, as JSON text. No other family can match. |

- **Row id:** the owner's user id, so each person has at most one address and it needs no index.
- **Indexes:** none, on purpose. Nothing can search or list addresses.
- **Table permissions:** none. Leave every box empty.
- **Row security:** ON, like the other tables. Rows are created with an empty permission list, so no browser session can read, change or delete them.
- Optional extra: if the Console shows an **Encrypted** option when you create a column, you can tick it for `line1` to `country`. It cannot be changed later, and nothing needs to search these columns.

## Setup, step by step

1. **Create the table.** Appwrite Console, open your project, Databases, `family`, Create table. Name it `addresses` and set the Table ID to `addresses`. Leave table Permissions empty. Turn Row security on.
2. **Add the eight columns** from the table above, one at a time (Columns tab, Create column, String). Wait until each one says Available before adding the next. Do not create any index.
3. **Confirm there are no permissions.** Open the table's Settings tab. The Permissions section must be empty.
4. **Deploy the new family-api code.** Console, Functions, `family-api`, Deployments, Create deployment, upload the `family-api.tar.gz` I sent (it contains `package.json` and `src`). Use entrypoint `src/main.js` and install command `npm install`, the same as before. Wait for Ready. This also changes the default video limit to 15 MB.
5. **Check the function permissions.** Functions, `family-api`, Settings, Scopes. It must already include the database rows scopes (read and write) and `users.read`. It does, because the rest of the app uses them.
6. **Turn off execution logging for family-api.** Functions, `family-api`, Settings, Logging: switch it off, then Update. This asks Appwrite not to keep request contents (which include the address while it is saved) in its Executions list. After saving an address, open Functions, `family-api`, Executions and look at the newest one. If the request body is still shown, tell me.
7. **Publish the website.** The files are already on GitHub Pages (version 1.43.0). Wait about a minute, then refresh the site.
8. **Try it yourself.** Settings, Privacy and personal information, My address, Add an address.
9. **Prove that direct access is refused (recommended before you rely on it).** On a computer with Node, open a terminal in the `setup` folder and run (use your own values; the password stays on your computer):
   `APPWRITE_ENDPOINT=https://nyc.cloud.appwrite.io/v1 APPWRITE_PROJECT=6aef6a03002636be44c2 OWNER_ID=<the owner's user id from Appwrite, Auth, Users> OTHER_EMAIL=<another member's email> OTHER_PASSWORD=<their password> node verify-address-privacy.mjs`
   Every line must say PASS. If any says FAIL, do not use the feature and tell me.
10. **Verify the Maps links with no key.** On the Address card, tap Open in Google Maps and Get directions. Google Maps opens in a new tab with the address filled in. Leave your Google account signed out if you like; it still works.
11. **Optional cleanup.** If you used the setup script instead of the Console for steps 1 and 2, delete its temporary API key afterwards.

You can create the table with the existing setup script instead of the Console (it now includes `addresses`). It needs a temporary API key like the first time; see `SETUP-SCRIPT.md`.

## What I tested, and what I could not

**Tested automatically (8 address tests, all passing, against a simulated Appwrite; 49 tests in the function in all):**
- The owner, an authorized member, a member of an unselected family, a family owner who was not granted access, a removed member, an invitation not yet accepted, and a signed-out caller. Only the owner and the authorized member get the address.
- Direct reads: the stored row has an empty permission list, so the simulated permission check refuses everyone, including the owner and family owners.
- Default Only me; sharing with one family and not another; revoking; the owner leaving a family; editing; deleting; another person's id in the request being ignored; sharing to a family you are not in being refused.
- Apartment numbers and international characters (accented and Japanese addresses).
- Maps links: both links build correctly with correct encoding, no origin on directions, and `google.com` appears in only one place in the code, inside the function that runs after a tap.

**Not tested here (needs your project):**
- Real Appwrite refusing direct reads. Step 9 checks exactly that. Until it passes, treat the privacy claim as unconfirmed.
- The screens on a real phone.
- Whether Google Maps opens as expected on every phone. Step 10 checks that.
