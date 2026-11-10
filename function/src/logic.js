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

export const TABLES = {
  families: 'families',
  profiles: 'profiles',
  posts: 'posts',
  comments: 'comments',
  reactions: 'reactions',
  bookmarks: 'bookmarks',
  people: 'people',
  suggestions: 'suggestions'
};

export const LIMITS = {
  bodyMax: 2000,
  commentMax: 500,
  nameMax: 60,
  imageMaxBytes: 8 * 1024 * 1024,
  avatarMaxBytes: 1024 * 1024,
  bioMax: 200,
  aboutCategories: 10,
  aboutItems: 12,
  aboutTitleMax: 32,
  aboutItemMax: 40,
  personNameMax: 80,
  maxPeople: 300,
  suggestionMax: 500
};

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/;
const KINDS = ['text', 'photo', 'video', 'short'];
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
  async function checkLink(familyId, raw, selfId, all) {
    if (raw === undefined || raw === null || raw === '') return '';
    const uid = idOf(raw, 'userId');
    const prof = await firstRow(TABLES.profiles, [Query.equal('profileKey', [`${familyId}_${uid}`])]);
    if (!prof) throw bad('That account is not a member of this family yet.');
    if (all.some((x) => x.userId === uid && x.$id !== selfId)) throw bad('That member is already linked to someone in the tree.');
    return uid;
  }
  function checkIds(raw, all, selfId) {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw) || raw.length > 8) throw bad('That list of relatives is not valid.');
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
    } else if (purpose === 'avatar') {
      if (!IMAGE_MIMES.includes(mime)) throw bad('Profile pictures must be JPEG, PNG or WebP.');
      if (size > LIMITS.avatarMaxBytes) throw bad('That profile picture is too large.');
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
  const actions = {
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
      if (!Array.isArray(list) || list.length > LIMITS.aboutCategories) throw bad(`You can have up to ${LIMITS.aboutCategories} categories.`);
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
      const json = JSON.stringify(clean);
      try {
        await updateRow(TABLES.profiles, existing.$id, { about: json });
      } catch (e) {
        if (sdkCode(e) === 400) throw bad('About me needs one more setup step: add the about column to the profiles table (see the Setup Guide).');
        throw e;
      }
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
      if (all.length >= LIMITS.maxPeople) throw new ApiError(409, 'quota', `A family tree can hold up to ${LIMITS.maxPeople} people.`);
      const name = textOf(body.name, 'Name', { min: 1, max: LIMITS.personNameMax });
      const linkId = await checkLink(ctx.familyId, body.userId, null, all);
      const parentIds = checkIds(body.parentIds, all, null);
      const partnerIds = checkIds(body.partnerIds, all, null);
      const row = await createRow(TABLES.people, ID.unique(),
        { familyId: ctx.familyId, name, userId: linkId, confirmed: false, parentIds, partnerIds, createdBy: user.$id }, teamRead(ctx.familyId));
      for (const pid of partnerIds) await addPartner(all, pid, row.$id);
      return { personId: row.$id };
    },

    async treeEditPerson({ user, body }) {
      const ctx = await requireMember(user, body.familyId);
      await requireTreeAdmin(user, ctx);
      const all = await treePeople(ctx.familyId);
      const p = all.find((x) => x.$id === body.personId);
      if (!p) throw missing('That person is not in this family tree.');
      const data = {};
      if (body.name !== undefined) data.name = textOf(body.name, 'Name', { min: 1, max: LIMITS.personNameMax });
      if (body.userId !== undefined) {
        const linkId = await checkLink(ctx.familyId, body.userId, p.$id, all);
        if (linkId !== (p.userId || '')) { data.userId = linkId; data.confirmed = false; }
      }
      if (body.parentIds !== undefined) {
        data.parentIds = checkIds(body.parentIds, all, p.$id);
        assertNoCycle(all, p.$id, data.parentIds);
      }
      let partners = null;
      if (body.partnerIds !== undefined) partners = checkIds(body.partnerIds, all, p.$id);
      if (partners) data.partnerIds = partners;
      if (Object.keys(data).length) await updateRow(TABLES.people, p.$id, data);
      if (partners) {
        const before = Array.isArray(p.partnerIds) ? p.partnerIds : [];
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
          await updateRow(TABLES.people, o.$id, { parentIds: par, partnerIds: prt });
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
      if (!KINDS.includes(kind)) throw bad('Unknown post type.');
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
      }
      const row = await createRow(TABLES.posts, ID.unique(), data, teamRead(familyId));
      return { postId: row.$id };
    },

    async editPost({ user, body }) {
      const { familyId } = await requireMember(user, body.familyId);
      const post = await loadPostInFamily(familyId, body.postId);
      if (post.authorId !== user.$id) throw forbidden('Only the author can edit a post.');
      const text = textOf(body.body ?? '', 'Post', { max: LIMITS.bodyMax });
      if (!text && !post.mediaFileId) throw bad('A post needs text or a file.');
      await updateRow(TABLES.posts, post.$id, { body: text });
      return { ok: true };
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
      const row = await createRow(
        TABLES.comments,
        ID.unique(),
        { familyId, postId: post.$id, authorId: user.$id, body: text },
        teamRead(familyId)
      );
      return { commentId: row.$id };
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
      const profDone = await deleteWhere(TABLES.profiles, byFamily, deadline, (p) => deleteFileQuiet(p.avatarFileId));
      if (!profDone) return { done: false };
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
        if (!inPost && !inProfile) {
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

  return { handle, actions };
}
