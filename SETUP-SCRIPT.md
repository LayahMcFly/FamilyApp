# Build the database and bucket with one script

This replaces guide steps 4 and 5 (database, six tables, 26 columns, 16 indexes, and the media bucket). You still create the Function by hand (step 6), because it needs your code uploaded.

You will make a temporary API key, run the script once, then delete the key. The key is a password to your whole project, so never paste it into the website, GitHub or a chat.

## A. Make a temporary API key

1. Appwrite Console > your project > **Overview** > **Integrations** > **API keys** > **Create API key**.
2. Name: `setup-temp`. Expiration: **1 day**.
3. Tick these scopes: `databases.read`, `databases.write`, `tables.read`, `tables.write`, `columns.read`, `columns.write`, `indexes.read`, `indexes.write`, `buckets.read`, `buckets.write`.
4. Create it and copy the secret key (shown once).

## B. Run the script

Pick one way.

**Way 1: your computer.** Install Node.js (the "LTS" download at https://nodejs.org). Open Terminal (Mac) or PowerShell (Windows), then go to the `setup` folder from the download:

```bash
cd path/to/family-app/setup
npm install
```

Mac or Linux:

```bash
APPWRITE_ENDPOINT="https://nyc.cloud.appwrite.io/v1" APPWRITE_PROJECT="6aef6a03002636be44c2" APPWRITE_KEY="PASTE-THE-KEY-HERE" node setup-appwrite.mjs
```

Windows PowerShell (three lines, then the run line):

```powershell
$env:APPWRITE_ENDPOINT="https://nyc.cloud.appwrite.io/v1"
$env:APPWRITE_PROJECT="6aef6a03002636be44c2"
$env:APPWRITE_KEY="PASTE-THE-KEY-HERE"
node setup-appwrite.mjs
```

**Way 2: no install.** Upload the `setup` folder to any GitHub repository, open the repository, press **Code > Codespaces > Create codespace**, and use the terminal at the bottom (Node is already there). Run the same commands as Way 1. Delete the codespace afterward. The key is never saved in the repository, because you type it only in the terminal.

## C. What you should see

Lines that say `created` or `exists`, then `Done.` It takes about two minutes because Appwrite builds columns one batch at a time. Running it twice is safe.

## D. Delete the key

Console > API keys > `setup-temp` > Delete. Then continue with guide step 6 (the Function).

## If it stops

| Message | Meaning |
|---|---|
| `FAILED ... code 401` | The key is missing a scope. Make a new key with every scope in section A |
| `Missing APPWRITE_ENDPOINT...` | One of the three values was not set in the same terminal window |
| `command not found: node` | Node.js is not installed, use Way 2 |

Copy the last 5 lines of the output and send them to me.
