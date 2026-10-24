// Aanbiedingen van de eigen websites van de winkels. Draait in Node 20+ (GitHub Actions), zonder afhankelijkheden.
//
// Per winkel één openbare aanbiedingenpagina, één keer per dag. Wat de winkel in robots.txt verbiedt, halen we niet op,
// en een blokkade (zoals bij Kruidvat) omzeilen we niet. Websites veranderen soms: dan levert die winkel tijdelijk
// niets op en toont de app dat per winkel.
//
// Elke parser zet de gegevens die al in de pagina staan (als JSON voor de website zelf) om naar ons formaat:
// { id, store, title, brand, size, price, was, mechanism, validFrom, validTo, source, url }  (bedragen in centen)

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

export const STORE_PAGES = {
  jumbo: 'https://www.jumbo.com/aanbiedingen/nu',
  dirk: 'https://www.dirk.nl/aanbiedingen',
  hoogvliet: 'https://www.hoogvliet.com/aanbiedingen',
  action: 'https://www.action.com/nl-nl/weekactie/',
  lidl: 'https://www.lidl.nl/c/aanbiedingen/a10008785',
  kruidvat: 'https://www.kruidvat.nl/acties',
};

const cents = (v) => {
  const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
};
const clean = (s) => (s == null ? null : String(s)
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').trim() || null);
const day = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(+d) ? null : d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' });
};
const euroText = (c) => (c / 100).toFixed(2).replace('.', ',');

function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

