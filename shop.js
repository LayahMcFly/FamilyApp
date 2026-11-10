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
    if (!json.ok) { var err = new Error(json.message || 'Something went wrong.'); err.code = ex.responseStatusCode; err.apiCode = json.error; throw err; }
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

  function head(title, back, backText) {
    return h('div', { class: 'shop-head' },
      back ? h('a', { class: 'link-btn back-btn', href: back, text: backText || 'Back' }) : null,
      h('h1', { text: title }));
  }
  function shopLinks(extra) {
    return h('div', { class: 'shop-links' },
      h('a', { class: 'btn secondary small cart-icon-btn', href: '#/shop/cart', 'aria-label': 'Cart' + (extra && extra.cart ? ', ' + extra.cart + ' items' : ''), title: 'Cart' }, icon('cart'), extra && extra.cart ? h('span', { class: 'cart-count', text: String(extra.cart) }) : null),
      h('a', { class: 'btn secondary small', href: '#/orders', text: 'My orders' }));
  }
  function setupNeeded(main, e) {
    clear(main).appendChild(h('div', { class: 'empty' }, h('h1', { text: 'Photo Gifts' }), h('p', { text: msgOf(e) }),
      h('p', { class: 'small muted', text: 'If you own this app: the shop is set up with SHOP-GUIDE.md.' })));
  }

  /* ================= SHOP HOME ================= */
  async function viewShop(main, token) {
    var holder = h('div', null, X.spinnerLine('Loading the shop…')); main.appendChild(holder);
    var cat;
    try { cat = await loadCatalog(true); } catch (e) { if (token === X.S.nav) setupNeeded(main, e); return; }
    if (token !== X.S.nav) return;
    clear(main);
    main.appendChild(h('h1', { text: 'Photo Gifts' }));
    main.appendChild(h('p', { class: 'muted', text: 'Turn a family photo into a gift. You choose the photo and the crop, and you see a layout preview before you pay. Shopping is optional and there are no ads or subscriptions.' }));
    main.appendChild(shopLinks());
    if (cat.config.testMode) main.appendChild(X.alertBox('warn', 'Test mode: payments here are practice payments and no real order is made.'));
    var finder = h('input', { type: 'search', class: 'shop-search', placeholder: 'Search the shop', 'aria-label': 'Search the shop' });
    var none = h('p', { class: 'hint', hidden: true, text: 'Nothing matches that. Try another word, like mug or necklace.' });
    main.appendChild(h('div', { class: 'shop-search-row' }, finder));
    main.appendChild(none);
    var blocks = [];
    SECTIONS.forEach(function (sec) {
    var slots = cat.slots.filter(function (x) { return (x.section || 'gifts') === sec.id; });
    if (!slots.length) return;
    var head2 = h('h2', { class: 'shop-section', text: sec.title }); main.appendChild(head2);
    var grid = h('div', { class: 'shop-grid' }); blocks.push({ head: head2, grid: grid });
    slots.forEach(function (slot) {
      var p = productByKey(cat, slot.key);
      if (p) grid.appendChild(h('a', { class: 'shop-card', href: '#/shop/product/' + p.key, 'data-q': (p.title + ' ' + (p.blurb || '') + ' ' + sec.title).toLowerCase() }, cardImg(p), h('strong', { class: 'shop-title', text: p.title }), h('span', { class: 'shop-price', text: 'From ' + money(fromPrice(p)) })));
      else grid.appendChild(h('div', { class: 'shop-card off', 'aria-disabled': 'true' }, h('strong', { text: slot.title }), h('span', { class: 'small', text: 'Not available yet' })));
    });
    main.appendChild(grid);
    });
    finder.addEventListener('input', function () {
      var words = finder.value.toLowerCase().split(/\s+/).filter(Boolean), shown = 0;
      blocks.forEach(function (b) {
        var any = 0;
        Array.prototype.forEach.call(b.grid.children, function (c) { var q = c.getAttribute('data-q'); var hit = q ? words.every(function (w) { return q.indexOf(w) !== -1; }) : !words.length; c.hidden = !hit; if (hit) any++; });
        b.head.hidden = b.grid.hidden = !any; shown += any;
      });
      none.hidden = !words.length || shown > 0;
    });
    if (!cat.products.length) main.appendChild(h('p', { class: 'hint', text: 'No products are switched on yet.' }));
    main.appendChild(h('div', { class: 'card inner' }, h('h2', { text: 'How it works' }),
      h('ol', { class: 'steps' },
        h('li', { text: 'Pick a product and a photo. Only photos whose owner allowed gifts can be used.' }),
        h('li', { text: 'Crop and place the photo. You see what will be cut off.' }),
        h('li', { text: 'Check the total, with shipping, before paying on Square’s secure page.' }),
        h('li', { text: 'After payment is confirmed, the photo is sent to Printify to be made and shipped. You can follow it in My orders.' }))));
    if (cat.isAdmin) main.appendChild(h('p', null, h('a', { class: 'link-btn', href: '#/shop/admin', text: 'Manage the shop (owner only)' })));
  }

  /* ================= "MAKE A GIFT" ENTRY ================= */
  async function viewGift(main, token, postId) {
    main.appendChild(head('Make a gift', '#/shop', 'Photo Gifts'));
    var holder = h('div', null, X.spinnerLine('Checking this photo…')); main.appendChild(holder);
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
      cat.products.forEach(function (p) { grid.appendChild(h('a', { class: 'shop-card', href: '#/shop/product/' + p.key + '/' + postId }, cardImg(p), h('strong', { class: 'shop-title', text: p.title }), h('span', { class: 'shop-price', text: 'From ' + money(fromPrice(p)) }))); });
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
    main.appendChild(head('', '#/shop', 'Photo Gifts'));
    var holder = h('div', null, X.spinnerLine('Loading…')); main.appendChild(holder);
    var cat, prod;
    try { cat = await loadCatalog(false); } catch (e) { if (token === X.S.nav) setupNeeded(main, e); return; }
    prod = productByKey(cat, key);
    if (token !== X.S.nav) return;
    if (!prod) { clear(holder); holder.appendChild(h('div', { class: 'empty' }, h('p', { text: 'That product is not available right now.' }), h('a', { class: 'btn', href: '#/shop', text: 'Back to the shop' }))); return; }
    main.firstChild.querySelector('h1') && (main.firstChild.querySelector('h1').textContent = prod.title);
    clear(holder);
    if (prod.image) holder.appendChild(h('img', { class: 'shop-hero', src: prod.image, alt: prod.title + ' (sample product picture)' }));

    var groups = optionGroups(prod.variants), chosen = {}, variant = prod.variants[0];
    groups.forEach(function (g) { chosen[g] = (variant.options || {})[g]; });
    var spec = { fit: 'cover', zoom: 1, ox: 0, oy: 0, caption: '' };
    var photo = { postId: postId || '', bmp: null, own: false };
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
      priceEl.textContent = money(variant.priceCents) + ' each';
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
            var okc = await X.confirmDialog('Before we make your product', CONSENT_IMAGE + ' Nothing is sent to Printify until your payment is confirmed. Until then, the picture stays in your private area of this app.', 'I understand');
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
          await shopApi('shopSaveDesign', { familyId: fid, postId: photo.postId, ownPhoto: photo.own ? true : undefined, productKey: prod.key, variantId: variant.id, fileId: uploaded.$id, quantity: Number(qtyEl.value),
            spec: { fit: spec.fit, zoom: spec.zoom, ox: spec.ox, oy: spec.oy, caption: spec.caption, srcW: photo.bmp.width, srcH: photo.bmp.height } });
          st().designs = null; toast('Added to your cart.'); location.hash = '#/shop/cart';
        } catch (e) {
          if (uploaded) X.storage.deleteFile({ bucketId: X.CFG.shopBucketId || 'family-media', fileId: uploaded.$id }).catch(function () {});
          X.showAlert(msg, 'error', msgOf(e));
        }
      }, 'Saving…');
    }

    async function usePhoto(post) {
      clear(pickEl); pickEl.appendChild(X.spinnerLine('Opening the photo…'));
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
      clear(pickEl); pickEl.appendChild(X.spinnerLine('Opening your photo…'));
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
      clear(pickEl); pickEl.appendChild(X.spinnerLine('Finding photos you can use…'));
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

    if (prod.blurb) holder.appendChild(h('details', { class: 'shop-about' }, h('summary', { text: 'About this product' }), h('p', { class: 'muted', text: prod.blurb })));
    holder.appendChild(optsEl); holder.appendChild(priceEl);
    drawOptions();
    holder.appendChild(pickEl); holder.appendChild(stage); holder.appendChild(controls);
    holder.appendChild(h('p', { class: 'small muted', text: 'Layout preview: made on your phone from the print area of the product. Printify’s own product mockups are not used, so it is not a picture of the finished item.' }));
    repaint();
    if (postId) {
      var found = (await X.listRows('posts', [X.Query.equal('$id', [postId]), X.Query.limit(1)])).rows[0];
      if (found && found.familyId === X.S.familyId && found.kind === 'photo') await usePhoto(found); else showPicker();
    } else showPicker();
    window.addEventListener('resize', repaint);
  }

  /* ================= CART + CHECKOUT ================= */
  function newRequestId() { try { return crypto.randomUUID(); } catch (e) { return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); } }

  async function viewCart(main, token) {
    main.appendChild(head('Your cart', '#/shop', 'Photo Gifts'));
    var holder = h('div', null, X.spinnerLine('Loading your cart…')); main.appendChild(holder);
    var cat; try { cat = await loadCatalog(false); } catch (e) { if (token === X.S.nav) setupNeeded(main, e); return; }
    var res; try { res = await shopApi('shopDesigns', { familyId: X.S.familyId }); } catch (e) { if (token === X.S.nav) { clear(holder); holder.appendChild(X.alertBox('error', msgOf(e))); } return; }
    if (token !== X.S.nav) return;
    var designs = res.designs; clear(holder);
    if (!designs.length) { holder.appendChild(h('div', { class: 'empty' }, h('p', { text: 'Your cart is empty.' }), h('a', { class: 'btn', href: '#/shop', text: 'Browse gifts' }))); return; }
    var list = h('div', { class: 'cart-list' }), summary = h('div', { class: 'card inner' }), form = h('form', { class: 'cart-form', novalidate: true }), msg = h('div');
    designs.forEach(function (d) {
      var img = h('img', { class: 'cart-thumb', alt: 'Your design for ' + d.title });
      X.fetchMedia(d.fileId, false, X.CFG.shopBucketId || 'family-media').then(function (b) { img.src = X.blobUrl(b, 'image/jpeg'); }).catch(function () {});
      var qty = h('select', { 'aria-label': 'Quantity for ' + d.title, onchange: async function () { try { await shopApi('shopUpdateDesign', { designId: d.id, quantity: Number(qty.value) }); st().requestId = null; X.route(false); } catch (e) { toast(msgOf(e)); } } },
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(function (n) { return h('option', { value: String(n), text: String(n) }); }));
      qty.value = String(d.quantity);
      list.appendChild(h('div', { class: 'cart-row' }, img, h('div', { class: 'grow' }, h('strong', { text: d.title }), h('div', { class: 'small muted', text: d.variantLabel }),
        d.available ? h('div', { text: money(d.unitCents) + ' each' }) : h('div', { class: 'small danger-text', text: 'No longer available. Please remove it.' }),
        h('div', { class: 'cart-actions' }, h('label', { class: 'small', text: 'Qty ' }, qty),
          h('button', { class: 'link-btn', type: 'button', text: 'Remove', onclick: async function () { try { await shopApi('shopUpdateDesign', { designId: d.id, remove: true }); st().requestId = null; X.route(false); } catch (e) { toast(msgOf(e)); } } })))));
    });
    holder.appendChild(list);

    var a = st().addr || {};
    function f(name, label, opts) { opts = opts || {}; var inp = h('input', { type: 'text', name: name, value: a[name] || (name === 'country' ? 'US' : ''), autocomplete: opts.ac || 'off', maxlength: opts.max || 80, 'aria-label': label, placeholder: label }); return { inp: inp, wrap: h('div', null, h('label', { text: label }), inp) }; }
    var F = { first_name: f('first_name', 'First name', { ac: 'given-name' }), last_name: f('last_name', 'Last name', { ac: 'family-name' }), address1: f('address1', 'Street address', { ac: 'address-line1' }),
      address2: f('address2', 'Apartment or suite (optional)', { ac: 'address-line2' }), city: f('city', 'City', { ac: 'address-level2' }), region: f('region', 'State (2 letters, like GA)', { ac: 'address-level1', max: 2 }),
      zip: f('zip', 'ZIP code', { ac: 'postal-code', max: 10 }), phone: f('phone', 'Phone (optional)', { ac: 'tel', max: 25 }) };
    form.appendChild(h('h2', { text: 'Delivery' }));
    form.appendChild(h('p', { class: 'hint', text: 'Delivery to: ' + cat.config.countries.join(', ') + '. Receipts and updates go to ' + (X.S.user.email || 'your account email') + '.' }));
    Object.keys(F).forEach(function (k) { form.appendChild(F[k].wrap); });
    var cbDel = h('input', { type: 'checkbox' }), cbImg = h('input', { type: 'checkbox' });
    form.appendChild(h('label', { class: 'check' }, cbDel, ' ', CONSENT_DELIVERY));
    form.appendChild(h('label', { class: 'check' }, cbImg, ' ', CONSENT_IMAGE + ' This happens only after your payment is confirmed.'));
    var quoteBtn = h('button', { class: 'btn secondary block', type: 'submit', text: 'Calculate shipping and total' });
    var payBtn = h('button', { class: 'btn block', type: 'button', text: 'Pay securely with Square', hidden: true });
    form.appendChild(quoteBtn); form.appendChild(summary); form.appendChild(payBtn); form.appendChild(msg);
    holder.appendChild(form);
    holder.appendChild(h('p', { class: 'small muted', text: 'You pay on Square’s own page, so this app never sees your card number. Photos are printed and shipped by Printify and its partners. If something is wrong with an order, contact ' + (cat.config.supportEmail || 'the person who runs the shop') + '.' }));

    function readAddr() { var o = {}; Object.keys(F).forEach(function (k) { o[k] = F[k].inp.value; }); o.country = 'US'; return o; }
    function body() { return { familyId: X.S.familyId, designIds: designs.map(function (d) { return d.id; }), address: readAddr() }; }
    var quoted = null;
    form.addEventListener('input', function () { quoted = null; payBtn.hidden = true; clear(summary); });
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

  /* ================= ORDERS ================= */
  function orderLine(o) {
    return h('a', { class: 'order-row', href: '#/orders/' + o.id },
      h('div', null, h('strong', { text: money(o.totalCents) }), h('div', { class: 'small muted', text: new Date(o.createdAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) + ' · ' + o.items.map(function (i) { return i.quantity + ' × ' + i.title; }).join(', ') })),
      h('span', { class: 'badge tone-' + o.stage.tone, text: o.stage.label.split('.')[0] }));
  }
  async function viewOrders(main, token, id, sub) {
    if (id) return viewOrder(main, token, id, sub);
    main.appendChild(head('My orders', '#/shop', 'Photo Gifts'));
    main.appendChild(h('p', { class: 'small muted', text: 'Only you can see your orders. Your family cannot.' }));
    var holder = h('div', null, X.spinnerLine('Loading…')); main.appendChild(holder);
    try {
      var r = await shopApi('shopOrders'); if (token !== X.S.nav) return; clear(holder);
      if (!r.orders.length) holder.appendChild(h('div', { class: 'empty' }, h('p', { text: 'No orders yet.' }), h('a', { class: 'btn', href: '#/shop', text: 'Browse gifts' })));
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
      holder.appendChild(h('p', { class: 'small muted', text: 'Need to change or cancel a paid order? Production can start quickly, so ' + (support ? 'email ' + support : 'contact the shop owner') + ' as soon as possible. Refunds are decided by the shop owner.' }));
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
      imp.forEach(function (p) {
        var info = [p.enabled ? 'ON' : 'hidden', p.variantCount + ' variant' + (p.variantCount === 1 ? '' : 's'), p.variantCount ? (p.minCents === p.maxCents ? money(p.minCents) : money(p.minCents) + ' to ' + money(p.maxCents)) : '', 'Printify: ' + (p.visible ? 'published' : 'draft')].filter(Boolean).join(' · ');
        var sel = h('select', { 'aria-label': 'Section for ' + p.title, onchange: async function () { try { await shopApi('shopAdminToggle', { key: p.key, enabled: p.enabled, section: sel.value }); toast('Moved.'); await reload(); } catch (e) { toast(msgOf(e)); } } },
          SECTIONS.map(function (x) { return h('option', { value: x.id, text: x.title }); }));
        sel.value = p.section;
        var line = h('div', { class: 'admin-prod imported' },
          p.image ? h('img', { class: 'shop-thumb small', src: p.image, alt: '' }) : null,
          h('div', null, h('strong', { text: p.title }), h('div', { class: 'small muted', text: info }),
            p.missing ? h('div', { class: 'small danger-text', text: 'No longer in your Printify shop, so it is hidden.' }) : null,
            !p.supported ? h('div', { class: 'small danger-text', text: 'Cannot be sold through the photo editor: ' + p.reason }) : null,
            (p.notes || []).map(function (n) { return h('div', { class: 'small muted', text: n }); })));
        var btns2 = h('div', { class: 'row' });
        btns2.appendChild(h('button', { class: 'btn secondary small', type: 'button', text: p.enabled ? 'Hide from customers' : 'Show to customers', disabled: !p.supported || p.missing, onclick: async function () { try { await shopApi('shopAdminToggle', { key: p.key, enabled: !p.enabled }); await reload(); } catch (e) { toast(msgOf(e)); } } }));
        btns2.appendChild(sel);
        sc.appendChild(line); sc.appendChild(btns2);
      });
      holder.appendChild(sc);
      // products chosen by hand from Printify's blank-product catalog (older method)
      var pc = h('div', { class: 'card inner' }, h('h2', { text: 'Products from Printify’s blank-product catalog' }), h('p', { class: 'hint', text: 'Only needed if you want a product you have not made in Printify. Products from your own Printify store are above.' }));
      var lastSection = '';
      ov.products.slice().sort(function (x, y) { return SECTIONS.map(function (z) { return z.id; }).indexOf(x.section) - SECTIONS.map(function (z) { return z.id; }).indexOf(y.section); }).forEach(function (p) {
        if (p.section !== lastSection) { lastSection = p.section; pc.appendChild(h('h3', { class: 'shop-section', text: sectionTitle(p.section) })); }
        var row = h('div', { class: 'admin-prod' }, h('strong', { text: p.title }), h('span', { class: 'small muted', text: p.saved ? (p.enabled ? 'ON' : 'saved, OFF') + ' · ' + p.variantCount + ' variants · blueprint ' + p.blueprintId + ' / provider ' + p.providerId : 'not set up' }));
        var btns = h('div', { class: 'row' });
        btns.appendChild(h('button', { class: 'btn secondary small', type: 'button', text: p.saved ? 'Change' : 'Set up', onclick: function () { productWizard(p); } }));
        if (p.saved) btns.appendChild(h('button', { class: 'btn secondary small', type: 'button', text: p.enabled ? 'Turn off' : 'Turn on', onclick: async function () { try { await shopApi('shopAdminToggle', { key: p.key, enabled: !p.enabled }); await reload(); } catch (e) { toast(msgOf(e)); } } }));
        pc.appendChild(row); pc.appendChild(btns);
      });
      holder.appendChild(pc);
      // orders
      var oc = h('div', { class: 'card inner' }, h('h2', { text: 'Orders' }));
      if (!ov.orders.length) oc.appendChild(h('p', { class: 'muted', text: 'No orders yet.' }));
      ov.orders.forEach(function (o) {
        var line = h('div', { class: 'admin-order' }, h('div', null, h('strong', { text: money(o.totalCents) }), ' ', h('span', { class: 'badge', text: o.paymentStatus }), ' ', h('span', { class: 'badge', text: o.fulfillmentStatus })),
          h('div', { class: 'small muted', text: o.items.map(function (i) { return i.quantity + '× ' + i.title; }).join(', ') + ' · ' + new Date(o.createdAt).toLocaleString() }),
          o.lastError ? h('div', { class: 'small danger-text', text: o.lastError }) : null,
          h('div', { class: 'small muted', text: 'Paid with: ' + o.paymentProvider + (o.squarePaymentId ? ' · payment ' + o.squarePaymentId : '') + (o.oldStripeRef ? ' · Stripe ref ' + o.oldStripeRef + ' (refund in the Stripe dashboard)' : '') + (o.refundedCents ? ' · refunded ' + money(o.refundedCents) : '') }),
          o.printifyCostCents ? h('div', { class: 'small muted', text: 'Printify cost (items + shipping): ' + money(o.printifyCostCents) + ' · customer paid ' + money(o.subtotalCents + o.shippingCents) }) : null);
        var acts = h('div', { class: 'row' });
        function act(label, a) { acts.appendChild(h('button', { class: 'btn secondary small', type: 'button', text: label, onclick: async function () {
          if (a === 'approve' && !(await X.confirmDialog('Send to production?', 'Printify will charge your Printify payment method for this order and start making it. Check the order in Printify first.', 'Approve'))) return;
          if (a === 'cancel_printify' && !(await X.confirmDialog('Cancel at Printify?', 'This cancels the Printify order. It does NOT refund the customer. Refund in Square separately.', 'Cancel at Printify'))) return;
          try { await shopApi('shopAdminResolve', { orderId: o.id, act: a }); await reload(); } catch (e) { toast(msgOf(e)); } } })); }
        if (o.paymentProvider === 'square' && (o.paymentStatus === 'pending_payment' || o.paymentStatus === 'processing')) act('Check payment with Square', 'refresh');
        if (o.paymentProvider === 'square' && o.paymentStatus === 'paid') act('Check for refunds in Square', 'refresh');
        if (o.paymentStatus === 'paid') {
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
      if (a === 'cart') return viewCart(main, token);
      if (a === 'admin') return viewAdmin(main, token);
      return viewShop(main, token);
    };
    X.VIEWS.orders = viewOrders;
  }
  window.FCShop = { install: install, giftSettingDialog: function (p) { return giftSettingDialog(p); }, setGiftAfterPost: setGiftAfterPost };
})();
