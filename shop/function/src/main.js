/*
 * shop-api entrypoint (Appwrite Function, Node.js).
 *
 * One function, two kinds of caller:
 *  - The FamilyCircle app, through the Appwrite SDK. The caller's own JWT is checked with Appwrite (account.get()).
 *  - Square and Printify webhooks, which post to this function's public domain at /webhooks/square and /webhooks/printify.
 *    They carry no Appwrite login; they are accepted ONLY if their signature verifies against a secret only we and the sender know.
 *
 * Every secret comes from the function's environment variables (Console > Functions > shop-api > Settings). None is ever sent to the browser.
 */
import { Client, Account, Users, TablesDB, Storage } from 'node-appwrite';
import { createShop } from './shop.js';
import { createSquare } from './square.js';
import { createPrintify } from './printify.js';
import { createCj } from './cj.js';

const env = (k, d = '') => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k]);

export default async ({ req, res, log, error }) => {
  const endpoint = process.env.APPWRITE_FUNCTION_API_ENDPOINT || process.env.APPWRITE_ENDPOINT;
  const projectId = process.env.APPWRITE_FUNCTION_PROJECT_ID;
  const key = req.headers['x-appwrite-key'];
  if (!endpoint || !projectId || !key) {
    error('Missing endpoint, project id or API key header. Check the function settings (Scopes).');
    return res.json({ ok: false, error: 'server_misconfigured', message: 'The shop is not set up correctly.' }, 500);
  }
  const squareToken = env('SQUARE_ACCESS_TOKEN');
  const squareEnvironment = env('SQUARE_ENVIRONMENT', 'sandbox') === 'production' ? 'production' : 'sandbox';
  const cfg = {
    databaseId: env('DATABASE_ID', 'family'),
    designBucketId: env('SHOP_DESIGN_BUCKET_ID', 'family-media'),
    siteUrl: env('SITE_URL', 'https://layahmcfly.github.io/FamilyCircle/'),
    adminIds: env('SHOP_ADMIN_USER_IDS').split(',').map((s) => s.trim()).filter(Boolean),
    countries: env('SHOP_COUNTRIES', 'US').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
    currency: 'usd',
    autoSubmit: env('PRINTIFY_AUTO_SUBMIT', 'false') === 'true',      // default OFF: you approve each order yourself
    taxPercent: Math.max(0, Math.min(30, Number(env('SQUARE_TAX_PERCENT', '0')) || 0)),
    supportEmail: env('SHOP_SUPPORT_EMAIL'),
    webhookBase: env('WEBHOOK_BASE_URL'),
    squareConfigured: !!squareToken,
    squareEnvironment,
    squareLocationId: env('SQUARE_LOCATION_ID'),
    squareWebhookSignatureKey: env('SQUARE_WEBHOOK_SIGNATURE_KEY'),
    squareNotificationUrl: env('SQUARE_NOTIFICATION_URL'),
    printifyConfigured: !!env('PRINTIFY_API_TOKEN'),
    printifyShopId: env('PRINTIFY_SHOP_ID'),
    printifyWebhookSecret: env('PRINTIFY_WEBHOOK_SECRET'),
    cjConfigured: !!env('CJ_API_KEY'),
    cjSandbox: env('CJ_SANDBOX', 'true') !== 'false',           // default ON: CJ orders are sandbox orders until you set CJ_SANDBOX=false
    cjAutoPay: env('CJ_AUTO_PAY', 'false') === 'true',          // default OFF: you press "Pay supplier" yourself
    returnPolicy: env('SHOP_RETURN_POLICY').slice(0, 1500)
  };
  const admin = new Client().setEndpoint(endpoint).setProject(projectId).setKey(key);
  const dbApi = new TablesDB(admin);
  // CJ's login tokens are kept in a private row (no permissions, so only this function can read it). Never sent to the browser.
  const cj = cfg.cjConfigured ? createCj({
    apiKey: env('CJ_API_KEY'),
    loadTokens: async () => { try { const r = await dbApi.getRow({ databaseId: cfg.databaseId, tableId: 'shopSettings', rowId: 'cj' }); return JSON.parse(r.value || '{}'); } catch { return {}; } },
    saveTokens: async (t) => {
      const data = { value: JSON.stringify(t) };
      try { await dbApi.updateRow({ databaseId: cfg.databaseId, tableId: 'shopSettings', rowId: 'cj', data }); }
      catch { try { await dbApi.createRow({ databaseId: cfg.databaseId, tableId: 'shopSettings', rowId: 'cj', data, permissions: [] }); } catch (e) { log('cj token save failed ' + String(e && e.message)); } }
    }
  }) : null;
  const shop = createShop({
    users: new Users(admin), db: new TablesDB(admin), storage: new Storage(admin),
    square: createSquare({ accessToken: squareToken, environment: squareEnvironment }),
    printify: createPrintify({ token: env('PRINTIFY_API_TOKEN'), shopId: cfg.printifyShopId }),
    cj,
    cfg,
    log: (...a) => log(a.join(' '))
  });

  // Webhooks: the path decides, the signature authenticates.
  const path = String(req.path || '');
  if (req.method === 'POST' && (path === '/webhooks/square' || path === '/webhooks/stripe' || path === '/webhooks/printify')) {
    const raw = typeof req.bodyRaw === 'string' ? req.bodyRaw : (typeof req.bodyText === 'string' ? req.bodyText : '');
    const out = await shop.handleWebhook(path.slice('/webhooks/'.length), raw, req.headers);
    if (out.cause) error(String(out.cause && out.cause.message ? out.cause.message : out.cause));
    return res.json(out.json, out.status);
  }

  // The app.
  let body = {};
  try { body = req.bodyJson && typeof req.bodyJson === 'object' ? req.bodyJson : {}; } catch { body = {}; }
  let user = null;
  const jwt = req.headers['x-appwrite-user-jwt'] || (typeof body.jwt === 'string' ? body.jwt : '');
  delete body.jwt;
  if (jwt) {
    try { user = await new Account(new Client().setEndpoint(endpoint).setProject(projectId).setJWT(jwt)).get(); }
    catch { return res.json({ ok: false, error: 'unauthenticated', message: 'Please sign in again.' }, 401); }
  }
  const out = await shop.handle({ user, body });
  if (out.cause) error(String(out.cause && out.cause.message ? out.cause.message : out.cause));
  return res.json(out.json, out.status);
};