function finish(store, list) {
  const seen = new Set();
  const out = [];
  for (const o of list) {
    if (!o || !o.title) continue;
    const title = clean(o.title);
    const key = `${title}|${o.size || ''}|${o.price ?? ''}|${o.mechanism || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: `${store}:${o.ref || hash(key)}`, store, title, brand: clean(o.brand), size: clean(o.size),
      price: o.price ?? null, was: o.was && o.price && o.was > o.price ? o.was : null,
      mechanism: clean(o.mechanism), validFrom: o.validFrom || null, validTo: o.validTo || null, source: store, url: o.url || null, image: o.image || null,
    });
  }
  return out;
}

// ---------- Nuxt (Jumbo, Dirk): __NUXT_DATA__ is in "devalue"-formaat ----------

export function devalue(arr) {
  const cache = new Map();
  const WRAP = new Set(['Reactive', 'ShallowReactive', 'Ref', 'ShallowRef', 'EmptyRef', 'EmptyShallowRef', 'NuxtError']);
  const get = (i) => {
    if (typeof i !== 'number' || i < 0) return i === -2 ? null : undefined;
    if (cache.has(i)) return cache.get(i);
    const v = arr[i];
    if (v === null || typeof v !== 'object') { cache.set(i, v); return v; }
    if (Array.isArray(v)) {
      if (typeof v[0] === 'string' && WRAP.has(v[0])) { const r = v.length > 1 ? get(v[1]) : undefined; cache.set(i, r); return r; }
      if (v[0] === 'Date') { cache.set(i, v[1]); return v[1]; }
      if (v[0] === 'Set') { const out = []; cache.set(i, out); for (const x of v.slice(1)) out.push(get(x)); return out; }
      if (v[0] === 'Map') { const out = {}; cache.set(i, out); for (let k = 1; k < v.length; k += 2) out[get(v[k])] = get(v[k + 1]); return out; }
      if (v[0] === 'null') { const out = {}; cache.set(i, out); for (let k = 1; k < v.length; k += 2) out[v[k]] = get(v[k + 1]); return out; }
      const out = []; cache.set(i, out); for (const x of v) out.push(get(x)); return out;
    }
    const out = {}; cache.set(i, out);
    for (const [k, x] of Object.entries(v)) out[k] = get(x);
    return out;
  };
  return get(0);
}

export function nuxtData(html) {
  const m = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('geen __NUXT_DATA__ in de pagina');
  return devalue(JSON.parse(m[1]));
}

/** Afbeeldingen van Dirk staan op hun bestandsserver (zoals de logo's in dezelfde pagina). */
export const DIRK_FILES = 'https://web-fileserver.dirk.nl/';
const dirkImage = (path) => (path ? DIRK_FILES + String(path).split('/').map(encodeURIComponent).join('/') : null);

/** Dirk: data["offers-currentOffers"][].currentOffers[] met offerPrice/normalPrice. */
export function parseDirk(html) {
  const d = nuxtData(html);
  const groups = d?.data?.['offers-currentOffers'];
  if (!Array.isArray(groups)) throw new Error('Dirk: lijst met aanbiedingen niet gevonden');
  const list = [];
  for (const g of groups) for (const o of g?.currentOffers || []) {
    const sign = clean(String(o.textPriceSign || '').replace(/_/g, ' '));
    const multi = sign && sign.match(/(\d+)\s*voor/i);
    const free = sign && sign.match(/\d+\s*\+\s*\d+(?:\s*gratis)?|\d+e\s*(?:gratis|halve prijs)/i);
    const base = {
      // Dirk zet lokale datums met een "Z" erachter (2026-10-25T23:59Z = zondag 25 okt): datumdeel overnemen.
      validFrom: String(o.startDate || '').slice(0, 10) || null, validTo: String(o.endDate || '').slice(0, 10) || null, url: 'https://www.dirk.nl/aanbiedingen',
    };
    const make = (ref, title, size, priceRaw, wasRaw, brand, image) => {
      const price = cents(priceRaw);
      const was = cents(wasRaw);
      return { ...base, ref, title, size, brand: brand || null,
        price: multi || free ? null : price, was: multi || free ? null : was,
        mechanism: multi && price ? `${multi[1]} voor ${euroText(price)}` : free ? free[0] : price ? `voor ${euroText(price)}` : null,
        image: dirkImage(image) };
    };
    const offerSize = String(o.packaging || '').replace(/OP=OP/gi, '').replace(/\.\s*$/, '').trim();
    // De actie zegt vaak alleen "Per pak"; de inhoud staat bij de producten ("300 g"). Elk product wordt dan een eigen regel,
    // met zijn eigen naam, inhoud en prijs (bij "Entrecote of ribeye" verschillen die).
    const prods = (o.products || []).filter((p) => p?.productInformation);
    const hasSize = (t) => /\d\s*(g|gr|gram|kg|kilo|ml|cl|l|liter|stuks?)\b/i.test(t || '');
    // Alleen als de productprijzen gelijk zijn aan de actieprijs; anders is niet duidelijk welke prijs bij welke inhoud hoort.
    const samePrice = prods.every((p) => p.offerPrice == null || Math.abs(p.offerPrice - o.offerPrice) < 0.015);
    if (prods.length && samePrice && !hasSize(offerSize) && prods.some((p) => hasSize(p.productInformation.packaging))) {
      for (const p of prods) {
        const pi = p.productInformation;
        list.push(make(`${o.offerId}-${p.productId}`, pi.headerText || o.headerText, pi.packaging || offerSize, p.offerPrice ?? o.offerPrice, p.normalPrice ?? o.normalPrice, pi.brand, pi.image || o.image));
      }
    } else {
      list.push(make(o.offerId, o.headerText, offerSize, o.offerPrice, o.normalPrice, prods[0]?.productInformation?.brand, prods[0]?.productInformation?.image || o.image));
    }
  }
  return finish('dirk', list);
}

/** Jumbo: data.nuTab.activeTab.runtimes[].sections[] met promotions[] (titel + actielabel, geen oude prijs). */
export function parseJumbo(html) {
  const d = nuxtData(html);
  const runtimes = d?.data?.nuTab?.activeTab?.runtimes;
  if (!Array.isArray(runtimes)) throw new Error('Jumbo: lijst met aanbiedingen niet gevonden');
  const list = [];
  const add = (p) => {
    if (!p?.title || p.hidden || p.active === false) return;
    const label = (p.tags || []).map((t) => t?.text).filter(Boolean).join(' · ');
    if (/alleen online/i.test(label)) return; // jullie doen de boodschappen in de winkel
    let price = null; let size = clean(String(p.subtitle || '').replace(/<br\s*\/?>/gi, ' · ').replace(/<[^>]+>/g, ' '));
    let m;
    if ((m = label.match(/^(?:voor\s*)?(\d+[.,]\d{2})\s*per\s*([\d.,]+\s*)?(g|gram|kg|kilo|ml|l|liter|stuks?)\b/i))) { price = cents(m[1]); size = `${(m[2] || '1 ').trim()} ${m[3]}`; }
    else if ((m = label.match(/^(?:voor\s*)?(\d+[.,]\d{2})(?!\s*(?:per|korting|euro|%))(?![\d])/i))) price = cents(m[1]);
    list.push({
      ref: p.id, title: p.title, size, brand: null,
      price, was: null, mechanism: label || null,
      validFrom: day(p.start?.iso), validTo: day(p.end?.iso), url: p.url ? `https://www.jumbo.com${encodeURI(p.url)}` : null, image: p.image || null,
    });
  };
  for (const r of runtimes) for (const s of r?.sections || []) {
    for (const p of s?.promotions || []) add(p);
    for (const c of s?.categories || []) for (const p of c?.promotions || []) add(p);
  }
  return finish('jumbo', list);
}

