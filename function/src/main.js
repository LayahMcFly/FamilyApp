/*
 * family-api entrypoint (Appwrite Function, Node.js).
 *
 * Secrets stay on the server: the API key arrives per execution in the x-appwrite-key header
 * (a short-lived key limited to the scopes you tick on the function). Nothing here is sent to
 * the browser.
 */
import { Client, Account, Users, Teams, TablesDB, Storage } from 'node-appwrite';
import { createApi } from './logic.js';

const cfg = {
  databaseId: process.env.DATABASE_ID || 'family',
  bucketId: process.env.BUCKET_ID || 'family-media',
  maxOwnedFamilies: Number(process.env.MAX_OWNED_FAMILIES || 3),
  maxVideoMB: Number(process.env.MAX_VIDEO_MB || 15),
  familyStorageMB: Number(process.env.FAMILY_STORAGE_MB || 500)
};

export default async ({ req, res, log, error }) => {
  const endpoint = process.env.APPWRITE_FUNCTION_API_ENDPOINT || process.env.APPWRITE_ENDPOINT;
  const projectId = process.env.APPWRITE_FUNCTION_PROJECT_ID;
  const key = req.headers['x-appwrite-key'];
  if (!endpoint || !projectId || !key) {
    error('Missing endpoint, project id or API key header. Check the function settings.');
    return res.json({ ok: false, error: 'server_misconfigured', message: 'The server is not set up correctly.' }, 500);
  }

  let body = {};
  try {
    body = req.bodyJson && typeof req.bodyJson === 'object' ? req.bodyJson : {};
  } catch (e) {
    body = {};
  }

  // Identity comes from the caller's own JWT, which Appwrite itself verifies in account.get().
  // The JWT normally arrives in the x-appwrite-user-jwt header; the web app also sends it in
  // the body as a fallback. Either way it is only a credential to check, never a claim of who
  // the caller is, and the body is never trusted for a user id.
  let user = null;
  const jwt = req.headers['x-appwrite-user-jwt'] || (typeof body.jwt === 'string' ? body.jwt : '');
  delete body.jwt;
  if (jwt) {
    try {
      user = await new Account(new Client().setEndpoint(endpoint).setProject(projectId).setJWT(jwt)).get();
    } catch (e) {
      return res.json({ ok: false, error: 'unauthenticated', message: 'Please sign in again.' }, 401);
    }
  }

  const admin = new Client().setEndpoint(endpoint).setProject(projectId).setKey(key);
  const api = createApi({
    users: new Users(admin),
    teams: new Teams(admin),
    db: new TablesDB(admin),
    storage: new Storage(admin),
    cfg
  });

  // Optional Appwrite event trigger (teams.*.memberships.*.delete): closes direct messages of someone who left or was removed.
  if (!user && req.headers['x-appwrite-trigger'] === 'event') {
    try {
      const ev = await api.handleEvent({ event: String(req.headers['x-appwrite-event'] || ''), payload: body, deadline: Date.now() + 9000 });
      return res.json(ev.json, ev.status);
    } catch (e) {
      error(String(e && e.message ? e.message : e));
      return res.json({ ok: false, error: 'server_error' }, 500);
    }
  }

  const out = await api.handle({ user, body, deadline: Date.now() + 9000 });
  if (out.cause) error(String(out.cause && out.cause.message ? out.cause.message : out.cause));
  return res.json(out.json, out.status);
};
