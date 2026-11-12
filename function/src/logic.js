/*
 * family-api: all trusted logic. No network or SDK construction happens in this file,
 * so it can be unit-tested with fakes (see ../test/logic.test.js).
 *
 * Trust model
 *  - `user` is the account returned by Appwrite for the caller's own JWT. It is never
 *    taken from the request body.
 *  - Every action that touches a family re-checks, on the server, that the caller holds
 *    a CONFIRMED membership in that family's Appwrite Team and that the Team is registered
 *    in the `families` table.
 *  - Rows are written with read permission for exactly one role: team:<familyId>
 *    (or user:<id> for bookmarks). Clients get no table-level write permission at all.
 */
import { Query, Permission, Role, ID } from 'node-appwrite';
import { createChat } from './chat.js';

export const TABLES = {
  families: 'families',
  profiles: 'profiles',
  posts: 'posts',
  comments: 'comments',
  reactions: 'reactions',
  bookmarks: 'bookmarks',
  people: 'people',
  suggestions: 'suggestions',
  addresses: 'addresses',      // private home addresses: NO client permissions at all, only this function reads or writes them
  shopDesigns: 'shopDesigns'   // optional shop: its print files share this bucket, so the cleanup must not delete them
};

export const LIMITS = {
  bodyMax: 2000,
  commentMax: 500,
  nameMax: 60,
  imageMaxBytes: 8 * 1024 * 1024,
  avatarMaxBytes: 1024 * 1024,
  avatarGifMaxBytes: 2 * 1024 * 1024,
  bannerMaxBytes: 3 * 1024 * 1024,      // profile banner: a wide picture or a looping GIF   // a looping GIF picture may be a little larger
  bioMax: 200,
  aboutCategories: 10,
  aboutItems: 12,
  aboutTitleMax: 32,
  aboutItemMax: 40,
  personNameMax: 80,
  maxPeople: 300,
  maxParents: 6,
  maxPartners: 8,
  suggestionMax: 500
};

// How a parent is related to a child. "birth" is the default and is never stored.
export const PARENT_KINDS = ['birth', 'adoptive', 'step', 'foster', 'guardian'];

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/;
const KINDS = ['text', 'photo', 'video', 'short'];
export const REPOST_NOTE = 'Remember this day?';

/* Automatic captions are made on the viewer's phone and saved as a short list of [start, end, text].
   The server re-checks the list so nobody can store anything else in that column. */
export const CAPTION_LIMITS = { maxCues: 400, maxText: 200, maxSeconds: 7200, maxChars: 16000 };
export function cleanCaptions(raw) {
  if (raw === null || raw === undefined || (Array.isArray(raw) && raw.length === 0)) return '';
  if (!Array.isArray(raw)) throw bad('Captions must be a list.');
  if (raw.length > CAPTION_LIMITS.maxCues) throw bad('Captions can have at most ' + CAPTION_LIMITS.maxCues + ' lines.');
  const out = [];
  let prev = 0;
  for (const c of raw) {
    if (!Array.isArray(c) || c.length !== 3) throw bad('A caption line is not in the right format.');
    const start = Number(c[0]), end = Number(c[1]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > CAPTION_LIMITS.maxSeconds || start < prev) {
      throw bad('Caption times must be in order.');
    }
    if (typeof c[2] !== 'string') throw bad('A caption line is not in the right format.');
    const text = c[2].replace(/[\u0000-\u001f\u007f<>&]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (text.length > CAPTION_LIMITS.maxText) throw bad('A caption line is too long.');
    out.push([Math.round(start * 10) / 10, Math.round(end * 10) / 10, text]);
    prev = start;
  }
  if (!out.length) return '';
  const json = JSON.stringify(out);
  if (json.length > CAPTION_LIMITS.maxChars) throw bad('These captions are too long to save.');
  return json;
}
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const bad = (m) => new ApiError(400, 'bad_request', m);
const forbidden = (m = 'You do not have access to do that.') => new ApiError(403, 'forbidden', m);
const missing = (m = 'Not found.') => new ApiError(404, 'not_found', m);

const libraryOf = (v) => {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v !== 'string' || !/^[a-z0-9]{1,24}$/.test(v)) throw bad('That library is not valid.');
  return v;
};

const sdkCode = (e) => (e && typeof e.code === 'number' ? e.code : 0);

