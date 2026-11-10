/*
 * Turns a product from the merchant's own Printify shop (GET /v1/shops/{shop_id}/products.json) into a FamilyCircle catalog row.
 * Pure functions only, so they can be tested without Printify.
 *
 * What is copied from Printify: title, description, product id, blueprint id, print provider id, the enabled variants with their
 * selling prices, the product picture, the print area and its size. What is NOT copied: the template artwork on the product
 * (each buyer's own photo is sent with their order instead) and anything that would change the product in Printify.
 */

export const IMPORT_PREFIX = 'pf_';
const ID_RE = /^[A-Za-z0-9]{8,30}$/;
export const MAX_VARIANT_JSON = 15000;

export const importedKey = (printifyId) => (ID_RE.test(String(printifyId || '')) ? IMPORT_PREFIX + printifyId : '');
export const isImportedKey = (key) => /^pf_[A-Za-z0-9]{8,30}$/.test(String(key || ''));

const clean = (s, n) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().slice(0, n);

/** Product pictures must come from Printify over https. Anything else is dropped. */
export function safeImage(src) {
  try {
    const u = new URL(String(src || ''));
    return u.protocol === 'https:' && (u.hostname === 'printify.com' || u.hostname.endsWith('.printify.com')) ? u.href : '';
  } catch { return ''; }
}

export function pickImage(product) {
  const imgs = Array.isArray(product.images) ? product.images : [];
  const first = imgs.find((i) => i && i.is_default && safeImage(i.src)) || imgs.find((i) => i && safeImage(i.src));
  return first ? safeImage(first.src) : '';
}

/** The shop sections, in the order customers see them. A product is placed by words in its title or its Printify blank-product name. */
export const SECTION_IDS = ['wall-art', 'drinkware', 'home', 'jewelry', 'apparel', 'gifts'];
const RULES = [
  ['jewelry', /necklace|bracelet|pendant|earring|jewel|charm|\bring\b|anklet|locket/i],
  ['drinkware', /\bmugs?\b|\bcups?\b|tumbler|bottle|flask|glassware|drinkware|\bstein\b/i],
  ['wall-art', /poster|canvas|framed|\bframes?\b|\bprints?\b|\bwall\b|\bart\b|tapestry|plaque|metal print/i],
  ['apparel', /t-?shirt|\btees?\b|hoodie|sweatshirt|apparel|\btote\b|\bbags?\b|\bhats?\b|\bcaps?\b|\bsocks?\b|leggings|\bshirts?\b/i],
  ['home', /blanket|pillow|cushion|puzzle|magnet|ornament|coaster|mouse ?pad|towel|candle|\brug\b|sticker|key ?chain|phone case|notebook|journal|clock|\bmat\b|puzzle/i]
];
export function guessSection(...texts) {
  const t = texts.join(' ');
  for (const [id, re] of RULES) if (re.test(t)) return id;
  return 'gifts';
}
export const cleanSection = (x) => (SECTION_IDS.includes(x) ? x : 'gifts');

/** Printify gives each variant a list of option value ids. Turn them into { Size: "11oz", Color: "White" } for the shop chips. */
function optionMap(product, variant) {
  const out = {};
  const ids = Array.isArray(variant.options) ? variant.options : [];
  for (const opt of Array.isArray(product.options) ? product.options : []) {
    const hit = (opt.values || []).find((v) => ids.includes(v.id));
    if (hit && opt.name) out[String(opt.name).slice(0, 30)] = String(hit.title || '').slice(0, 40);
  }
  return out;
}

/**
 * product: one entry from the products list. catalog: the catalog variants response for the same blueprint and provider
 * (needed because the shop product does not state the print area's pixel size). blueprintTitle: optional, used for the section guess.
 * Returns everything needed to store a row, plus support = { ok, reason } telling the owner whether the photo editor can fill it.
 */
