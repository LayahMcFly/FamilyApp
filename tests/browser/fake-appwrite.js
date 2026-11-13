/* A stand-in for the Appwrite web SDK, used ONLY by the browser tests. It never talks to a network.
 * The test sets window.__MOCK before this loads: { signedIn, user, families, profiles, people, canCreateFamily }. */
(function () {
  var M = window.__MOCK = window.__MOCK || {};
  M.log = M.log || [];
  function svc(impl) { return new Proxy(impl, { get: function (t, k) { if (k in t) return t[k]; if (typeof k !== 'string' || k === 'then') return undefined; return function () { M.log.push('unmocked ' + k); return Promise.resolve({}); }; } }); }
  function fail(code, type) { var e = new Error(type); e.code = code; e.type = type; return Promise.reject(e); }
  function Client() { this.setEndpoint = function () { return this; }; this.setProject = function () { return this; }; this.subscribe = function () { M.log.push('subscribe'); return function () { M.log.push('unsubscribe'); }; }; }
  function Account() { return svc({
    get: function () { return M.signedIn ? Promise.resolve(M.user) : fail(401, 'general_unauthorized_scope'); },
    createJWT: function () { return Promise.resolve({ jwt: 'test-jwt' }); },
    createEmailPasswordSession: function () { M.signedIn = true; return Promise.resolve({}); },
    deleteSession: function () { M.signedIn = false; return Promise.resolve({}); },
    updatePrefs: function (a) { M.user.prefs = a.prefs; return Promise.resolve(M.user); }
  }); }
  function Teams() { return svc({ listMemberships: function () { return Promise.resolve({ memberships: (M.members || []) }); } }); }
  function Functions() { return svc({ createExecution: function (a) {
    var body = JSON.parse(a.body || '{}'), act = body.action, out = { ok: true };
    M.log.push('api ' + act + (body.familyId ? ' ' + body.familyId : ''));
    if (act === 'chatOpen') { var tag = (body.familyId || '').replace('fam', '').toLowerCase(); out.role = 'owner'; out.channels = [{ id: 'ch-' + tag, name: 'channel-of-' + tag, kind: 'channel' }]; out.dms = []; out.unread = {}; out.blocked = []; out.allowDms = true; }
    if (act === 'listFamilies') { out.families = M.families.filter(function (f) { return !(M.revoked || []).includes(f.id); }); out.canCreateFamily = !!M.canCreateFamily; }
    return Promise.resolve({ responseBody: JSON.stringify(out), responseStatusCode: 200 });
  } }); }
  function TablesDB() { return svc({ listRows: function (a) {
    var fid = null; (a.queries || []).forEach(function (q) { if (q && q.m === 'equal' && q.a[0] === 'familyId') fid = q.a[1][0]; });
    var rows = ((M.tables || {})[a.tableId] || []).filter(function (r) { return !fid || r.familyId === fid; });
    return Promise.resolve({ rows: rows, total: rows.length });
  } }); }
  function Storage() { return svc({ getFileView: function (a) { var ep = (window.FAMILY_CONFIG && window.FAMILY_CONFIG.endpoint) || 'https://fake.invalid/v1'; return ep.replace(/\/$/, '') + '/storage/buckets/' + a.bucketId + '/files/' + a.fileId + '/view'; } }); }
  var Query = new Proxy({}, { get: function (t, k) { return function () { return { m: k, a: [].slice.call(arguments) }; }; } });
  var ID = { unique: function () { return 'id' + Math.random().toString(36).slice(2); } };
  var Permission = new Proxy({}, { get: function () { return function () { return 'perm'; }; } });
  var Role = new Proxy({}, { get: function () { return function () { return 'role'; }; } });
  window.Appwrite = { Client: Client, Account: Account, Teams: Teams, Functions: Functions, TablesDB: TablesDB, Storage: Storage, Query: Query, ID: ID, Permission: Permission, Role: Role };
})();