// ---------- Next.js (Hoogvliet): __NEXT_DATA__ ----------

/** Hoogvliet: props.pageProps.promotionPeriods[].groups[].items[]. */
export function parseHoogvliet(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('Hoogvliet: geen __NEXT_DATA__ in de pagina');
  const periods = JSON.parse(m[1])?.props?.pageProps?.promotionPeriods;
  if (!Array.isArray(periods)) throw new Error('Hoogvliet: lijst met aanbiedingen niet gevonden');
  const list = [];
  for (const per of periods) for (const g of per?.groups || []) for (const it of g?.items || []) {
    const meta = it.promotion_meta_data || {};
    const type = String(meta.actietype || '').toLowerCase();
    // Geen korting: "vast laag" (gewone lage prijs), alleen-online-acties en "gratis bezorging".
    const top = clean(it.discount_label_top || meta.raw_discount_label?.text || '');
    if (/vast laag|online only|gratis bezorg/.test(type) || /gratis bezorg/i.test(top || '') || it.is_promotion_online_only) continue;
    const bottom = it.discount_label_bottom ?? meta.raw_discount_label?.price ?? null;
    const mp = it.price_range?.minimum_price || {};
    const regular = cents(mp.regular_price?.value);
    let price = null; let was = null; let mechanism = null; let size = null;
    if (top && /^per\b/i.test(top)) {
      price = cents(bottom ?? meta.promotie_prijs);
      was = regular && price && regular > price ? regular : null;
      size = top.replace(/^per\s+/i, '');
      if (/^(stuk|pak|zak|doos|fles|bak|beker|pakje|tube|kuipje|blik|pot|bos|net|schaal|set)$/i.test(size)) size = null;
      mechanism = price ? `voor ${euroText(price)}` : null;
    } else if (top && /voor$/i.test(top) && bottom != null) {
      mechanism = `${top} ${euroText(cents(bottom))}`; // "2 voor 3,99"
    } else if (top) {
      mechanism = top; // "1 + 1 Gratis", "2e halve prijs", "25% korting"
    }
    if (!price && !mechanism) continue;
    // Inhoud uit de productgegevens ("500 Gram") als het actielabel die niet noemt, alleen bij één product (geen "A of B").
    const attr = it.sub_title_attributes;
    const single = !it.is_promotion_group || (it.enabled_child_skus || it.child_skus || []).length <= 1;
    if (!size && single && attr?.volume && attr.unit) {
      const v = String(attr.volume).replace('.', ',');
      size = /^stuk/i.test(attr.unit) ? (+attr.volume > 1 ? `${v} stuks` : null) : `${v} ${attr.unit.toLowerCase()}`;
    }
    // Groepsacties: de inhoud staat in de omschrijving ("Fles van 1 liter", "Pak met 16 of 24 rollen").
    // Alleen als die over hetzelfde gaat als de prijs: "per pak" met "Fles van 1 liter" is een pak flessen (aantal onbekend).
    const desc = clean(meta.promotie_beschrijving || '') || '';
    const perWord = (String(top || '').match(/^per\s+(\S+)/i) || [])[1]?.toLowerCase();
    const descWord = (desc.match(/^\S+/) || [''])[0].toLowerCase();
    const sameThing = !perWord || descWord.startsWith(perWord) || perWord.startsWith(descWord);
    if (!size && sameThing && /\d\s*(liter|ltr|l|ml|cl|gram|gr|g|kg|kilo|rollen|rol|stuks|wasbeurten|tabletten|capsules)\b/i.test(desc)) size = desc;
    list.push({
      ref: it.sku, title: it.display_name || it.name, size, brand: null, price, was, mechanism,
      validFrom: day(String(meta.valid_from || per.validFrom || '').replace(' ', 'T').replace(/\+00$/, 'Z')),
      validTo: day(String(meta.valid_to || per.validTo || '').replace(' ', 'T').replace(/\+00$/, 'Z')),
      url: it.product_link || it.first_child_product_link ? `https://www.hoogvliet.com${it.product_link || it.first_child_product_link}` : 'https://www.hoogvliet.com/aanbiedingen',
      image: it.thumbnail?.url || null,
    });
  }
  return finish('hoogvliet', list);
}

