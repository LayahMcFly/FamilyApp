/*
 * Family chat (shared channels + direct messages). All trusted logic lives here and runs inside family-api.
 *
 * Trust model (same as logic.js)
 *  - `user` is the account Appwrite verified from the caller's own JWT. The sender of a message is ALWAYS that
 *    account; no body field can change it.
 *  - Browsers have no write permission on any chat table. Every send, edit, delete, reaction, channel change
 *    and block goes through an action below, which re-checks membership / participation first.
 *  - Row read permissions decide who can read through the database and through Realtime:
 *      shared channel rows -> read(team:<familyId>)           (removing someone from the Team locks them out)
 *      direct message rows -> read(user:<a>) + read(user:<b>) (nobody else: not owners, not chat admins)
 *    Rows of the chatReads, chatBlocks and chatMod tables have NO client permission at all.
 *  - Chat roles are their own thing: family owner (Team role), chat admin (profiles.chatAdmin) and member.
 *    A family-tree relationship, `treeAdmin` or any shop permission never grants chat powers.
 */
import { createHash, createHmac } from 'node:crypto';
import { Query, Permission, Role, ID } from 'node-appwrite';
import { fetchPreview, fetchSiteInfo, checkUrl } from './preview.js';

export const CHAT_TABLES = {
  channels: 'chatChannels',
  messages: 'chatMessages',
  reactions: 'chatReactions',
  dms: 'chatDms',
  reads: 'chatReads',
  typing: 'chatTyping',
  blocks: 'chatBlocks',
  mod: 'chatMod'
};

export const CHAT_LIMITS = {
  bodyMax: 1000,          // characters in one message (the column allows more; this is the rule)
  nameMax: 30,
  descMax: 120,
  maxChannels: 20,        // all channels of one family, archived ones included
  burst: { count: 6, seconds: 10 },     // messages per person
  minute: { count: 30, seconds: 60 },
  reactBurst: { count: 20, seconds: 10 },
  editGapMs: 1000,
  historyPage: 100
};
export const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];   // the quick row; any single emoji is allowed (see emojiOk)
export const EMOJI_MAX_UNITS = 8;          // the chatReactions.emoji column holds 8 UTF-16 units: a few long combinations (families, England's flag) do not fit
export const MAX_REACTION_KINDS = 20;      // different emoji on one message
const EMOJI_RE = /^(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*)$/u;
/** One emoji and nothing else: no letters, no text, no two emoji in a row. */
export function emojiOk(s) { return typeof s === 'string' && s.length > 0 && s.length <= EMOJI_MAX_UNITS && EMOJI_RE.test(s); }
export const DEFAULT_CHANNELS = [
  { slug: 'general', name: 'general', description: 'Everyday conversation for the whole family.', readOnly: false },
  { slug: 'announcements', name: 'announcements', description: 'News from the family owner and chat admins. Everyone can read it; only admins can post.', readOnly: true },
  { slug: 'plans-and-events', name: 'plans-and-events', description: 'Trips, birthdays, dinners and get-togethers: who is coming, when and where.', readOnly: false }
];

