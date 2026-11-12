/* Family Circle: Photo Gifts shop (optional).
 *
 * Everything here runs in the browser and only asks the trusted `shop-api` function to do things.
 * Prices, shipping, payment checks and Printify orders are all decided on the server; this file never sees
 * a Printify token, a payment key or another person's order.
 *
 * What is local and what is not:
 *  - The layout preview and the print-ready image are made HERE, on the phone, with a canvas. Nothing leaves the phone
 *    until the person taps "Add to cart", when the print-ready JPEG goes to a private Appwrite bucket (only they can read it).
 *  - Printify's own mockup generator is NOT used, so the preview is a flat layout of the print area, never a picture of the
 *    finished product.
 *  - The image is shared with Printify and its print partners only after payment has been verified on the server.
 */
(function () {
  'use strict';
  var X = null;                       // helpers handed over by app.js
  var h, clear, icon, toast;

  var CONSENT_IMAGE = 'To create your product, the selected image will be shared with Printify and the fulfillment partners needed to make and deliver it.';
  var CONSENT_DELIVERY = 'Your name, delivery address, email and phone number (if you add one) will be shared with Printify and the shipping partners so they can deliver this order. They are not shown to your family. Your email is also given to Square so it can send your payment receipt.';

  function money(c) { return '$' + (Number(c || 0) / 100).toFixed(2); }
  function st() { return X.S.shop || (X.S.shop = { orders: null, designs: null, addr: null, requestId: null }); }

  /* ---------- talking to the shop function ---------- */
  async function shopApi(action, payload) {
    var body = Object.assign({ action: action, jwt: await X.getJwt() }, payload || {});
    var ex = await X.functions.createExecution({ functionId: X.CFG.shopFunctionId, body: JSON.stringify(body), async: false, xpath: '/', method: 'POST' });
    var json = null;
    try { json = JSON.parse(ex.responseBody || 'null'); } catch (e) { json = null; }
    if (!json || typeof json !== 'object') {
      var bad = new Error('The shop did not answer. It may not be set up yet, or it may be starting up. Please try again in a moment.');
      bad.code = ex.responseStatusCode || 500; throw bad;
    }
    if (!json.ok) { var err = new Error(json.message || 'Something went wrong.'); err.code = ex.responseStatusCode; err.apiCode = json.error; err.data = json; throw err; }
    return json;
  }
  function msgOf(e) { return e && e.message ? e.message : X.friendly(e); }

  /* The catalog is read once per visit and kept in memory only. */
  async function loadCatalog(force) {
    var s = st();
    if (s.catalog && !force && s.catalogFam === X.S.familyId) return s.catalog;
    s.catalog = await shopApi('shopCatalog', { familyId: X.S.familyId }); s.catalogFam = X.S.familyId;
    return s.catalog;
  }
  function productByKey(cat, key) { return (cat.products || []).filter(function (p) { return p.key === key; })[0] || null; }
  function fromPrice(p) { return Math.min.apply(null, p.variants.map(function (v) { return v.priceCents; })); }

  var DEFAULT_SECTIONS = [{ id: 'photo-gifts', title: 'Photo Gifts', blurb: 'Turn your memories into personalized gifts.', ready: true }, { id: 'family-shop', title: 'Family Shop', blurb: 'Shop useful finds for family life and gatherings.', ready: false }];
  function head(title, back, backText) {
    return h('div', { class: 'shop-head' },
      back ? h('a', { class: 'link-btn back-btn', href: back, text: backText || 'Back', onclick: null }) : null,
      h('h1', { text: title }));
  }
  function shopLinks(extra) {
    return h('div', { class: 'shop-links' },
      h('a', { class: 'btn secondary small cart-icon-btn', href: '#/shop/cart', 'aria-label': 'Cart' + (extra && extra.cart ? ', ' + extra.cart + ' items' : ''), title: 'Cart', onclick: function (ev) { if (st().section === 'family-shop') { ev.preventDefault(); location.hash = '#/shop/cart/family'; } } }, icon('cart'), extra && extra.cart ? h('span', { class: 'cart-count', text: String(extra.cart) }) : null),
      h('a', { class: 'btn secondary small', href: '#/orders', text: 'My orders', onclick: function () { X.S.ordersFrom = ''; } }));
  }
  function setupNeeded(main, e) {
    clear(main).appendChild(h('div', { class: 'empty' }, h('h1', { text: 'Shop' }), h('p', { text: msgOf(e) }),
      h('p', { class: 'small muted', text: 'If you own this app: the shop is set up with SHOP-GUIDE.md.' })));
  }

  /* ================= SHOP HOME ================= */
  var PER_PAGE = 12;
  var SORTS = [['featured', 'Featured first'], ['price-asc', 'Price: low to high'], ['price-desc', 'Price: high to low'], ['name', 'Name: A to Z']];
  var COUNTRY_NAMES = { US: 'the United States', CN: 'China', GB: 'the United Kingdom', DE: 'Germany', FR: 'France', CA: 'Canada', AU: 'Australia' };
  var BANDS = [['u10', 'Under $10', 0, 1000], ['10-25', '$10 to $25', 1000, 2500], ['25-50', '$25 to $50', 2500, 5000], ['50p', '$50 and over', 5000, Infinity]];
  function freshFilters() { return { q: '', sort: 'featured', cat: 'all', kind: 'all', stock: false, band: '', min: '', max: '', page: 1 }; }
  function filtersFor(id) { var s = st(); s.filters = s.filters || {}; return s.filters[id] || (s.filters[id] = freshFilters()); }
  function isFiltered(f) { return !!(f.q || f.cat !== 'all' || f.kind !== 'all' || f.stock || f.band || f.min || f.max); }
  function dollarsToCents(v) { var t = String(v || '').replace(/[$,\s]/g, ''); if (!t) return null; var n = Math.round(parseFloat(t) * 100); return isFinite(n) && n >= 0 ? n : null; }
  function priceOk(it, f) {
    var b = BANDS.filter(function (x) { return x[0] === f.band; })[0];
    if (b && !(it.fromCents >= b[2] && it.fromCents < b[3])) return false;
    var lo = dollarsToCents(f.min), hi = dollarsToCents(f.max);
    return !((lo !== null && it.fromCents < lo) || (hi !== null && it.fromCents > hi));
  }
  function norm(s) { return String(s || '').toLowerCase(); }
  function priceText(it) { return (it.hasRange ? 'From ' : '') + money(it.fromCents); }
  function priceBits(it) {
    var c = Number(it.fromCents || 0), d = Math.floor(c / 100), ct = String(c % 100).padStart(2, '0');
    return h('span', { class: 'tt-price' }, it.hasRange ? h('em', { text: 'From ' }) : null, h('small', { text: '$' }), h('b', { text: d.toLocaleString('en-US') }), h('small', { text: '.' + ct }));
  }
  function itemCard(it) {
    var img = it.image ? h('img', { class: 'shop-thumb', src: it.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : h('div', { class: 'shop-thumb ph', 'aria-hidden': 'true' });
    var tag = it.tag ? h('span', { class: 'tt-badge', text: it.tag }) : null;
    var avail = it.availability === 'out_of_stock' ? h('span', { class: 'tt-out', text: 'Out of stock' }) : null;
    var title = h('strong', { class: 'shop-title' }, tag, tag ? ' ' : null, it.title);
    return h('a', { class: 'shop-card tt-card', href: it.href }, img, title, avail,
      h('span', { class: 'tt-foot' }, priceBits(it), h('span', { class: 'tt-add', 'aria-hidden': 'true' }, icon('cart'))));
  }
  /* Both sections feed the same list shape, so search, sort, filters and pages behave the same in each. */
  function photoItems(cat) {
    var secOf = {}; (cat.slots || []).forEach(function (s) { secOf[s.key] = s.section || 'gifts'; });
    var featured = cat.featuredKeys || [];
    return (cat.products || []).map(function (p) {
      var sec = secOf[p.key] || 'gifts';
      return { id: p.key, href: '#/shop/product/' + p.key, title: p.title, image: p.image || '', fromCents: fromPrice(p), hasRange: p.variants.length > 1 && fromPrice(p) !== Math.max.apply(null, p.variants.map(function (v) { return v.priceCents; })), tag: p.kind === 'words' ? 'Add your words' : 'Add your photo',
        cat: sec, kind: p.kind === 'words' ? 'words' : 'photo', featured: featured.indexOf(p.key) >= 0, availability: 'unknown', text: norm(p.title + ' ' + (p.blurb || '') + ' ' + sectionTitle(sec) + ' ' + (p.kind === 'words' ? 'words text engraved name' : 'photo picture')) };
    });
  }
  function familyItems(fam) {
    return (fam.products || []).map(function (p) {
      return { id: p.id, href: '#/shop/item/' + p.id, title: p.title, image: p.image || '', fromCents: p.fromCents, hasRange: p.hasRange, tag: '', cat: p.category, kind: 'all', featured: p.featured, availability: p.availability, text: norm(p.title + ' ' + (p.description || '').slice(0, 300) + ' ' + famCatTitle(fam, p.category)) };
    });
  }
  function famCatTitle(fam, id) { var c = (fam.categories || []).filter(function (x) { return x.id === id; })[0]; return c ? c.title : 'More finds'; }
  function applyFilters(items, f, skip) {
    var words = norm(f.q).split(/\s+/).filter(Boolean);
    var out = items.filter(function (it) {
      return words.every(function (w) { return it.text.indexOf(w) !== -1; }) && (skip === 'cat' || f.cat === 'all' || it.cat === f.cat) && (skip === 'kind' || f.kind === 'all' || it.kind === f.kind)
        && (skip === 'stock' || !f.stock || it.availability === 'in_stock') && (skip === 'price' || priceOk(it, f));
    });
    if (skip) return out;
    var by = { 'price-asc': function (a, b) { return a.fromCents - b.fromCents; }, 'price-desc': function (a, b) { return b.fromCents - a.fromCents; }, name: function (a, b) { return a.title.localeCompare(b.title); },
      featured: function (a, b) { return (b.featured ? 1 : 0) - (a.featured ? 1 : 0); } }[f.sort] || null;
    if (by) out = out.map(function (x, i) { return [x, i]; }).sort(function (a, b) { return by(a[0], b[0]) || a[1] - b[1]; }).map(function (p) { return p[0]; });
    return out;
  }

  function priceLabel(f) {
    var b = BANDS.filter(function (x) { return x[0] === f.band; })[0];
    if (b) return b[1];
    var lo = dollarsToCents(f.min), hi = dollarsToCents(f.max);
    return lo !== null && hi !== null ? money(lo) + ' to ' + money(hi) : (lo !== null ? money(lo) + ' and over' : 'Up to ' + money(hi));
  }
  /* Amazon-style filter sheet: opens over the shop, changes apply at once, the button at the bottom says how many results you will see. */
  var sheetEl = null, sheetKey = null;
  function closeSheet() { if (sheetEl) { sheetEl.remove(); sheetEl = null; document.removeEventListener('keydown', sheetKey); window.removeEventListener('hashchange', closeSheet); document.body.style.overflow = ''; } }
  function openSheet(id, items, cats, anyStock, f, redraw) {
    closeSheet();
    var opener = document.activeElement;
    sheetEl = h('div', { class: 'sheet-backdrop' });
    var box = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Filters' }); sheetEl.appendChild(box);
    sheetKey = function (ev) { if (ev.key === 'Escape') { closeSheet(); if (opener && opener.focus) opener.focus(); } };
    document.addEventListener('keydown', sheetKey); window.addEventListener('hashchange', closeSheet);
    sheetEl.addEventListener('click', function (ev) { if (ev.target === sheetEl) closeSheet(); });
    function group(title, kids) { return h('fieldset', { class: 'filter-group' }, h('legend', { text: title }), kids); }
    function radio(name, label, n, checked, onpick) {
      var r = h('input', { type: 'radio', name: name }); r.checked = checked; r.addEventListener('change', function () { onpick(); f.page = 1; redraw(); render(); });
      return h('label', { class: 'filter-opt' }, r, h('span', null, label), n == null ? null : h('span', { class: 'small muted', text: ' (' + n + ')' }));
    }
    function render() {
      var scroll = box.querySelector('.sheet-body'), top = scroll ? scroll.scrollTop : 0;
      clear(box);
      var body = h('div', { class: 'sheet-body' });
      if (false) {   // departments live in the tab row on the shop page, not in this sheet
        var byCat = applyFilters(items, f, 'cat');
        body.appendChild(group('Department', [radio('cat', 'All departments', byCat.length, f.cat === 'all', function () { f.cat = 'all'; })].concat(cats.map(function (c) {
          var n = byCat.filter(function (it) { return it.cat === c.id; }).length;
          return n || f.cat === c.id ? radio('cat', c.title, n, f.cat === c.id, function () { f.cat = c.id; }) : null;
        }))));
      }
      if (id === 'photo-gifts') {
        var byKind = applyFilters(items, f, 'kind');
        body.appendChild(group('Personalize with', [['all', 'Anything'], ['photo', 'Your photo'], ['words', 'Your words']].map(function (k) {
          return radio('kind', k[1], byKind.filter(function (it) { return k[0] === 'all' || it.kind === k[0]; }).length, f.kind === k[0], function () { f.kind = k[0]; });
        })));
      }
      var byPrice = applyFilters(items, f, 'price');
      var bands = [radio('band', 'Any price', byPrice.length, !f.band && !f.min && !f.max, function () { f.band = ''; f.min = ''; f.max = ''; })];
      BANDS.forEach(function (b) { var n = byPrice.filter(function (it) { return it.fromCents >= b[2] && it.fromCents < b[3]; }).length; if (n || f.band === b[0]) bands.push(radio('band', b[1], n, f.band === b[0], function () { f.band = b[0]; f.min = ''; f.max = ''; })); });
      var lo = h('input', { type: 'text', inputmode: 'decimal', maxlength: 7, placeholder: 'Min $', 'aria-label': 'Lowest price', value: f.min }), hi = h('input', { type: 'text', inputmode: 'decimal', maxlength: 7, placeholder: 'Max $', 'aria-label': 'Highest price', value: f.max });
      bands.push(h('div', { class: 'row price-range' }, lo, h('span', { text: 'to' }), hi, h('button', { class: 'btn secondary small', type: 'button', text: 'Go', onclick: function () {
        f.min = dollarsToCents(lo.value) === null ? '' : lo.value; f.max = dollarsToCents(hi.value) === null ? '' : hi.value; f.band = ''; f.page = 1; redraw(); render(); } })));
      bands.push(h('p', { class: 'small muted', text: 'Prices are the starting price shown on each product.' }));
      body.appendChild(group('Price', bands));
      if (id === 'family-shop' && anyStock) {
        var cb = h('input', { type: 'checkbox' }); cb.checked = f.stock; cb.addEventListener('change', function () { f.stock = cb.checked; f.page = 1; redraw(); render(); });
        body.appendChild(group('Availability', [h('label', { class: 'filter-opt' }, cb, h('span', { text: 'In stock only' })), h('p', { class: 'small muted', text: 'Only items where the supplier lists a stock number can be matched.' })]));
      }
      var total = applyFilters(items, f).length;
      var close = h('button', { class: 'btn small secondary', type: 'button', 'aria-label': 'Close filters', text: 'Close', onclick: function () { closeSheet(); if (opener && opener.focus) opener.focus(); } });
      box.appendChild(h('div', { class: 'sheet-head' }, h('strong', { text: 'Filters' }), close));
      box.appendChild(body);
      box.appendChild(h('div', { class: 'sheet-foot' }, isFiltered(f) ? h('button', { class: 'btn secondary', type: 'button', text: 'Clear all', onclick: function () { st().filters[id] = freshFilters(); Object.assign(f, freshFilters()); var si = document.querySelector('.shop-search'); if (si) si.value = ''; redraw(); render(); } }) : null,
        h('button', { class: 'btn grow', type: 'button', text: 'Show ' + total + (total === 1 ? ' result' : ' results'), onclick: function () { closeSheet(); if (opener && opener.focus) opener.focus(); } })));
      var nb = box.querySelector('.sheet-body'); if (nb) nb.scrollTop = top;
    }
    render(); document.body.appendChild(sheetEl); document.body.style.overflow = 'hidden';
    var first = box.querySelector('input'); if (first) first.focus();
  }

  async function viewShop(main, token) {
    closeSheet();
    var holder = h('div', null, X.spinnerLine('Loading the shop…')); main.appendChild(holder);
    var cat;
    try { cat = await loadCatalog(true); } catch (e) { if (token === X.S.nav) setupNeeded(main, e); return; }
    if (token !== X.S.nav) return;
    clear(main);
    var secs = (cat.sections && cat.sections.length) ? cat.sections : DEFAULT_SECTIONS;
    var familyOpen = secs.some(function (s) { return s.id === 'family-shop' && s.ready; });
    main.appendChild(h('h1', { class: 'sr-only', text: 'Shop' }));
    if (cat.config.testMode) main.appendChild(X.alertBox('warn', 'Test mode: payments here are practice payments and no real order is made.'));

    var search = h('input', { type: 'search', class: 'shop-search', 'aria-label': 'Search this section', enterkeyhint: 'search', autocomplete: 'off' });
    var ttHead = h('div', { class: 'tt-head' });
    ttHead.appendChild(h('div', { class: 'tt-bar' },
      h('form', { class: 'shop-search-row tt-search', role: 'search', onsubmit: function (ev) { ev.preventDefault(); search.blur(); } }, icon('search'), search),
      h('a', { class: 'tt-ic', href: '#/orders', 'aria-label': 'My orders', title: 'My orders', onclick: function () { X.S.ordersFrom = ''; } }, icon('bag')),
      h('a', { class: 'tt-ic', href: '#/shop/cart', 'aria-label': 'Cart', title: 'Cart', onclick: function (ev) { if (st().section === 'family-shop') { ev.preventDefault(); location.hash = '#/shop/cart/family'; } } }, icon('cart'))));
    main.appendChild(ttHead);
    var panelHost = h('div', { role: 'tabpanel', id: 'shop-panel', 'aria-live': 'polite' });
    var tabBtns = [];
    var photoItemsAll = photoItems(cat), famState = { fam: null, error: '', loading: false };

    function pickSection(id, focus) {
      if (id !== 'photo-gifts' && id !== 'family-shop') id = 'photo-gifts';
      st().section = id;
      tabBtns.forEach(function (b) { var on = b.getAttribute('data-section') === id; b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; b.classList.toggle('on', on); if (on && focus) b.focus(); });
      panelHost.setAttribute('aria-labelledby', 'shop-tab-' + id);
      search.placeholder = id === 'photo-gifts' ? 'Search Photo Gifts' : 'Search the Family Shop';
      search.setAttribute('aria-label', search.placeholder);
      search.value = filtersFor(id).q;
      drawPanel();
    }
    var tabbar = h('div', { class: 'shop-tabs', role: 'tablist', 'aria-label': 'Shop sections' }, secs.map(function (sec) {
      var b = h('button', { class: 'shop-tab', type: 'button', role: 'tab', id: 'shop-tab-' + sec.id, 'data-section': sec.id, 'aria-controls': 'shop-panel', onclick: function () { pickSection(sec.id); } },
        h('strong', { text: sec.title }), sec.ready === false ? h('span', { class: 'soon-badge small', text: 'Soon' }) : null);
      b.addEventListener('keydown', function (ev) {
        if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
        ev.preventDefault(); var i = tabBtns.indexOf(b); pickSection(tabBtns[(i + (ev.key === 'ArrowRight' ? 1 : tabBtns.length - 1)) % tabBtns.length].getAttribute('data-section'), true);
      });
      tabBtns.push(b); return b;
    }));
    ttHead.appendChild(tabbar); main.appendChild(panelHost);
    var typing = null;
    search.addEventListener('input', function () { clearTimeout(typing); typing = setTimeout(function () { var f = filtersFor(st().section); f.q = search.value; f.page = 1; drawPanel(); }, 180); });

    async function loadFamily() {
      famState.loading = true; famState.error = ''; drawPanel();
      try { famState.fam = await shopApi('shopCjBrowse', { familyId: X.S.familyId }); st().famBrowse = famState.fam; }
      catch (e) { famState.error = msgOf(e); }
      famState.loading = false; if (token === X.S.nav) drawPanel();
    }

    function drawPanel() {
      if (token !== X.S.nav) return;
      var id = st().section || 'photo-gifts';
      clear(panelHost);
      if (id === 'family-shop') {
        if (!familyOpen) { panelHost.appendChild(h('div', { class: 'card inner family-soon' }, h('span', { class: 'soon-badge', text: 'Coming soon' }), h('h2', { text: 'Family Shop' }), h('p', { text: 'Shop useful finds for family life and gatherings.' }), h('p', { class: 'small muted', text: 'This section is not open yet. Photo Gifts works as usual.' }))); return; }
        if (!famState.fam && !famState.error) { if (!famState.loading) loadFamily(); panelHost.appendChild(h('div', { class: 'skeleton-grid', 'aria-hidden': 'true' }, [1, 2, 3, 4].map(function () { return h('div', { class: 'skeleton-card' }); }))); panelHost.appendChild(X.spinnerLine('Loading the Family Shop…')); return; }
        if (famState.error) { panelHost.appendChild(X.alertBox('error', famState.error)); panelHost.appendChild(h('button', { class: 'btn secondary', type: 'button', text: 'Try again', onclick: function () { famState.error = ''; loadFamily(); } })); return; }
        drawSection(id, familyItems(famState.fam), famState.fam.categories.map(function (c) { return { id: c.id, title: c.title, count: c.count }; }), famState.fam);
      } else drawSection(id, photoItemsAll, sectionTiles(cat), null);
    }
    function sectionTiles(c) {
      var n = {}; photoItemsAll.forEach(function (it) { n[it.cat] = (n[it.cat] || 0) + 1; });
      return SECTIONS.filter(function (s) { return n[s.id]; }).map(function (s) { return { id: s.id, title: s.title, count: n[s.id] }; });
    }

    function drawSection(id, items, cats, fam) {
      var f = filtersFor(id);
      if (f.cat !== 'all' && !cats.some(function (c) { return c.id === f.cat; })) f.cat = 'all';
      var sec = secs.filter(function (s) { return s.id === id; })[0] || {};
      if (!items.length) {
        panelHost.appendChild(h('div', { class: 'empty' }, h('p', { text: id === 'photo-gifts' ? 'No products are switched on yet.' : 'The Family Shop has no products yet.' }),
          cat.isAdmin ? h('a', { class: 'btn secondary', href: id === 'photo-gifts' ? '#/shop/admin' : '#/shop/admin/cj', text: 'Manage products' }) : h('p', { class: 'small muted', text: 'Check back soon.' })));
        if (cat.isAdmin) panelHost.appendChild(adminLink());
        return;
      }
      // Departments as a row of tabs (All first), like the TikTok Shop top menu.
      if (cats.length > 1) {
        var catRow = h('div', { class: 'tt-cats', role: 'group', 'aria-label': 'Departments' });
        [{ id: 'all', title: 'All' }].concat(cats).forEach(function (c) {
          catRow.appendChild(h('button', { class: 'tt-cat', type: 'button', 'aria-pressed': f.cat === c.id ? 'true' : 'false', text: c.title, onclick: function () { f.cat = c.id; f.page = 1; drawPanel(); } }));
        });
        panelHost.appendChild(catRow);
      }
      var feat = items.filter(function (it) { return it.featured; }).slice(0, 8);
      if (feat.length && !isFiltered(f)) {
        panelHost.appendChild(h('h2', { class: 'shop-section', text: 'Picks for you' }));
        panelHost.appendChild(h('div', { class: 'feat-row' }, feat.map(itemCard)));
      }
      var anyStock = items.some(function (it) { return it.availability === 'in_stock' || it.availability === 'out_of_stock'; });
      var results = h('div', { id: 'shop-results' });
      var sortSel = h('select', { 'aria-label': 'Sort by', onchange: function () { f.sort = sortSel.value; f.page = 1; drawPanel(); } }, SORTS.map(function (s) { return h('option', { value: s[0], text: s[1] }); })); sortSel.value = f.sort;
      var nActive = [f.kind !== 'all', f.stock, !!f.band || !!f.min || !!f.max].filter(Boolean).length;
      var filtBtn = h('button', { class: 'btn secondary small', type: 'button', 'aria-haspopup': 'dialog', text: nActive ? 'Filters (' + nActive + ')' : 'Filters', onclick: function () { openSheet(id, items, cats, anyStock, f, drawPanel); } });
      panelHost.appendChild(h('div', { class: 'shop-toolbar' }, filtBtn, h('label', { class: 'small' }, 'Sort ', sortSel)));
      // what is switched on, each removable with one tap
      var chips = [];
      function chip(label, clear1) { chips.push(h('button', { class: 'chip on', type: 'button', 'aria-label': 'Remove filter: ' + label, onclick: function () { clear1(); f.page = 1; if (!f.q) search.value = ''; drawPanel(); } }, label + ' ×')); }
      if (f.q) chip('“' + f.q + '”', function () { f.q = ''; search.value = ''; });
      if (f.kind !== 'all') chip(f.kind === 'words' ? 'Add your words' : 'Add your photo', function () { f.kind = 'all'; });
      if (f.stock) chip('In stock', function () { f.stock = false; });
      if (f.band || f.min || f.max) chip(priceLabel(f), function () { f.band = ''; f.min = ''; f.max = ''; });
      if (chips.length) panelHost.appendChild(h('div', { class: 'chips active-filters', role: 'group', 'aria-label': 'Active filters' }, chips, chips.length > 1 ? h('button', { class: 'link-btn', type: 'button', text: 'Clear all', onclick: function () { st().filters[id] = freshFilters(); search.value = ''; drawPanel(); } }) : null));
      var list = applyFilters(items, f), pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
      if (f.page > pages) f.page = pages;
      var from0 = list.length ? (f.page - 1) * PER_PAGE + 1 : 0, to0 = Math.min(list.length, f.page * PER_PAGE);
      var count = h('div', { class: 'shop-count' }, h('span', { role: 'status', text: list.length ? from0 + '-' + to0 + ' of ' + list.length + (list.length === 1 ? ' result' : ' results') : '0 results' }));
      results.appendChild(count);
      if (!list.length) results.appendChild(h('div', { class: 'empty' }, h('p', { text: 'Nothing matches that.' }), h('p', { class: 'small muted', text: 'Try another word' + (id === 'photo-gifts' ? ', like mug or necklace,' : '') + ' or reset the filters.' })));
      else {
        results.appendChild(h('div', { class: 'shop-grid' }, list.slice((f.page - 1) * PER_PAGE, f.page * PER_PAGE).map(itemCard)));
        if (pages > 1) results.appendChild(h('nav', { class: 'pager', 'aria-label': 'Pages' },
          h('button', { class: 'btn secondary small', type: 'button', text: 'Previous', disabled: f.page <= 1, onclick: function () { f.page--; drawPanel(); results.scrollIntoView({ block: 'start' }); } }),
          h('span', { class: 'small', text: 'Page ' + f.page + ' of ' + pages }),
          h('button', { class: 'btn secondary small', type: 'button', text: 'Next', disabled: f.page >= pages, onclick: function () { f.page++; drawPanel(); results.scrollIntoView({ block: 'start' }); } })));
      }
      panelHost.appendChild(results);
      panelHost.appendChild(h('details', { class: 'card inner tt-how' }, h('summary', { text: 'How it works' }), h('ol', { class: 'steps' }, id === 'photo-gifts' ? [
        h('li', { text: 'Pick a product and a photo. Only photos whose owner allowed gifts can be used.' }), h('li', { text: 'Crop and place the photo. You see what will be cut off.' }),
        h('li', { text: 'Check the total, with shipping, before paying on Square’s secure page.' }), h('li', { text: 'After payment is confirmed, the photo is sent to Printify to be made and shipped. You can follow it in My orders.' })
      ] : [
        h('li', { text: 'Add items to your Family Shop cart. It is separate from your Photo Gifts cart.' }), h('li', { text: 'Enter your address. Stock, prices and shipping are checked again with the supplier, and you see the total before paying.' }),
        h('li', { text: 'You pay on Square’s secure page. The shop owner then orders from the supplier, CJdropshipping, and pays them separately. No photos are sent for these items.' }), h('li', { text: 'Tracking appears in My orders once the supplier gives a tracking number.' })
      ])));
      if (cat.isAdmin) panelHost.appendChild(adminLink());
      void sec;
    }
    function adminLink() { return h('p', null, h('a', { class: 'link-btn', href: '#/shop/admin', text: 'Manage Photo Gifts (owner only)' }), familyOpen ? ' · ' : null, familyOpen ? h('a', { class: 'link-btn', href: '#/shop/admin/cj', text: 'Manage Family Shop (owner only)' }) : null); }
    pickSection(st().section || 'photo-gifts');
    if (cat.isAdmin) autoSync(token, false);
  }

  /* Owner only: opening the shop refreshes it from Printify and CJ (at most every 10 minutes on this device), and says what happened.
     It never turns anything on by itself. Products gone from Printify or CJ are removed, as with the manual buttons. */
  var autoRunning = false, AUTO_KEY = 'fc_shop_autosync', AUTO_EVERY = 10 * 60 * 1000, lastAuto = '';
  function autoStatus(token, text, withButton) {
    var host = document.querySelector('.shop-search-row'); if (!host || !host.parentNode) return;
    var old = document.getElementById('auto-sync-note'); if (old) old.parentNode.removeChild(old);
    var note = h('p', { id: 'auto-sync-note', class: 'small muted', role: 'status' }, text + ' ');
    if (withButton) note.appendChild(h('button', { class: 'link-btn', type: 'button', text: 'Update now', onclick: function () { autoSync(token, true); } }));
    host.parentNode.insertBefore(note, host.nextSibling);
  }
  async function autoSync(token, force) {
    if (autoRunning) return;
    if (!force) {
      try { if (Date.now() - Number(localStorage.getItem(AUTO_KEY) || 0) < AUTO_EVERY) { if (lastAuto) autoStatus(token, lastAuto, true); return; } } catch (e) { /* no storage: sync every time */ }
    }
    autoRunning = true;
    var cjOn = ((st().catalog && st().catalog.sections) || []).some(function (x) { return x.id === 'family-shop' && x.ready; }), who = cjOn ? 'Printify and CJ' : 'Printify';
    autoStatus(token, 'Updating the shop from ' + who + '…', false);
    var changed = 0, parts = [], failed = false;
    try {
      try {
        var seen = [], page = 1, last = 1, total = 0, bad = '';
        do {
          var r = await shopApi('shopAdminSync', { page: page, enableNew: false });
          if (r.diagnosis) { bad = r.diagnosis.message; break; }
          last = r.lastPage; total = r.total; r.results.forEach(function (x) { if (x.key) seen.push(x.key); if (x.action === 'new' || x.action === 'updated') changed++; });
          page++;
        } while (page <= last);
        if (bad) { failed = true; parts.push('Printify: ' + bad); }
        else { var f = await shopApi('shopAdminSyncFinish', { seen: seen }); changed += (f.deleted || 0); parts.push('Printify: ' + total + ' products read' + (f.deleted ? ', ' + f.deleted + ' removed' : '')); }
      } catch (e) { failed = true; parts.push('Printify: ' + msgOf(e)); }
      if (cjOn) try {
        var ov = await shopApi('shopAdminCjList');
        if (ov.configured) {
          var list = ov.products.slice(0, 30), done = 0;
          for (var i = 0; i < list.length; i++) {
            try { var cr = await shopApi('shopAdminCjSync', { id: list[i].id }); done++; if (cr.deleted || (cr.changes && cr.changes.length)) changed++; }
            catch (e) { if (e.apiCode === 'cj_rate_limit' || e.apiCode === 'cj_auth') { failed = true; parts.push('CJ: ' + msgOf(e)); break; } }
          }
          if (!failed || done) parts.push('CJ: ' + done + ' checked');
        }
      } catch (e) { /* CJ hidden or not set up: nothing to update */ }
    } finally { autoRunning = false; }
    lastAuto = 'Last updated ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '. ' + parts.join('. ') + '.';
    if (!failed) { try { localStorage.setItem(AUTO_KEY, String(Date.now())); } catch (e) { /* ignore */ } }
    if (token !== X.S.nav) return;
    autoStatus(token, lastAuto, true);
    if (changed && !force) { toast('The shop was updated from ' + who + '.'); X.route(false); }
    else if (changed) { toast('Updated. Reopen the shop to see the changes.'); X.route(false); }
  }


  /* ================= "MAKE A GIFT" ENTRY ================= */
  async function viewGift(main, token, postId) {
    st().section = 'photo-gifts';
    main.appendChild(head('Make a gift', '#/shop', 'Photo Gifts'));
    var holder = h('div', null, X.spinnerLine('Checking this photo…', 'photo')); main.appendChild(holder);
    try {
      var cat = await loadCatalog(false);
      var ok = await shopApi('shopGiftStatus', { familyId: X.S.familyId, postIds: [postId] });
      var posts = (await X.listRows('posts', [X.Query.equal('$id', [postId]), X.Query.limit(1)])).rows;
      var mine = posts[0] && posts[0].authorId === X.S.user.$id;
      if (token !== X.S.nav) return;
      clear(holder);
      if (!posts[0] || posts[0].familyId !== X.S.familyId || posts[0].kind !== 'photo') { holder.appendChild(h('p', { text: 'That photo is not available.' })); return; }
      if (!mine && !ok.allowed[postId]) { holder.appendChild(h('p', { text: 'The person who posted this photo has not allowed it to be used for gifts. You can ask them to turn it on from the ⋯ menu on the photo.' })); return; }
      holder.appendChild(h('p', { class: 'muted', text: 'Choose a product for this photo.' }));
      var grid = h('div', { class: 'shop-grid' });
      cat.products.filter(function (p) { return p.kind !== 'words'; }).forEach(function (p) { grid.appendChild(h('a', { class: 'shop-card', href: '#/shop/product/' + p.key + '/' + postId }, cardImg(p), h('strong', { class: 'shop-title', text: p.title }), h('span', { class: 'shop-price', text: 'From ' + money(fromPrice(p)) }))); });
      holder.appendChild(cat.products.length ? grid : h('p', { class: 'hint', text: 'No products are switched on yet.' }));
    } catch (e) { if (token === X.S.nav) { clear(holder); holder.appendChild(X.alertBox('error', msgOf(e))); } }
  }

  /* ================= PRODUCT + DESIGNER ================= */
  function optionGroups(variants) {
    var names = [];
    variants.forEach(function (v) { Object.keys(v.options || {}).forEach(function (k) { if (names.indexOf(k) < 0) names.push(k); }); });
    return names.filter(function (n) { var seen = {}; variants.forEach(function (v) { seen[(v.options || {})[n]] = 1; }); return Object.keys(seen).length > 1; });
  }
  var SECTIONS = [{ id: 'wall-art', title: 'Wall art and prints' }, { id: 'drinkware', title: 'Mugs and drinkware' }, { id: 'home', title: 'Home and keepsakes' }, { id: 'jewelry', title: 'Jewelry' }, { id: 'apparel', title: 'Clothing and bags' }, { id: 'gifts', title: 'More photo gifts' }];
  function sectionTitle(id) { var f = SECTIONS.filter(function (x) { return x.id === id; })[0]; return f ? f.title : 'More photo gifts'; }
  function cardImg(p) { return p.image ? h('img', { class: 'shop-thumb', src: p.image, alt: '', loading: 'lazy' }) : null; }
  function pretty(s) { return String(s || '').replace(/^./, function (c) { return c.toUpperCase(); }); }

  // Where the photo sits inside the print area. All numbers are in print-area pixels.
  function geometry(sw, sh, W, H, spec) {
    var bandH = spec.caption ? Math.round(H * 0.17) : 0, rh = H - bandH;
    var base = spec.fit === 'contain' ? Math.min(W / sw, rh / sh) : Math.max(W / sw, rh / sh);
    var z = Math.min(4, Math.max(1, spec.zoom || 1)), scale = base * z, dw = sw * scale, dh = sh * scale;
    var maxX = Math.max(0, (dw - W) / 2), maxY = Math.max(0, (dh - rh) / 2);
    var cx = W / 2 + Math.max(-1, Math.min(1, spec.ox || 0)) * (spec.fit === 'contain' ? W / 2 : maxX);
    var cy = rh / 2 + Math.max(-1, Math.min(1, spec.oy || 0)) * (spec.fit === 'contain' ? rh / 2 : maxY);
    if (spec.fit !== 'contain') { cx = Math.max(W / 2 - maxX, Math.min(W / 2 + maxX, cx)); cy = Math.max(rh / 2 - maxY, Math.min(rh / 2 + maxY, cy)); }
    return { x: cx - dw / 2, y: cy - dh / 2, w: dw, h: dh, scale: scale, rh: rh, bandH: bandH };
  }
  function drawText(c, text, W, H, bandH) {
    c.fillStyle = '#ffffff'; c.fillRect(0, H - bandH, W, bandH);
    // The words live inside the blue safe line: 5% in from the left, right and bottom edges.
    var top = H - bandH, bottom = H * 0.95, mid = (top + bottom) / 2, maxW = W * 0.86;
    var size = Math.round((bottom - top) * 0.55); c.fillStyle = '#222'; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (; size > 8; size -= 2) { c.font = '600 ' + size + 'px "Helvetica Neue", Arial, sans-serif'; if (c.measureText(text).width <= maxW) break; }
    c.fillText(text, W / 2, mid);
  }
  // Draws the finished print image (no guides) at k times the print-area size.
  function paintPrint(c, bmp, W, H, spec, k) {
    var g = geometry(bmp.width, bmp.height, W, H, spec);
    c.save(); c.scale(k, k);
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, W, H);
    c.beginPath(); c.rect(0, 0, W, g.rh); c.clip();
    c.imageSmoothingQuality = 'high'; c.drawImage(bmp, g.x, g.y, g.w, g.h);
    c.restore();
    if (spec.caption) { c.save(); c.scale(k, k); drawText(c, spec.caption, W, H, g.bandH); c.restore(); }
    return g;
  }
  function qualityOf(bmp, W, H, spec) {
    var g = geometry(bmp.width, bmp.height, W, H, spec);
    var visW = Math.min(bmp.width, W / g.scale), visH = Math.min(bmp.height, g.rh / g.scale);
    var r = Math.min(visW / W, visH / g.rh);
    var outside = spec.fit === 'contain' ? 0 : Math.max(0, 1 - Math.min(1, (W / g.scale * g.rh / g.scale) / (bmp.width * bmp.height)));
    return { ratio: r, level: r >= 0.5 ? 'good' : (r >= 0.33 ? 'fair' : 'low'), outsidePct: Math.round(outside * 100) };
  }

  async function viewProduct(main, token, key, postId) {
    st().section = 'photo-gifts';
    main.appendChild(head('', '#/shop', 'Photo Gifts'));
    var holder = h('div', null, X.spinnerLine('Loading…')); main.appendChild(holder);
    var cat, prod;
    try { cat = await loadCatalog(false); } catch (e) { if (token === X.S.nav) setupNeeded(main, e); return; }
    prod = productByKey(cat, key);
    if (token !== X.S.nav) return;
    if (!prod) { clear(holder); holder.appendChild(h('div', { class: 'empty' }, h('p', { text: 'That product is not available right now.' }), h('a', { class: 'btn', href: '#/shop', text: 'Back to the shop' }))); return; }
    main.firstChild.querySelector('h1') && (main.firstChild.querySelector('h1').textContent = prod.title);
    clear(holder);
    var hero = prod.image ? h('img', { class: 'shop-hero', src: prod.image, alt: prod.title + ' (sample product picture)' }) : null;
    if (hero) holder.appendChild(hero);
    // Each size or style has its own Printify picture. Fetch them all quietly now, one after another, so a tap on a size swaps instantly instead of waiting for a download.
    var warm = {};
    function warmPic(u) {
      if (!u || warm[u]) return warm[u];
      warm[u] = new Promise(function (res) { var im = new Image(); im.decoding = 'async'; im.onload = function () { (im.decode ? im.decode().catch(function () {}) : Promise.resolve()).then(function () { res(true); }); }; im.onerror = function () { res(false); }; im.src = u; });
      return warm[u];
    }
    (function () {
      var list = [prod.image].concat(prod.images || []).filter(function (u, i, a) { return u && a.indexOf(u) === i; }).slice(0, 16), i = 0;
      (function next() { if (i >= list.length || token !== X.S.nav) return; warmPic(list[i++]).then(next); })();
    })();

    var groups = optionGroups(prod.variants), chosen = {}, variant = prod.variants[0];
    groups.forEach(function (g) { chosen[g] = (variant.options || {})[g]; });
    var spec = { fit: 'cover', zoom: 1, ox: 0, oy: 0, caption: '' };
    var photo = { postId: postId || '', bmp: null, own: false };
    var isWords = prod.kind === 'words';
    var wspec = { text: '', font: 'script' };
    var quality = h('div', { class: 'shop-quality', role: 'status' });
    var priceEl = h('div', { class: 'shop-price big' });
    var optsEl = h('div', { class: 'shop-opts' });
    var stage = h('div', { class: 'shop-stage' });
    var controls = h('div', { class: 'shop-controls', hidden: true });
    var pickEl = h('div', { class: 'shop-pick' });
    var msg = h('div');

    function pickVariant() {
      var m = prod.variants.filter(function (v) { return groups.every(function (g) { return (v.options || {})[g] === chosen[g]; }); })[0];
      variant = m || prod.variants[0];
    }
    function drawOptions() {
      clear(optsEl);
      if (!groups.length) {
        var sel = h('select', { 'aria-label': 'Style', onchange: function () { variant = prod.variants.filter(function (v) { return String(v.id) === sel.value; })[0]; repaint(); } },
          prod.variants.map(function (v) { return h('option', { value: String(v.id), text: v.label + ' · ' + money(v.priceCents) }); }));
        sel.value = String(variant.id); optsEl.appendChild(h('label', { text: 'Style' })); optsEl.appendChild(sel);
      }
      groups.forEach(function (g) {
        var values = []; prod.variants.forEach(function (v) { var val = (v.options || {})[g]; if (val && values.indexOf(val) < 0) values.push(val); });
        var row = h('div', { class: 'chips', role: 'group', 'aria-label': pretty(g) });
        values.forEach(function (val) {
          row.appendChild(h('button', { class: 'chip', type: 'button', 'aria-pressed': chosen[g] === val ? 'true' : 'false', text: val, onclick: function () { chosen[g] = val; pickVariant(); drawOptions(); repaint(); } }));
        });
        optsEl.appendChild(h('div', null, h('div', { class: 'label', text: pretty(g) }), row));
      });
      if (prod.frameNote) optsEl.appendChild(h('p', { class: 'hint', text: 'The frame style and size come from the options above. The frame itself cannot be edited. You are only designing the picture inside it.' }));
    }

    /* the designer canvas: the print area in the middle, the rest of the photo faded around it */
    var canvas = h('canvas', { class: 'shop-canvas', tabindex: '0', role: 'img', 'aria-label': 'Layout preview. Drag to move the photo. Arrow keys also move it.' });
    var PAD = 0.14;
    function size() { var box = Math.min(main.clientWidth || 340, 420); var W = variant.width, H = variant.height; var s = box / (W * (1 + 2 * PAD)); return { s: s, cw: Math.round(W * (1 + 2 * PAD) * s), ch: Math.round(H * (1 + 2 * PAD) * s), pad: PAD }; }
    function repaint() {
      if (hero) { var pic = (prod.images && Number.isInteger(variant.img) && prod.images[variant.img]) || prod.image; if (hero.getAttribute('src') !== pic) { var want = pic; hero.classList.add('swapping'); warmPic(pic).then(function () { if (want === ((prod.images && Number.isInteger(variant.img) && prod.images[variant.img]) || prod.image)) { hero.src = want; hero.classList.remove('swapping'); } }); } }   // each size or style can have its own picture
      priceEl.textContent = money(variant.priceCents) + ' each';
      if (isWords) { paintWordsPreview(); return; }
      if (!photo.bmp) { canvas.width = canvas.height = 1; return; }
      var W = variant.width, H = variant.height, z = size();
      canvas.width = z.cw; canvas.height = z.ch;
      var c = canvas.getContext('2d'), k = z.s, ox = W * PAD * k, oy = H * PAD * k;
      c.fillStyle = '#e9ecef'; c.fillRect(0, 0, z.cw, z.ch);
      var g = geometry(photo.bmp.width, photo.bmp.height, W, H, spec);
      c.save(); c.translate(ox, oy); c.scale(k, k);
      c.globalAlpha = 0.35; c.drawImage(photo.bmp, g.x, g.y, g.w, g.h);                       // the whole photo, faded: what falls outside is visible
      c.globalAlpha = 1; c.beginPath(); c.rect(0, 0, W, g.rh); c.clip();
      c.fillStyle = '#fff'; c.fillRect(0, 0, W, H); c.drawImage(photo.bmp, g.x, g.y, g.w, g.h);
      c.restore();
      if (spec.caption) { c.save(); c.translate(ox, oy); c.scale(k, k); drawText(c, spec.caption, W, H, g.bandH); c.restore(); }
      c.strokeStyle = '#111'; c.lineWidth = 2; c.strokeRect(ox, oy, W * k, H * k);          // the print edge
      c.setLineDash([6, 5]); c.strokeStyle = '#0095f6'; c.strokeRect(ox + W * k * 0.05, oy + H * k * 0.05, W * k * 0.9, H * k * 0.9);   // safe area: keep faces and words inside
      var q = qualityOf(photo.bmp, W, H, spec);
      var parts = [];
      if (spec.fit !== 'contain' && q.outsidePct > 0) parts.push(q.outsidePct + '% of your photo falls outside the print area and will not be printed.');
      if (q.level === 'low') parts.push('Low resolution: this photo is small for this size and may look soft or blocky. A smaller product, or less zoom, will look better.');
      else if (q.level === 'fair') parts.push('Fair resolution: it should print, but fine detail may look soft.');
      else parts.push('Resolution looks good for this size.');
      parts.push('Dashed blue line: keep faces and words inside it. Black line: the edge of the print.');
      quality.className = 'shop-quality ' + q.level; clear(quality);
      parts.forEach(function (t) { quality.appendChild(h('p', { text: t })); });
    }
    // drag to move, pinch or slider to zoom, arrows for keyboards
    var drag = null, pts = {};
    function nudge(dx, dy) {
      var W = variant.width, H = variant.height, g = geometry(photo.bmp.width, photo.bmp.height, W, H, spec);
      var rangeX = spec.fit === 'contain' ? W / 2 : Math.max(1, (g.w - W) / 2), rangeY = spec.fit === 'contain' ? g.rh / 2 : Math.max(1, (g.h - g.rh) / 2);
      spec.ox = Math.max(-1, Math.min(1, (spec.ox || 0) + dx / rangeX)); spec.oy = Math.max(-1, Math.min(1, (spec.oy || 0) + dy / rangeY)); repaint();
    }
    canvas.addEventListener('pointerdown', function (ev) { if (!photo.bmp) return; canvas.setPointerCapture(ev.pointerId); pts[ev.pointerId] = { x: ev.clientX, y: ev.clientY }; drag = { x: ev.clientX, y: ev.clientY, d: pinchDist() }; });
    canvas.addEventListener('pointermove', function (ev) {
      if (!drag || !pts[ev.pointerId]) return; pts[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      var ids = Object.keys(pts);
      if (ids.length >= 2) { var d = pinchDist(); if (drag.d) { spec.zoom = Math.max(1, Math.min(4, (spec.zoom || 1) * d / drag.d)); zoomEl.value = String(spec.zoom); repaint(); } drag.d = d; return; }
      var z = size(), dx = (ev.clientX - drag.x) / z.s, dy = (ev.clientY - drag.y) / z.s; drag.x = ev.clientX; drag.y = ev.clientY; nudge(-dx * -1, -dy * -1);
    });
    function endDrag(ev) { delete pts[ev.pointerId]; if (!Object.keys(pts).length) drag = null; else drag = { x: ev.clientX, y: ev.clientY, d: pinchDist() }; }
    function pinchDist() { var ids = Object.keys(pts); if (ids.length < 2) return 0; var a = pts[ids[0]], b = pts[ids[1]]; return Math.hypot(a.x - b.x, a.y - b.y); }
    canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('keydown', function (ev) {
      var step = 20 / (size().s || 1) * 0.3, m = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key];
      if (m && photo.bmp) { ev.preventDefault(); nudge(m[0], m[1]); }
    });
    var zoomEl = h('input', { type: 'range', min: 1, max: 4, step: 0.01, value: 1, 'aria-label': 'Zoom', oninput: function () { spec.zoom = Number(zoomEl.value); repaint(); } });
    var fitBtn = h('button', { class: 'btn secondary small', type: 'button', text: 'Show whole photo', onclick: function () {
      spec.fit = spec.fit === 'contain' ? 'cover' : 'contain'; spec.ox = 0; spec.oy = 0; fitBtn.textContent = spec.fit === 'contain' ? 'Fill the print area' : 'Show whole photo'; repaint();
    } });
    var capEl = h('input', { type: 'text', maxlength: 60, placeholder: 'Optional caption, like Summer 2026', 'aria-label': 'Caption', oninput: function () { spec.caption = capEl.value.trim(); repaint(); } });
    var resetBtn = h('button', { class: 'btn secondary small', type: 'button', text: 'Reset', onclick: function () { spec = { fit: 'cover', zoom: 1, ox: 0, oy: 0, caption: '' }; zoomEl.value = '1'; capEl.value = ''; fitBtn.textContent = 'Show whole photo'; repaint(); } });
    var qtyEl = h('select', { 'aria-label': 'Quantity' }, [1, 2, 3, 4, 5].map(function (n) { return h('option', { value: String(n), text: String(n) }); }));
    var checks = ['I checked the spelling of any words.', 'I checked the crop and everyone who is in the photo.', 'I understand this layout preview is not a picture of the finished product.'].map(function (t) {
      var cb = h('input', { type: 'checkbox' }); return { cb: cb, row: h('label', { class: 'check' }, cb, ' ', t) };
    });
    var ownCb = h('input', { type: 'checkbox' }), ownRow = h('label', { class: 'check', hidden: true }, ownCb, ' This photo is mine, or the person who took it and everyone in it agreed to this gift.');
    checks.push({ cb: ownCb, row: ownRow, ownOnly: true });
    var addBtn = h('button', { class: 'btn block', type: 'button', text: 'Add to cart', onclick: function () { addToCart(); } });
    controls.appendChild(h('div', { class: 'shop-ctl-row' }, h('label', { text: 'Zoom' }), zoomEl));
    controls.appendChild(h('div', { class: 'shop-ctl-row' }, fitBtn, resetBtn));
    controls.appendChild(h('div', null, h('label', { text: 'Caption (printed under the photo)' }), capEl));
    controls.appendChild(quality);
    controls.appendChild(h('div', { class: 'card inner' }, h('h2', { text: 'Before you add it' }), checks.map(function (c) { return c.row; })));
    controls.appendChild(h('div', { class: 'shop-ctl-row' }, h('label', { text: 'Quantity' }), qtyEl));
    controls.appendChild(addBtn); controls.appendChild(msg);

    async function addToCart() {
      if (!photo.bmp) return;
      if (!checks.every(function (c) { return c.cb.checked || (c.ownOnly && !photo.own); })) return X.showAlert(msg, 'error', 'Please tick every box after checking your design.');
      X.showAlert(msg, 'error', '');
      await X.busy(addBtn, async function () {
        var fid = X.S.familyId, uploaded = null;
        try {
          if (!st().consentShown) {
            var okc = await X.confirmDialog('Before we make your product', CONSENT_IMAGE + ' A copy of the finished design goes to Printify when you add it to the cart, so it can show you a picture of the product. Nothing is printed until your payment is confirmed.', 'I understand');
            if (!okc) return; st().consentShown = true;
          }
          var W = variant.width, H = variant.height, s = Math.min(1, 4096 / Math.max(W, H)), blob = null, outW = 0, outH = 0;
          for (var tries = 0; tries < 6; tries++) {
            outW = Math.round(W * s); outH = Math.round(H * s);
            var oc = document.createElement('canvas'); oc.width = outW; oc.height = outH;
            paintPrint(oc.getContext('2d'), photo.bmp, W, H, spec, outW / W);
            blob = await new Promise(function (r) { oc.toBlob(r, 'image/jpeg', 0.92); });
            if (blob && blob.size <= 4.8 * 1048576) break;
            s *= 0.82;
          }
          if (!blob || blob.size > 4.9 * 1048576) throw new Error('This design is too large to send. Try a smaller product.');
          var uid = X.S.user.$id;
          uploaded = await X.storage.createFile({ bucketId: X.CFG.shopBucketId || 'family-media', fileId: X.ID.unique(), file: new File([blob], 'design.jpg', { type: 'image/jpeg' }),
            permissions: [X.Permission.read(X.Role.user(uid)), X.Permission.update(X.Role.user(uid)), X.Permission.delete(X.Role.user(uid))] });
          if (fid !== X.S.familyId) throw new Error('You switched families. Nothing was added.');
          var saved = await shopApi('shopSaveDesign', { familyId: fid, postId: photo.postId, ownPhoto: photo.own ? true : undefined, productKey: prod.key, variantId: variant.id, fileId: uploaded.$id, quantity: Number(qtyEl.value),
            spec: { fit: spec.fit, zoom: spec.zoom, ox: spec.ox, oy: spec.oy, caption: spec.caption, srcW: photo.bmp.width, srcH: photo.bmp.height } });
          st().designs = null;
          // Start Printify's picture now, so it is further along by the time the cart opens. Not waited for; the cart keeps checking.
          try { if (saved && saved.design) shopApi('shopPreview', { familyId: fid, designId: saved.design.id }).catch(function () {}); } catch (e1) { /* the cart will start it */ }
          toast('Added to your cart.'); location.hash = '#/shop/cart';
        } catch (e) {
          if (uploaded) X.storage.deleteFile({ bucketId: X.CFG.shopBucketId || 'family-media', fileId: uploaded.$id }).catch(function () {});
          X.showAlert(msg, 'error', msgOf(e));
        }
      }, 'Saving…');
    }

    async function usePhoto(post) {
      clear(pickEl); pickEl.appendChild(X.spinnerLine('Opening the photo…', 'photo'));
      try {
        var blob = await X.fetchMedia(post.mediaFileId, true);
        var bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
        if (token !== X.S.nav) return;
        photo.postId = post.$id; photo.own = false; ownRow.hidden = true; ownCb.checked = false; photo.bmp = bmp; spec.ox = 0; spec.oy = 0; spec.zoom = 1; zoomEl.value = '1';
        clear(pickEl); pickEl.appendChild(h('button', { class: 'btn secondary small', type: 'button', text: 'Choose a different photo', onclick: function () { photo.bmp = null; controls.hidden = true; clear(stage); showPicker(); } }));
        clear(stage); stage.appendChild(canvas); controls.hidden = false; repaint();
      } catch (e) { clear(pickEl); X.showAlert(pickEl, 'error', "That photo couldn't be opened. " + msgOf(e)); }
    }
    // A photo from this phone: the gallery, or the camera. It is never posted to the family. Only the finished print image is kept, in your private area.
    async function useFile(file) {
      if (!file) return;
      if (!/^image\//.test(file.type || '')) return X.showAlert(pickEl, 'error', 'Please choose a picture (JPEG, PNG or WebP).');
      if (file.size > 40 * 1048576) return X.showAlert(pickEl, 'error', 'That picture is too large (over 40 MB). Try a smaller one.');
      clear(pickEl); pickEl.appendChild(X.spinnerLine('Opening your photo…', 'photo'));
      try {
        var bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
        if (Math.max(bmp.width, bmp.height) > 4096) {
          var k = 4096 / Math.max(bmp.width, bmp.height), small = await createImageBitmap(bmp, { resizeWidth: Math.round(bmp.width * k), resizeHeight: Math.round(bmp.height * k), resizeQuality: 'high' });
          bmp.close && bmp.close(); bmp = small;
        }
        if (token !== X.S.nav) return;
        photo.postId = 'own-upload'; photo.own = true; ownRow.hidden = false; ownCb.checked = false; photo.bmp = bmp; spec.ox = 0; spec.oy = 0; spec.zoom = 1; zoomEl.value = '1';
        clear(pickEl); pickEl.appendChild(h('button', { class: 'btn secondary small', type: 'button', text: 'Choose a different photo', onclick: function () { photo.bmp = null; controls.hidden = true; clear(stage); showPicker(); } }));
        clear(stage); stage.appendChild(canvas); controls.hidden = false; repaint();
      } catch (e) { clear(pickEl); X.showAlert(pickEl, 'error', "That picture couldn't be opened. Photos in HEIC format may not work in this browser. Try a JPEG or PNG."); pickEl.appendChild(sourceButtons()); }
    }
    function sourceButtons() {
      var up = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: function () { useFile(up.files && up.files[0]); } });
      var cam = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onchange: function () { useFile(cam.files && cam.files[0]); } });
      return h('div', { class: 'row shop-sources' }, up, cam,
        h('button', { class: 'btn secondary', type: 'button', text: 'Upload a photo', onclick: function () { up.click(); } }),
        h('button', { class: 'btn secondary', type: 'button', text: 'Take a photo', onclick: function () { cam.click(); } }));
    }
    async function showPicker() {
      clear(pickEl); pickEl.appendChild(X.spinnerLine('Finding photos you can use…', 'photo'));
      try {
        var rows = (await X.listRows('posts', [X.Query.equal('familyId', [X.S.familyId]), X.Query.equal('kind', ['photo']), X.Query.orderDesc('$createdAt'), X.Query.limit(30)])).rows;
        var ok = rows.length ? (await shopApi('shopGiftStatus', { familyId: X.S.familyId, postIds: rows.map(function (r) { return r.$id; }) })).allowed : {};
        var usable = rows.filter(function (r) { return r.authorId === X.S.user.$id || ok[r.$id]; });
        if (token !== X.S.nav) return;
        clear(pickEl);
        pickEl.appendChild(h('h2', { text: 'Choose a photo' }));
        pickEl.appendChild(sourceButtons());
        if (!usable.length) { pickEl.appendChild(h('p', { class: 'muted', text: 'No photos can be used yet. Photos you post can always be used by you. For other photos, the person who posted them turns on "Allow gifts" from the ⋯ menu.' })); return; }
        var grid = h('div', { class: 'shop-photos' });
        pickEl.appendChild(h('p', { class: 'small muted', text: 'Or pick one of the photos in Family Circle:' }));
        usable.slice(0, 24).forEach(function (p) {
          var b = h('button', { class: 'shop-photo', type: 'button', 'aria-label': 'Use this photo' + (p.body ? ': ' + p.body.slice(0, 40) : ''), onclick: function () { usePhoto(p); } });
          grid.appendChild(b);
          X.fetchMedia(p.mediaFileId, true).then(function (bl) { var im = h('img', { alt: '', src: X.blobUrl(bl, bl.type || 'image/jpeg') }); b.appendChild(im); }).catch(function () { b.textContent = 'Photo'; });
        });
        pickEl.appendChild(grid);
      } catch (e) { clear(pickEl); X.showAlert(pickEl, 'error', msgOf(e)); }
    }

    /* ----- products made of words (an engraved name bar, for example): no photo, the buyer types the words ----- */
    var WORD_FONT_CSS = { script: '700 {s}px "Dancing Script", "Snell Roundhand", cursive', serif: '700 {s}px Georgia, "Times New Roman", serif', sans: '700 {s}px system-ui, Arial, sans-serif', type: '700 {s}px "Courier New", monospace' };
    function paintWordsOn(c, W, H, k) {
      c.fillStyle = '#fff'; c.fillRect(0, 0, W * k, H * k);
      var text = wspec.text; if (!text) return;
      var s = H * 0.62 * k; c.font = WORD_FONT_CSS[wspec.font].replace('{s}', String(Math.max(8, s)));
      var w = c.measureText(text).width, maxW = W * k * 0.9;
      if (w > maxW) { s = s * maxW / w; c.font = WORD_FONT_CSS[wspec.font].replace('{s}', String(Math.max(8, s))); }
      c.fillStyle = '#111'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, W * k / 2, H * k / 2 + s * 0.04);
    }
    function paintWordsPreview() {
      var W = variant.width, H = variant.height, z = size();
      canvas.width = z.cw; canvas.height = z.ch;
      var c = canvas.getContext('2d'), k = z.s, ox = W * PAD * k, oy = H * PAD * k;
      c.fillStyle = '#e9ecef'; c.fillRect(0, 0, z.cw, z.ch);
      c.save(); c.translate(ox, oy); paintWordsOn(c, W, H, k); c.restore();
      c.strokeStyle = '#111'; c.lineWidth = 2; c.strokeRect(ox, oy, W * k, H * k);
      c.setLineDash([6, 5]); c.strokeStyle = '#0095f6'; c.strokeRect(ox + W * k * 0.05, oy + H * k * 0.05, W * k * 0.9, H * k * 0.9);
    }
    function showWords() {
      clear(pickEl); clear(stage); stage.appendChild(canvas); canvas.setAttribute('aria-label', 'Layout preview of your words'); canvas.removeAttribute('tabindex');
      var txt = h('input', { type: 'text', maxlength: 40, placeholder: 'Type the words to print', 'aria-label': 'Words to print', autocomplete: 'off', oninput: function () { wspec.text = txt.value.replace(/\s+/g, ' ').trim(); repaint(); } });
      var fontBtns = [['script', 'Script'], ['serif', 'Classic'], ['sans', 'Clean'], ['type', 'Typewriter']].map(function (f) {
        return h('button', { class: 'chip', type: 'button', 'aria-pressed': f[0] === wspec.font ? 'true' : 'false', text: f[1], onclick: function () { wspec.font = f[0]; fontBtns.forEach(function (b, i) { b.setAttribute('aria-pressed', ['script', 'serif', 'sans', 'type'][i] === wspec.font ? 'true' : 'false'); }); repaint(); } });
      });
      var wChecks = ['I checked the spelling of every word.', 'I understand this layout preview is not a picture of the finished product.'].map(function (t) { var cb = h('input', { type: 'checkbox' }); return { cb: cb, row: h('label', { class: 'check' }, cb, ' ', t) }; });
      var wQty = h('select', { 'aria-label': 'Quantity' }, [1, 2, 3, 4, 5].map(function (n) { return h('option', { value: String(n), text: String(n) }); }));
      var wMsg = h('div');
      var wAdd = h('button', { class: 'btn block', type: 'button', text: 'Add to cart', onclick: function () { addWords(); } });
      async function addWords() {
        if (!wspec.text) return X.showAlert(wMsg, 'error', 'Type the words to print first.');
        if (!wChecks.every(function (c) { return c.cb.checked; })) return X.showAlert(wMsg, 'error', 'Please tick every box after checking your words.');
        X.showAlert(wMsg, 'error', '');
        await X.busy(wAdd, async function () {
          var fid = X.S.familyId, uploaded = null;
          try {
            if (!st().consentShown) {
              var okc = await X.confirmDialog('Before we make your product', 'Your words will be shared with Printify and the fulfillment partners needed to make and deliver it. A copy of the finished design goes to Printify when you add it to the cart, so it can show you a picture of the product. Nothing is made until your payment is confirmed.', 'I understand');
              if (!okc) return; st().consentShown = true;
            }
            try { await document.fonts.load(WORD_FONT_CSS[wspec.font].replace('{s}', '40') , wspec.text); } catch (e0) { /* the browser's fallback font is used */ }
            var W = variant.width, H = variant.height, sc = Math.min(1, 4096 / Math.max(W, H)), blob = null;
            for (var tries = 0; tries < 6; tries++) {
              var oc = document.createElement('canvas'); oc.width = Math.round(W * sc); oc.height = Math.round(H * sc);
              paintWordsOn(oc.getContext('2d'), W, H, oc.width / W);
              blob = await new Promise(function (r) { oc.toBlob(r, 'image/jpeg', 0.92); });
              if (blob && blob.size <= 4.8 * 1048576) break;
              sc *= 0.82;
            }
            if (!blob || blob.size > 4.9 * 1048576) throw new Error('This design is too large to send.');
            var uid = X.S.user.$id;
            uploaded = await X.storage.createFile({ bucketId: X.CFG.shopBucketId || 'family-media', fileId: X.ID.unique(), file: new File([blob], 'design.jpg', { type: 'image/jpeg' }),
              permissions: [X.Permission.read(X.Role.user(uid)), X.Permission.update(X.Role.user(uid)), X.Permission.delete(X.Role.user(uid))] });
            if (fid !== X.S.familyId) throw new Error('You switched families. Nothing was added.');
            var saved = await shopApi('shopSaveDesign', { familyId: fid, postId: 'words-only', productKey: prod.key, variantId: variant.id, fileId: uploaded.$id, quantity: Number(wQty.value), spec: { text: wspec.text, font: wspec.font } });
            st().designs = null;
            try { if (saved && saved.design) shopApi('shopPreview', { familyId: fid, designId: saved.design.id }).catch(function () {}); } catch (e1) { /* the cart will start it */ }
            toast('Added to your cart.'); location.hash = '#/shop/cart';
          } catch (e) {
            if (uploaded) X.storage.deleteFile({ bucketId: X.CFG.shopBucketId || 'family-media', fileId: uploaded.$id }).catch(function () {});
            X.showAlert(wMsg, 'error', msgOf(e));
          }
        }, 'Saving…');
      }
      pickEl.appendChild(h('h2', { text: 'Your words' }));
      pickEl.appendChild(txt);
      pickEl.appendChild(h('div', { class: 'chips', role: 'group', 'aria-label': 'Letter style' }, fontBtns));
      pickEl.appendChild(h('p', { class: 'hint', text: 'Up to 40 letters. The words are sized to fit inside the dashed line.' }));
      pickEl.appendChild(h('div', { class: 'card inner' }, h('h2', { text: 'Before you add it' }), wChecks.map(function (c) { return c.row; })));
      pickEl.appendChild(h('div', { class: 'shop-ctl-row' }, h('label', { text: 'Quantity' }), wQty));
      pickEl.appendChild(wAdd); pickEl.appendChild(wMsg);
      document.fonts && document.fonts.load('700 40px "Dancing Script"').then(function () { repaint(); }).catch(function () {});
      repaint();
    }

    if (prod.blurb) holder.appendChild(h('details', { class: 'shop-about' }, h('summary', { text: 'About this product' }), h('p', { class: 'muted', text: prod.blurb })));
    holder.appendChild(optsEl); holder.appendChild(priceEl);
    drawOptions();
    holder.appendChild(pickEl); holder.appendChild(stage); holder.appendChild(controls);
    holder.appendChild(h('p', { class: 'small muted', text: 'Layout preview: made on your phone from the print area of the product, so it is not a picture of the finished item. After you add it to the cart, Printify makes a picture of the real product with your photo on it.' }));
    repaint();
    if (isWords) { showWords(); }
    else if (postId) {
      var found = (await X.listRows('posts', [X.Query.equal('$id', [postId]), X.Query.limit(1)])).rows[0];
      if (found && found.familyId === X.S.familyId && found.kind === 'photo') await usePhoto(found); else showPicker();
    } else showPicker();
    window.addEventListener('resize', repaint);
  }

  /* ================= CART + CHECKOUT ================= */
  function newRequestId() { try { return crypto.randomUUID(); } catch (e) { return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); } }

  /* Asks the server for Printify's picture of each design on its product, one at a time, every few seconds. Failing is fine: the flat design stays. */
  async function runPreviews(items, token) {
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      it.note.hidden = false; it.note.textContent = 'Making your product preview… this picture is not the final look yet. It can take a minute.';
      var done = false;
      for (var n = 0; n < 50 && !done; n++) {
        if (token !== X.S.nav) return;
        try {
          var r = await shopApi('shopPreview', { familyId: X.S.familyId, designId: it.d.id });
          if (r.status === 'ready') { await it.show(r.fileId); it.note.hidden = true; it.wrap.classList.remove('thumb-loading'); it.badge.textContent = ''; done = true; }
          else if (r.status === 'unavailable') { it.wrap.classList.remove('thumb-loading'); it.badge.textContent = 'Layout only'; if (r.hint) { it.note.hidden = false; it.note.textContent = r.hint; } else it.note.hidden = true; done = true; }
        } catch (e) { it.note.hidden = true; it.wrap.classList.remove('thumb-loading'); it.badge.textContent = 'Layout only'; done = true; }
        if (!done) await new Promise(function (res) { setTimeout(res, 2500); });
      }
      if (!done) { it.note.hidden = true; it.wrap.classList.remove('thumb-loading'); it.badge.textContent = 'Layout only'; }
    }
  }
  async function viewCart(main, token) {
    st().section = 'photo-gifts';
    main.appendChild(head('Your cart', '#/shop', 'Photo Gifts'));
    main.appendChild(cartSwitch('photo-gifts'));
    var holder = h('div', null, X.spinnerLine('Loading your cart…')); main.appendChild(holder);
    var cat; try { cat = await loadCatalog(false); } catch (e) { if (token === X.S.nav) setupNeeded(main, e); return; }
    var res; try { res = await shopApi('shopDesigns', { familyId: X.S.familyId }); } catch (e) { if (token === X.S.nav) { clear(holder); holder.appendChild(X.alertBox('error', msgOf(e))); } return; }
    if (token !== X.S.nav) return;
    var designs = res.designs; clear(holder);
    if (!designs.length) { holder.appendChild(h('div', { class: 'empty' }, h('p', { text: 'Your cart is empty.' }), h('a', { class: 'btn', href: '#/shop', text: 'Browse the shop' }))); return; }
    var list = h('div', { class: 'cart-list' }), summary = h('div', { class: 'card inner' }), form = h('form', { class: 'cart-form', novalidate: true }), msg = h('div');
    var previews = [];
    designs.forEach(function (d) {
      var img = h('img', { class: 'cart-thumb', alt: 'Your design for ' + d.title });
      var pvNote = h('div', { class: 'small muted', hidden: true });
      var badge = h('span', { class: 'thumb-badge' }), wrap = h('div', { class: 'cart-thumb-wrap' }, img, badge);
      function showFile(id, mime) { return X.fetchMedia(id, false, X.CFG.shopBucketId || 'family-media').then(function (b) { img.src = X.blobUrl(b, mime || 'image/jpeg'); }); }
      // The flat print image shows first. Printify's picture of the real product replaces it as soon as it is ready.
      showFile(d.preview || d.fileId, d.preview ? 'image/jpeg' : 'image/jpeg').catch(function () { if (d.preview) showFile(d.fileId).catch(function () {}); });
      if (!d.preview && d.previewState === 'maybe' && d.available) { wrap.classList.add('thumb-loading'); badge.textContent = 'Not the final look'; previews.push({ d: d, note: pvNote, show: showFile, wrap: wrap, badge: badge }); }
      var qty = h('select', { 'aria-label': 'Quantity for ' + d.title, onchange: async function () { try { await shopApi('shopUpdateDesign', { designId: d.id, quantity: Number(qty.value) }); st().requestId = null; X.route(false); } catch (e) { toast(msgOf(e)); } } },
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(function (n) { return h('option', { value: String(n), text: String(n) }); }));
      qty.value = String(d.quantity);
      list.appendChild(h('div', { class: 'cart-row' }, wrap, h('div', { class: 'grow' }, h('strong', { text: d.title }), h('div', { class: 'small muted', text: d.variantLabel }), pvNote,
        d.available ? h('div', { text: money(d.unitCents) + ' each' }) : h('div', { class: 'small danger-text', text: 'No longer available. Please remove it.' }),
        h('div', { class: 'cart-actions' }, h('label', { class: 'small', text: 'Qty ' }, qty),
          h('button', { class: 'link-btn', type: 'button', text: 'Remove', onclick: async function () { try { await shopApi('shopUpdateDesign', { designId: d.id, remove: true }); st().requestId = null; X.route(false); } catch (e) { toast(msgOf(e)); } } })))));
    });
    holder.appendChild(list);
    runPreviews(previews, token);

    var a = st().addr || {};
    function f(name, label, opts) { opts = opts || {}; var inp = h('input', { type: 'text', name: name, value: a[name] || (name === 'country' ? 'US' : ''), autocomplete: opts.ac || 'off', maxlength: opts.max || 80, 'aria-label': label, placeholder: label }); return { inp: inp, wrap: h('div', null, h('label', { text: label }), inp) }; }
    var F = { first_name: f('first_name', 'First name', { ac: 'given-name' }), last_name: f('last_name', 'Last name', { ac: 'family-name' }), address1: f('address1', 'Street address', { ac: 'address-line1' }),
      address2: f('address2', 'Apartment or suite (optional)', { ac: 'address-line2' }), city: f('city', 'City', { ac: 'address-level2' }), region: f('region', 'State (2 letters, like GA)', { ac: 'address-level1', max: 2 }),
      zip: f('zip', 'ZIP code', { ac: 'postal-code', max: 10 }), phone: f('phone', 'Phone (optional)', { ac: 'tel', max: 25 }) };
    form.appendChild(h('h2', { text: 'Delivery' }));
    form.appendChild(h('p', { class: 'hint', text: 'Delivery to: ' + cat.config.countries.join(', ') + '. Receipts and updates go to ' + (X.S.user.email || 'your account email') + '.' }));
    // Optional: fill the delivery fields from the address saved in Settings. Only on this tap; nothing is sent to the shop until Pay, and every field can be changed.
    var useMsg = h('div');
    form.appendChild(h('div', { class: 'stack' }, h('button', { class: 'btn secondary small', type: 'button', text: 'Use my saved address', onclick: async function (ev) {
      await X.busy(ev.currentTarget, async function () {
        try {
          var r = await X.api('addressGet');
          if (!r.address) return X.showAlert(useMsg, 'error', 'You have not saved an address. You can add one under Settings, Privacy and personal information, or type it below.');
          var ad = r.address, set = function (k, v) { F[k].inp.value = v || ''; };
          set('address1', ad.line1); set('address2', ad.line2); set('city', ad.city); set('region', ad.region); set('zip', ad.postal);
          X.showAlert(useMsg, 'ok', 'Filled in from your saved address. Please check every line, and add your name, before you continue. Your profile address is not sent to the shop until you pay.');
        } catch (e) { X.showAlert(useMsg, 'error', msgOf(e)); }
      }, 'Filling in…');
    } }), useMsg));
    Object.keys(F).forEach(function (k) { form.appendChild(F[k].wrap); });
    var cbDel = h('input', { type: 'checkbox' }), cbImg = h('input', { type: 'checkbox' });
    form.appendChild(h('label', { class: 'check' }, cbDel, ' ', CONSENT_DELIVERY));
    form.appendChild(h('label', { class: 'check' }, cbImg, ' ', CONSENT_IMAGE + ' Printing starts only after your payment is confirmed.'));
    var quoteBtn = h('button', { class: 'btn secondary block', type: 'submit', text: 'Calculate shipping and total' });
    var payBtn = h('button', { class: 'btn block', type: 'button', text: 'Pay securely with Square', hidden: true });
    form.appendChild(quoteBtn); form.appendChild(summary); form.appendChild(payBtn); form.appendChild(msg);
    holder.appendChild(form);
    holder.appendChild(h('p', { class: 'small muted', text: 'You pay on Square’s own page, so this app never sees your card number. Photos are printed and shipped by Printify and its partners. If something is wrong with an order, contact ' + (cat.config.supportEmail || 'the person who runs the shop') + '.' }));

    function readAddr() { var o = {}; Object.keys(F).forEach(function (k) { o[k] = F[k].inp.value; }); o.country = 'US'; return o; }
    function body() { return { section: 'photo-gifts', familyId: X.S.familyId, designIds: designs.map(function (d) { return d.id; }), address: readAddr() }; }
    var quoted = null;
    form.addEventListener('input', function (ev) { if (ev.target && ev.target.type === 'checkbox') return; quoted = null; payBtn.hidden = true; clear(summary); });
    form.addEventListener('submit', function (ev) {
      ev.preventDefault(); X.showAlert(msg, 'error', '');
      if (designs.some(function (d) { return !d.available; })) return X.showAlert(msg, 'error', 'Remove the designs that are no longer available first.');
      X.busy(quoteBtn, async function () {
        try {
          st().addr = readAddr();
          var q = await shopApi('shopQuote', body()); quoted = q; clear(summary);
          q.lines.forEach(function (l) { summary.appendChild(h('div', { class: 'sum-row' }, h('span', { text: l.quantity + ' × ' + l.title + ' (' + l.variantLabel + ')' }), h('span', { text: money(l.unitCents * l.quantity) }))); });
          summary.appendChild(h('div', { class: 'sum-row' }, h('span', { text: 'Standard shipping' }), h('span', { text: money(q.shippingCents) })));
          summary.appendChild(h('div', { class: 'sum-row total' }, h('strong', { text: 'Total before tax' }), h('strong', { text: money(q.totalCents) })));
          summary.appendChild(h('p', { class: 'small muted', text: q.taxNote }));
          payBtn.hidden = false;
        } catch (e) { X.showAlert(msg, 'error', msgOf(e)); }
      }, 'Calculating…');
    });
    payBtn.addEventListener('click', function () {
      X.showAlert(msg, 'error', '');
      if (!quoted) return;
      if (!cbDel.checked || !cbImg.checked) return X.showAlert(msg, 'error', 'Please tick both permission boxes first.');
      X.busy(payBtn, async function () {
        try {
          if (!st().requestId) st().requestId = newRequestId();      // the same cart gets the same id, so a double tap cannot make two orders
          var r = await shopApi('shopCheckout', Object.assign(body(), { requestId: st().requestId, consentImage: true, consentDelivery: true }));
          if (!r.url) { st().requestId = null; location.hash = '#/orders/' + r.orderId; return; }
          location.href = r.url;
        } catch (e) { X.showAlert(msg, 'error', msgOf(e)); }
      }, 'Opening Square…');
    });
  }

  /* ================= FAMILY SHOP: PRODUCT PAGE ================= */
  var POLICY_FALLBACK = 'The shop owner has not published a return policy yet. Please contact the shop before you buy if you have questions.';
  function cartSwitch(active, counts) {
    function tab(id, label, href) { return h('a', { class: 'cart-tab' + (active === id ? ' on' : ''), href: href, 'aria-current': active === id ? 'page' : null, text: label + (counts && counts[id] != null ? ' (' + counts[id] + ')' : ''), onclick: function () { st().section = id; } }); }
    return h('div', { class: 'cart-tabs', role: 'navigation', 'aria-label': 'Carts' }, tab('photo-gifts', 'Photo Gifts cart', '#/shop/cart'), tab('family-shop', 'Family Shop cart', '#/shop/cart/family'));
  }
  async function viewItem(main, token, id) {
    st().section = 'family-shop';
    main.appendChild(head('Family Shop', '#/shop', 'Shop'));
    var holder = h('div', null, X.spinnerLine('Loading…')); main.appendChild(holder);
    var r, cart;
    try { r = await shopApi('shopCjItem', { familyId: X.S.familyId, id: id }); } catch (e) { if (token === X.S.nav) { clear(holder); holder.appendChild(X.alertBox('error', e.apiCode === 'not_found' ? 'That product is not available any more.' : msgOf(e))); holder.appendChild(h('a', { class: 'btn secondary', href: '#/shop', text: 'Back to the shop' })); } return; }
    if (token !== X.S.nav) return;
    var p = r.product; clear(holder);
    var hero = h('img', { class: 'shop-hero', alt: p.title, src: p.images[0] || p.image || '', referrerpolicy: 'no-referrer' });
    var thumbs = h('div', { class: 'thumb-strip', role: 'group', 'aria-label': 'Pictures' }, p.images.slice(0, 8).map(function (u, i) {
      return h('button', { class: 'thumb-btn', type: 'button', 'aria-label': 'Picture ' + (i + 1), onclick: function () { hero.src = u; } }, h('img', { src: u, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }));
    }));
    var cur = p.variants[0];
    var price = h('div', { class: 'shop-price big' }), availEl = h('div', { class: 'small' }), qty = h('select', { 'aria-label': 'Quantity' }), msg = h('div');
    var vsel = p.variants.length > 1 ? h('select', { 'aria-label': 'Choose an option', onchange: function () { cur = p.variants.filter(function (v) { return v.id === vsel.value; })[0]; show(true); } },
      p.variants.map(function (v) { return h('option', { value: v.id, text: v.label + ' · ' + money(v.priceCents) + (v.inStock === false ? ' · out of stock' : '') }); })) : null;
    var addBtn = h('button', { class: 'btn block', type: 'button', text: 'Add to Family Shop cart' });
    function show(swap) {
      if (swap && cur.image) hero.src = cur.image;
      price.textContent = money(cur.priceCents);
      availEl.textContent = cur.inStock === false ? 'Out of stock' : (cur.inStock === true ? 'In stock' : '');
      availEl.className = 'small ' + (cur.inStock === false ? 'danger-text' : 'ok-text');
      clear(qty); for (var n = 1; n <= Math.max(1, cur.maxQty); n++) qty.appendChild(h('option', { value: String(n), text: String(n) }));
      addBtn.disabled = cur.inStock === false || cur.maxQty < 1;
    }
    show(false);
    addBtn.addEventListener('click', function () {
      X.busy(addBtn, async function () {
        try {
          var have = await shopApi('shopCjCart', { familyId: X.S.familyId });
          var line = have.lines.filter(function (l) { return l.productId === p.id && l.vid === cur.id; })[0];
          var total = Math.min(cur.maxQty, (line ? line.quantity : 0) + Number(qty.value));
          await shopApi('shopCjCartSet', { familyId: X.S.familyId, productId: p.id, vid: cur.id, quantity: total });
          st().cjRequestId = null;
          X.showAlert(msg, 'ok', 'Added. You have ' + total + ' of this item in your Family Shop cart.');
          msg.appendChild(h('a', { class: 'btn secondary small', href: '#/shop/cart/family', text: 'View cart' }));
        } catch (e) { X.showAlert(msg, 'error', msgOf(e)); }
      }, 'Adding…');
    });
    var support = (st().catalog && st().catalog.config.supportEmail) || '';
    holder.appendChild(h('div', { class: 'card inner' }, hero, p.images.length > 1 ? thumbs : null, h('h1', { text: p.title }), price, availEl,
      vsel ? h('div', null, h('label', { text: 'Option' }), vsel) : (cur.label && cur.label !== 'Standard' ? h('div', { class: 'small muted', text: cur.label }) : null),
      h('div', null, h('label', { text: 'Quantity' }), qty), addBtn, msg));
    holder.appendChild(h('div', { class: 'card inner' }, h('h2', { text: 'Delivery' }),
      p.shipsFrom ? h('p', { text: 'Ships from a warehouse in ' + (COUNTRY_NAMES[p.shipsFrom] || p.shipsFrom) + '.' }) : null,
      h('p', { text: 'The delivery cost and the supplier’s time estimate are worked out from your address at checkout. They are the supplier’s own figures, not a promise.' }),
      h('p', { class: 'small muted', text: 'This item is bought and shipped by our supplier, CJdropshipping. Your family photos are never sent for it.' })));
    if (p.description) holder.appendChild(h('div', { class: 'card inner' }, h('h2', { text: 'About this item' }), h('p', { class: 'prewrap', text: p.description })));
    if (p.specs && p.specs.length) holder.appendChild(h('div', { class: 'card inner' }, h('h2', { text: 'Details' }), h('dl', { class: 'specs' }, p.specs.map(function (s) { return [h('dt', { text: s[0] }), h('dd', { text: s[1] })]; }).reduce(function (a, b) { return a.concat(b); }, []))));
    holder.appendChild(h('div', { class: 'card inner' }, h('h2', { text: 'Returns and cancellations' }), h('p', { class: 'prewrap', text: r.policy || POLICY_FALLBACK }),
      h('p', { class: 'small muted', text: support ? 'Questions: ' + support : 'Questions: ask the person who runs the shop.' })));
  }

  /* ================= FAMILY SHOP: CART AND CHECKOUT ================= */
  var CONSENT_CJ = 'Your name, delivery address, email and phone number (if you add one) will be shared with CJdropshipping and the shipping partners it uses, so they can deliver this order. They are not shown to your family. Your email is also given to Square for your payment receipt. No photos are sent.';
  async function viewFamilyCart(main, token) {
    st().section = 'family-shop';
    main.appendChild(head('Your cart', '#/shop', 'Shop'));
    main.appendChild(cartSwitch('family-shop'));
    var holder = h('div', null, X.spinnerLine('Loading your cart…')); main.appendChild(holder);
    var cat, res;
    try { cat = await loadCatalog(false); res = await shopApi('shopCjCart', { familyId: X.S.familyId }); } catch (e) { if (token === X.S.nav) { clear(holder); holder.appendChild(X.alertBox('error', msgOf(e))); } return; }
    if (token !== X.S.nav) return;
    clear(holder);
    if (!res.lines.length) { holder.appendChild(h('div', { class: 'empty' }, h('p', { text: 'Your Family Shop cart is empty.' }), h('a', { class: 'btn', href: '#/shop', onclick: function () { st().section = 'family-shop'; }, text: 'Browse the Family Shop' }))); return; }
    var list = h('div', { class: 'cart-list' }), summary = h('div', { class: 'card inner' }), form = h('form', { class: 'cart-form', novalidate: true }), msg = h('div'), noteEl = h('div');
    function setQty(l, n) { return async function () { try { await shopApi('shopCjCartSet', { familyId: X.S.familyId, productId: l.productId, vid: l.vid, quantity: n }); st().cjRequestId = null; X.route(false); } catch (e) { toast(msgOf(e)); } }; }
    res.lines.forEach(function (l) {
      var q = h('select', { 'aria-label': 'Quantity for ' + l.title, onchange: function () { setQty(l, Number(q.value))(); } }, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(function (n) { return h('option', { value: String(n), text: String(n) }); }));
      q.value = String(l.quantity);
      list.appendChild(h('div', { class: 'cart-row' }, l.image ? h('img', { class: 'cart-thumb', src: l.image, alt: '', referrerpolicy: 'no-referrer' }) : h('div', { class: 'cart-thumb' }),
        h('div', { class: 'grow' }, h('strong', { text: l.title }), l.variantLabel ? h('div', { class: 'small muted', text: l.variantLabel }) : null,
          l.unitCents ? h('div', { text: money(l.unitCents) + ' each' }) : null, l.available ? null : h('div', { class: 'small danger-text', text: (l.reason || 'Not available') + '. Change the quantity or remove it.' }),
          h('div', { class: 'cart-actions' }, h('label', { class: 'small', text: 'Qty ' }, q), h('button', { class: 'link-btn', type: 'button', text: 'Remove', onclick: setQty(l, 0) })))));
    });
    holder.appendChild(list);
    var blocked = res.lines.some(function (l) { return !l.available; });
    var a = st().addr || {};
    function f(name, label, opts) { opts = opts || {}; var inp = h('input', { type: 'text', name: name, value: a[name] || '', autocomplete: opts.ac || 'off', maxlength: opts.max || 80, 'aria-label': label, placeholder: label }); return { inp: inp, wrap: h('div', null, h('label', { text: label }), inp) }; }
    var F = { first_name: f('first_name', 'First name', { ac: 'given-name' }), last_name: f('last_name', 'Last name', { ac: 'family-name' }), address1: f('address1', 'Street address', { ac: 'address-line1' }),
      address2: f('address2', 'Apartment or suite (optional)', { ac: 'address-line2' }), city: f('city', 'City', { ac: 'address-level2' }), region: f('region', 'State (2 letters, like GA)', { ac: 'address-level1', max: 2 }),
      zip: f('zip', 'ZIP code', { ac: 'postal-code', max: 10 }), phone: f('phone', 'Phone (optional)', { ac: 'tel', max: 25 }) };
    form.appendChild(h('h2', { text: 'Delivery' }));
    form.appendChild(h('p', { class: 'hint', text: 'Delivery to: ' + cat.config.countries.join(', ') + '. Receipts and updates go to ' + (X.S.user.email || 'your account email') + '.' }));
    var useMsg = h('div');
    form.appendChild(h('div', { class: 'stack' }, h('button', { class: 'btn secondary small', type: 'button', text: 'Use my saved address', onclick: async function (ev) {
      await X.busy(ev.currentTarget, async function () {
        try {
          var r = await X.api('addressGet');
          if (!r.address) return X.showAlert(useMsg, 'error', 'You have not saved an address. You can add one under Settings, or type it below.');
          var ad = r.address, set = function (k, v) { F[k].inp.value = v || ''; };
          set('address1', ad.line1); set('address2', ad.line2); set('city', ad.city); set('region', ad.region); set('zip', ad.postal);
          X.showAlert(useMsg, 'ok', 'Filled in from your saved address. Please check every line and add your name. Nothing is sent to the shop until you pay.');
        } catch (e) { X.showAlert(useMsg, 'error', msgOf(e)); }
      }, 'Filling in…');
    } }), useMsg));
    Object.keys(F).forEach(function (k) { form.appendChild(F[k].wrap); });
    var cbDel = h('input', { type: 'checkbox' });
    form.appendChild(h('label', { class: 'check' }, cbDel, ' ', CONSENT_CJ));
    var quoteBtn = h('button', { class: 'btn secondary block', type: 'submit', text: 'Check stock and calculate shipping', disabled: blocked });
    var payBtn = h('button', { class: 'btn block', type: 'button', text: 'Pay securely with Square', hidden: true });
    form.appendChild(quoteBtn); form.appendChild(summary); form.appendChild(noteEl); form.appendChild(payBtn); form.appendChild(msg);
    holder.appendChild(form);
    holder.appendChild(h('p', { class: 'small muted', text: 'You pay on Square’s own page, so this app never sees your card number. Your payment covers your order. The shop owner pays the supplier separately, and orders are sent to the supplier only after your payment is confirmed. Questions: ' + (cat.config.supportEmail || 'the person who runs the shop') + '.' }));
    function readAddr() { var o = {}; Object.keys(F).forEach(function (k) { o[k] = F[k].inp.value; }); o.country = 'US'; return o; }
    var quoted = null;
    function drawQuote(q, changedFrom) {
      quoted = q; clear(summary); clear(noteEl);
      q.lines.forEach(function (l) { summary.appendChild(h('div', { class: 'sum-row' }, h('span', { text: l.quantity + ' × ' + l.title + (l.variantLabel ? ' (' + l.variantLabel + ')' : '') }), h('span', { text: money(l.unitCents * l.quantity) }))); });
      summary.appendChild(h('div', { class: 'sum-row' }, h('span', { text: 'Shipping (' + q.shipping.method + ')' }), h('span', { text: money(q.shippingCents) })));
      summary.appendChild(h('div', { class: 'sum-row total' }, h('strong', { text: 'Total before tax' }), h('strong', { text: money(q.totalCents) })));
      if (q.shipping.supplierEstimate) summary.appendChild(h('p', { class: 'small muted', text: 'Delivery estimate: ' + q.shipping.supplierEstimate + '.' }));
      summary.appendChild(h('p', { class: 'small muted', text: q.taxNote }));
      if (changedFrom != null) noteEl.appendChild(X.alertBox('warn', 'The total changed from ' + money(changedFrom) + ' to ' + money(q.totalCents) + ' (stock, price or shipping was checked again). Please review it. Pressing Pay again approves the new total.'));
      payBtn.hidden = false;
    }
    form.addEventListener('input', function (ev) { if (ev.target && ev.target.type === 'checkbox') return; quoted = null; payBtn.hidden = true; clear(summary); clear(noteEl); });
    form.addEventListener('submit', function (ev) {
      ev.preventDefault(); X.showAlert(msg, 'error', '');
      X.busy(quoteBtn, async function () {
        try { st().addr = readAddr(); drawQuote(await shopApi('shopCjQuote', { familyId: X.S.familyId, address: readAddr() })); }
        catch (e) { X.showAlert(msg, 'error', msgOf(e)); if (e.apiCode === 'out_of_stock' || e.apiCode === 'unavailable' || e.apiCode === 'price_changed') { var again = h('a', { class: 'link-btn', href: '#/shop/cart/family', text: 'Review your cart', onclick: function () { X.route(false); } }); msg.appendChild(again); } }
      }, 'Checking…');
    });
    payBtn.addEventListener('click', function () {
      X.showAlert(msg, 'error', '');
      if (!quoted) return;
      if (!cbDel.checked) return X.showAlert(msg, 'error', 'Please tick the permission box first.');
      X.busy(payBtn, async function () {
        try {
          if (!st().cjRequestId) st().cjRequestId = newRequestId();
          var r = await shopApi('shopCjCheckout', { familyId: X.S.familyId, address: readAddr(), requestId: st().cjRequestId, consentDelivery: true, expectedTotalCents: quoted.totalCents });
          if (!r.url) { st().cjRequestId = null; location.hash = '#/orders/' + r.orderId; return; }
          location.href = r.url;
        } catch (e) {
          if (e.apiCode === 'total_changed' && e.data && e.data.quote) { var was = quoted.totalCents; drawQuote(e.data.quote, was); X.showAlert(msg, 'error', ''); return; }
          X.showAlert(msg, 'error', msgOf(e));
        }
      }, 'Opening Square…');
    });
  }

  /* ================= SHOP OWNER: FAMILY SHOP (CJdropshipping) ================= */
  function retailClient(v, rule, manual) {
    if (manual != null && Number.isInteger(manual)) return manual;
    var pct = Number(rule.percent);
    if (rule.percent === '' || rule.percent == null || !isFinite(pct) || pct < 0 || v.costCents == null) return null;
    var c = Math.ceil(v.costCents * (1 + pct / 100));
    if (rule.round99) c = Math.ceil((c + 1) / 100) * 100 - 1;
    return c;
  }
  function parseCents(s) { var t = String(s || '').replace(/[$,\s]/g, ''); if (!t) return undefined; var n = Math.round(parseFloat(t) * 100); return isFinite(n) ? n : NaN; }
  async function viewAdminCj(main, token) {
    main.appendChild(head('Family Shop products', '#/shop/admin', 'Manage the shop'));
    var holder = h('div', null, X.spinnerLine('Loading…')); main.appendChild(holder);
    var ov;
    try { ov = await shopApi('shopAdminCjList'); } catch (e) { if (token === X.S.nav) { clear(holder); holder.appendChild(X.alertBox('error', e.apiCode === 'forbidden' ? 'Only the shop owner can open this page.' : msgOf(e))); } return; }
    if (token !== X.S.nav) return;
    var editorHost = h('div'), listHost = h('div');
    function draw() {
      clear(holder);
      holder.appendChild(h('div', { class: 'card inner' }, h('h2', { text: 'Connection' }),
        h('p', { text: 'CJ login key: ' + (ov.configured ? 'set (kept private on the server)' : 'NOT set. Add CJ_API_KEY in the shop-api settings.') }),
        h('p', { text: 'CJ mode: ' + (ov.sandbox ? 'SANDBOX. Orders are practice orders and nothing ships.' : 'LIVE. Paid orders create real CJ orders.') }),
        h('p', { text: 'Paying CJ: ' + (ov.autoPay ? 'automatic from your CJ wallet after a customer pays' : 'only when you press “Pay supplier” on the order') }),
        connectionTester()));
      var sku = h('input', { type: 'text', 'aria-label': 'CJ SKU or product ID', placeholder: 'CJ SKU or product ID', maxlength: 80 });
      var lookMsg = h('div');
      var go = h('button', { class: 'btn', type: 'button', text: 'Look up on CJ', onclick: function () { X.busy(go, function () { return doLookup(sku.value, lookMsg); }, 'Looking…'); } });
      var kw = h('input', { type: 'search', 'aria-label': 'Search CJ by keyword', placeholder: 'Or search CJ by keyword', maxlength: 100 });
      var found = h('div', { class: 'lib-list' });
      var sb = h('button', { class: 'btn secondary', type: 'button', text: 'Search CJ', onclick: function () {
        X.busy(sb, async function () {
          clear(found);
          try {
            var r = await shopApi('shopAdminCjSearch', { keyword: kw.value });
            if (!r.items.length) found.appendChild(h('p', { class: 'muted', text: 'CJ found nothing for that.' }));
            r.items.forEach(function (it) { found.appendChild(h('button', { class: 'lib-row', type: 'button', onclick: function () { sku.value = it.pid || it.sku; X.busy(go, function () { return doLookup(it.pid || it.sku, lookMsg); }, 'Looking…'); } }, h('span', { text: it.title + (it.priceText ? ' · CJ price ' + it.priceText : '') }))); });
          } catch (e) { found.appendChild(X.alertBox('error', msgOf(e))); }
        }, 'Searching…');
      } });
      holder.appendChild(h('div', { class: 'card inner' }, h('h2', { text: 'Add a CJ product' }),
        h('p', { class: 'hint', text: 'Type the product’s SKU or ID from CJ. Looking up is free and read-only: nothing is saved or ordered until you press Save. A keyword search uses more of your CJ API allowance (about 50 points a call), so use it when you need it.' }),
        sku, h('div', { class: 'row' }, go), lookMsg, kw, h('div', { class: 'row' }, sb), found));
      holder.appendChild(editorHost); holder.appendChild(listHost); drawList();
    }
    function connectionTester() {
      var out = h('div'), sku = h('input', { type: 'text', 'aria-label': 'Optional CJ SKU to test reading', placeholder: 'Optional: a CJ SKU to test reading', maxlength: 80 });
      var b = h('button', { class: 'btn secondary', type: 'button', text: 'Test CJ connection', onclick: function () {
        X.busy(b, async function () {
          clear(out);
          try {
            var c = await shopApi('shopAdminCjCheck', { sku: sku.value });
            var lines = [(c.loginOk ? '✓ Logged in to CJ.' : '✗ ' + c.problem), 'Square mode: ' + c.squareEnvironment, c.squareEnvironment !== 'production' && !c.sandbox ? '⚠ CJ is LIVE but Square is in test mode. Real CJ orders will be blocked until Square is live.' : (c.squareEnvironment === 'production' && c.sandbox ? '⚠ Square is live but CJ is in sandbox. Paid orders will be held until you set CJ_SANDBOX=false.' : '✓ Square and CJ modes match.')];
            if (c.product) lines.push(c.product.found ? '✓ Read “' + c.product.title + '”: ' + c.product.variantCount + ' variants, ' + c.product.imageCount + ' pictures' + (c.product.hasPrices ? '' : ', some prices missing') + '.' : '✗ ' + c.product.problem);
            lines.push('This test only logs in and reads. It places no order and pays nothing.');
            out.appendChild(h('ul', { class: 'ticks' }, lines.map(function (t) { return h('li', { text: t }); })));
          } catch (e) { out.appendChild(X.alertBox('error', msgOf(e))); }
        }, 'Testing…');
      } });
      return h('div', { class: 'stack' }, sku, h('div', { class: 'row' }, b), out);
    }
    async function doLookup(q, msgEl) {
      clear(msgEl); clear(editorHost);
      try {
        var r = await shopApi('shopAdminCjLookup', { query: q });
        var ex = r.existing;
        openEditor(r.product, ex ? { title: ex.titleSaved, description: ex.description, category: ex.category, status: ex.status, featured: ex.featured, fromCountry: ex.fromCountry, retail: ex.retail } : null, r.warehouses);
        editorHost.scrollIntoView({ block: 'start' });
      } catch (e) { X.showAlert(msgEl, 'error', msgOf(e)); }
    }
    function openEditor(sup, ex, warehouses) {
      clear(editorHost);
      var card = h('div', { class: 'card inner cj-editor' }), msg = h('div'), preview = h('div');
      editorHost.appendChild(card);
      card.appendChild(h('h2', { text: ex ? 'Edit: ' + sup.title : 'Review: ' + sup.title }));
      if (ex) card.appendChild(h('p', { class: 'hint', text: 'This CJ product is already in your shop. Saving updates it; it will not be added twice. Your edits below are kept when you sync.' }));
      card.appendChild(h('p', { class: 'small muted', text: 'CJ’s own title: ' + sup.title + ' · SKU ' + (sup.sku || '?') }));
      if (sup.images.length) card.appendChild(h('div', { class: 'thumb-strip' }, sup.images.slice(0, 6).map(function (u) { return h('img', { class: 'shop-thumb small', src: u, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }); })));
      var title = h('input', { type: 'text', maxlength: 120, value: (ex && ex.title) || sup.title.slice(0, 120), 'aria-label': 'Title shown to shoppers' });
      var desc = h('textarea', { rows: 6, maxlength: 3000, 'aria-label': 'Description shown to shoppers' }); desc.value = (ex && ex.description) || sup.description.slice(0, 3000);
      var catSel = h('select', { 'aria-label': 'Department' }, ov.categories.map(function (c) { return h('option', { value: c.id, text: c.title }); })); catSel.value = (ex && ex.category) || 'other';
      var countries = Object.keys(warehouses || {}); if (!countries.length) countries = ['US'];
      var ship = h('select', { 'aria-label': 'Ship from' }, countries.map(function (c) { return h('option', { value: c, text: 'Warehouse in ' + (COUNTRY_NAMES[c] || c) }); })); ship.value = (ex && ex.fromCountry && countries.indexOf(ex.fromCountry) >= 0) ? ex.fromCountry : countries[0];
      var saved = (ex && ex.retail) || { percent: null, round99: true, manual: {}, selected: [] };
      var pct = h('input', { type: 'text', inputmode: 'decimal', maxlength: 5, 'aria-label': 'Markup percent over CJ cost', value: saved.percent == null ? '' : String(saved.percent) });
      var r99 = h('input', { type: 'checkbox' }); r99.checked = saved.round99 !== false;
      card.appendChild(h('label', { text: 'Title shown to shoppers' })); card.appendChild(title);
      card.appendChild(h('label', { text: 'Description shown to shoppers (plain text)' })); card.appendChild(desc);
      card.appendChild(h('label', { text: 'Department' })); card.appendChild(catSel);
      card.appendChild(h('label', { text: 'Ship from (one warehouse per order; items from different warehouses cannot share an order)' })); card.appendChild(ship);
      card.appendChild(h('h3', { text: 'Pricing' }));
      card.appendChild(h('p', { class: 'hint', text: 'Rule: your price = CJ cost plus this percent. A price you type for one option wins over the rule. Remember CJ’s shipping is charged to the customer separately, and Square keeps a fee from each payment. A price at or below CJ’s cost cannot be saved for sale.' }));
      card.appendChild(h('div', { class: 'row' }, h('label', { class: 'small' }, 'Markup % ', pct), h('label', { class: 'check' }, r99, ' End prices in .99')));
      var rows = sup.variants.map(function (v) {
        var sell = h('input', { type: 'checkbox', 'aria-label': 'Sell ' + v.name }); sell.checked = (saved.selected || []).indexOf(v.vid) >= 0;
        var m = saved.manual && Number.isInteger(saved.manual[v.vid]) ? saved.manual[v.vid] : null;
        var price = h('input', { type: 'text', inputmode: 'decimal', maxlength: 9, 'aria-label': 'Your price for ' + v.name, placeholder: 'rule', value: m != null ? (m / 100).toFixed(2) : '' });
        var info = h('div', { class: 'small' });
        var stock = v.stockKnown ? Object.keys(v.stock).map(function (c) { return c + ' ' + v.stock[c]; }).join(', ') || 'none listed' : 'unknown';
        var line = h('div', { class: 'cj-var' }, h('label', { class: 'check' }, sell, ' ', h('span', null, h('strong', { text: v.name || v.sku }), h('span', { class: 'small muted', text: ' CJ cost ' + money(v.costCents) + ' · stock ' + stock }))), h('div', { class: 'row' }, price, info));
        card.appendChild(line);
        return { v: v, sell: sell, price: price, info: info };
      });
      function refresh() {
        var rule = { percent: pct.value.trim(), round99: r99.checked };
        rows.forEach(function (x) {
          var typed = parseCents(x.price.value); var manual = typed === undefined || isNaN(typed) ? null : typed;
          var p = retailClient(x.v, rule, manual);
          x.info.className = 'small';
          if (p == null) x.info.textContent = 'No price yet';
          else if (p <= x.v.costCents) { x.info.textContent = money(p) + ' is not above cost'; x.info.className = 'small danger-text'; }
          else x.info.textContent = 'Sells at ' + money(p) + ' · margin ' + money(p - x.v.costCents);
        });
      }
      [pct, r99].forEach(function (el) { el.addEventListener('input', refresh); el.addEventListener('change', refresh); });
      rows.forEach(function (x) { x.price.addEventListener('input', refresh); });
      refresh();
      var feat = h('input', { type: 'checkbox' }); feat.checked = !!(ex && ex.featured);
      var status = h('select', { 'aria-label': 'Status' }, [['draft', 'Draft (hidden from shoppers)'], ['published', 'Published (shoppers can buy it)'], ['disabled', 'Switched off']].map(function (s) { return h('option', { value: s[0], text: s[1] }); })); status.value = (ex && ex.status) || 'draft';
      card.appendChild(h('label', { class: 'check' }, feat, ' Show in “Picked by the shop owner”'));
      card.appendChild(h('label', { text: 'Status' })); card.appendChild(status);
      var save = h('button', { class: 'btn block', type: 'button', text: ex ? 'Save changes' : 'Save product', onclick: function () {
        X.busy(save, async function () {
          clear(preview);
          var sel = [];
          for (var i = 0; i < rows.length; i++) {
            var x = rows[i]; if (!x.sell.checked) continue;
            var typed = parseCents(x.price.value); if (typed !== undefined && isNaN(typed)) return X.showAlert(msg, 'error', 'One of the prices is not a number.');
            sel.push(typed === undefined ? { vid: x.v.vid } : { vid: x.v.vid, retailCents: typed });
          }
          try {
            var r = await shopApi('shopAdminCjSave', { pid: sup.pid, status: status.value, title: title.value, description: desc.value, category: catSel.value, fromCountry: ship.value, featured: feat.checked, percent: pct.value.trim() === '' ? null : Number(pct.value), round99: r99.checked, selected: sel });
            X.showAlert(msg, 'ok', r.updated ? 'Saved.' : 'Saved to your shop' + (status.value === 'published' ? ' and published.' : ' as a draft. Publish it when you are ready.'));
            var pv = r.preview; clear(preview);
            preview.appendChild(h('h3', { text: 'How shoppers will see it' }));
            preview.appendChild(itemCard({ href: '#/shop/item/' + pv.id, title: pv.title, image: pv.image, fromCents: pv.fromCents, hasRange: pv.hasRange, tag: '', availability: pv.availability }));
            ov = await shopApi('shopAdminCjList'); drawList();
          } catch (e) { X.showAlert(msg, 'error', msgOf(e)); }
        }, 'Saving…');
      } });
      card.appendChild(save); card.appendChild(msg); card.appendChild(preview);
      card.appendChild(h('button', { class: 'link-btn', type: 'button', text: 'Close', onclick: function () { clear(editorHost); } }));
    }
    function drawList() {
      clear(listHost);
      var c = h('div', { class: 'card inner' }, h('h2', { text: 'Your Family Shop products' }));
      if (!ov.products.length) c.appendChild(h('p', { class: 'muted', text: 'Nothing saved yet. Look up a CJ product above.' }));
      ov.products.forEach(function (p) {
        var line = h('div', { class: 'admin-prod imported' }, p.image ? h('img', { class: 'shop-thumb small', src: p.image, alt: '', referrerpolicy: 'no-referrer' }) : null,
          h('div', null, h('strong', { text: p.title }), h('div', { class: 'small muted', text: [p.status.toUpperCase(), p.featured ? 'featured' : '', p.selectedCount + ' of ' + p.variantCount + ' options for sale', p.minRetailCents ? 'from ' + money(p.minRetailCents) : 'no price yet', 'CJ cost ' + money(p.minCostCents) + (p.maxCostCents !== p.minCostCents ? ' to ' + money(p.maxCostCents) : '')].filter(Boolean).join(' · ') }),
            p.lastSyncAt ? h('div', { class: 'small muted', text: 'Checked with CJ ' + new Date(p.lastSyncAt).toLocaleString() }) : null,
            p.syncNote ? h('div', { class: 'small danger-text', text: p.syncNote }) : null));
        var acts = h('div', { class: 'row' });
        function btn(label, fn, busy) { var b = h('button', { class: 'btn secondary small', type: 'button', text: label, onclick: function () { X.busy(b, async function () { try { await fn(); } catch (e) { toast(msgOf(e)); } }, busy || 'Working…'); } }); acts.appendChild(b); }
        btn('Edit', async function () { var r = await shopApi('shopAdminCjOpen', { id: p.id }); var x = r.product; openEditor(x.supplier && Object.assign({ pid: x.pid, sku: x.sku }, x.supplier), { title: x.title, description: x.description, category: x.category, status: x.status, featured: x.featured, fromCountry: x.fromCountry, retail: x.retail }, warehousesOf(x.supplier)); editorHost.scrollIntoView({ block: 'start' }); }, 'Opening…');
        btn('Check CJ for changes', async function () { var r = await shopApi('shopAdminCjSync', { id: p.id }); toast(r.deleted ? 'CJ no longer has this product, so it was removed from your shop.' : (r.changes.length ? r.changes.join('; ') : 'No changes at CJ. Your edits were not touched.')); ov = await shopApi('shopAdminCjList'); drawList(); }, 'Checking…');
        btn(p.status === 'published' ? 'Switch off' : 'Publish', async function () { await shopApi('shopAdminCjToggle', { id: p.id, status: p.status === 'published' ? 'disabled' : 'published' }); ov = await shopApi('shopAdminCjList'); drawList(); });
        btn(p.featured ? 'Unfeature' : 'Feature', async function () { await shopApi('shopAdminCjToggle', { id: p.id, featured: !p.featured }); ov = await shopApi('shopAdminCjList'); drawList(); });
        if (p.status !== 'published') btn('Delete', async function () { if (!(await X.confirmDialog('Delete this product?', 'It is removed from your shop list. Past orders keep their own record. You can add it again from CJ.', 'Delete'))) return; await shopApi('shopAdminCjDelete', { id: p.id }); ov = await shopApi('shopAdminCjList'); drawList(); });
        c.appendChild(line); c.appendChild(acts);
      });
      listHost.appendChild(c);
    }
    function warehousesOf(sup) { var w = {}; ((sup && sup.variants) || []).forEach(function (v) { Object.keys(v.stock || {}).forEach(function (cc) { w[cc] = (w[cc] || 0) + v.stock[cc]; }); }); return w; }
    draw();
  }

  /* ================= ORDERS ================= */
  function orderLine(o) {
    return h('a', { class: 'order-row', href: '#/orders/' + o.id },
      h('div', null, h('strong', { text: money(o.totalCents) }), h('div', { class: 'small muted', text: new Date(o.createdAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) + ' · ' + o.items.map(function (i) { return i.quantity + ' × ' + i.title; }).join(', ') })),
      h('span', { class: 'badge tone-' + o.stage.tone, text: o.stage.label.split('.')[0] }));
  }
  async function viewOrders(main, token, id, sub) {
    if (id) return viewOrder(main, token, id, sub);
    main.appendChild(X.S.ordersFrom === '#/profile' ? head('My orders', '#/profile', 'Profile') : head('My orders', '#/shop', 'Shop'));
    main.appendChild(h('p', { class: 'small muted', text: 'Only you can see your orders. Your family cannot.' }));
    var holder = h('div', null, X.spinnerLine('Loading…')); main.appendChild(holder);
    try {
      var r = await shopApi('shopOrders'); if (token !== X.S.nav) return; clear(holder);
      if (!r.orders.length) holder.appendChild(h('div', { class: 'empty' }, h('p', { text: 'No orders yet.' }), h('a', { class: 'btn', href: '#/shop', text: 'Browse the shop' })));
      else r.orders.forEach(function (o) { holder.appendChild(orderLine(o)); });
      // A redirect or an email link is never proof of payment, so unpaid orders are re-checked with Square (at most 3).
      var pend = r.orders.filter(function (o) { return o.paymentStatus === 'pending_payment' || o.paymentStatus === 'processing'; }).slice(0, 3);
      if (pend.length) {
        var changed = false;
        for (var i = 0; i < pend.length; i++) { try { var u = await shopApi('shopOrder', { orderId: pend[i].id, refresh: true }); if (u.order.paymentStatus !== pend[i].paymentStatus) changed = true; } catch (e) { /* the list still shows what we had */ } }
        if (changed && token === X.S.nav) { var r2 = await shopApi('shopOrders'); if (token === X.S.nav) { clear(holder); r2.orders.forEach(function (o) { holder.appendChild(orderLine(o)); }); } }
      }
    } catch (e) { if (token === X.S.nav) { clear(holder); holder.appendChild(X.alertBox('error', msgOf(e))); } }
  }
  async function viewOrder(main, token, id, sub) {
    main.appendChild(head('Order', '#/orders', 'My orders'));
    var holder = h('div', null, X.spinnerLine('Loading…')); main.appendChild(holder);
    var tries = 0;
    async function load(refresh) {
      var r;
      try { r = await shopApi('shopOrder', { orderId: id, refresh: refresh === true }); } catch (e) { if (token === X.S.nav) { clear(holder); holder.appendChild(X.alertBox('error', msgOf(e))); } return null; }
      if (token !== X.S.nav) return null;
      draw(r.order, r.supportEmail); return r.order;
    }
    function draw(o, support) {
      clear(holder);
      if (sub === 'done' && (o.paymentStatus === 'pending_payment' || o.paymentStatus === 'processing')) holder.appendChild(X.alertBox('ok', 'Thank you. We are confirming your payment with Square. This page updates by itself.'));
      else if (sub === 'done' && o.paymentStatus === 'paid') holder.appendChild(X.alertBox('ok', 'Payment confirmed. Thank you!'));
      holder.appendChild(h('div', { class: 'card inner' }, h('span', { class: 'badge tone-' + o.stage.tone, text: o.stage.label })));
      holder.appendChild(h('div', { class: 'card inner' }, h('h2', { text: 'Items' }),
        o.items.map(function (i) { return h('div', { class: 'sum-row' }, h('span', { text: i.quantity + ' × ' + i.title + ' (' + i.variantLabel + ')' }), h('span', { text: money(i.unitCents * i.quantity) })); }),
        h('div', { class: 'sum-row' }, h('span', { text: 'Shipping' }), h('span', { text: money(o.shippingCents) })),
        o.taxCents ? h('div', { class: 'sum-row' }, h('span', { text: 'Tax' }), h('span', { text: money(o.taxCents) })) : null,
        h('div', { class: 'sum-row total' }, h('strong', { text: 'Total' }), h('strong', { text: money(o.totalCents) }))));
      if (o.tracking && o.tracking.length) holder.appendChild(h('div', { class: 'card inner' }, h('h2', { text: 'Tracking' }), o.tracking.map(function (t) {
        return h('div', null, (t.carrier || 'Carrier').toUpperCase() + ' ', t.url ? h('a', { href: t.url, target: '_blank', rel: 'noopener noreferrer', text: t.number || 'Track package' }) : (t.number || ''), t.deliveredAt ? ' · delivered' : '');
      })));
      if (o.address) holder.appendChild(h('div', { class: 'card inner' }, h('h2', { text: 'Delivering to' }), h('p', { text: o.address.first_name + ' ' + o.address.last_name }), h('p', { class: 'small muted', text: [o.address.address1, o.address.address2, o.address.city + ', ' + o.address.region + ' ' + o.address.zip].filter(Boolean).join(', ') }), h('p', { class: 'small muted', text: 'Only you (and the shop owner, if there is a problem to fix) can see this.' })));
      var actions = h('div', { class: 'row' });
      actions.appendChild(h('button', { class: 'btn secondary small', type: 'button', text: 'Refresh status', onclick: function () { load(true); } }));
      if (o.paymentStatus === 'pending_payment') actions.appendChild(h('button', { class: 'btn secondary small', type: 'button', text: 'Cancel this unpaid order', onclick: async function () { try { await shopApi('shopCancelOrder', { orderId: o.id }); load(false); } catch (e) { toast(msgOf(e)); } } }));
      holder.appendChild(actions);
      holder.appendChild(h('p', { class: 'small muted', text: o.section === 'family-shop' ? 'Need to change or cancel a paid order? Orders go to the supplier soon after payment, so ' + (support ? 'email ' + support : 'contact the shop owner') + ' as soon as possible. Refunds are decided by the shop owner.' : 'Need to change or cancel a paid order? Production can start quickly, so ' + (support ? 'email ' + support : 'contact the shop owner') + ' as soon as possible. Refunds are decided by the shop owner.' }));
      holder.appendChild(h('p', { class: 'small muted', text: 'Order ' + o.id.slice(0, 8) }));
      if ((o.paymentStatus === 'pending_payment' || o.paymentStatus === 'processing') && sub === 'done' && tries < 14 && token === X.S.nav) { tries++; setTimeout(function () { if (token === X.S.nav) load(true); }, 3000); }
    }
    await load(sub === 'done');
  }

  /* ================= SHOP OWNER ================= */
  async function viewAdmin(main, token) {
    main.appendChild(head('Manage the shop', '#/shop', 'Photo Gifts'));
    var holder = h('div', null, X.spinnerLine('Loading…')); main.appendChild(holder);
    var chk, ov;
    try { chk = await shopApi('shopAdminCheck'); ov = await shopApi('shopAdminOverview'); }
    catch (e) { if (token === X.S.nav) { clear(holder); holder.appendChild(X.alertBox('error', e.apiCode === 'forbidden' ? 'Only the shop owner can open this page.' : msgOf(e))); } return; }
    if (token !== X.S.nav) return;
    function featuredNow(k) { var f = st().featured || (st().catalog && st().catalog.featuredKeys) || []; return f.indexOf(k) >= 0; }
    function render() {
      clear(holder);
      holder.appendChild(h('div', { class: 'card inner' }, h('h2', { text: 'Status' }),
        h('p', { text: 'Square mode: ' + chk.squareEnvironment.toUpperCase() + (chk.squareEnvironment === 'production' ? ' (real money)' : ' (practice)') }),
        chk.squareLocation ? h('p', { class: chk.squareLocation.error ? 'small danger-text' : 'small', text: chk.squareLocation.error ? chk.squareLocation.error : 'Square location: ' + chk.squareLocation.name + ' (' + chk.squareLocation.status.toLowerCase() + ', ' + chk.squareLocation.currency + ')' }) : null,
        chk.squareNotificationUrl ? h('p', { class: 'small', text: 'The Square webhook subscription must use exactly this URL: ' + chk.squareNotificationUrl }) : h('p', { class: 'small danger-text', text: 'Set WEBHOOK_BASE_URL so the Square webhook URL can be worked out.' }),
        h('p', { text: 'Orders go to production: ' + (chk.autoSubmit ? 'automatically after payment' : 'only after YOU approve them') }),
        h('p', { text: 'Sales tax: ' + (chk.taxPercent ? 'a flat ' + chk.taxPercent + '% that you set (SQUARE_TAX_PERCENT)' : 'not added') }),
        chk.printifyShopsError ? h('p', { class: 'small danger-text', text: chk.printifyShopsError }) : null,
        chk.printifyShops ? h('p', { class: 'small', text: 'Printify stores this token can see: ' + (chk.printifyShops.length ? chk.printifyShops.map(function (x) { return x.title + ' (id ' + x.id + ', ' + (x.channel || 'store') + ')'; }).join('; ') : 'none') + '. PRINTIFY_SHOP_ID must be one of these ids.' }) : null,
        h('ul', { class: 'ticks' }, Object.keys(chk.configured).map(function (k) { return h('li', { text: (chk.configured[k] ? '✓ ' : '✗ missing: ') + k }); }))));
      if (((st().catalog && st().catalog.sections) || []).some(function (x) { return x.id === 'family-shop' && x.ready; })) holder.appendChild(h('div', { class: 'card inner' }, h('h2', { text: 'Family Shop (CJdropshipping)' }), h('p', { class: 'small muted', text: 'Add and price CJ products, check connection, and publish.' }), h('a', { class: 'btn secondary', href: '#/shop/admin/cj', text: 'Manage Family Shop products' })));
      var wh = h('button', { class: 'btn secondary small', type: 'button', text: 'Register Printify order webhooks', onclick: function () {
        X.busy(wh, async function () { try { var r = await shopApi('shopAdminRegisterWebhooks'); toast(r.added.length ? 'Registered ' + r.added.length + ' webhook(s).' : 'Already registered.'); } catch (e) { toast(msgOf(e)); } }, 'Registering…'); } });
      holder.appendChild(h('p', null, wh));
      // products from the owner's own Printify shop
      var sc = h('div', { class: 'card inner' }, h('h2', { text: 'Your Printify store products' }),
        h('p', { class: 'hint', text: 'Make and edit your products in Printify. Press Sync and they appear here. Titles, descriptions, pictures, enabled sizes and styles, and prices come from Printify each time you sync. Whether a product is shown to customers, and which section it sits in, is decided here and is kept when you sync again. Nothing in Printify is ever changed, moved or deleted from here.' }));
      var newCb = h('input', { type: 'checkbox', id: 'sync-new' });
      var progress = h('div', { class: 'small', role: 'status' });
      var report = h('div');
      var syncBtn = h('button', { class: 'btn', type: 'button', text: 'Sync from Printify', onclick: function () {
        X.busy(syncBtn, async function () {
          clear(report); var seen = [], counts = { new: 0, updated: 0, flagged: 0, skipped: 0 }, page = 1, last = 1, total = 0, shopInfo = null;
          try {
            do {
              progress.textContent = 'Reading page ' + page + (last > 1 ? ' of ' + last : '') + ' from Printify…';
              var r = await shopApi('shopAdminSync', { page: page, enableNew: newCb.checked });
              last = r.lastPage; total = r.total; if (r.shop) shopInfo = r.shop;
              if (r.diagnosis) { progress.textContent = ''; report.appendChild(X.alertBox('error', r.diagnosis.message)); return; }
              r.results.forEach(function (x) { if (x.key) seen.push(x.key); if (x.action === 'skipped') counts.skipped++; else counts[x.action]++; if (x.action !== 'skipped' && !x.supported) counts.flagged++; });
              page++;
            } while (page <= last);
            await shopApi('shopAdminSyncFinish', { seen: seen });
            progress.textContent = '';
            toast('Synced ' + total + ' product' + (total === 1 ? '' : 's') + '.');
            await reload();
          } catch (e) { progress.textContent = ''; report.appendChild(X.alertBox('error', msgOf(e))); }
        }, 'Syncing…'); } });
      var checkBtn = h('button', { class: 'btn secondary', type: 'button', text: 'Check Printify connection', onclick: function () {
        X.busy(checkBtn, async function () {
          clear(report);
          try {
            var c = await shopApi('shopAdminPrintifyCheck');
            report.appendChild(h('div', { class: 'card inner' },
              h('p', { class: c.shopMatch ? '' : 'danger-text', text: c.shopMatch ? '✓ PRINTIFY_SHOP_ID ' + c.configuredShopId + ' is one of your shops.' : '✗ PRINTIFY_SHOP_ID ' + (c.configuredShopId || '(empty)') + ' is not one of the shops this token can see.' }),
              h('ul', { class: 'ticks' }, c.shops.map(function (x) { return h('li', { text: (x.configured ? '→ ' : '') + x.title + ' (ID ' + x.id + ', ' + (x.channel || 'store') + '): ' + (x.products === null ? 'product count unavailable' : x.products + ' product' + (x.products === 1 ? '' : 's')) + (x.configured ? ' ← the shop this site uses' : '') }); })),
              h('ul', { class: 'ticks' }, c.scopes.map(function (x) { return h('li', { class: x.ok === false ? 'danger-text' : '', text: (x.ok === true ? '✓ ' : x.ok === false ? '✗ ' : '• ') + x.scope + (x.note ? ': ' + x.note : '') }); }))));
          } catch (e) { report.appendChild(X.alertBox('error', msgOf(e))); }
        }, 'Checking…'); } });
      sc.appendChild(h('label', { class: 'check', for: 'sync-new' }, newCb, h('span', { text: ' Show NEW products to customers right away (otherwise they start hidden)' })));
      sc.appendChild(h('div', { class: 'row' }, syncBtn, checkBtn)); sc.appendChild(progress); sc.appendChild(report);
      var imp = ov.imported || [];
      if (!imp.length) sc.appendChild(h('p', { class: 'muted', text: 'Nothing synced yet. Press “Sync from Printify”.' }));
      var picked = {}, boxes = [];
      var pickInfo = h('span', { class: 'small muted', text: '0 selected' });
      function eligible(p) { return p.supported && !p.missing; }
      function refreshPicked() { var n = Object.keys(picked).length; pickInfo.textContent = n + ' selected'; allCb.checked = n > 0 && n === imp.filter(eligible).length; showSel.disabled = hideSel.disabled = !n; }
      var allCb = h('input', { type: 'checkbox', 'aria-label': 'Select all products', onchange: function () {
        picked = {}; boxes.forEach(function (b) { b.cb.checked = allCb.checked && !b.cb.disabled; if (b.cb.checked) picked[b.key] = true; }); refreshPicked(); } });
      function bulk(on) {
        return async function () {
          var keys = Object.keys(picked), failed = 0;
          for (var i = 0; i < keys.length; i++) { try { await shopApi('shopAdminToggle', { key: keys[i], enabled: on }); } catch (e) { failed++; } }
          toast((on ? 'Shown: ' : 'Hidden: ') + (keys.length - failed) + (failed ? ' (' + failed + ' could not be changed)' : '')); await reload();
        };
      }
      var showSel = h('button', { class: 'btn small', type: 'button', text: 'Show selected to customers', disabled: true, onclick: function () { X.busy(showSel, bulk(true), 'Working…'); } });
      var hideSel = h('button', { class: 'btn secondary small', type: 'button', text: 'Hide selected', disabled: true, onclick: function () { X.busy(hideSel, bulk(false), 'Working…'); } });
      if (imp.length) sc.appendChild(h('div', { class: 'row bulk-bar' }, h('label', { class: 'check' }, allCb, h('span', { text: ' Select all' })), showSel, hideSel, pickInfo));
      imp.forEach(function (p) {
        var info = [p.enabled ? 'ON' : 'hidden', p.variantCount + ' variant' + (p.variantCount === 1 ? '' : 's'), p.variantCount ? (p.minCents === p.maxCents ? money(p.minCents) : money(p.minCents) + ' to ' + money(p.maxCents)) : '', 'Printify: ' + (p.visible ? 'published' : 'draft')].filter(Boolean).join(' · ');
        var sel = h('select', { 'aria-label': 'Section for ' + p.title, onchange: async function () { try { await shopApi('shopAdminToggle', { key: p.key, enabled: p.enabled, section: sel.value }); toast('Moved.'); await reload(); } catch (e) { toast(msgOf(e)); } } },
          SECTIONS.map(function (x) { return h('option', { value: x.id, text: x.title }); }));
        sel.value = p.section;
        var pcb = h('input', { type: 'checkbox', 'aria-label': 'Select ' + p.title, disabled: !eligible(p), onchange: function () { if (pcb.checked) picked[p.key] = true; else delete picked[p.key]; refreshPicked(); } });
        boxes.push({ key: p.key, cb: pcb });
        var line = h('div', { class: 'admin-prod imported' },
          pcb,
          p.image ? h('img', { class: 'shop-thumb small', src: p.image, alt: '' }) : null,
          h('div', null, h('strong', { text: p.title }), h('div', { class: 'small muted', text: info }),
            p.missing ? h('div', { class: 'small danger-text', text: 'No longer in your Printify shop, so it is hidden.' }) : null,
            !p.supported ? h('div', { class: 'small danger-text', text: 'Cannot be sold through the photo editor: ' + p.reason }) : null,
            (p.notes || []).map(function (n) { return h('div', { class: 'small muted', text: n }); })));
        var btns2 = h('div', { class: 'row' });
        btns2.appendChild(h('button', { class: 'btn secondary small', type: 'button', text: p.enabled ? 'Hide from customers' : 'Show to customers', disabled: !p.supported || p.missing, onclick: async function () { try { await shopApi('shopAdminToggle', { key: p.key, enabled: !p.enabled }); await reload(); } catch (e) { toast(msgOf(e)); } } }));
        btns2.appendChild(sel);
        btns2.appendChild(h('button', { class: 'btn secondary small', type: 'button', text: featuredNow(p.key) ? 'Unfeature' : 'Feature on the shop page', onclick: async function () { try { var fr = await shopApi('shopAdminFeaturePhoto', { key: p.key, featured: !featuredNow(p.key) }); st().featured = fr.featured; if (st().catalog) st().catalog.featuredKeys = fr.featured; await reload(); } catch (e) { toast(msgOf(e)); } } }));
        var ksel = h('select', { 'aria-label': 'What the buyer provides for ' + p.title, onchange: async function () { try { await shopApi('shopAdminToggle', { key: p.key, enabled: p.enabled, kind: ksel.value }); toast('Saved.'); await reload(); } catch (e) { toast(msgOf(e)); } } },
          [['photo', 'Buyer adds a photo'], ['words', 'Buyer types words']].map(function (x) { return h('option', { value: x[0], text: x[1] }); }));
        ksel.value = p.kind || 'photo'; btns2.appendChild(ksel);
        sc.appendChild(line); sc.appendChild(btns2);
      });
      holder.appendChild(sc);
      // orders
      var oc = h('div', { class: 'card inner' }, h('h2', { text: 'Orders' }));
      if (!ov.orders.length) oc.appendChild(h('p', { class: 'muted', text: 'No orders yet.' }));
      ov.orders.forEach(function (o) {
        var line = h('div', { class: 'admin-order' }, h('div', null, h('strong', { text: money(o.totalCents) }), ' ', h('span', { class: 'badge', text: o.paymentStatus }), ' ', h('span', { class: 'badge', text: o.fulfillmentStatus })),
          h('div', { class: 'small muted', text: o.items.map(function (i) { return i.quantity + '× ' + i.title; }).join(', ') + ' · ' + new Date(o.createdAt).toLocaleString() }),
          o.lastError ? h('div', { class: 'small danger-text', text: o.lastError }) : null,
          h('div', { class: 'small muted', text: 'Paid with: ' + o.paymentProvider + (o.squarePaymentId ? ' · payment ' + o.squarePaymentId : '') + (o.oldStripeRef ? ' · Stripe ref ' + o.oldStripeRef + ' (refund in the Stripe dashboard)' : '') + (o.refundedCents ? ' · refunded ' + money(o.refundedCents) : '') }),
          o.supplier === 'cj' ? h('div', { class: 'small muted', text: 'Family Shop order · CJ order: ' + (o.supplierOrderId || 'not created yet') + (o.supplierStatus ? ' · CJ status ' + o.supplierStatus : '') + ' · customer paid ' + money(o.subtotalCents + o.shippingCents) + ' for items and shipping' }) : null,
          o.printifyCostCents ? h('div', { class: 'small muted', text: 'Printify cost (items + shipping): ' + money(o.printifyCostCents) + ' · customer paid ' + money(o.subtotalCents + o.shippingCents) }) : null);
        var acts = h('div', { class: 'row' });
        function act(label, a) { acts.appendChild(h('button', { class: 'btn secondary small', type: 'button', text: label, onclick: async function () {
          if (a === 'approve' && !(await X.confirmDialog('Send to production?', 'Printify will charge your Printify payment method for this order and start making it. Check the order in Printify first.', 'Approve'))) return;
          if (a === 'cj_pay' && !(await X.confirmDialog('Pay CJ from your wallet?', (o.supplierStatus ? 'CJ order status: ' + o.supplierStatus + '. ' : '') + 'This takes the order cost out of your CJ wallet and CJ starts preparing it. Check the order in your CJ account first. In sandbox mode nothing real is charged.', 'Pay supplier'))) return;
          if (a === 'cj_cancel' && !(await X.confirmDialog('Cancel at CJ?', 'CJ only cancels orders that are not paid yet. This does NOT refund the customer. Refund in Square separately.', 'Cancel at CJ'))) return;
          if (a === 'cancel_printify' && !(await X.confirmDialog('Cancel at Printify?', 'This cancels the Printify order. It does NOT refund the customer. Refund in Square separately.', 'Cancel at Printify'))) return;
          try { await shopApi('shopAdminResolve', { orderId: o.id, act: a }); await reload(); } catch (e) { toast(msgOf(e)); } } })); }
        if (o.paymentProvider === 'square' && (o.paymentStatus === 'pending_payment' || o.paymentStatus === 'processing')) act('Check payment with Square', 'refresh');
        if (o.paymentProvider === 'square' && o.paymentStatus === 'paid') act('Check for refunds in Square', 'refresh');
        if (o.supplier === 'cj') {
          if (o.paymentStatus === 'paid') {
            if (!o.supplierOrderId && ['failed', 'needs_review', 'creating'].indexOf(o.fulfillmentStatus) >= 0) { act('Check CJ for this order', 'cj_check'); act('Retry creating the CJ order', 'cj_retry'); }
            if (o.supplierOrderId) {
              act('Refresh from CJ', 'cj_refresh');
              if (['created', 'needs_review'].indexOf(o.fulfillmentStatus) >= 0) { act('Pay supplier (CJ wallet)', 'cj_pay'); act('Cancel at CJ', 'cj_cancel'); }
            }
          }
        } else if (o.paymentStatus === 'paid') {
          if (!o.printifyOrderId && (o.fulfillmentStatus === 'failed' || o.fulfillmentStatus === 'needs_review' || o.fulfillmentStatus === 'creating')) act('Retry creating the Printify order', 'retry');
          if (o.printifyOrderId) { act('Refresh from Printify', 'refresh'); if (['created', 'needs_review'].indexOf(o.fulfillmentStatus) >= 0) act('Approve and send to production', 'approve'); if (['created', 'needs_review'].indexOf(o.fulfillmentStatus) >= 0) act('Cancel at Printify', 'cancel_printify'); }
        }
        acts.appendChild(h('button', { class: 'btn secondary small', type: 'button', text: 'Show delivery details', onclick: async function () { try { var d = await shopApi('shopAdminOrder', { orderId: o.id }); var a = d.order.address || {}; toast(a.first_name + ' ' + a.last_name + ', ' + a.address1 + ', ' + a.city + ' ' + a.region + ' ' + a.zip + ' · ' + (a.email || '')); } catch (e) { toast(msgOf(e)); } } }));
        oc.appendChild(line); oc.appendChild(acts);
      });
      holder.appendChild(oc);
    }
    async function reload() { ov = await shopApi('shopAdminOverview'); render(); }

    function productWizard(p) {
      var dlg = h('dialog', { class: 'sheet-dialog wizard', 'aria-labelledby': 'dlg-title' });
      function close() { dlg.close(); if (dlg.parentNode) dlg.parentNode.removeChild(dlg); }
      dlg.addEventListener('cancel', function (e) { e.preventDefault(); close(); });
      var body = h('div', { class: 'stack' }); var msg = h('div');
      dlg.appendChild(h('h2', { id: 'dlg-title', text: 'Set up: ' + p.title })); dlg.appendChild(body); dlg.appendChild(msg);
      dlg.appendChild(h('div', { class: 'row' }, h('button', { class: 'btn ghost', type: 'button', text: 'Close', onclick: close })));
      document.body.appendChild(dlg); dlg.showModal();
      var sel = { blueprintId: 0, providerId: 0, variants: [], position: '' };
      function step1() {
        clear(body); body.appendChild(h('p', { class: 'hint', text: 'Step 1 of 3. Search Printify’s catalog for the product (for example: ' + p.title.split(' ').slice(-1)[0].toLowerCase() + ').' }));
        var q = h('input', { type: 'text', 'aria-label': 'Search', value: '' }), list = h('div', { class: 'lib-list' });
        var go = h('button', { class: 'btn', type: 'button', text: 'Search', onclick: async function () { try { clear(list); var r = await shopApi('shopAdminBlueprints', { query: q.value }); r.blueprints.forEach(function (b) { list.appendChild(h('button', { class: 'lib-row', type: 'button', onclick: function () { sel.blueprintId = b.id; step2(b); } }, h('span', { text: b.title + ' (' + b.brand + ') #' + b.id }))); }); if (!r.blueprints.length) list.appendChild(h('p', { text: 'Nothing found.' })); } catch (e) { X.showAlert(msg, 'error', msgOf(e)); } } });
        body.appendChild(q); body.appendChild(go); body.appendChild(list);
      }
      async function step2(b) {
        clear(body); body.appendChild(h('p', { class: 'hint', text: 'Step 2 of 3. Choose the print provider for "' + b.title + '". Compare them in your Printify dashboard first: price, location and production time differ.' }));
        try {
          var r = await shopApi('shopAdminProviders', { blueprintId: b.id });
          r.providers.forEach(function (pr) { body.appendChild(h('button', { class: 'lib-row', type: 'button', onclick: function () { sel.providerId = pr.id; step3(b, pr); } }, h('span', { text: pr.title + ' #' + pr.id + (pr.location ? ' · ' + pr.location.country : '') + (pr.productionDays ? ' · ~' + pr.productionDays + ' days' : '') }))); });
        } catch (e) { X.showAlert(msg, 'error', msgOf(e)); }
      }
      async function step3(b, pr) {
        clear(body); body.appendChild(h('p', { class: 'hint', text: 'Step 3 of 3. Pick the variants to sell and type YOUR selling price for each. Look up Printify’s cost for the same variant in your Printify dashboard, so the price covers cost, shipping you do not pass on, Square’s fee and a margin.' }));
        try {
          var r = await shopApi('shopAdminVariants', { blueprintId: b.id, providerId: pr.id });
          var positions = []; r.variants.forEach(function (v) { v.placeholders.forEach(function (ph) { if (positions.indexOf(ph.position) < 0) positions.push(ph.position); }); });
          var posSel = h('select', { 'aria-label': 'Print area' }, positions.map(function (x) { return h('option', { value: x, text: x }); }));
          body.appendChild(h('label', { text: 'Print area (the side you print the photo on)' })); body.appendChild(posSel);
          var rows = r.variants.slice(0, 60).map(function (v) {
            var cb = h('input', { type: 'checkbox', 'aria-label': 'Sell ' + v.title }), price = h('input', { type: 'text', inputmode: 'decimal', placeholder: '$ price', 'aria-label': 'Price for ' + v.title, maxlength: 8 });
            body.appendChild(h('div', { class: 'var-row' }, h('label', null, cb, ' ', v.title, h('span', { class: 'small muted', text: ' ' + (v.placeholders[0] ? v.placeholders[0].width + '×' + v.placeholders[0].height + ' px' : '') })), price));
            return { v: v, cb: cb, price: price };
          });
          var en = h('input', { type: 'checkbox' });
          body.appendChild(h('label', { class: 'check' }, en, ' Turn this product on for shoppers right away'));
          body.appendChild(h('button', { class: 'btn block', type: 'button', text: 'Check with Printify and save', onclick: async function () {
            var variants = rows.filter(function (x) { return x.cb.checked; }).map(function (x) { return { id: x.v.id, priceCents: Math.round(parseFloat(String(x.price.value).replace('$', '')) * 100) }; });
            try { await shopApi('shopAdminSaveProduct', { key: p.key, blueprintId: b.id, providerId: pr.id, position: posSel.value, variants: variants, enabled: en.checked }); toast('Saved.'); close(); await reload(); }
            catch (e) { X.showAlert(msg, 'error', msgOf(e)); } } }));
        } catch (e) { X.showAlert(msg, 'error', msgOf(e)); }
      }
      step1();
    }
    render();
  }

  /* ================= PHOTO MENU HELPERS (used by app.js) ================= */
  async function giftSettingDialog(post) {
    var dlg = h('dialog', { class: 'sheet-dialog', 'aria-labelledby': 'dlg-title' });
    function close() { dlg.close(); if (dlg.parentNode) dlg.parentNode.removeChild(dlg); }
    dlg.addEventListener('cancel', function (e) { e.preventDefault(); close(); });
    var cb = h('input', { type: 'checkbox', disabled: true }), msg = h('div');
    dlg.appendChild(h('h2', { id: 'dlg-title', text: 'Gifts with this photo' }));
    dlg.appendChild(h('p', { class: 'hint', text: 'If you turn this on, other members of ' + X.famName() + ' can order gifts printed with this photo (the picture is shared with Printify to make them). You can turn it off any time. Orders already paid for are not stopped automatically, but an order that has not been made yet will be held for the shop owner to review.' }));
    dlg.appendChild(h('label', { class: 'check' }, cb, ' Allow family members to order gifts with this photo'));
    dlg.appendChild(msg);
    var save = h('button', { class: 'btn', type: 'button', text: 'Save', disabled: true, onclick: function () {
      X.busy(save, async function () { try { await shopApi('shopSetGift', { familyId: X.S.familyId, postId: post.$id, allowed: cb.checked }); toast(cb.checked ? 'Gifts allowed for this photo.' : 'Gifts turned off for this photo.'); close(); } catch (e) { X.showAlert(msg, 'error', msgOf(e)); } }, 'Saving…');
    } });
    dlg.appendChild(h('div', { class: 'row' }, h('button', { class: 'btn secondary', type: 'button', text: 'Cancel', onclick: close }), save));
    document.body.appendChild(dlg); dlg.showModal();
    try { var r = await shopApi('shopGiftStatus', { familyId: X.S.familyId, postIds: [post.$id] }); cb.checked = !!r.allowed[post.$id]; cb.disabled = false; save.disabled = false; }
    catch (e) { X.showAlert(msg, 'error', msgOf(e)); }
  }
  async function setGiftAfterPost(postId, allowed) { try { await shopApi('shopSetGift', { familyId: X.S.familyId, postId: postId, allowed: allowed }); } catch (e) { /* the post itself is fine; the person can switch gifts on later from the ⋯ menu */ } }

  function install(ctx) {
    X = ctx; h = X.h; clear = X.clear; icon = X.icon; toast = X.toast;
    X.VIEWS.shop = function (main, token, a, b, c) {
      if (a === 'product') return viewProduct(main, token, b, c);
      if (a === 'gift') return viewGift(main, token, b);
      if (a === 'item') return viewItem(main, token, b);
      if (a === 'cart') return b === 'family' ? viewFamilyCart(main, token) : viewCart(main, token);
      if (a === 'admin') return b === 'cj' ? viewAdminCj(main, token) : viewAdmin(main, token);
      return viewShop(main, token);
    };
    X.VIEWS.orders = viewOrders;
  }
  window.FCShop = { install: install, giftSettingDialog: function (p) { return giftSettingDialog(p); }, setGiftAfterPost: setGiftAfterPost };
})();