// ---------- Next.js app router (Action): RSC-"flight"-gegevens in self.__next_f ----------

function balancedJson(s, i) {
  let depth = 0; let inStr = false;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (inStr) { if (c === '\\') j++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) return s.slice(i, j + 1); }
  }
  return null;
}

/** Action: alle "product"-objecten met isDeal (de weekactie). */
export function parseAction(html) {
  const flight = [...html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)].map((m) => JSON.parse(`"${m[1]}"`)).join('');
  if (!flight) throw new Error('Action: geen productgegevens in de pagina');
  const products = new Map();
  let i = 0;
  while ((i = flight.indexOf('"product":{"id":', i)) >= 0) {
    const js = balancedJson(flight, i + 10);
    i += 10;
    try { const p = JSON.parse(js); products.set(p.id, p); } catch { /* onvolledig object */ }
  }
  const list = [];
  for (const p of products.values()) {
    if (!p.isDeal) continue;
    const sticker = (p.stickers || []).find((s) => s.code === 'IS_DEAL');
    const range = sticker?.subValue?.match(/(\d{1,2})-(\d{1,2})\s*t\/m\s*(\d{1,2})-(\d{1,2})/);
    const year = new Date().getFullYear();
    const iso = (d, m) => `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const price = cents(p.price?.current?.amount);
    list.push({
      ref: p.id, title: p.title, brand: p.brand, size: String(p.description || '').split('|')[0],
      price, was: cents(p.price?.original?.amount), mechanism: price ? `voor ${euroText(price)}` : null,
      validFrom: range ? iso(range[1], range[2]) : null, validTo: range ? iso(range[3], range[4]) : null, url: p.href || null,
      image: p.image ? `${p.image}`.replace('/image/upload/', '/image/upload/w_240/') : null,
    });
  }
  return finish('action', list);
}

// ---------- Lidl: data-grid-data-attributen met JSON per product ----------

const unescapeAttr = (s) => s.replace(/&quot;|&#34;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

export function parseLidl(html) {
  const items = [...html.matchAll(/data-grid-data="([^"]*)"/g)].map((m) => { try { return JSON.parse(unescapeAttr(m[1])); } catch { return null; } }).filter(Boolean);
  if (!items.length) throw new Error('Lidl: geen producten in de pagina');
  const list = [];
  for (const it of items) {
    const region = it.regionsPrices ? Object.values(it.regionsPrices)[0] : null;
    const plus = region?.currentLidlPlusPrice;
    // currentPrice ís het prijsobject; bij Lidl Plus zit het een laag dieper.
    const pr = region?.currentPrice || plus?.price;
    if (!pr) continue;
    const price = cents(pr.price);
    if (!price) continue;
    const was = cents(pr.oldPrice ?? pr.discount?.deletedPrice);
    const brand = it.brand?.showBrand ? it.brand.name : null;
    list.push({
      ref: it.productId, title: it.fullTitle || it.title, brand: brand && brand !== 'DUMMYMARKE' ? brand : null, size: pr.packaging?.text,
      price, was, mechanism: plus ? `met Lidl Plus: ${euroText(price)}` : `voor ${euroText(price)}`,
      validFrom: it.storeStartDate ? day(it.storeStartDate * 1000) : day(pr.startDate),
      validTo: it.storeEndDate ? day(it.storeEndDate * 1000) : day(pr.endDate),
      url: it.canonicalUrl ? `https://www.lidl.nl${it.canonicalUrl}` : null,
      image: it.image || null,
    });
  }
  return finish('lidl', list);
}

