# Maintenance screen

A "Maintenance" screen with a spinner can appear in two ways.

## 1. Automatically
If Family Circle cannot reach its server (for example while you redeploy the shop-api or family-api function), it shows "Maintenance" instead of an error. It tries again by itself every 15 seconds and opens the app when the server answers.

## 2. By switch, while you work
The switch is the file `maintenance.json` in the main folder.

To turn it ON:
1. Open `maintenance.json` in your GitHub repository (LayahMcFly/FamilyCircle).
2. Press the pencil (Edit).
3. Change `"on": false` to `"on": true`. Optionally change the message.
4. Press **Commit changes**. Everyone who opens or refreshes the site sees the Maintenance screen within about a minute.

To turn it OFF, change it back to `"on": false` and commit. Open pages notice within 15 seconds and reload by themselves.

The switch only hides the app's screens. It does not stop the server, so your Appwrite and Printify commands keep working.
