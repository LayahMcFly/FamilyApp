/* Family Circle: turns our own people rows into the format the family-chart drawing library expects.
 *
 * The library only DRAWS. Our people stay in our own Appwrite table; nothing here talks to a server.
 * What the library can and cannot show is decided here, and everything it cannot show is returned in
 * `notes` so the page can tell the reader, instead of quietly leaving a relationship out.
 *
 * Library limits found by testing family-chart 0.9.0:
 *   - A child can have at most 2 parents (3 or more throws "child has more than 1 parent").
 *   - Gender is M or F; anything else is drawn as a neutral card.
 *   - Every parent link looks the same, so adoptive / step / foster are shown by us as a label on the child's card.
 *   - Partner status (married, divorced...) is shown by us as text on the partner line.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FCTreeAdapter = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PARENT_LABEL = { biological: 'Biological parent', adoptive: 'Adoptive parent', step: 'Step-parent', foster: 'Foster parent', guardian: 'Guardian' };
  var CHILD_LABEL = { adoptive: 'Adopted', step: 'Step-child', foster: 'Foster child', guardian: 'Ward' };
  var PARTNER_LABEL = { partner: 'Partner', married: 'Married', divorced: 'Divorced', separated: 'Separated' };

  function kindsOf(p) {
    if (!p || !p.relKinds) return {};
    try { var o = JSON.parse(p.relKinds); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch (e) { return {}; }
  }
  function genderCode(g) {
    var s = String(g || '').trim().toLowerCase();
    if (s === 'female' || s === 'f' || s === 'woman' || s === 'girl') return 'F';
    if (s === 'male' || s === 'm' || s === 'man' || s === 'boy') return 'M';
    return '';   // not set, nonbinary, other: drawn as a neutral card
  }
  function uniq(list) { var out = []; list.forEach(function (x) { if (out.indexOf(x) === -1) out.push(x); }); return out; }

  /**
   * people: rows of the people table for ONE family (the caller fetches them with a familyId query).
   * Returns { data, notes, parentKind, partnerKind, hiddenParents }.
   */
  function buildChartData(people) {
    var byId = {}; people.forEach(function (p) { byId[p.$id] = p; });
    var order = people.slice().sort(function (a, b) { return new Date(a.$createdAt || 0) - new Date(b.$createdAt || 0); });
    var notes = [], parentKind = {}, partnerKind = {}, hiddenParents = {};

    // partners are mirrored: if either side lists the other, they are partners
    var spouses = {}; order.forEach(function (p) { spouses[p.$id] = []; });
    order.forEach(function (p) {
      (p.partnerIds || []).forEach(function (q) {
        if (!byId[q] || q === p.$id) return;
        if (spouses[p.$id].indexOf(q) === -1) spouses[p.$id].push(q);
        if (spouses[q].indexOf(p.$id) === -1) spouses[q].push(p.$id);
      });
    });
    // partner status can be stored on either person; "divorced" etc. win over the plain default
    order.forEach(function (p) {
      var k = kindsOf(p);
      Object.keys(k).forEach(function (key) {
        if (key.slice(0, 2) !== 's:') return;
        var q = key.slice(2); if (!byId[q]) return;
        var pair = [p.$id, q].sort().join('|');
        if (PARTNER_LABEL[k[key]] && k[key] !== 'partner') partnerKind[pair] = k[key];
      });
    });

    // parents: the library draws two per child. Choose the pair that is most likely "the" parents and report the rest.
    var parents = {};
    order.forEach(function (p) {
      var ids = uniq((p.parentIds || []).filter(function (x) { return byId[x] && x !== p.$id; }));
      var kinds = kindsOf(p);
      ids.forEach(function (q) { if (kinds['p:' + q] && kinds['p:' + q] !== 'biological') parentKind[p.$id + '>' + q] = kinds['p:' + q]; });
      if (ids.length > 2) {
        var best = null;
        for (var i = 0; i < ids.length && !best; i++) for (var j = i + 1; j < ids.length; j++) {
          if (spouses[ids[i]].indexOf(ids[j]) !== -1) { best = [ids[i], ids[j]]; break; }
        }
        if (!best) {
          var bio = ids.filter(function (q) { return !parentKind[p.$id + '>' + q]; });
          best = bio.concat(ids.filter(function (q) { return bio.indexOf(q) === -1; })).slice(0, 2);
        }
        var drawn = ids.filter(function (q) { return best.indexOf(q) !== -1; });
        var hidden = ids.filter(function (q) { return best.indexOf(q) === -1; });
        hiddenParents[p.$id] = hidden;
        notes.push({ personId: p.$id, kind: 'extra-parents', text: p.name + ' has ' + ids.length + ' parents. The tree can draw two, so ' + hidden.map(function (q) { return byId[q].name; }).join(' and ') + (hidden.length > 1 ? ' are' : ' is') + ' not drawn above ' + p.name + '. The link is still saved and is listed in ' + p.name + '’s details below the tree.' });
        ids = drawn;
      }
      parents[p.$id] = ids;
    });

    var children = {}; order.forEach(function (p) { children[p.$id] = []; });
    order.forEach(function (p) { parents[p.$id].forEach(function (q) { children[q].push(p.$id); }); });

    var data = order.map(function (p) {
      return {
        id: p.$id,
        data: { name: p.name || 'Someone', gender: genderCode(p.gender), birthday: p.birthday || '', userId: p.userId || '', confirmed: p.confirmed === true },
        rels: { parents: parents[p.$id], spouses: spouses[p.$id], children: children[p.$id] }
      };
    });
    return { data: data, notes: notes, parentKind: parentKind, partnerKind: partnerKind, hiddenParents: hiddenParents };
  }

  /** The plain-words relationship of one person, for the details panel: nothing is dropped here. */
  function relativesOf(people, id) {
    var byId = {}; people.forEach(function (p) { byId[p.$id] = p; });
    var p = byId[id]; if (!p) return null;
    var kinds = kindsOf(p);
    var out = { parents: [], partners: [], children: [], siblings: [] };
    uniq((p.parentIds || []).filter(function (x) { return byId[x] && x !== id; })).forEach(function (q) {
      out.parents.push({ id: q, name: byId[q].name, kind: kinds['p:' + q] || 'biological' });
    });
    var seenPartner = {};
    function addPartner(q) {
      if (!byId[q] || q === id || seenPartner[q]) return; seenPartner[q] = 1;
      var other = kindsOf(byId[q]);
      var k = kinds['s:' + q] || other['s:' + id] || 'partner';
      out.partners.push({ id: q, name: byId[q].name, kind: k });
    }
    (p.partnerIds || []).forEach(addPartner);
    people.forEach(function (o) { if ((o.partnerIds || []).indexOf(id) !== -1) addPartner(o.$id); });
    people.forEach(function (c) {
      if (c.$id === id) return;
      var ck = kindsOf(c);
      if ((c.parentIds || []).indexOf(id) !== -1) out.children.push({ id: c.$id, name: c.name, kind: ck['p:' + id] || 'biological' });
    });
    var mine = out.parents.map(function (x) { return x.id; });
    people.forEach(function (c) {
      if (c.$id === id) return;
      var shared = (c.parentIds || []).filter(function (x) { return mine.indexOf(x) !== -1; });
      if (shared.length) out.siblings.push({ id: c.$id, name: c.name, kind: shared.length === mine.length && mine.length > 1 ? 'full' : 'half' });
    });
    return out;
  }

  return { buildChartData: buildChartData, relativesOf: relativesOf, genderCode: genderCode, kindsOf: kindsOf, PARENT_LABEL: PARENT_LABEL, CHILD_LABEL: CHILD_LABEL, PARTNER_LABEL: PARTNER_LABEL };
});