export const PARSERS = { jumbo: parseJumbo, dirk: parseDirk, hoogvliet: parseHoogvliet, action: parseAction, lidl: parseLidl };

// ---------- robots.txt ----------

/** Mag dit pad volgens robots.txt (regels voor "*")? Eenvoudige, gangbare interpretatie: langste regel wint. */
export function robotsAllows(robots, path) {
  const rules = [];
  let applies = false; let inGroup = false;
  for (const raw of String(robots || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const k = m[1].toLowerCase(); const v = m[2].trim();
    if (k === 'user-agent') { if (!inGroup) applies = false; inGroup = true; if (v === '*') applies = true; continue; }
    inGroup = false;
    if (!applies || (k !== 'allow' && k !== 'disallow') || !v) continue;
    rules.push({ allow: k === 'allow', re: new RegExp('^' + v.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$')), len: v.length });
  }
  const hits = rules.filter((r) => r.re.test(path)).sort((a, b) => b.len - a.len || b.allow - a.allow);
  return hits.length ? hits[0].allow : true;
}

/** Haalt de aanbiedingen van één winkel op. */
export async function fetchStore(fetchImpl = fetch, store, { log = () => {} } = {}) {
  const url = STORE_PAGES[store];
  if (!url) throw new Error('geen bron voor deze winkel');
  const u = new URL(url);
  const headers = { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*', 'Accept-Language': 'nl-NL,nl;q=0.9' };
  try {
    const rr = await fetchImpl(`${u.origin}/robots.txt`, { headers });
    if (rr.ok && !robotsAllows(await rr.text(), u.pathname)) throw new Error('robots.txt staat het ophalen van deze pagina niet toe');
  } catch (e) {
    if (/robots\.txt staat/.test(e.message)) throw e; // robots.txt onbereikbaar: gangbaar is dan doorgaan
  }
  const r = await fetchImpl(url, { headers, redirect: 'follow' });
  if (r.status === 403 || r.status === 429) throw new Error(`de website weigert automatische toegang (${r.status}); niet omzeild`);
  if (!r.ok) throw new Error(`${r.status} bij ${url}`);
  const html = await r.text();
  if (/captcha|challenge-platform|awsWafIntegration|Access Denied/i.test(html.slice(0, 5000)) && html.length < 20000) {
    throw new Error('de website toont een anti-botcontrole; niet omzeild');
  }
  const parse = PARSERS[store];
  if (!parse) throw new Error('nog geen verwerking voor deze winkel');
  const offers = parse(html);
  log(`${store}: ${offers.length} aanbiedingen`);
  return { offers, html };
}