export function createApi({ users, teams, db, storage, cfg, now = () => Date.now() }) {
  const databaseId = cfg.databaseId;
  const bucketId = cfg.bucketId;
  const maxOwned = cfg.maxOwnedFamilies;
  const maxVideoBytes = cfg.maxVideoMB * 1024 * 1024;
  // Per-family storage allowance for photos and videos. The Appwrite plan's storage is shared by
  // every family, so this keeps one family from using it all. It is a setting, not a promise of
  // unlimited space, and reaching it only pauses new uploads: nothing is ever deleted for it.
  const familyStorageBytes = Math.round((Number(cfg.familyStorageMB) > 0 ? Number(cfg.familyStorageMB) : 500) * 1024 * 1024);

  async function familyUsedBytes(familyId) {
    let used = 0;
    let cursor = null;
    for (let i = 0; i < 200; i++) {
      const q = [Query.equal('familyId', [familyId]), Query.limit(100)];
      if (cursor) q.push(Query.cursorAfter(cursor));
      const page = await listRows(TABLES.posts, q);
      for (const r of page.rows) used += Number(r.mediaSize || 0);
      if (page.rows.length < 100) break;
      cursor = page.rows[page.rows.length - 1].$id;
    }
    return used;
  }

  /* ---------- small data helpers ---------- */
  const listRows = (tableId, queries) => db.listRows({ databaseId, tableId, queries });
  const createRow = (tableId, rowId, data, permissions) =>
    db.createRow({ databaseId, tableId, rowId, data, permissions });
  const updateRow = (tableId, rowId, data) => db.updateRow({ databaseId, tableId, rowId, data });
  const deleteRow = (tableId, rowId) => db.deleteRow({ databaseId, tableId, rowId });
  async function getRowOrNull(tableId, rowId) {
    try {
      return await db.getRow({ databaseId, tableId, rowId });
    } catch (e) {
      if (sdkCode(e) === 404) return null;
      throw e;
    }
  }
  async function firstRow(tableId, queries) {
    const r = await listRows(tableId, [...queries, Query.limit(1)]);
    return r.rows[0] || null;
  }
  async function getFileOrNull(fileId) {
    try {
      return await storage.getFile({ bucketId, fileId });
    } catch (e) {
      if (sdkCode(e) === 404) return null;
      throw e;
    }
  }
  async function deleteFileQuiet(fileId) {
    if (!fileId) return;
    try {
      await storage.deleteFile({ bucketId, fileId });
    } catch (e) {
      if (sdkCode(e) !== 404) throw e;
    }
  }
  const teamRead = (familyId) => [Permission.read(Role.team(familyId))];

  /* ---------- input validation ---------- */
  function idOf(value, label) {
    if (typeof value !== 'string' || !ID_RE.test(value)) throw bad(`${label} is not valid.`);
    return value;
  }
  function textOf(value, label, { max, min = 0 }) {
    if (typeof value !== 'string') throw bad(`${label} must be text.`);
    const t = value.replace(/\r\n/g, '\n').trim();
    if (t.length < min) throw bad(`${label} is too short.`);
    if (t.length > max) throw bad(`${label} is too long (max ${max}).`);
    return t;
  }

  /* ---------- identity and membership ---------- */
  function requireVerifiedUser(user) {
    if (!user || !user.$id) throw new ApiError(401, 'unauthenticated', 'Please sign in.');
    if (user.status === false) throw new ApiError(403, 'blocked', 'This account is disabled.');
    if (!user.emailVerification) throw new ApiError(403, 'email_not_verified', 'Verify your email first.');
  }
  async function confirmedMemberships(user) {
    const res = await users.listMemberships({ userId: user.$id, queries: [Query.limit(100)] });
    return res.memberships.filter((m) => m.confirm === true);
  }
  /** Throws unless the caller is a confirmed member of a REGISTERED family. */
  async function requireMember(user, familyIdRaw) {
    const familyId = idOf(familyIdRaw, 'familyId');
    const mine = await confirmedMemberships(user);
    const m = mine.find((x) => x.teamId === familyId);
    if (!m) throw forbidden('You are not a member of this family.');
    const family = await getRowOrNull(TABLES.families, familyId);
    if (!family) throw forbidden('This family is not set up.');
    return { familyId, isOwner: Array.isArray(m.roles) && m.roles.includes('owner'), family, membership: m };
  }
  async function syncLabel(user, hasFamily) {
    const labels = Array.isArray(user.labels) ? user.labels : [];
    const has = labels.includes('family');
    if (hasFamily && !has) {
      await users.updateLabels({ userId: user.$id, labels: [...labels, 'family'] });
    } else if (!hasFamily && has) {
      await users.updateLabels({ userId: user.$id, labels: labels.filter((l) => l !== 'family') });
    }
  }

  /* ---------- family tree helpers ---------- */
  async function treePeople(familyId) {
    const out = [];
    let cursor = null;
    while (out.length < 1000) {
      const q = [Query.equal('familyId', [familyId]), Query.limit(100)];
      if (cursor) q.push(Query.cursorAfter(cursor));
      const page = await listRows(TABLES.people, q);
      out.push(...page.rows);
      if (page.rows.length < 100) break;
      cursor = page.rows[page.rows.length - 1].$id;
    }
    return out;
  }
  // A tree admin is a family owner or someone an owner designated. A relationship label never counts.
  async function requireTreeAdmin(user, ctx) {
    if (ctx.isOwner) return;
    const prof = await firstRow(TABLES.profiles, [Query.equal('profileKey', [`${ctx.familyId}_${user.$id}`])]);
    if (!prof || prof.treeAdmin !== true) throw forbidden('Only the family owner or a tree admin can change the family tree. You can send a suggestion instead.');
  }
  // Personal details on a tree entry: birthday ("2015-06-30" or just a year) and gender. Stored only when given.
  function cleanBirthday(v) {
    if (v === undefined || v === null || v === '') return '';
    const s = String(v).trim();
    if (!/^\d{4}(-\d{2}-\d{2})?$/.test(s)) throw bad('A birthday looks like 2015-06-30 (or just the year).');
    const y = Number(s.slice(0, 4));
    if (y < 1850 || y > new Date().getFullYear()) throw bad('That birth year does not look right.');
    return s;
  }
  function cleanGender(v) {
    if (v === undefined || v === null || v === '') return '';
    return textOf(v, 'Gender', { min: 1, max: 20 });
  }
  async function writePerson(createOrUpdate, data, extras) {
    const clean = {};
    for (const [k, val] of Object.entries(extras)) if (val !== undefined) clean[k] = val;
    try { return await createOrUpdate({ ...data, ...clean }); }
    catch (e) {
      // The new columns (birthday, gender, inviteMembershipId) may not exist yet: save everything else.
      if (Object.keys(clean).length && sdkCode(e) === 400) return await createOrUpdate(data);
      throw e;
    }
  }
  async function checkLink(familyId, raw, selfId, all) {
    if (raw === undefined || raw === null || raw === '') return '';
    const uid = idOf(raw, 'userId');
    const prof = await firstRow(TABLES.profiles, [Query.equal('profileKey', [`${familyId}_${uid}`])]);
    if (!prof) {
      // A member who joined but never saved a profile has no profile row yet. Their membership is what proves they belong.
      const ms = await users.listMemberships({ userId: uid, queries: [Query.limit(100)] }).catch(() => ({ memberships: [] }));
      if (!ms.memberships.some((m) => m.teamId === familyId && m.confirm === true)) throw bad('That account is not a member of this family yet.');
    }
    if (all.some((x) => x.userId === uid && x.$id !== selfId)) throw bad('That member is already linked to someone in the tree.');
    return uid;
  }
  function checkIds(raw, all, selfId, max = 8) {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw) || raw.length > max) throw bad(`That list of relatives is not valid (at most ${max}).`);
    const out = [];
    for (const id of raw) {
      idOf(id, 'person');
      if (id === selfId) throw bad('A person cannot be their own relative.');
      if (!all.some((x) => x.$id === id)) throw bad('A relative in that list is not in this family tree.');
      if (!out.includes(id)) out.push(id);
    }
    return out;
  }
  function assertNoCycle(all, personId, parentIds) {
    const byId = new Map(all.map((x) => [x.$id, x]));
    const seen = new Set();
    const stack = [...parentIds];
    while (stack.length) {
      const id = stack.pop();
      if (id === personId) throw bad('That would make someone their own ancestor.');
      if (seen.has(id)) continue;
      seen.add(id);
      for (const pp of (byId.get(id) || {}).parentIds || []) stack.push(pp);
    }
  }
  // parentKinds is stored as a small JSON text such as {"<parentId>":"adoptive"}. Only parents of this person may appear,
  // and only values from PARENT_KINDS. "birth" is the default, so it is left out to keep the text short.
  function cleanParentKinds(raw, parentIds) {
    if (raw === undefined || raw === null || raw === '') return '';
    const obj = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { throw bad('Parent kinds are not valid.'); } })() : raw;
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw bad('Parent kinds are not valid.');
    const out = {};
    for (const [id, kind] of Object.entries(obj)) {
      if (!parentIds.includes(id)) throw bad('A parent kind was given for someone who is not listed as a parent.');
      if (typeof kind !== 'string' || !PARENT_KINDS.includes(kind)) throw bad('That kind of parent is not valid.');
      if (kind !== 'birth') out[id] = kind;
    }
    return Object.keys(out).length ? JSON.stringify(out) : '';
  }
  function readKinds(raw) {
    try { const o = JSON.parse(raw || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; }
  }
  // Keeps only the kinds that still belong to a listed parent (used when parents change or someone is removed).
  function pruneKinds(raw, parentIds) {
    const o = readKinds(raw), out = {};
    for (const id of parentIds) if (o[id]) out[id] = o[id];
    return Object.keys(out).length ? JSON.stringify(out) : '';
  }
  function assertNotPartnerOfParent(parentIds, partnerIds) {
    if (parentIds.some((id) => partnerIds.includes(id))) throw bad('A parent cannot also be listed as a partner of the same person.');
  }
  function kindsColumnMissing() {
    return bad('Adoptive, step and foster links need one more setup step: add the parentKinds column to the people table (see the Setup Guide).');
  }
  /** What a new relative needs so the tree connects them to `anchor` as `relation`; missing middle people get unnamed placeholders. */
  async function relate(ctx, user, all, anchor, relation) {
    const out = { parentIds: null, partnerIds: null, afterCreate: null, linked: null };
    const idsOf = (r) => (Array.isArray(r.parentIds) ? r.parentIds : []).filter((x) => all.some((y) => y.$id === x));
    // A relative whose middle link is missing (an uncle needs a parent and a grandparent) gets an unnamed placeholder, so the
    // new person is still connected. The placeholder is a normal tree person that can be renamed or replaced in Settings.
    const mk = async (label, pIds) => {
      const r = await writePerson((d) => createRow(TABLES.people, ID.unique(), d, teamRead(ctx.familyId)),
        { familyId: ctx.familyId, name: label, confirmed: false, parentIds: pIds, partnerIds: [], createdBy: user.$id }, {});
      all.push(r); return r;
    };
    const ensureParent = async (p) => {
      const have = idsOf(p); if (have.length) return all.find((y) => y.$id === have[0]);
      const ph = await mk(`Parent of ${p.name} (add their name)`, []);
      await updateRow(TABLES.people, p.$id, { parentIds: [ph.$id] }); p.parentIds = [ph.$id]; return ph;
    };
    const ensureSibling = async (p) => {
      const par = await ensureParent(p);
      return all.find((x) => x.$id !== p.$id && idsOf(x).includes(par.$id)) || mk(`Sibling of ${p.name} (add their name)`, [par.$id]);
    };
    if (relation === 'child') { out.parentIds = [anchor.$id]; out.linked = true; }
    else if (relation === 'partner') { out.partnerIds = [anchor.$id]; out.linked = true; }
    else if (relation === 'sibling') { await ensureParent(anchor); out.parentIds = idsOf(anchor).slice(0, 2); out.linked = true; }
    else if (relation === 'parent') {
      const mine = idsOf(anchor);
      if (mine.length < 2) { out.linked = true; out.afterCreate = (newId) => updateRow(TABLES.people, anchor.$id, { parentIds: [...mine, newId] }); }
      else out.linked = false;
    } else if (relation === 'grandparent') {
      const par = await ensureParent(anchor), gp = idsOf(par);
      if (gp.length < 2) { out.linked = true; out.afterCreate = (newId) => updateRow(TABLES.people, par.$id, { parentIds: [...gp, newId] }); }
      else out.linked = false;
    } else if (relation === 'aunt_uncle') {
      const par = await ensureParent(anchor); await ensureParent(par);
      out.parentIds = idsOf(par).slice(0, 2); out.linked = true;
    } else if (relation === 'niece_nephew') {
      out.parentIds = [(await ensureSibling(anchor)).$id]; out.linked = true;
    } else if (relation === 'cousin') {
      out.parentIds = [(await ensureSibling(await ensureParent(anchor))).$id]; out.linked = true;
    } else if (relation === 'grandchild') {
      const kid = all.find((x) => idsOf(x).includes(anchor.$id)) || await mk(`Child of ${anchor.name} (add their name)`, [anchor.$id]);
      out.parentIds = [kid.$id]; out.linked = true;
    } else out.linked = false;

    return out;
  }
  async function addPartner(all, otherId, selfId) {
    const o = all.find((x) => x.$id === otherId);
    const cur = (o && o.partnerIds) || [];
    if (o && !cur.includes(selfId)) await updateRow(TABLES.people, otherId, { partnerIds: [...cur, selfId] });
  }
  async function dropPartner(all, otherId, selfId) {
    const o = all.find((x) => x.$id === otherId);
    const cur = (o && o.partnerIds) || [];
    if (o && cur.includes(selfId)) await updateRow(TABLES.people, otherId, { partnerIds: cur.filter((x) => x !== selfId) });
  }

  /* ---------- file ownership + normalisation ---------- */
  /**
   * A file may be attached only if (a) it carries update permission for the caller, which a
   * browser can only grant to itself, (b) it is readable by the target family's team, and
   * (c) it passes type and size checks. Then its permissions are rewritten to exactly
   * read(team:familyId), so the uploader's own extra permissions disappear and the file can
   * never be attached a second time.
   */
  async function claimFile(user, familyId, fileId, purpose) {
    idOf(fileId, 'fileId');
    const file = await getFileOrNull(fileId);
    if (!file) throw bad('The uploaded file was not found.');
    const perms = file.$permissions || [];
    if (!perms.includes(Permission.update(Role.user(user.$id)))) throw forbidden('That file is not yours to attach.');
    if (!perms.includes(Permission.read(Role.team(familyId)))) throw forbidden('That file was not uploaded for this family.');
    const mime = String(file.mimeType || '').toLowerCase();
    const size = Number(file.sizeOriginal || 0);
    if (purpose === 'photo') {
      if (!IMAGE_MIMES.includes(mime)) throw bad('Photos must be JPEG, PNG or WebP.');
      if (size > LIMITS.imageMaxBytes) throw bad('That photo is too large.');
    } else if (purpose === 'banner') {
      if (!IMAGE_MIMES.includes(mime) && mime !== 'image/gif') throw bad('A banner must be JPEG, PNG, WebP or GIF.');
      if (size > LIMITS.bannerMaxBytes) throw bad('That banner is too large.');
    } else if (purpose === 'avatar') {
      if (!IMAGE_MIMES.includes(mime) && mime !== 'image/gif') throw bad('Profile pictures must be JPEG, PNG, WebP or GIF.');
      if (size > (mime === 'image/gif' ? LIMITS.avatarGifMaxBytes : LIMITS.avatarMaxBytes)) throw bad('That profile picture is too large.');
    } else {
      if (!mime.startsWith('video/')) throw bad('That file is not a video.');
      if (size > maxVideoBytes) throw bad('That video is too large.');
    }
    await storage.updateFile({ bucketId, fileId, permissions: teamRead(familyId) });
    return { fileId, mime, size };
  }

  /* ---------- cascade deletes ---------- */
  async function deleteWhere(tableId, queries, deadline, onRow) {
    for (;;) {
      const page = await listRows(tableId, [...queries, Query.limit(50)]);
      if (page.rows.length === 0) return true;
      for (const row of page.rows) {
        if (onRow) await onRow(row);
        await deleteRow(tableId, row.$id);
      }
      if (now() > deadline) return false;
    }
  }
  async function purgePost(post, deadline) {
    const byPost = [Query.equal('postId', [post.$id])];
    if (!(await deleteWhere(TABLES.comments, byPost, deadline))) return false;
    if (!(await deleteWhere(TABLES.reactions, byPost, deadline))) return false;
    if (!(await deleteWhere(TABLES.bookmarks, byPost, deadline))) return false;
    await deleteFileQuiet(post.mediaFileId);
    await deleteRow(TABLES.posts, post.$id);
    return true;
  }
  async function loadPostInFamily(familyId, postIdRaw) {
    const postId = idOf(postIdRaw, 'postId');
    const post = await getRowOrNull(TABLES.posts, postId);
    if (!post || post.familyId !== familyId) throw missing('That post was not found in this family.');
    return post;
  }

  /* ================= actions ================= */

  /* ---------- optional home address (sensitive) ----------
   * Stored in its own table with NO row or table permissions, so no browser or SDK session can read it, even with the row id.
   * Only this function (using its API key) reads and writes it, and every read re-checks who is asking and which family they ask in.
   * Row id = the owner's user id, taken from the verified login and never from the request. Sharing is a list of family ids the
   * owner picked; access also requires the viewer AND the owner to still be confirmed members of that family right now, so leaving
   * or being removed from a family ends access at once. Family owners and tree admins get nothing extra. Nothing here is logged. */
  const ADDRESS_FIELDS = { line1: 200, line2: 200, city: 120, region: 120, postal: 40, country: 100 };
  function cleanAddressText(v, label, max, required) {
    if (v === undefined || v === null || v === '') { if (required) throw bad(`${label} is required.`); return ''; }
    if (typeof v !== 'string') throw bad(`${label} must be text.`);
    // keep letters from every language; drop control characters and collapse spaces
    const t = v.normalize('NFC').replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim();
    if (required && !t) throw bad(`${label} is required.`);
    if (t.length > max) throw bad(`${label} is too long (max ${max}).`);
    return t;
  }
  const readShared = (row) => { try { const a = JSON.parse(row.sharedWith || '[]'); return Array.isArray(a) ? a.filter((x) => typeof x === 'string' && ID_RE.test(x)) : []; } catch { return []; } };
  const addressFields = (row) => ({ line1: row.line1 || '', line2: row.line2 || '', city: row.city || '', region: row.region || '', postal: row.postal || '', country: row.country || '' });

  async function addressGet({ user }) {
    const row = await getRowOrNull(TABLES.addresses, user.$id);
    if (!row) return { address: null };
    const mine = new Set((await confirmedMemberships(user)).map((m) => m.teamId));
    // only families the owner is still in count; stale entries are not shown (and are dropped on the next save)
    return { address: { ...addressFields(row), sharedWith: readShared(row).filter((f) => mine.has(f)), updatedAt: row.$updatedAt || '' } };
  }
  async function addressSave({ user, body }) {
    const data = {};
    const LABEL = { line1: 'Address line 1', line2: 'Address line 2', city: 'City', region: 'State or region', postal: 'ZIP or postal code', country: 'Country' };
    for (const [k, max] of Object.entries(ADDRESS_FIELDS)) data[k] = cleanAddressText(body[k], LABEL[k], max, k === 'line1' || k === 'country');
    const visibility = body.visibility === 'families' ? 'families' : 'private';
    let shared = [];
    if (visibility === 'families') {
      const picked = Array.isArray(body.familyIds) ? [...new Set(body.familyIds)].slice(0, 30) : [];
      if (!picked.length) throw bad('Choose at least one family, or choose Only me.');
      if (body.confirmShare !== true) throw bad('Please confirm the families you are sharing with.');
      const mine = new Set((await confirmedMemberships(user)).map((m) => m.teamId));
      for (const f of picked) {
        idOf(f, 'familyId');
        if (!mine.has(f)) throw forbidden('You can only share with families you belong to.');
      }
      shared = picked;
    }
    const row = { ownerId: user.$id, ...data, sharedWith: JSON.stringify(shared) };
    try {
      const existing = await getRowOrNull(TABLES.addresses, user.$id);
      if (existing) await updateRow(TABLES.addresses, user.$id, row);
      else await createRow(TABLES.addresses, user.$id, row, []);       // [] = nobody but this function can read it
    } catch (e) {
      if (e instanceof ApiError) throw e;
      if (sdkCode(e) === 404 || sdkCode(e) === 400) throw new ApiError(503, 'not_set_up', 'Saving addresses is not set up on the server yet. The app owner needs to finish ADDRESS-GUIDE.md.');
      throw e;
    }
    return { saved: true, address: { ...data, sharedWith: shared } };
  }
  async function addressDelete({ user }) {
    const existing = await getRowOrNull(TABLES.addresses, user.$id);
    if (existing) await deleteRow(TABLES.addresses, user.$id);
    return { deleted: true };
  }
  /** Someone else's shared address, asked for inside one family. Same empty answer whether there is none or it is not shared with this viewer. */
  async function addressView({ user, body }) {
    const { familyId } = await requireMember(user, body.familyId);
    const ownerId = idOf(body.userId, 'userId');
    if (ownerId === user.$id) return { address: null, own: true };
    const theirs = await users.listMemberships({ userId: ownerId, queries: [Query.limit(100)] }).catch(() => ({ memberships: [] }));
    if (!theirs.memberships.some((m) => m.teamId === familyId && m.confirm === true)) return { address: null };
    const row = await getRowOrNull(TABLES.addresses, ownerId);
    if (!row || !readShared(row).includes(familyId)) return { address: null };
    return { address: addressFields(row) };
  }

  // Family chat (channels, direct messages, roles). See chat.js and CHAT-GUIDE.md.
  const chat = createChat({ claimFile, deleteFileQuiet, listRows, createRow, updateRow, deleteRow, getRowOrNull, firstRow, requireMember, confirmedMemberships, idOf, textOf, bad, forbidden, missing, ApiError, sdkCode, now, db, databaseId, teams, profilesTable: TABLES.profiles , fetchPreview: cfg.fetchPreview, fetchSiteInfo: cfg.fetchSiteInfo, httpFetch: cfg.httpFetch, livekit: cfg.livekit });

  const actions = {
    addressGet, addressSave, addressDelete, addressView,
    ...chat.actions,
    /** Lists the caller's confirmed, registered families. Also keeps the `family` label in sync. */
    async listFamilies({ user }) {
      const mine = await confirmedMemberships(user);
      let families = [];
      if (mine.length) {
        const ids = mine.map((m) => m.teamId);
        const res = await listRows(TABLES.families, [Query.equal('$id', ids), Query.limit(100)]);
        const registered = new Set(res.rows.map((r) => r.$id));
        families = mine
          .filter((m) => registered.has(m.teamId))
          .map((m) => ({
            id: m.teamId,
            name: m.teamName,
            role: Array.isArray(m.roles) && m.roles.includes('owner') ? 'owner' : 'member'
          }));
      }
      await syncLabel(user, families.length > 0);
      const owned = await listRows(TABLES.families, [Query.equal('ownerId', [user.$id]), Query.limit(1)]);
      return { families, canCreateFamily: owned.total < maxOwned, maxOwnedFamilies: maxOwned };
    },

    /** The browser creates the Team (it becomes owner); this call registers it as a family. */
    async registerFamily({ user, body }) {
      const teamId = idOf(body.teamId, 'teamId');
      const mine = await confirmedMemberships(user);
      const m = mine.find((x) => x.teamId === teamId);
      if (!m || !Array.isArray(m.roles) || !m.roles.includes('owner')) {
        throw forbidden('Only the owner of a team can register it as a family.');
      }
      if (await getRowOrNull(TABLES.families, teamId)) throw new ApiError(409, 'already_registered', 'This family already exists.');
      const owned = await listRows(TABLES.families, [Query.equal('ownerId', [user.$id]), Query.limit(1)]);
      if (owned.total >= maxOwned) {
        throw new ApiError(409, 'quota', `You can own up to ${maxOwned} families.`);
      }
      const name = textOf(m.teamName || '', 'Family name', { min: 1, max: LIMITS.nameMax });
      await createRow(TABLES.families, teamId, { ownerId: user.$id, name }, teamRead(teamId));
      await syncLabel(user, true);
      return { family: { id: teamId, name, role: 'owner' } };
    },

    async saveProfile({ user, body }) {
      const { familyId } = await requireMember(user, body.familyId);
      const displayName = textOf(body.displayName, 'Name', { min: 1, max: LIMITS.nameMax });
      const key = `${familyId}_${user.$id}`;
      const existing = await firstRow(TABLES.profiles, [Query.equal('profileKey', [key])]);
      let avatarFileId = existing ? existing.avatarFileId || '' : '';
      if (body.avatarFileId !== undefined && body.avatarFileId !== avatarFileId) {
        const next = body.avatarFileId === '' || body.avatarFileId === null ? '' : String(body.avatarFileId);
        if (next) await claimFile(user, familyId, next, 'avatar');
        const old = avatarFileId;
        avatarFileId = next;
        if (old) await deleteFileQuiet(old);
      }
      const extra = {};
      if (body.bio !== undefined) extra.bio = textOf(body.bio ?? '', 'Bio', { max: LIMITS.bioMax });
      const data = { familyId, userId: user.$id, profileKey: key, displayName, avatarFileId, ...extra };
      const wrapBio = async (fn) => {
        try {
          return await fn();
        } catch (e) {
          if (extra.bio !== undefined && sdkCode(e) === 400) {
            throw bad('Bios need one more setup step: add the bio column to the profiles table (see the Setup Guide).');
          }
          throw e;
        }
      };
      const row = existing
        ? await wrapBio(() => updateRow(TABLES.profiles, existing.$id, { displayName, avatarFileId, ...extra }))
        : await wrapBio(() => createRow(TABLES.profiles, ID.unique(), data, teamRead(familyId)));
      return { profile: { id: row.$id, userId: user.$id, displayName, avatarFileId, bio: row.bio || '', about: row.about || '' } };
    },

    /** "About me": a list of categories, each with a few short answers. Stored as JSON on my profile row, written only here. */
    async saveAbout({ user, body }) {
      const { familyId } = await requireMember(user, body.familyId);
      const list = body.about;
      if (!Array.isArray(list) || list.filter((c) => !(c && (c.key === 'ringcolors' || c.key === 'address' || c.key === 'banner' || c.key === 'pagestyle'))).length > LIMITS.aboutCategories || list.length > LIMITS.aboutCategories + 4) throw bad(`You can have up to ${LIMITS.aboutCategories} categories.`);   // the hidden "ringcolors" entry (own circle colors) does not count
      const clean = list.map((c, i) => {
        if (!c || typeof c !== 'object') throw bad('A category is not valid.');
        const title = textOf(c.title ?? '', 'Category name', { min: 1, max: LIMITS.aboutTitleMax });
        if (!Array.isArray(c.items) || c.items.length > LIMITS.aboutItems) throw bad(`Each category can have up to ${LIMITS.aboutItems} answers.`);
        const items = c.items.map((x) => textOf(typeof x === 'string' ? x : '', 'Answer', { min: 1, max: LIMITS.aboutItemMax }));
        const key = typeof c.key === 'string' && /^[a-z0-9]{1,20}$/.test(c.key) ? c.key : `c${i}`;
        return { key, title, items };
      });
      const existing = await firstRow(TABLES.profiles, [Query.equal('profileKey', [`${familyId}_${user.$id}`])]);
      if (!existing) throw bad('Set up your profile first.');
      // The banner is one hidden category: "color:#rrggbb" or "file:<id>" (a picture or looping GIF).
      const bannerOf = (arr) => { const b = Array.isArray(arr) ? arr.find((x) => x && x.key === 'banner') : null; return b && Array.isArray(b.items) && typeof b.items[0] === 'string' ? b.items[0] : ''; };
      let oldAbout = []; try { oldAbout = JSON.parse(existing.about || '[]'); } catch (e) { oldAbout = []; }
      const oldBanner = bannerOf(oldAbout), newBanner = bannerOf(clean);
      // The look of the person's own page: a few allowed "name:value" settings (background, border, accent, font, corners).
      const pg = clean.find((c) => c.key === 'pagestyle');
      if (pg) {
        const okItem = (x) => /^(bg:(#[0-9a-fA-F]{6}|g[1-6])|border:#[0-9a-fA-F]{6}|bstyle:(solid|dashed|dotted|double|rainbow|none)|bwidth:[1-6]|accent:#[0-9a-fA-F]{6}|font:(sans|serif|rounded|script|mono)|round:(sm|md|lg))$/.test(x);
        const names = pg.items.map((x) => x.split(':')[0]);
        if (!pg.items.every(okItem) || new Set(names).size !== names.length) throw bad('That page style is not valid.');
      }
      if (newBanner && !/^(color:#[0-9a-fA-F]{6}|file:[A-Za-z0-9._-]{1,34})$/.test(newBanner)) throw bad('That banner is not valid.');
      if (newBanner !== oldBanner && newBanner.startsWith('file:')) await claimFile(user, familyId, newBanner.slice(5), 'banner');
      const json = JSON.stringify(clean);
      try {
        await updateRow(TABLES.profiles, existing.$id, { about: json });
      } catch (e) {
        if (sdkCode(e) === 400) throw bad('About me needs one more setup step: add the about column to the profiles table (see the Setup Guide).');
        throw e;
      }
      if (newBanner !== oldBanner && oldBanner.startsWith('file:')) await deleteFileQuiet(oldBanner.slice(5));
      return { about: json };
    },

    /* ---------- family tree ---------- */
    async setTreeAdmin({ user, body }) {
      const { familyId, isOwner } = await requireMember(user, body.familyId);
      if (!isOwner) throw forbidden('Only a family owner can choose tree admins.');
      const target = await firstRow(TABLES.profiles, [Query.equal('profileKey', [`${familyId}_${idOf(body.userId, 'userId')}`])]);
      if (!target) throw missing('That person has no profile in this family yet.');
      const on = body.admin !== false;
      try {
        await updateRow(TABLES.profiles, target.$id, { treeAdmin: on });
      } catch (e) {
        if (sdkCode(e) === 400) throw bad('Tree admins need one more setup step: add the treeAdmin column to the profiles table (see the Setup Guide).');
        throw e;
      }
      return { admin: on };
    },

    async treeAddPerson({ user, body }) {
      const ctx = await requireMember(user, body.familyId);
      await requireTreeAdmin(user, ctx);
      const all = (await treePeople(ctx.familyId));
      if (all.length >= LIMITS.maxPeople - 1) throw new ApiError(409, 'quota', `A family tree can hold up to ${LIMITS.maxPeople} people.`);
      const name = textOf(body.name, 'Name', { min: 1, max: LIMITS.personNameMax });
      const linkId = await checkLink(ctx.familyId, body.userId, null, all);
      let parentIds = checkIds(body.parentIds, all, null, LIMITS.maxParents);
      let partnerIds = checkIds(body.partnerIds, all, null, LIMITS.maxPartners);
      assertNotPartnerOfParent(parentIds, partnerIds);
      let parentKinds = cleanParentKinds(body.parentKinds, parentIds);
      const extras = { birthday: cleanBirthday(body.birthday) || undefined, gender: cleanGender(body.gender) || undefined };
      if (body.inviteMembershipId) extras.inviteMembershipId = idOf(body.inviteMembershipId, 'inviteMembershipId');

      // "How is this person related to me?" Only parent and partner links exist in the tree; the rest are added without a link.
      let relationLinked = null, meRow = null, afterCreate = null;
      const relation = typeof body.relation === 'string' ? body.relation : '';
      if (relation) {
        meRow = body.relationOf ? (all.find((x) => x.$id === idOf(body.relationOf, 'relationOf')) || null) : (all.find((x) => x.userId === user.$id) || null);
        if (body.relationOf && !meRow) throw new ApiError(404, 'not_found', 'That person is not in the tree.');
        if (!meRow) {
          const prof = await firstRow(TABLES.profiles, [Query.equal('profileKey', [`${ctx.familyId}_${user.$id}`])]);
          meRow = await writePerson((d) => createRow(TABLES.people, ID.unique(), d, teamRead(ctx.familyId)),
            { familyId: ctx.familyId, name: (prof && prof.displayName) || 'Me', userId: user.$id, confirmed: true, parentIds: [], partnerIds: [], createdBy: user.$id }, {});
          all.push(meRow);
        }
        const r = await relate(ctx, user, all, meRow, relation);
        if (r.parentIds) parentIds = r.parentIds;
        if (r.partnerIds) partnerIds = r.partnerIds;
        afterCreate = r.afterCreate; relationLinked = r.linked;
      }
      const baseData = { familyId: ctx.familyId, name, userId: linkId, confirmed: false, parentIds, partnerIds, createdBy: user.$id };
      let row;
      try {
        // parentKinds is NOT optional like birthday: if the column is missing we say so instead of quietly losing "adoptive".
        row = await writePerson((d) => createRow(TABLES.people, ID.unique(), d, teamRead(ctx.familyId)),
          parentKinds ? { ...baseData, parentKinds } : baseData, extras);
      } catch (e) {
        if (parentKinds && sdkCode(e) === 400) throw kindsColumnMissing();
        throw e;
      }
      for (const pid of partnerIds) await addPartner(all, pid, row.$id);
      if (afterCreate) await afterCreate(row.$id);
      return { personId: row.$id, linked: relationLinked };
    },

    /** "About you": my own name, birthday and gender. Creates my tree entry the first time, so a member never needs an admin for this. */
    async saveMyPerson({ user, body }) {
      const ctx = await requireMember(user, body.familyId);
      const all = await treePeople(ctx.familyId);
      const extras = {};
      if (body.birthday !== undefined) extras.birthday = cleanBirthday(body.birthday);
      if (body.gender !== undefined) extras.gender = cleanGender(body.gender);
      const mine = all.find((x) => x.userId === user.$id);
      if (mine) {
        const data = {};
        if (body.name !== undefined) data.name = textOf(body.name, 'Name', { min: 1, max: LIMITS.personNameMax });
        if (Object.keys(data).length || Object.keys(extras).length) await writePerson((d) => updateRow(TABLES.people, mine.$id, d), data, extras);
        return { personId: mine.$id, created: false };
      }
      if (all.length >= LIMITS.maxPeople - 1) throw new ApiError(409, 'quota', `A family tree can hold up to ${LIMITS.maxPeople} people.`);
      const prof = await firstRow(TABLES.profiles, [Query.equal('profileKey', [`${ctx.familyId}_${user.$id}`])]);
      const name = body.name !== undefined ? textOf(body.name, 'Name', { min: 1, max: LIMITS.personNameMax }) : ((prof && prof.displayName) || 'Me');
      const row = await writePerson((d) => createRow(TABLES.people, ID.unique(), d, teamRead(ctx.familyId)),
        { familyId: ctx.familyId, name, userId: user.$id, confirmed: true, parentIds: [], partnerIds: [], createdBy: user.$id }, extras);
      return { personId: row.$id, created: true };
    },

    /**
     * Someone who just accepted an invitation. The entry the inviter made for them becomes theirs (confirmed).
     * Details the new member saved on their own account win over what the inviter typed.
     * If they already set themselves up in this family, the inviter's entry is merged into theirs (links kept, no duplicate).
     */
    async claimInvite({ user, body }) {
      const ctx = await requireMember(user, body.familyId);
      const all = await treePeople(ctx.familyId);
      const inv = all.find((x) => x.inviteMembershipId && x.inviteMembershipId === ctx.membership.$id && !x.userId);
      if (!inv) return { claimed: false };
      const mine = all.find((x) => x.userId === user.$id);
      const me = body.me && typeof body.me === 'object' ? body.me : {};
      const own = {};
      const ownExtras = {};
      try { if (me.name) own.name = textOf(me.name, 'Name', { min: 1, max: LIMITS.personNameMax }); } catch { /* ignore a bad saved value */ }
      try { if (me.birthday) ownExtras.birthday = cleanBirthday(me.birthday); } catch { /* ignore */ }
      try { if (me.gender) ownExtras.gender = cleanGender(me.gender); } catch { /* ignore */ }
      if (!mine) {
        await writePerson((d) => updateRow(TABLES.people, inv.$id, d), { ...own, userId: user.$id, confirmed: true }, ownExtras);
        return { claimed: true, personId: inv.$id };
      }
      // merge the invitation entry into my own entry
      const uniq = (l) => [...new Set(l)];
      const invParents = (inv.parentIds || []).filter((x) => x !== mine.$id);
      const invPartners = (inv.partnerIds || []).filter((x) => x !== mine.$id);
      const parents = uniq([...(mine.parentIds || []), ...invParents]).slice(0, LIMITS.maxParents);
      const partners = uniq([...(mine.partnerIds || []), ...invPartners]).filter((x) => !parents.includes(x)).slice(0, LIMITS.maxPartners);
      const kinds = { ...readKinds(inv.parentKinds), ...readKinds(mine.parentKinds) };
      const mergedKinds = pruneKinds(JSON.stringify(kinds), parents);
      const mineData = { parentIds: parents, partnerIds: partners };
      if (mergedKinds || mine.parentKinds) mineData.parentKinds = mergedKinds;
      try { await updateRow(TABLES.people, mine.$id, mineData); }
      catch (e) { if (sdkCode(e) === 400 && 'parentKinds' in mineData) { delete mineData.parentKinds; await updateRow(TABLES.people, mine.$id, mineData); } else throw e; }
      for (const o of all) {
        if (o.$id === inv.$id || o.$id === mine.$id) continue;
        const hasP = (o.parentIds || []).includes(inv.$id), hasS = (o.partnerIds || []).includes(inv.$id);
        if (!hasP && !hasS) continue;
        const data = {};
        if (hasP) data.parentIds = uniq((o.parentIds || []).map((x) => (x === inv.$id ? mine.$id : x)));
        if (hasS) data.partnerIds = uniq((o.partnerIds || []).map((x) => (x === inv.$id ? mine.$id : x)));
        const ok = readKinds(o.parentKinds);
        if (ok[inv.$id]) { ok[mine.$id] = ok[inv.$id]; delete ok[inv.$id]; data.parentKinds = JSON.stringify(ok); }
        try { await updateRow(TABLES.people, o.$id, data); }
        catch (e) { if (sdkCode(e) === 400 && 'parentKinds' in data) { delete data.parentKinds; await updateRow(TABLES.people, o.$id, data); } else throw e; }
      }
      await deleteRow(TABLES.people, inv.$id);
      return { claimed: true, merged: true, personId: mine.$id };
    },

    /** Links tree entries made by an invitation to the member who has since joined (even if they never saved a profile). */
    async treeSyncInvites({ user, body }) {
      const ctx = await requireMember(user, body.familyId);
      await requireTreeAdmin(user, ctx);
      const all = await treePeople(ctx.familyId);
      const waiting = all.filter((x) => x.inviteMembershipId && !x.userId);
      if (!waiting.length) return { linked: 0 };
      const res = await teams.listMemberships({ teamId: ctx.familyId, queries: [Query.limit(100)] });
      let linked = 0;
      for (const p of waiting) {
        const m = res.memberships.find((x) => x.$id === p.inviteMembershipId && x.confirm === true && x.userId);
        if (!m || all.some((x) => x.userId === m.userId)) continue;
        await updateRow(TABLES.people, p.$id, { userId: m.userId, confirmed: false });
        p.userId = m.userId; linked++;
      }
      return { linked };
    },

    /** Connects someone who is already in the tree to a chosen person (parent, partner, child, sibling, ...). */
    async treeLinkRelative({ user, body }) {
      const ctx = await requireMember(user, body.familyId);
      await requireTreeAdmin(user, ctx);
      const all = await treePeople(ctx.familyId);
      const target = all.find((x) => x.$id === idOf(body.personId, 'personId'));
      const anchor = all.find((x) => x.$id === idOf(body.relationOf, 'relationOf'));
      if (!target || !anchor) throw new ApiError(404, 'not_found', 'That person is not in the tree.');
      if (target.$id === anchor.$id) throw bad('A person cannot be their own relative.');
      const relation = typeof body.relation === 'string' ? body.relation : '';
      const r = await relate(ctx, user, all, anchor, relation);
      if (r.linked !== true) throw bad('That relationship cannot be linked automatically. Use Edit on their box.');
      const data = {};
      if (r.parentIds) {
        const merged = [...new Set([...(target.parentIds || []), ...r.parentIds.filter((x) => x !== target.$id)])];
        if (merged.length > LIMITS.maxParents) throw bad('That person already has the most parents the tree can hold.');
        data.parentIds = merged;
      }
      if (r.partnerIds) {
        const ps = [...new Set([...(target.partnerIds || []), ...r.partnerIds.filter((x) => x !== target.$id)])];
        if ((data.parentIds || target.parentIds || []).some((x) => ps.includes(x))) throw bad('A parent cannot also be this person\u2019s partner.');
        data.partnerIds = ps;
      }
      if (Object.keys(data).length) await updateRow(TABLES.people, target.$id, data);
      for (const pid of r.partnerIds || []) await addPartner(all, pid, target.$id);
      if (r.afterCreate) await r.afterCreate(target.$id);
      return { personId: target.$id, linked: true };
    },

    async treeEditPerson({ user, body }) {
      const ctx = await requireMember(user, body.familyId);
      const all = await treePeople(ctx.familyId);
      const p = all.find((x) => x.$id === body.personId);
      if (!p) throw missing('That person is not in this family tree.');
      const isSelf = p.userId === user.$id;
      if (!isSelf) await requireTreeAdmin(user, ctx);
      // Once a person has accepted (their entry is linked and confirmed), their own details are theirs alone.
      const locked = !!(p.userId && p.confirmed === true && !isSelf);
      if (locked && (body.name !== undefined && body.name !== p.name || body.birthday !== undefined && String(body.birthday || '') !== String(p.birthday || '') || body.gender !== undefined && String(body.gender || '') !== String(p.gender || ''))) {
        throw forbidden(`Only ${p.name} can change their own name, gender and birthday, because it is their account.`);
      }
      const data = {};
      const extras = {};
      if (!locked) {
        if (body.name !== undefined) data.name = textOf(body.name, 'Name', { min: 1, max: LIMITS.personNameMax });
        if (body.birthday !== undefined) extras.birthday = cleanBirthday(body.birthday);
        if (body.gender !== undefined) extras.gender = cleanGender(body.gender);
      }
      // Inviting someone who is already in the tree but has no account yet: remember which invitation belongs to this entry.
      if (body.inviteMembershipId && !p.userId && !isSelf) extras.inviteMembershipId = idOf(body.inviteMembershipId, 'inviteMembershipId');
      if (body.userId !== undefined && !isSelf) {
        const linkId = await checkLink(ctx.familyId, body.userId, p.$id, all);
        if (linkId !== (p.userId || '')) { data.userId = linkId; data.confirmed = false; }
      }
      if (body.parentIds !== undefined) {
        data.parentIds = checkIds(body.parentIds, all, p.$id, LIMITS.maxParents);
        assertNoCycle(all, p.$id, data.parentIds);
      }
      let partners = null;
      if (body.partnerIds !== undefined) partners = checkIds(body.partnerIds, all, p.$id, LIMITS.maxPartners);
      if (partners) data.partnerIds = partners;
      if (body.parentIds !== undefined || body.partnerIds !== undefined) assertNotPartnerOfParent(data.parentIds !== undefined ? data.parentIds : (p.parentIds || []), partners || (p.partnerIds || []));
      // The kinds always follow the final list of parents.
      const finalParents = data.parentIds !== undefined ? data.parentIds : (p.parentIds || []);
      let kindsWrite = false;
      if (body.parentKinds !== undefined) { data.parentKinds = cleanParentKinds(body.parentKinds, finalParents); kindsWrite = !!data.parentKinds || !!p.parentKinds; }
      else if (data.parentIds !== undefined && p.parentKinds) { data.parentKinds = pruneKinds(p.parentKinds, finalParents); kindsWrite = true; }
      if (!kindsWrite) delete data.parentKinds;
      const before = Array.isArray(p.partnerIds) ? [...p.partnerIds] : [];   // read before the write, so it cannot change underneath us
      if (Object.keys(data).length || Object.keys(extras).length) {
        try { await writePerson((d) => updateRow(TABLES.people, p.$id, d), data, extras); }
        catch (e) { if (data.parentKinds && sdkCode(e) === 400) throw kindsColumnMissing(); throw e; }
      }
      if (partners) {
        for (const pid of partners.filter((x) => !before.includes(x))) await addPartner(all, pid, p.$id);
        for (const pid of before.filter((x) => !partners.includes(x))) await dropPartner(all, pid, p.$id);
      }
      return { ok: true };
    },

    async treeDeletePerson({ user, body }) {
      const ctx = await requireMember(user, body.familyId);
      await requireTreeAdmin(user, ctx);
      const all = await treePeople(ctx.familyId);
      const p = all.find((x) => x.$id === body.personId);
      if (!p) throw missing('That person is not in this family tree.');
      for (const o of all) {
        if (o.$id === p.$id) continue;
        const par = (o.parentIds || []).filter((x) => x !== p.$id);
        const prt = (o.partnerIds || []).filter((x) => x !== p.$id);
        if (par.length !== (o.parentIds || []).length || prt.length !== (o.partnerIds || []).length) {
          const upd = { parentIds: par, partnerIds: prt };
          if (o.parentKinds) upd.parentKinds = pruneKinds(o.parentKinds, par);
          await updateRow(TABLES.people, o.$id, upd);
        }
      }
      await deleteRow(TABLES.people, p.$id);
      return { ok: true };
    },

    /** The person a tree admin linked to my account says "yes, this is me" (or "no", which unlinks it). */
    async treeConfirm({ user, body }) {
      const { familyId } = await requireMember(user, body.familyId);
      const p = await getRowOrNull(TABLES.people, idOf(body.personId, 'personId'));
      if (!p || p.familyId !== familyId) throw missing('That person is not in this family tree.');
      if (p.userId !== user.$id) throw forbidden('This tree entry is not linked to your account.');
      if (body.confirm === false) {
        await updateRow(TABLES.people, p.$id, { userId: '', confirmed: false });
        return { confirmed: false };
      }
      await updateRow(TABLES.people, p.$id, { confirmed: true });
      return { confirmed: true };
    },

    async suggestTreeChange({ user, body }) {
      const { familyId } = await requireMember(user, body.familyId);
      const text = textOf(body.text, 'Suggestion', { min: 3, max: LIMITS.suggestionMax });
      let personId = '';
      if (body.personId) {
        const p = await getRowOrNull(TABLES.people, idOf(body.personId, 'personId'));
        if (!p || p.familyId !== familyId) throw missing('That person is not in this family tree.');
        personId = p.$id;
      }
      const open = await listRows(TABLES.suggestions, [Query.equal('familyId', [familyId]), Query.equal('authorId', [user.$id]), Query.equal('status', ['open']), Query.limit(21)]);
      if (open.rows.length >= 20) throw new ApiError(409, 'quota', 'You already have 20 open suggestions. Wait for a tree admin to review some.');
      const row = await createRow(TABLES.suggestions, ID.unique(),
        { familyId, authorId: user.$id, personId, text, status: 'open' }, teamRead(familyId));
      return { suggestionId: row.$id };
    },

    async resolveSuggestion({ user, body }) {
      const ctx = await requireMember(user, body.familyId);
      await requireTreeAdmin(user, ctx);
      const s = await getRowOrNull(TABLES.suggestions, idOf(body.suggestionId, 'suggestionId'));
      if (!s || s.familyId !== ctx.familyId) throw missing('That suggestion was not found.');
      const status = body.status === 'dismissed' ? 'dismissed' : 'done';
      await updateRow(TABLES.suggestions, s.$id, { status });
      return { status };
    },

    async familyUsage({ user, body }) {
      const { familyId } = await requireMember(user, body.familyId);
      return {
        usedBytes: await familyUsedBytes(familyId),
        limitBytes: familyStorageBytes,
        maxVideoMB: cfg.maxVideoMB
      };
    },

    async createPost({ user, body }) {
      const { familyId } = await requireMember(user, body.familyId);
      const kind = body.kind;
      if (!KINDS.includes(kind)) throw bad('Unknown post type.');   // reposts have their own action (repostPost)
      const text = textOf(body.body ?? '', 'Post', { max: LIMITS.bodyMax });
      const data = { familyId, authorId: user.$id, kind, body: text };
      if (kind === 'text') {
        if (!text) throw bad('Write something first.');
        if (body.mediaFileId) throw bad('A text post cannot have a file.');
      } else {
        if (!body.mediaFileId) throw bad('This post type needs a file.');
        const f = await claimFile(user, familyId, body.mediaFileId, kind === 'photo' ? 'photo' : 'video');
        const used = await familyUsedBytes(familyId);
        if (used + f.size > familyStorageBytes) {
          // Only the file that was just uploaded is removed. Existing memories are never touched.
          await deleteFileQuiet(f.fileId);
          throw new ApiError(409, 'storage_full', 'Your family has used all of its free storage, so new photos and videos are paused. Nothing has been deleted. Remove posts you no longer need, or ask the family owner.');
        }
        data.mediaFileId = f.fileId;
        data.mediaMime = f.mime.slice(0, 32);
        data.mediaSize = f.size;
        if (kind !== 'photo' && body.captions !== undefined && body.captions !== null) {
          const cj = cleanCaptions(body.captions);
          if (cj) data.captions = cj;
        }
      }
      let row, captionsSaved = !!data.captions;
      try {
        row = await createRow(TABLES.posts, ID.unique(), data, teamRead(familyId));
      } catch (e) {
        if (sdkCode(e) !== 400 || !data.captions) throw e;
        delete data.captions; captionsSaved = false;   // the captions column has not been added yet: post without them
        row = await createRow(TABLES.posts, ID.unique(), data, teamRead(familyId));
      }
      return { postId: row.$id, captionsSaved };
    },

    /** "Remember this day?": a new post that points at an older one (no file is copied, so it uses no extra storage). */
    async repostPost({ user, body }) {
      const { familyId } = await requireMember(user, body.familyId);
      let orig = await loadPostInFamily(familyId, body.postId);
      if (orig.kind === 'repost') {                           // reposting a repost reposts the original
        if (!orig.repostOfId) throw missing('The original post was removed.');
        orig = await loadPostInFamily(familyId, orig.repostOfId);
      }
      const note = textOf(body.body ?? '', 'Note', { max: LIMITS.bodyMax });
      const recent = (await listRows(TABLES.posts, [Query.equal('familyId', [familyId]), Query.equal('authorId', [user.$id]), Query.orderDesc('$createdAt'), Query.limit(50)])).rows;
      const since = now() - 24 * 3600 * 1000;
      if (recent.some((r) => r.repostOfId === orig.$id && new Date(r.$createdAt).getTime() > since)) {
        throw new ApiError(409, 'already_reposted', 'You already reposted this in the last 24 hours.');
      }
      const data = { familyId, authorId: user.$id, kind: 'repost', body: note || REPOST_NOTE, repostOfId: orig.$id };
      let row;
      try {
        row = await createRow(TABLES.posts, ID.unique(), data, teamRead(familyId));
      } catch (e) {
        if (sdkCode(e) === 400) throw bad('Reposts are not set up yet. Add the repostOfId column (see the guide).');
        throw e;
      }
      return { postId: row.$id };
    },

    async editPost({ user, body }) {
      const { familyId } = await requireMember(user, body.familyId);
      const post = await loadPostInFamily(familyId, body.postId);
      if (post.authorId !== user.$id) throw forbidden('Only the author can edit a post.');
      const text = textOf(body.body ?? '', 'Post', { max: LIMITS.bodyMax });
      if (!text && !post.mediaFileId) throw bad('A post needs text or a file.');
      if (text === (post.body || '')) return { ok: true, edited: false };
      const stamp = new Date(now()).toISOString();
      try {
        await updateRow(TABLES.posts, post.$id, { body: text, editedAt: stamp });
      } catch (e) {
        if (sdkCode(e) !== 400) throw e;
        await updateRow(TABLES.posts, post.$id, { body: text }); // the editedAt column has not been added yet
      }
      return { ok: true, edited: true };
    },

    /** The author adds, replaces or removes automatic captions on one of their videos. */
    async setCaptions({ user, body }) {
      const { familyId } = await requireMember(user, body.familyId);
      const post = await loadPostInFamily(familyId, body.postId);
      if (post.authorId !== user.$id) throw forbidden('Only the author can change captions.');
      if (post.kind !== 'video' && post.kind !== 'short') throw bad('Only videos can have captions.');
      const cj = cleanCaptions(body.captions);
      try {
        await updateRow(TABLES.posts, post.$id, { captions: cj });
      } catch (e) {
        if (sdkCode(e) === 400) throw bad('Captions are not set up yet. Add the captions column first (see the guide).');
        throw e;
      }
      return { ok: true, captions: cj };
    },

    async deletePost({ user, body, deadline }) {
      const { familyId, isOwner } = await requireMember(user, body.familyId);
      const post = await loadPostInFamily(familyId, body.postId);
      if (post.authorId !== user.$id && !isOwner) throw forbidden('Only the author or a family owner can delete this post.');
      const done = await purgePost(post, deadline);
      return { done };
    },

    async createComment({ user, body }) {
      const { familyId } = await requireMember(user, body.familyId);
      const post = await loadPostInFamily(familyId, body.postId);
      const text = textOf(body.body, 'Comment', { min: 1, max: LIMITS.commentMax });
      // A reply points at the top comment of its thread (one level of replies, like Instagram).
      let parentId = null;
      if (body.parentId) {
        const parent = await getRowOrNull(TABLES.comments, idOf(body.parentId, 'parentId'));
        if (!parent || parent.familyId !== familyId || parent.postId !== post.$id) throw missing('The comment you are replying to was not found.');
        parentId = parent.parentId || parent.$id;
      }
      const data = { familyId, postId: post.$id, authorId: user.$id, body: text };
      let row;
      try {
        row = await createRow(TABLES.comments, ID.unique(), parentId ? { ...data, parentId } : data, teamRead(familyId));
      } catch (e) {
        // The parentId column is not set up yet: still post the reply, as a plain comment that starts with @Name.
        if (parentId && sdkCode(e) === 400) { parentId = null; row = await createRow(TABLES.comments, ID.unique(), data, teamRead(familyId)); }
        else throw e;
      }
      return { commentId: row.$id, parentId };
    },

    /** Like or unlike a comment. The list of likers lives on the comment row (column `likedBy`, a list of user ids). */
    async toggleCommentLike({ user, body }) {
      const { familyId } = await requireMember(user, body.familyId);
      const commentId = idOf(body.commentId, 'commentId');
      const c = await getRowOrNull(TABLES.comments, commentId);
      if (!c || c.familyId !== familyId) throw missing('That comment was not found in this family.');
      const list = Array.isArray(c.likedBy) ? c.likedBy.filter((x) => typeof x === 'string') : [];
      const had = list.includes(user.$id);
      const next = had ? list.filter((x) => x !== user.$id) : [...list, user.$id].slice(-200);
      try {
        await updateRow(TABLES.comments, c.$id, { likedBy: next });
      } catch (e) {
        if (sdkCode(e) === 400) throw bad('Comment likes need one more setup step: add the likedBy column to the comments table (see the Setup Guide).');
        throw e;
      }
      return { liked: !had, count: next.length };
    },

    /** Post author only. Up to 3 pinned comments per post, kept as a comma list in `pinnedCommentIds`. */
    async pinComment({ user, body }) {
      const { familyId } = await requireMember(user, body.familyId);
      const post = await loadPostInFamily(familyId, body.postId);
      if (post.authorId !== user.$id) throw forbidden('Only the person who made the post can pin comments.');
      const commentId = idOf(body.commentId, 'commentId');
      const c = await getRowOrNull(TABLES.comments, commentId);
      if (!c || c.familyId !== familyId || c.postId !== post.$id) throw missing('That comment was not found on this post.');
      const cur = String(post.pinnedCommentIds || '').split(',').filter(Boolean);
      let next;
      if (body.pinned === false) next = cur.filter((x) => x !== commentId);
      else if (cur.includes(commentId)) next = cur;
      else if (cur.length >= 3) throw new ApiError(409, 'quota', 'You can pin up to 3 comments. Unpin one first.');
      else next = [...cur, commentId];
      try {
        await updateRow(TABLES.posts, post.$id, { pinnedCommentIds: next.join(',') });
      } catch (e) {
        if (sdkCode(e) === 400) throw bad('Pinning needs one more setup step: add the pinnedCommentIds column to the posts table (see the Setup Guide).');
        throw e;
      }
      return { pinned: next };
    },

    async deleteComment({ user, body }) {
      const { familyId, isOwner } = await requireMember(user, body.familyId);
      const commentId = idOf(body.commentId, 'commentId');
      const c = await getRowOrNull(TABLES.comments, commentId);
      if (!c || c.familyId !== familyId) throw missing('That comment was not found in this family.');
      let allowed = c.authorId === user.$id || isOwner;
      if (!allowed) {
        const post = await getRowOrNull(TABLES.posts, c.postId);
        allowed = !!post && post.familyId === familyId && post.authorId === user.$id;
      }
      if (!allowed) throw forbidden('You cannot delete this comment.');
      await deleteRow(TABLES.comments, c.$id);
      return { ok: true };
    },

    async toggleReaction({ user, body }) {
      const { familyId } = await requireMember(user, body.familyId);
      const post = await loadPostInFamily(familyId, body.postId);
      const key = `${post.$id}_${user.$id}`;
      const existing = await firstRow(TABLES.reactions, [Query.equal('reactionKey', [key])]);
      if (existing) {
        await deleteRow(TABLES.reactions, existing.$id);
        return { liked: false };
      }
      try {
        await createRow(
          TABLES.reactions,
          ID.unique(),
          { familyId, postId: post.$id, userId: user.$id, reactionKey: key },
          teamRead(familyId)
        );
      } catch (e) {
        if (sdkCode(e) !== 409) throw e; // a double tap already created it
      }
      return { liked: true };
    },

    /** Move one of my saved posts into one of my libraries ('' = Saved for later). Library names live in my own account settings. */
    async setBookmarkCollection({ user, body }) {
      const { familyId } = await requireMember(user, body.familyId);
      const post = await loadPostInFamily(familyId, body.postId);
      const key = `${user.$id}_${post.$id}`;
      const existing = await firstRow(TABLES.bookmarks, [Query.equal('bookmarkKey', [key])]);
      if (!existing) throw missing('Save the post first.');
      const lib = libraryOf(body.collectionId);
      try {
        await updateRow(TABLES.bookmarks, existing.$id, { collectionId: lib });
      } catch (e) {
        if (sdkCode(e) === 400) throw bad('Libraries need one more setup step: add the collectionId column to the bookmarks table (see the Setup Guide).');
        throw e;
      }
      return { ok: true };
    },

    async toggleBookmark({ user, body }) {
      const { familyId } = await requireMember(user, body.familyId);
      const post = await loadPostInFamily(familyId, body.postId);
      const key = `${user.$id}_${post.$id}`;
      const existing = await firstRow(TABLES.bookmarks, [Query.equal('bookmarkKey', [key])]);
      if (existing) {
        await deleteRow(TABLES.bookmarks, existing.$id);
        return { saved: false };
      }
      try {
        const data = { familyId, userId: user.$id, postId: post.$id, bookmarkKey: key };
        // Only sent when a library was chosen, so plain "Saved for later" works on any table version.
        const lib = libraryOf(body.collectionId);
        if (lib) data.collectionId = lib;
        await createRow(TABLES.bookmarks, ID.unique(), data, [Permission.read(Role.user(user.$id))]);
      } catch (e) {
        if (sdkCode(e) !== 409) throw e;
      }
      return { saved: true };
    },

    /** Owner only. Call repeatedly until `done` is true; each call stays inside the time budget. */
    async deleteFamily({ user, body, deadline }) {
      const { familyId, isOwner } = await requireMember(user, body.familyId);
      if (!isOwner) throw forbidden('Only a family owner can delete the family.');
      const byFamily = [Query.equal('familyId', [familyId])];
      if (!(await deleteWhere(TABLES.reactions, byFamily, deadline))) return { done: false };
      if (!(await deleteWhere(TABLES.comments, byFamily, deadline))) return { done: false };
      if (!(await deleteWhere(TABLES.bookmarks, byFamily, deadline))) return { done: false };
      const postDone = await deleteWhere(TABLES.posts, byFamily, deadline, (p) => deleteFileQuiet(p.mediaFileId));
      if (!postDone) return { done: false };
      const profDone = await deleteWhere(TABLES.profiles, byFamily, deadline, async (p) => { await deleteFileQuiet(p.avatarFileId); try { const a = JSON.parse(p.about || '[]'); const b = a.find((x) => x && x.key === 'banner'); const v = b && b.items && b.items[0]; if (typeof v === 'string' && v.startsWith('file:')) await deleteFileQuiet(v.slice(5)); } catch (e) { /* no banner */ } });
      if (!profDone) return { done: false };
      if (!(await chat.purgeFamily(familyId, deleteWhere, deadline))) return { done: false };
      await deleteRow(TABLES.families, familyId);
      try {
        await teams.delete({ teamId: familyId });
      } catch (e) {
        if (sdkCode(e) !== 404) throw e;
      }
      return { done: true };
    }
  };

  /* ---------- scheduled cleanup (no user) ---------- */
  /** Deletes uploads older than one hour that no post or profile refers to. Safe to run by anyone. */
  async function sweep(deadline) {
    const cutoff = new Date(now() - 60 * 60 * 1000).toISOString();
    let removed = 0;
    let cursor = null;
    while (now() < deadline) {
      const q = [Query.lessThan('$createdAt', cutoff), Query.limit(50)];
      if (cursor) q.push(Query.cursorAfter(cursor));
      const page = await storage.listFiles({ bucketId, queries: q });
      if (!page.files.length) break;
      for (const f of page.files) {
        const inPost = await firstRow(TABLES.posts, [Query.equal('mediaFileId', [f.$id])]);
        const inProfile = inPost ? null : await firstRow(TABLES.profiles, [Query.equal('avatarFileId', [f.$id])]);
        let inDesign = false, inBanner = false, inChatPic = false;
        if (!inPost && !inProfile) {
          // A banner lives inside the About text, and the family chat picture lives in the team settings. If a check fails, the file is kept.
          try { inBanner = !!(await firstRow(TABLES.profiles, [Query.contains('about', [`file:${f.$id}`])])); } catch (e) { inBanner = true; }
          try {
            const tp = (f.$permissions || []).map((x) => /^read\("team:([^"]+)"\)$/.exec(x)).filter(Boolean)[0];
            if (tp) { const pr = await teams.getPrefs({ teamId: tp[1] }); inChatPic = pr && pr.chatPic === f.$id; }
          } catch (e) { inChatPic = sdkCode(e) !== 404; }
        }
        if (!inPost && !inProfile && !inBanner && !inChatPic) {
          // A saved gift design. If the shop is not installed the table is simply missing (404), which means "no". Any other
          // error means "could not check", and an unchecked file is kept rather than risk deleting a print file.
          try { inDesign = !!(await firstRow(TABLES.shopDesigns, [Query.equal('fileId', [f.$id])])); } catch (e) { if (sdkCode(e) !== 404) inDesign = true; }
        }
        if (!inPost && !inProfile && !inBanner && !inChatPic && !inDesign) {
          await deleteFileQuiet(f.$id);
          removed += 1;
        }
      }
      cursor = page.files[page.files.length - 1].$id;
      if (page.files.length < 50) break;
    }
    return { removed };
  }

  /* ---------- entry ---------- */
  async function handle({ user, body, deadline }) {
    try {
      if (!user) {
        // No signed-in caller: only the scheduler or the Console may run the cleanup, and
        // a request that names an action without credentials is simply unauthenticated.
        if (body && body.action) throw new ApiError(401, 'unauthenticated', 'Please sign in.');
        return { status: 200, json: { ok: true, ...(await sweep(deadline)) } };
      }
      requireVerifiedUser(user);
      const name = body && body.action;
      if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(actions, name)) {
        throw bad('Unknown action.');
      }
      const result = await actions[name]({ user, body: body || {}, deadline });
      return { status: 200, json: { ok: true, ...result } };
    } catch (e) {
      if (e instanceof ApiError) {
        return { status: e.status, json: { ok: false, error: e.code, message: e.message } };
      }
      return { status: 500, json: { ok: false, error: 'server_error', message: 'Something went wrong on the server.' }, cause: e };
    }
  }

  return { handle, actions, handleEvent: chat.handleEvent };
}