export function planImport(product, catalog, blueprintTitle = '') {
  const notes = [];
  const key = importedKey(product && product.id);
  const base = {
    key, printifyId: product && product.id, title: clean(product && product.title, 80) || 'Untitled product',
    blurb: clean(product && product.description, 300), blueprintId: Number(product && product.blueprint_id) || 0, providerId: Number(product && product.print_provider_id) || 0,
    position: '-', variants: [], image: pickImage(product || {}), visible: !!(product && product.visible),
    section: guessSection(blueprintTitle, product && product.title), notes
  };
  const fail = (reason) => ({ ...base, support: { ok: false, reason } });
  if (!key) return fail('Printify gave this product an ID the shop cannot store.');
  if (!base.blueprintId || !base.providerId) return fail('Printify did not say which blank product or print provider this uses.');

  // One print area only: the buyer's photo goes on it. Products printed on several areas (front and back) are flagged, never half-filled.
  const positions = [];
  for (const area of Array.isArray(product.print_areas) ? product.print_areas : []) {
    for (const ph of area.placeholders || []) if (ph && ph.position && !positions.includes(ph.position)) positions.push(ph.position);
  }
  if (!positions.length) return fail('This product has no print area in Printify yet. Open it in Printify, add a design and save.');
  if (positions.length > 1) return fail(`This product prints on ${positions.length} areas (${positions.join(', ')}). The photo editor fills one area only.`);
  const position = positions[0];

  const enabled = (Array.isArray(product.variants) ? product.variants : []).filter((v) => v && v.is_enabled === true);
  if (!enabled.length) return fail('No variants are switched on in Printify. Enable at least one size or style there.');

  const live = new Map(((catalog && catalog.variants) || []).map((v) => [v.id, v]));
  const variants = [];
  for (const v of enabled) {
    const id = Number(v.id);
    if (v.is_available === false) { notes.push(`"${clean(v.title, 40)}" is switched on but Printify says it is currently unavailable, so it is left out.`); continue; }
    const cat = live.get(id);
    const ph = cat && (cat.placeholders || []).find((p) => p.position === position);
    if (!ph || !ph.width || !ph.height) { notes.push(`"${clean(v.title, 40)}": Printify's catalog gave no size for the "${position}" print area, so it is left out.`); continue; }
    const price = Number(v.price);
    if (!Number.isInteger(price) || price < 100 || price > 100000) { notes.push(`"${clean(v.title, 40)}" has a price of ${v.price} cents in Printify (allowed here: 100 to 100000), so it is left out.`); continue; }
    let options = optionMap(product, v);
    if (!Object.keys(options).length) options = (cat && cat.options) || {};
    variants.push({ id, label: clean(v.title, 80), options, priceCents: price, width: ph.width, height: ph.height });
  }
  if (!variants.length) return { ...base, position, support: { ok: false, reason: 'None of the enabled variants could be used (see notes).' } };
  if (JSON.stringify(variants).length > MAX_VARIANT_JSON) return { ...base, position, support: { ok: false, reason: `Too many variants (${variants.length}) to store. Switch some off in Printify and sync again.` } };
  return { ...base, position, variants, support: { ok: true, reason: '' } };
}

/** Packs the variants and the small amount of sync information into the existing text column, so no new database column is needed. */
export function packVariants(plan, extra = {}) {
  return JSON.stringify({
    v: plan.variants,
    m: {
      pid: plan.printifyId, image: plan.image, visible: plan.visible, section: plan.section, sectionLocal: !!extra.sectionLocal, shopId: extra.shopId || '',
      ok: plan.support.ok, reason: plan.support.reason, notes: plan.notes.slice(0, 6), syncedAt: extra.syncedAt || '', missing: false
    }
  });
}

export function unpack(text) {
  try {
    const j = JSON.parse(text || '[]');
    if (Array.isArray(j)) return { variants: j, meta: null };
    return { variants: Array.isArray(j.v) ? j.v : [], meta: j.m && typeof j.m === 'object' ? j.m : null };
  } catch { return { variants: [], meta: null }; }
}

/** The owner-facing explanation for a failed Printify call. */
export function explainPrintifyFailure(e, what = 'Printify') {
  const status = e && e.status;
  const body = e && e.body ? ` Printify said: ${String(e.body.message || e.body.error || JSON.stringify(e.body)).slice(0, 160)}` : '';
  if (status === 401) return { code: 'bad_token', message: `Printify did not accept the token (401). The token may be wrong, expired or revoked. Make a new one and update PRINTIFY_API_TOKEN.${body}` };
  if (status === 403) return { code: 'missing_permission', message: `Printify accepted the token but refused this request (403). The token is missing a permission needed to read ${what}. Make a new token with all permissions ticked and update PRINTIFY_API_TOKEN.${body}` };
  if (status === 404) return { code: 'not_found', message: `Printify could not find ${what} (404). This usually means the shop ID is not one of the shops on this token's account.${body}` };
  if (status === 429) return { code: 'rate_limited', message: 'Printify says too many requests were made (429). Wait a minute and try again.' };
  if (status >= 500) return { code: 'api_failure', message: `Printify had a problem on its side (${status}). Try again in a few minutes.${body}` };
  if (status) return { code: 'api_error', message: `Printify refused the request (${status}).${body}` };
  return { code: 'api_failure', message: 'The shop could not reach Printify just now. Try again in a minute.' };
}