const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,36}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export function createChat(c) {
  const { listRows, createRow, updateRow, deleteRow, getRowOrNull, firstRow, requireMember, confirmedMemberships, idOf, textOf,
    bad, forbidden, missing, ApiError, sdkCode, now, db, databaseId, teams, profilesTable } = c;
  const doPreview = c.fetchPreview || fetchPreview;
  const doSiteInfo = c.fetchSiteInfo || fetchSiteInfo;
  const lk = c.livekit || {};
  const doFetch = c.httpFetch || ((...a) => fetch(...a));
  const T = CHAT_TABLES;
  const L = CHAT_LIMITS;

  const channelPerms = (familyId) => [Permission.read(Role.team(familyId))];
  const dmPerms = (a, b) => [Permission.read(Role.user(a)), Permission.read(Role.user(b))];
  const iso = (ms) => new Date(ms).toISOString();

  /** HS256 pass for LiveKit: who you are, which room, and that you may speak and listen. Lasts one hour. */
  function livekitToken(key, secret, { room, identity, ttlSec }) {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const t = Math.floor(now() / 1000);
    const head = b64({ alg: 'HS256', typ: 'JWT' });
    const pay = b64({ iss: key, sub: identity, nbf: t - 10, exp: t + ttlSec, video: { room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: false } });
    const sig = createHmac('sha256', secret).update(`${head}.${pay}`).digest('base64url');
    return `${head}.${pay}.${sig}`;
  }
  async function markCall(familyId, conv, userId, on) {
    const typingKey = `c_${conv.row.$id}_${userId}`;
    const until = iso(on ? now() + 100000 : now() - 1000);
    const ex = await firstRow(T.typing, [Query.equal('typingKey', [typingKey])]);
    if (ex) { await updateRow(T.typing, ex.$id, { until }); return; }
    if (!on) return;
    try { await createRow(T.typing, ID.unique(), { familyId, convId: `call:${conv.row.$id}`, userId, typingKey, text: '', until }, conv.perms); }
    catch (e) { if (sdkCode(e) !== 409) throw e; const again = await firstRow(T.typing, [Query.equal('typingKey', [typingKey])]); if (again) await updateRow(T.typing, again.$id, { until }); }
  }
  const tooMany = (what) => new ApiError(429, 'rate_limited', `You are ${what} too quickly. Wait a few seconds and try again.`);
  const unavailable = () => new ApiError(403, 'dm_unavailable', 'This person is not taking direct messages right now.');
  const notFound = () => missing('That conversation was not found.');
  /** A GIF or sticker message carries only a GIPHY id and a few small fields. Anything else is refused (no URLs, no HTML). */
  const cleanMedia = (m) => {
    if (m === undefined || m === null) return null;
    if (typeof m !== 'object' || Array.isArray(m)) throw bad('That GIF or sticker is not valid.');
    if (m.provider !== 'giphy' || (m.type !== 'gif' && m.type !== 'sticker')) throw bad('That GIF or sticker is not valid.');
    if (typeof m.id !== 'string' || !/^[A-Za-z0-9]{5,30}$/.test(m.id)) throw bad('That GIF or sticker is not valid.');
    const dim = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 20 && n <= 1000 ? n : 200; };
    const alt = typeof m.alt === 'string' ? m.alt.replace(/[\u0000-\u001f\u007f<>"\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) : '';
    return JSON.stringify({ p: 'giphy', t: m.type, id: m.id, w: dim(m.w), h: dim(m.h), a: alt });
  };
  const cleanBody = (v) => {
    const t = textOf(typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '') : v, 'Message', { min: 1, max: L.bodyMax });
    return t;
  };

  /* ---------- roles ---------- */
  async function chatRole(user, ctx) {
    if (ctx.isOwner) return 'owner';
    const prof = await firstRow(profilesTable, [Query.equal('profileKey', [`${ctx.familyId}_${user.$id}`])]);
    return prof && prof.chatAdmin === true ? 'admin' : 'member';
  }
  async function requireManager(user, ctx) {
    const role = await chatRole(user, ctx);
    if (role === 'member') throw forbidden('Only the family owner or a chat admin can do that.');
    return role;
  }
  async function isMemberOf(familyId, userId) {
    const mine = await confirmedMemberships({ $id: userId });
    return mine.some((m) => m.teamId === familyId);
  }

  /* ---------- family chat picture (kept in the family's team settings, so no new table is needed) ---------- */
  async function familyPicture(familyId) {
    try { const prefs = await teams.getPrefs({ teamId: familyId }); return typeof prefs.chatPic === 'string' ? prefs.chatPic : ''; } catch (e) { return ''; }
  }

  /* ---------- channels ---------- */
  const pubChannel = (r) => ({ id: r.$id, name: r.name, description: r.description || '', position: Number(r.position || 0), readOnly: r.readOnly === true, archived: r.archived === true });
  async function listChannels(familyId) {
    const out = [];
    let cursor = null;
    for (let i = 0; i < 5; i++) {
      const q = [Query.equal('familyId', [familyId]), Query.limit(50)];
      if (cursor) q.push(Query.cursorAfter(cursor));
      const page = await listRows(T.channels, q);
      out.push(...page.rows);
      if (page.rows.length < 50) break;
      cursor = page.rows[page.rows.length - 1].$id;
    }
    return out.sort((a, b) => Number(a.position || 0) - Number(b.position || 0) || String(a.$createdAt).localeCompare(String(b.$createdAt)));
  }
  /** Creates the starter channels once per family. The unique `channelKey` makes a second run (or two people opening chat at
   *  the same moment) skip what exists, so a family can never end up with duplicate starter channels. */
  async function ensureChannels(familyId, userId) {
    if (await firstRow(T.channels, [Query.equal('familyId', [familyId])])) return false;
    let made = false;
    for (let i = 0; i < DEFAULT_CHANNELS.length; i++) {
      const d = DEFAULT_CHANNELS[i];
      try {
        await createRow(T.channels, ID.unique(), { familyId, channelKey: `${familyId}_${d.slug}`, name: d.name, description: d.description, position: i, readOnly: d.readOnly, archived: false, createdBy: userId }, channelPerms(familyId));
        made = true;
      } catch (e) { if (sdkCode(e) !== 409) throw e; }
    }
    return made;
  }

  /* ---------- conversations: one place that decides who may touch what ---------- */
  async function resolveConv(user, familyId, kind, convId) {
    if (kind !== 'channel' && kind !== 'dm') throw bad('Conversation kind is not valid.');
    idOf(convId, 'conversation');
    if (kind === 'channel') {
      const row = await getRowOrNull(T.channels, convId);
      if (!row || row.familyId !== familyId) throw notFound();
      return { kind, row, perms: channelPerms(familyId), open: row.archived !== true, reason: row.archived === true ? 'archived' : '' };
    }
    const row = await getRowOrNull(T.dms, convId);
    if (!row || row.familyId !== familyId || (row.userA !== user.$id && row.userB !== user.$id)) throw notFound();   // same answer for "no such DM" and "not yours"
    return { kind, row, perms: dmPerms(row.userA, row.userB), open: row.status === 'open', reason: row.status === 'open' ? '' : 'closed', other: row.userA === user.$id ? row.userB : row.userA };
  }
  async function blockedBetween(familyId, me, other) {
    const theyBlockedMe = await firstRow(T.blocks, [Query.equal('familyId', [familyId]), Query.equal('blockerId', [other]), Query.equal('blockedId', [me, '*'])]);
    if (theyBlockedMe) return 'them';
    const iBlocked = await firstRow(T.blocks, [Query.equal('familyId', [familyId]), Query.equal('blockerId', [me]), Query.equal('blockedId', [other])]);
    return iBlocked ? 'me' : '';
  }
  async function rateCheck(table, field, userId, win, extra = []) {
    const cutoff = iso(now() - win.seconds * 1000);
    const r = await listRows(table, [Query.equal(field, [userId]), Query.greaterThan('$createdAt', cutoff), ...extra, Query.limit(win.count + 1)]);
    return r.rows.length > win.count - 1;   // already at the limit
  }
  const pubMessage = (r) => ({ id: r.$id, convId: r.convId, kind: r.kind, authorId: r.authorId, body: r.body, replyToId: r.replyToId || '', clientId: r.clientId || '', editedAt: r.editedAt || '', createdAt: r.$createdAt, media: r.media || '' });
  // Light per-person limiter for the two actions that call other websites. It lives in memory, so it is a brake rather than a guarantee.
  const hits = new Map();
  function softLimit(kind, userId, count, seconds) {
    const k = `${kind}:${userId}`, t = now(), from = t - seconds * 1000;
    const list = (hits.get(k) || []).filter((x) => x > from);
    if (list.length >= count) { hits.set(k, list); return false; }
    list.push(t); hits.set(k, list);
    if (hits.size > 2000) hits.delete(hits.keys().next().value);
    return true;
  }
  async function dropReactions(messageId) {
    for (let i = 0; i < 20; i++) {
      const page = await listRows(T.reactions, [Query.equal('messageId', [messageId]), Query.limit(100)]);
      if (!page.rows.length) return;
      for (const r of page.rows) await deleteRow(T.reactions, r.$id);
    }
  }
  async function logMod(familyId, actorId, action, convId, targetUserId) {
    try { await createRow(T.mod, ID.unique(), { familyId, actorId, action, convId: convId || '', targetUserId: targetUserId || '' }, []); } catch (e) { /* the record is best-effort; the action itself already happened */ }
  }

  /* ---------- unread: per member, per conversation ---------- */
  async function unreadMap(familyId, me, channels, dms) {
    const reads = await listRows(T.reads, [Query.equal('userId', [me]), Query.equal('familyId', [familyId]), Query.limit(100)]);
    const at = new Map(reads.rows.map((r) => [r.convId, r.lastReadAt]));
    const out = {};
    const list = [...channels.map((r) => ({ r, dm: false })), ...dms.map((r) => ({ r, dm: true }))];
    for (const { r: conv, dm } of list) {
      const since = at.get(conv.$id) || conv.$createdAt;   // never opened: only messages after the conversation was created count
      const r = await listRows(T.messages, [Query.equal('convId', [conv.$id]), Query.notEqual('authorId', [me]), Query.greaterThan('$createdAt', since), Query.limit(10)]);
      out[conv.$id] = { n: r.rows.length, readAt: since, dm };
    }
    return out;
  }

  /* ---------- leaving a family: close that person's DMs ---------- */
  /** Safe to call about anyone: it does nothing unless `userId` is really NOT a confirmed member of the family any more.
   *  The DM row and every message/reaction in it then become readable only by the person who stayed. */
  async function closeDmsFor(familyId, userId, deadline) {
    if (await isMemberOf(familyId, userId)) return { done: true, closed: 0 };
    let closed = 0;
    const dms = await listRows(T.dms, [Query.equal('familyId', [familyId]), Query.or([Query.equal('userA', [userId]), Query.equal('userB', [userId])]), Query.limit(100)]);
    for (const dm of dms.rows) {
      if (dm.status === 'open') {
        const stay = dm.userA === userId ? dm.userB : dm.userA;
        await db.updateRow({ databaseId, tableId: T.dms, rowId: dm.$id, data: { status: 'closed', closedFor: userId, pending: true }, permissions: [Permission.read(Role.user(stay))] });
        dm.status = 'closed'; dm.pending = true; dm.stay = stay; closed += 1;
      } else if (dm.pending === true) dm.stay = dm.userA === dm.closedFor ? dm.userB : dm.userA;
      if (dm.pending !== true) continue;
      let finished = true;
      for (const table of [T.messages, T.reactions]) {
        let cursor = null;
        for (;;) {
          const q = [Query.equal('convId', [dm.$id]), Query.limit(50)];
          if (cursor) q.push(Query.cursorAfter(cursor));
          const page = await listRows(table, q);
          for (const r of page.rows) await db.updateRow({ databaseId, tableId: table, rowId: r.$id, permissions: [Permission.read(Role.user(dm.stay))] });
          if (page.rows.length < 50) break;
          cursor = page.rows[page.rows.length - 1].$id;
          if (now() > deadline) { finished = false; break; }
        }
        if (!finished) break;
      }
      if (finished) await updateRow(T.dms, dm.$id, { pending: false });
      else return { done: false, closed };
    }
    return { done: true, closed };
  }

  /* ---------- family deletion ---------- */
  async function purgeFamily(familyId, deleteWhere, deadline) {
    const by = [Query.equal('familyId', [familyId])];
    for (const t of [T.typing, T.reactions, T.messages, T.reads, T.blocks, T.mod, T.dms, T.channels]) {
      try { if (!(await deleteWhere(t, by, deadline))) return false; } catch (e) { if (sdkCode(e) !== 404) throw e; }   // 404 = chat tables not installed
    }
    return true;
  }

  const actions = {
    /** Everything the chat screen needs in one call, after re-checking membership on the server. */
    async chatOpen({ user, body, deadline }) {
      const ctx = await requireMember(user, body.familyId);
      await ensureChannels(ctx.familyId, user.$id);
      const role = await chatRole(user, ctx);
      // If someone I have a DM with left the family, close those DMs now (idempotent; finishes any half-done earlier attempt).
      const mineDms = await listRows(T.dms, [Query.equal('familyId', [ctx.familyId]), Query.or([Query.equal('userA', [user.$id]), Query.equal('userB', [user.$id])]), Query.limit(100)]);
      let dms = mineDms.rows;
      if (dms.length) {
        const memberIds = new Set((await teams.listMemberships({ teamId: ctx.familyId, queries: [Query.limit(100)] })).memberships.filter((m) => m.confirm === true).map((m) => m.userId));
        let changed = false;
        for (const dm of dms) {
          const other = dm.userA === user.$id ? dm.userB : dm.userA;
          if ((dm.status === 'open' && !memberIds.has(other)) || dm.pending === true) { await closeDmsFor(ctx.familyId, dm.status === 'open' ? other : dm.closedFor, deadline); changed = true; }
        }
        if (changed) dms = (await listRows(T.dms, [Query.equal('familyId', [ctx.familyId]), Query.or([Query.equal('userA', [user.$id]), Query.equal('userB', [user.$id])]), Query.limit(100)])).rows;
      }
      const channels = await listChannels(ctx.familyId);
      const unread = await unreadMap(ctx.familyId, user.$id, channels.filter((x) => x.archived !== true), dms.filter((d) => d.status === 'open'));
      const blocks = await listRows(T.blocks, [Query.equal('familyId', [ctx.familyId]), Query.equal('blockerId', [user.$id]), Query.limit(100)]);
      return {
        role,
        picture: await familyPicture(ctx.familyId),
        channels: channels.map(pubChannel),
        dms: dms.map((d) => ({ id: d.$id, otherId: d.userA === user.$id ? d.userB : d.userA, status: d.status, lastAt: d.lastAt || d.$createdAt })).sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt))),
        unread,
        blocked: blocks.rows.map((b) => b.blockedId).filter((id) => id !== '*'),
        allowDms: !blocks.rows.some((b) => b.blockedId === '*'),
        limits: { body: L.bodyMax },
        reactions: REACTIONS
      };
    },

    async chatUnread({ user, body }) {
      const ctx = await requireMember(user, body.familyId);
      const channels = (await listChannels(ctx.familyId)).filter((x) => x.archived !== true);
      const dms = (await listRows(T.dms, [Query.equal('familyId', [ctx.familyId]), Query.or([Query.equal('userA', [user.$id]), Query.equal('userB', [user.$id])]), Query.equal('status', ['open']), Query.limit(100)])).rows;
      return { unread: await unreadMap(ctx.familyId, user.$id, channels, dms) };
    },

    /** A conversation counts as read when it is on screen, the page is visible and the newest message is in view. The app then
     *  sends the time of the newest message it showed; it can only move forward. */
    async chatMarkRead({ user, body }) {
      const ctx = await requireMember(user, body.familyId);
      await resolveConv(user, ctx.familyId, body.kind, body.convId);
      if (typeof body.at !== 'string' || !ISO_RE.test(body.at) || Number.isNaN(Date.parse(body.at))) throw bad('That time is not valid.');
      const at = iso(Math.min(Date.parse(body.at), now()));
      const readKey = `${user.$id}_${body.convId}`;
      const ex = await firstRow(T.reads, [Query.equal('readKey', [readKey])]);
      if (!ex) {
        try { await createRow(T.reads, ID.unique(), { familyId: ctx.familyId, userId: user.$id, convId: body.convId, readKey, lastReadAt: at }, []); }
        catch (e) { if (sdkCode(e) !== 409) throw e; }
      } else if (at > ex.lastReadAt) await updateRow(T.reads, ex.$id, { lastReadAt: at });
      return { readAt: at };
    },

    async chatSend({ user, body }) {
      const ctx = await requireMember(user, body.familyId);
      const conv = await resolveConv(user, ctx.familyId, body.kind, body.convId);
      const media = cleanMedia(body.media);
      const mediaKind = media ? JSON.parse(media).t : '';
      const caption = typeof body.body === 'string' ? body.body.trim() : '';
      const text = media && !caption ? (mediaKind === 'sticker' ? '[Sticker]' : '[GIF]') : cleanBody(body.body);
      if (typeof body.clientId !== 'string' || !CLIENT_ID_RE.test(body.clientId)) throw bad('Message id is not valid.');
      const sendKey = `${user.$id}_${body.clientId}`;
      // A retry of a message that already arrived must not post it twice: the same clientId returns the stored message.
      const already = await firstRow(T.messages, [Query.equal('sendKey', [sendKey])]);
      if (already) return { message: pubMessage(already), duplicate: true };
      if (!conv.open) throw forbidden(conv.kind === 'channel' ? 'This channel is archived, so nobody can post in it.' : 'This conversation is closed. Someone in it left the family.');
      if (conv.kind === 'channel' && conv.row.readOnly === true) {
        const role = await chatRole(user, ctx);
        if (role === 'member') throw forbidden('Only the family owner or a chat admin can post in this channel.');
      }
      if (conv.kind === 'dm') {
        if (!(await isMemberOf(ctx.familyId, conv.other))) throw forbidden('That person is no longer in this family.');
        const blk = await blockedBetween(ctx.familyId, user.$id, conv.other);
        if (blk === 'them') throw unavailable();
        if (blk === 'me') throw forbidden('You blocked this person. Unblock them in chat settings to message them.');
      }
      if (await rateCheck(T.messages, 'authorId', user.$id, L.burst) || await rateCheck(T.messages, 'authorId', user.$id, L.minute)) throw tooMany('sending messages');
      let replyToId = '';
      if (body.replyToId) {
        replyToId = idOf(body.replyToId, 'reply');
        const target = await getRowOrNull(T.messages, replyToId);
        if (!target || target.convId !== conv.row.$id) throw bad('The message you are replying to is not in this conversation.');
      }
      const data = { familyId: ctx.familyId, convId: conv.row.$id, kind: conv.kind, authorId: user.$id, body: text, clientId: body.clientId, sendKey };
      if (replyToId) data.replyToId = replyToId;
      if (media) data.media = media;
      let row;
      try { row = await createRow(T.messages, ID.unique(), data, conv.perms); }
      catch (e) {
        if (sdkCode(e) !== 409) throw e;
        const again = await firstRow(T.messages, [Query.equal('sendKey', [sendKey])]);
        if (!again) throw e;
        return { message: pubMessage(again), duplicate: true };
      }
      if (conv.kind === 'dm') { try { await updateRow(T.dms, conv.row.$id, { lastAt: row.$createdAt }); } catch (e) { /* ordering hint only */ } }
      return { message: pubMessage(row) };
    },

    /** "Someone is typing". A small row per person and conversation that members of that conversation can read, so it reaches them by realtime.
     *  It only holds the wording the person chose (at most 40 characters of plain text) and a time about 7 seconds ahead. Never the message itself.
     *  Everything that is not allowed (archived, blocked, read-only, too often) quietly does nothing: typing hints must never show an error. */
    async chatTyping({ user, body }) {
      const ctx = await requireMember(user, body.familyId);
      const conv = await resolveConv(user, ctx.familyId, body.kind, body.convId);
      if (!conv.open) return { ok: true, shown: false };
      if (conv.kind === 'channel' && conv.row.readOnly === true && (await chatRole(user, ctx)) === 'member') return { ok: true, shown: false };
      if (conv.kind === 'dm') {
        if (!(await isMemberOf(ctx.familyId, conv.other))) return { ok: true, shown: false };
        if (await blockedBetween(ctx.familyId, user.$id, conv.other)) return { ok: true, shown: false };
      }
      if (!softLimit('typing', user.$id, 20, 60)) return { ok: true, shown: false };
      const text = typeof body.text === 'string' ? body.text.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) : '';
      const typingKey = `${conv.row.$id}_${user.$id}`;
      const until = iso(now() + 7000);
      const ex = await firstRow(T.typing, [Query.equal('typingKey', [typingKey])]);
      if (ex) await updateRow(T.typing, ex.$id, { until, text });
      else {
        try { await createRow(T.typing, ID.unique(), { familyId: ctx.familyId, convId: conv.row.$id, userId: user.$id, typingKey, text, until }, conv.perms); }
        catch (e) { if (sdkCode(e) !== 409) throw e; const again = await firstRow(T.typing, [Query.equal('typingKey', [typingKey])]); if (again) await updateRow(T.typing, again.$id, { until, text }); }
      }
      return { ok: true, shown: true };
    },

    /** "Online now": one row per person (convId "presence"), refreshed by a heartbeat while the chat is open and visible.
     *  The row expires on its own (about 100 seconds), so nothing needs cleaning up. Everyone in the family can read it. */
    async chatPresence({ user, body }) {
      const ctx = await requireMember(user, body.familyId);
      if (!softLimit('presence', user.$id, 6, 60)) return { ok: true, shown: false };
      const typingKey = `p_${ctx.familyId}_${user.$id}`;
      const until = iso(now() + 100000);
      const ex = await firstRow(T.typing, [Query.equal('typingKey', [typingKey])]);
      if (ex) await updateRow(T.typing, ex.$id, { until });
      else {
        try { await createRow(T.typing, ID.unique(), { familyId: ctx.familyId, convId: 'presence', userId: user.$id, typingKey, text: '', until }, channelPerms(ctx.familyId)); }
        catch (e) { if (sdkCode(e) !== 409) throw e; const again = await firstRow(T.typing, [Query.equal('typingKey', [typingKey])]); if (again) await updateRow(T.typing, again.$id, { until }); }
      }
      return { ok: true, shown: true };
    },

    /** Calls. A call is a LiveKit room named after the conversation. Only people who can open the conversation get a pass,
     *  so a DM call is only ever between the two of them and a channel call only for the family. The "call in progress"
     *  banner uses one expiring row per person (convId "call:<conversation>"), the same idea as the online dots. */
    async callJoin({ user, body }) {
      const ctx = await requireMember(user, body.familyId);
      const conv = await resolveConv(user, ctx.familyId, body.kind, body.convId);
      if (!conv.open) throw forbidden('This conversation is read-only now, so it cannot be used for calls.');
      if (conv.kind === 'dm') {
        if (!(await isMemberOf(ctx.familyId, conv.other))) throw forbidden('That person is no longer in the family.');
        if (await blockedBetween(ctx.familyId, user.$id, conv.other)) throw forbidden('You cannot call this person.');
      }
      if (!lk.url || !lk.key || !lk.secret) throw bad('Calls are not turned on yet. The family owner needs to finish the call setup (see CHAT-GUIDE.md, "Calls").');
      if (!softLimit('call', user.$id, 20, 60)) throw tooMany('starting calls');
      // The first person to join starts the call: leave a "started a call" card in the conversation so everyone can join from there.
      try {
        const live = await listRows(T.typing, [Query.equal('convId', [`call:${conv.row.$id}`]), Query.limit(50)]);
        const someoneIn = (live.rows || []).some((r) => Date.parse(r.until || '') > now() && r.userId !== user.$id);
        const mineLive = (live.rows || []).some((r) => Date.parse(r.until || '') > now() && r.userId === user.$id);
        if (!someoneIn && !mineLive) {
          const row = await createRow(T.messages, ID.unique(), { familyId: ctx.familyId, convId: conv.row.$id, kind: conv.kind, authorId: user.$id, body: '[call]', clientId: `call${now()}`, sendKey: `${user.$id}_call${now()}` }, conv.perms);
          if (conv.kind === 'dm') { try { await updateRow(T.dms, conv.row.$id, { lastAt: row.$createdAt }); } catch (e) { /* ordering hint only */ } }
        }
      } catch (e) { /* the call itself must still start */ }
      await markCall(ctx.familyId, conv, user.$id, true);
      const room = `fc_${conv.row.$id}`;
      const token = livekitToken(lk.key, lk.secret, { room, identity: user.$id, ttlSec: 3600 });
      return { url: lk.url, token, room, identity: user.$id };
    },

    async callPing({ user, body }) {
      const ctx = await requireMember(user, body.familyId);
      const conv = await resolveConv(user, ctx.familyId, body.kind, body.convId);
      if (!conv.open || !softLimit('callping', user.$id, 6, 60)) return { ok: true };
      await markCall(ctx.familyId, conv, user.$id, true);
      return { ok: true };
    },

    async callLeave({ user, body }) {
      const ctx = await requireMember(user, body.familyId);
      const conv = await resolveConv(user, ctx.familyId, body.kind, body.convId);
      await markCall(ctx.familyId, conv, user.$id, false);
      return { ok: true };
    },

    async chatEdit({ user, body }) {
      const ctx = await requireMember(user, body.familyId);
      const id = idOf(body.messageId, 'message');
      const row = await getRowOrNull(T.messages, id);
      if (!row || row.familyId !== ctx.familyId) throw missing('That message was not found.');
      const conv = await resolveConv(user, ctx.familyId, row.kind, row.convId);
      if (row.authorId !== user.$id) throw forbidden('You can only edit your own messages.');
      if (!conv.open) throw forbidden('This conversation is read-only now.');
      const text = cleanBody(body.body);
      if (row.editedAt && now() - Date.parse(row.editedAt) < L.editGapMs) throw tooMany('editing');
      if (text === row.body) return { message: pubMessage(row) };
      const updated = await updateRow(T.messages, id, { body: text, editedAt: iso(now()) });
      return { message: pubMessage(updated) };
    },

    /** Your own message: you can always delete it. A message from someone else in a SHARED channel: only the family owner or a
     *  chat admin, and that is written to the moderation record (who, what kind of action, where; never the message text).
     *  Direct messages can only ever be deleted by their author. */
    async chatDelete({ user, body }) {
      const ctx = await requireMember(user, body.familyId);
      const id = idOf(body.messageId, 'message');
      const row = await getRowOrNull(T.messages, id);
      if (!row || row.familyId !== ctx.familyId) throw missing('That message was not found.');
      await resolveConv(user, ctx.familyId, row.kind, row.convId);
      let moderated = false;
      if (row.authorId !== user.$id) {
        if (row.kind !== 'channel') throw forbidden('You can only delete your own messages.');
        await requireManager(user, ctx);
        moderated = true;
      }
      await dropReactions(id);
      await deleteRow(T.messages, id);
      if (moderated) await logMod(ctx.familyId, user.$id, 'removed_message', row.convId, row.authorId);
      return { deleted: true, moderated };
    },

    async chatReact({ user, body }) {
      const ctx = await requireMember(user, body.familyId);
      const id = idOf(body.messageId, 'message');
      const emoji = typeof body.emoji === 'string' ? body.emoji : '';
      if (!emojiOk(emoji)) throw bad('Choose a single emoji to react with.');
      const row = await getRowOrNull(T.messages, id);
      if (!row || row.familyId !== ctx.familyId) throw missing('That message was not found.');
      const conv = await resolveConv(user, ctx.familyId, row.kind, row.convId);
      if (!conv.open) throw forbidden('This conversation is read-only now.');
      // The six quick emoji keep their original key; every other emoji is keyed by a short hash of itself (one row per person per emoji per message).
      const idx = REACTIONS.indexOf(emoji);
      const reactionKey = `${id}_${user.$id}_${idx >= 0 ? idx : 'x' + createHash('sha1').update(emoji).digest('hex').slice(0, 12)}`;
      const ex = await firstRow(T.reactions, [Query.equal('reactionKey', [reactionKey])]);
      if (ex) { await deleteRow(T.reactions, ex.$id); return { on: false }; }
      if (await rateCheck(T.reactions, 'userId', user.$id, L.reactBurst)) throw tooMany('reacting');
      const existing = await listRows(T.reactions, [Query.equal('messageId', [id]), Query.limit(100)]);
      const kinds = new Set(existing.rows.map((r) => r.emoji));
      if (!kinds.has(emoji) && kinds.size >= MAX_REACTION_KINDS) throw bad(`This message already has ${MAX_REACTION_KINDS} different reactions.`);
      try { await createRow(T.reactions, ID.unique(), { familyId: ctx.familyId, convId: row.convId, messageId: id, userId: user.$id, emoji, reactionKey }, conv.perms); }
      catch (e) { if (sdkCode(e) !== 409) throw e; }
      return { on: true };
    },


    /* ----- link previews and GIF search (the server talks to the other websites, never the family's phones) ----- */
    async chatPreview({ user, body }) {
      await requireMember(user, body.familyId);
      const url = typeof body.url === 'string' ? body.url.trim() : '';
      if (!url || url.length > 500 || !checkUrl(url)) throw bad('That link cannot be previewed.');
      if (!softLimit('preview', user.$id, 12, 60)) throw tooMany('asking for link previews');
      return { preview: await doPreview(url) };
    },

    /** Saved links: the page title and a small icon for an address. The server talks to the other website, never the phone. */
    async linkInfo({ user, body }) {
      await requireMember(user, body.familyId);
      const url = typeof body.url === 'string' ? body.url.trim() : '';
      if (!url || url.length > 500 || !checkUrl(url)) throw bad('That link cannot be looked up.');
      if (!softLimit('linkinfo', user.$id, 12, 60)) throw tooMany('adding links');
      const info = await doSiteInfo(url);
      return { title: String(info && info.title || '').slice(0, 120), icon: info && typeof info.icon === 'string' && info.icon.length < 140000 ? info.icon : '' };
    },

    /** Sets or clears the picture shown for this family's chat. Owner or chat admin only. fileId '' clears it. */
    async chatPicture({ user, body }) {
      const ctx = await requireMember(user, body.familyId);
      await requireManager(user, ctx);
      const fileId = body.fileId ? idOf(body.fileId, 'file') : '';
      const prefs = await teams.getPrefs({ teamId: ctx.familyId }).catch(() => ({}));
      const old = typeof prefs.chatPic === 'string' ? prefs.chatPic : '';
      if (fileId && fileId !== old) await c.claimFile(user, ctx.familyId, fileId, 'avatar');
      const next = { ...prefs };
      if (fileId) next.chatPic = fileId; else delete next.chatPic;
      await teams.updatePrefs({ teamId: ctx.familyId, prefs: next });
      if (old && old !== fileId && c.deleteFileQuiet) await c.deleteFileQuiet(old);
      return { picture: fileId };
    },

    /* ----- channel management (family owner or chat admin) ----- */
    async chatChannelSave({ user, body }) {
      const ctx = await requireMember(user, body.familyId);
      await requireManager(user, ctx);
      const name = textOf(body.name === undefined ? '' : body.name, 'Channel name', { min: 0, max: 60 }).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const desc = body.description === undefined ? undefined : textOf(body.description, 'Description', { max: L.descMax });
      const all = await listChannels(ctx.familyId);
      if (body.channelId) {
        const row = all.find((x) => x.$id === idOf(body.channelId, 'channel'));
        if (!row) throw missing('That channel was not found.');
        const data = {};
        if (body.name !== undefined) {
          if (!name || name.length > L.nameMax) throw bad(`A channel name uses 1 to ${L.nameMax} letters, numbers or dashes.`);
          if (all.some((x) => x.$id !== row.$id && x.name === name)) throw bad('A channel with that name already exists.');
          data.name = name;
        }
        if (desc !== undefined) data.description = desc;
        if (typeof body.readOnly === 'boolean') data.readOnly = body.readOnly;
        if (!Object.keys(data).length) return { channel: pubChannel(row) };
        const updated = await updateRow(T.channels, row.$id, data);
        if (data.readOnly !== undefined && data.readOnly !== (row.readOnly === true)) await logMod(ctx.familyId, user.$id, data.readOnly ? 'channel_read_only' : 'channel_open_to_all', row.$id, '');
        return { channel: pubChannel(updated) };
      }
      if (!name || name.length > L.nameMax) throw bad(`A channel name uses 1 to ${L.nameMax} letters, numbers or dashes.`);
      if (all.length >= L.maxChannels) throw bad(`A family can have at most ${L.maxChannels} channels, including archived ones.`);
      if (all.some((x) => x.name === name)) throw bad('A channel with that name already exists.');
      const position = all.reduce((m, x) => Math.max(m, Number(x.position || 0)), -1) + 1;
      const row = await createRow(T.channels, ID.unique(), { familyId: ctx.familyId, channelKey: `${ctx.familyId}_${ID.unique()}`, name, description: desc || '', position, readOnly: body.readOnly === true, archived: false, createdBy: user.$id }, channelPerms(ctx.familyId));
      return { channel: pubChannel(row) };
    },

    async chatChannelOrder({ user, body }) {
      const ctx = await requireMember(user, body.familyId);
      await requireManager(user, ctx);
      if (!Array.isArray(body.order) || body.order.length > L.maxChannels) throw bad('That order is not valid.');
      const all = await listChannels(ctx.familyId);
      const ids = new Set(all.map((x) => x.$id));
      const order = [];
      for (const id of body.order) { idOf(id, 'channel'); if (!ids.has(id)) throw bad('A channel in that list does not belong to this family.'); if (!order.includes(id)) order.push(id); }
      for (const r of all) if (!order.includes(r.$id)) order.push(r.$id);
      for (let i = 0; i < order.length; i++) { const r = all.find((x) => x.$id === order[i]); if (Number(r.position || 0) !== i) await updateRow(T.channels, r.$id, { position: i }); }
      return { ok: true };
    },

    /** Archiving never deletes messages. The channel leaves the list, stays readable (from "Archived channels"), and nobody can post
     *  until it is restored. */
    async chatChannelArchive({ user, body }) {
      const ctx = await requireMember(user, body.familyId);
      await requireManager(user, ctx);
      const all = await listChannels(ctx.familyId);
      const row = all.find((x) => x.$id === idOf(body.channelId, 'channel'));
      if (!row) throw missing('That channel was not found.');
      const archived = body.archived !== false;
      if (archived && all.filter((x) => x.archived !== true).length <= 1) throw bad('A family needs at least one channel that is not archived.');
      if (row.archived === true !== archived) {
        await updateRow(T.channels, row.$id, { archived });
        await logMod(ctx.familyId, user.$id, archived ? 'channel_archived' : 'channel_restored', row.$id, '');
      }
      return { ok: true, archived };
    },

    /** Owner only. Makes a family member a chat admin (or removes that). Owners always have admin powers. */
    async chatSetAdmin({ user, body }) {
      const ctx = await requireMember(user, body.familyId);
      if (!ctx.isOwner) throw forbidden('Only a family owner can choose chat admins.');
      const uid = idOf(body.userId, 'userId');
      const prof = await firstRow(profilesTable, [Query.equal('profileKey', [`${ctx.familyId}_${uid}`])]);
      if (!prof) throw bad('That person is not a member of this family.');
      try { await updateRow(profilesTable, prof.$id, { chatAdmin: body.admin === true }); }
      catch (e) { if (sdkCode(e) === 400) throw bad('Chat is not fully set up: the chatAdmin column is missing on the profiles table (see CHAT-GUIDE.md).'); throw e; }
      await logMod(ctx.familyId, user.$id, body.admin === true ? 'chat_admin_added' : 'chat_admin_removed', '', uid);
      return { admin: body.admin === true };
    },

    async chatModLog({ user, body }) {
      const ctx = await requireMember(user, body.familyId);
      await requireManager(user, ctx);
      const r = await listRows(T.mod, [Query.equal('familyId', [ctx.familyId]), Query.orderDesc('$createdAt'), Query.limit(50)]);
      return { entries: r.rows.map((x) => ({ id: x.$id, actorId: x.actorId, action: x.action, convId: x.convId || '', targetUserId: x.targetUserId || '', at: x.$createdAt })) };
    },

    /* ----- direct messages: scoped to one family; one conversation per pair of people per family ----- */
    async chatDmStart({ user, body }) {
      const ctx = await requireMember(user, body.familyId);
      const other = idOf(body.userId, 'userId');
      if (other === user.$id) throw bad('You cannot message yourself.');
      if (!(await isMemberOf(ctx.familyId, other))) throw bad('That person is not a member of this family.');
      const prof = await firstRow(profilesTable, [Query.equal('profileKey', [`${ctx.familyId}_${other}`])]);
      if (!prof) throw bad('That person has not finished setting up their profile yet.');
      const blk = await blockedBetween(ctx.familyId, user.$id, other);
      if (blk === 'them') throw unavailable();
      if (blk === 'me') throw forbidden('You blocked this person. Unblock them in chat settings first.');
      const [a, b] = [user.$id, other].sort();
      const dmKey = `${ctx.familyId}_${a}_${b}`;
      let row = await firstRow(T.dms, [Query.equal('dmKey', [dmKey])]);
      if (!row) {
        try { row = await createRow(T.dms, ID.unique(), { familyId: ctx.familyId, userA: a, userB: b, dmKey, status: 'open', lastAt: '', closedFor: '', pending: false }, dmPerms(a, b)); }
        catch (e) { if (sdkCode(e) !== 409) throw e; row = await firstRow(T.dms, [Query.equal('dmKey', [dmKey])]); }
      }
      if (row.status !== 'open') throw forbidden('This conversation was closed when someone left the family.');
      return { dm: { id: row.$id, otherId: other, status: row.status, lastAt: row.lastAt || row.$createdAt } };
    },

    /** userId "*" means "no direct messages from anyone in this family". Blocked people are not told. */
    async chatBlock({ user, body }) {
      const ctx = await requireMember(user, body.familyId);
      const target = body.userId === '*' ? '*' : idOf(body.userId, 'userId');
      if (target === user.$id) throw bad('You cannot block yourself.');
      const key = `${ctx.familyId}_${user.$id}_${target}`;
      const ex = await firstRow(T.blocks, [Query.equal('blockKey', [key])]);
      if (body.blocked === false) { if (ex) await deleteRow(T.blocks, ex.$id); return { blocked: false }; }
      if (!ex) {
        try { await createRow(T.blocks, ID.unique(), { familyId: ctx.familyId, blockerId: user.$id, blockedId: target, blockKey: key }, []); }
        catch (e) { if (sdkCode(e) !== 409) throw e; }
      }
      return { blocked: true };
    },

    /** The owner calls this after removing someone (the app does it for them). Harmless about anyone who is still a member. */
    async chatReconcile({ user, body, deadline }) {
      const ctx = await requireMember(user, body.familyId);
      const r = await closeDmsFor(ctx.familyId, idOf(body.userId, 'userId'), deadline);
      return r;
    }
  };

  /** Appwrite event trigger on "teams.*.memberships.*.delete". The payload is the deleted membership. */
  async function handleEvent({ event, payload, deadline }) {
    if (typeof event === 'string' && /\.memberships\.[^.]+\.delete$/.test(event) && payload && typeof payload.teamId === 'string' && typeof payload.userId === 'string') {
      try { const r = await closeDmsFor(payload.teamId, payload.userId, deadline); return { status: 200, json: { ok: true, ...r } }; }
      catch (e) { if (sdkCode(e) === 404) return { status: 200, json: { ok: true, skipped: true } }; throw e; }
    }
    return { status: 200, json: { ok: true, ignored: true } };
  }

  return { actions, handleEvent, purgeFamily };
}
