// Bronnen voor wekelijkse aanbiedingen. Draait in Node 20+ (GitHub Actions), zonder afhankelijkheden.
//
// LET OP: beide bronnen zijn onofficieel en kunnen zonder aankondiging veranderen.
//  - Albert Heijn: de (niet-gedocumenteerde) API achter de AH-app, met een anoniem token.
//    Endpoints zoals gebruikt door het open-sourceproject github.com/gwillem/appie-go.
//  - Andere winkels: de winkelpagina's van Folderz.nl (HTML).
// Er worden alleen openbare aanbiedingen opgehaald; er gaan geen gegevens van jullie naartoe.

export const AH = {
  base: 'https://api.ah.nl',
  headers: {
    'User-Agent': 'Appie/9.28 (iPhone17,3; iPhone; CPU OS 26_1 like Mac OS X)',
    'x-client-name': 'appie-ios',
    'x-client-version': '9.28',
    'x-application': 'AHWEBSHOP',
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
};

const cents = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null);

function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

/** Kleinste afbeelding van minstens 200 px breed (AH levert meerdere formaten). */
function ahImage(images) {
  const list = (Array.isArray(images) ? images : []).filter((i) => i?.url);
  if (!list.length) return null;
  const ok = list.filter((i) => (i.width || 0) >= 200).sort((a, b) => (a.width || 0) - (b.width || 0));
  return (ok[0] || list[list.length - 1]).url;
}

/** Zet één product uit de AH-bonus-API om naar ons aanbiedingsformaat. */
export function ahProductToOffer(p, { mechanism = null, period = {} } = {}) {
  if (!p || !p.title) return null;
  const m = p.bonusMechanism || mechanism || null;
  return {
    id: `ah:${p.webshopId || hash(p.title + m)}`,
    store: 'ah',
    title: p.title,
    brand: p.brand || null,
    size: p.salesUnitSize || null,
    price: cents(p.currentPrice),
    was: cents(p.priceBeforeBonus),
    mechanism: m,
    validFrom: period.start || null,
    validTo: period.end || null,
    source: 'ah',
    url: p.webshopId ? `https://www.ah.nl/producten/product/wi${p.webshopId}` : 'https://www.ah.nl/bonus',
    image: ahImage(p.images),
  };
}

/** Verwerkt een AH-bonussectie (lijst met producten en bonusgroepen). */
export function parseAhSection(json, period) {
  const out = [];
  for (const item of json?.bonusGroupOrProducts || []) {
    if (item.product) out.push(ahProductToOffer(item.product, { period }));
    const g = item.bonusGroup;
    if (g) {
      if (g.products?.length) {
        for (const p of g.products) out.push(ahProductToOffer(p, { mechanism: g.discountDescription, period }));
      } else {
        out.push({
          id: `ah:g${g.id || hash(g.segmentDescription)}`, store: 'ah', title: g.segmentDescription, brand: null, size: null,
          price: cents(g.exampleForPrice), was: cents(g.exampleFromPrice), mechanism: g.discountDescription || null,
          validFrom: period.start || null, validTo: period.end || null, source: 'ah', group: true, url: 'https://www.ah.nl/bonus', image: ahImage(g.images),
        });
      }
    }
  }
  return out.filter(Boolean);
}

async function getJson(fetchImpl, url, opts = {}) {
  const r = await fetchImpl(url, opts);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText || ''} bij ${url.replace(/\?.*$/, '')}`.trim());
  return r.json();
}

/** Haalt alle landelijke AH-bonusaanbiedingen van deze week op. */
export async function fetchAh(fetchImpl = fetch, { today = new Date().toISOString().slice(0, 10), log = () => {} } = {}) {
  const tok = await getJson(fetchImpl, `${AH.base}/mobile-auth/v1/auth/token/anonymous`, {
    method: 'POST', headers: AH.headers, body: JSON.stringify({ clientId: 'appie-ios' }),
  });
  if (!tok?.access_token) throw new Error('Geen anoniem token ontvangen van AH.');
  const headers = { ...AH.headers, Authorization: `Bearer ${tok.access_token}` };
  const meta = await getJson(fetchImpl, `${AH.base}/mobile-services/bonuspage/v3/metadata`, { headers });
  const current = meta?.periods?.[0];
  if (!current) throw new Error('Geen bonusperiode gevonden.');
  const period = { start: current.bonusStartDate, end: current.bonusEndDate };
  const categories = [];
  for (const tab of current.tabs || []) for (const u of tab.urlMetadataList || []) if (u.bonusType === 'NATIONAL' && u.description) categories.push(u.description);
  log(`AH: bonusweek ${period.start} t/m ${period.end}, ${categories.length} categorieën`);
  const offers = [];
  for (const category of [...new Set(categories)]) {
    const qs = new URLSearchParams({ application: 'AHWEBSHOP', date: today, promotionType: 'NATIONAL', category });
    try {
      const sec = await getJson(fetchImpl, `${AH.base}/mobile-services/bonuspage/v2/section?${qs}`, { headers });
      offers.push(...parseAhSection(sec, period));
    } catch (e) {
      log(`AH: categorie "${category}" mislukt: ${e.message}`);
    }
  }
  const seen = new Set();
  return { period, offers: offers.filter((o) => (seen.has(o.id) ? false : seen.add(o.id))) };
}

// ---------------- Folderz ----------------

export const FOLDERZ_STORES = {
  lidl: ['lidl'],
  hoogvliet: ['hoogvliet'],
  jumbo: ['jumbo'],
  dirk: ['dirk', 'dirk-van-den-broek'],
  plus: ['plus'],
  aldi: ['aldi'],
  action: ['action'],
  wibra: ['wibra'],
  kruidvat: ['kruidvat'],
  etos: ['etos'],
  ah: ['albert-heijn'], // alleen als terugval als de AH-API niet werkt
};

const decode = (s) => String(s || '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n))
  .replace(/\s+/g, ' ').trim();

const euroCents = (s) => {
  const m = String(s || '').replace(/\s/g, '').match(/(\d{1,4})[.,](\d{2})/) || String(s || '').match(/€\s*(\d{1,4})(?![\d.,])/);
  if (!m) return null;
  return m[2] != null ? +m[1] * 100 + +m[2] : +m[1] * 100;
};

function validity(text, today) {
  const t = String(text || '').toLowerCase();
  let days = null;
  let m;
  if ((m = t.match(/(\d+)\s*dag/))) days = +m[1];
  else if ((m = t.match(/(\d+)\s*we(e)?k/))) days = +m[1] * 7;
  else if (/vandaag/.test(t)) days = 0;
  else if (/morgen/.test(t)) days = 1;
  if (days == null) {
    const d = t.match(/(\d{1,2})[-/](\d{1,2})(?:[-/](\d{2,4}))?\s*$/) || t.match(/t\/m\s*\w*\s*(\d{1,2})[-/](\d{1,2})/);
    if (d) {
      const y = d[3] ? (d[3].length === 2 ? 2000 + +d[3] : +d[3]) : +today.slice(0, 4);
      return `${y}-${String(d[2]).padStart(2, '0')}-${String(d[1]).padStart(2, '0')}`;
    }
    return null;
  }
  const dt = new Date(today + 'T12:00:00Z');
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Zoekt in willekeurige JSON naar objecten die op een aanbieding lijken. */
function collectFromJson(node, out, depth = 0) {
  if (!node || depth > 12) return;
  if (Array.isArray(node)) { for (const x of node) collectFromJson(x, out, depth + 1); return; }
  if (typeof node !== 'object') return;
  const name = node.name || node.title || node.productName;
  const offers = node.offers && (Array.isArray(node.offers) ? node.offers[0] : node.offers);
  const price = node.offerPrice ?? node.price ?? node.salePrice ?? node.discountPrice ?? offers?.price ?? offers?.lowPrice;
  const was = node.originalPrice ?? node.normalPrice ?? node.regularPrice ?? node.oldPrice ?? offers?.highPrice ?? null;
  if (typeof name === 'string' && name.length > 2 && price != null && !Number.isNaN(parseFloat(price))) {
    out.push({
      title: decode(name), price: Math.round(parseFloat(price) * 100), was: was != null && !Number.isNaN(parseFloat(was)) ? Math.round(parseFloat(was) * 100) : null,
      mechanism: node.label || node.badge || node.discountLabel || node.promotion || node.promotionText || null,
      validTo: (node.validThrough || offers?.priceValidUntil || node.endDate || node.validUntil || '').slice(0, 10) || null,
      size: node.size || node.unitSize || node.weight || null,
    });
    return;
  }
  for (const v of Object.values(node)) if (v && typeof v === 'object') collectFromJson(v, out, depth + 1);
}

/**
 * Leest aanbiedingen uit een Folderz-winkelpagina. Drie methoden, in volgorde:
 *  1. JSON-LD (schema.org) of __NEXT_DATA__/ingesloten JSON
 *  2. HTML-blokken met klassen als product__name / product__price-offer (zoals in eerdere Folderz-versies)
 * @returns {{ offers: object[], method: string }}
 */
export function parseFolderz(html, store, today) {
  const found = [];
  let method = 'geen';
  // 1. ingesloten JSON
  const scripts = [...html.matchAll(/<script[^>]*type="application\/(?:ld\+json|json)"[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  for (const s of scripts) {
    try { collectFromJson(JSON.parse(s), found); } catch { /* geen geldige JSON */ }
  }
  if (found.length) method = 'json';
  // 2. HTML-blokken
  if (!found.length) {
    // Splitsen op elementen waarvan een hele klassenaam "product", "offer-card" e.d. is (niet "product__name").
    const blocks = html.split(/<(?:div|article|a|li)[^>]*class="(?:[^"]*\s)?(?:product|offer|aanbieding|product-card|offer-card|product-tile|offer-tile|product-item|offer-item)(?:\s[^"]*)?"/i).slice(1);
    for (const b of blocks) {
      const chunk = b.slice(0, 4000);
      const name = chunk.match(/class="[^"]*(?:product__name|product-name|offer__title|product__title|title)[^"]*"[^>]*>([\s\S]*?)<\//i);
      const offer = chunk.match(/class="[^"]*(?:price-offer|offer-price|price--offer|product__price-offer|new-price|price__new)[^"]*"[^>]*>([\s\S]*?)<\//i);
      const normal = chunk.match(/class="[^"]*(?:price-normal|old-price|price--old|product__price-normal|price__old|regular-price)[^"]*"[^>]*>([\s\S]*?)<\//i);
      const badge = chunk.match(/class="[^"]*(?:badge|label|promo)[^"]*"[^>]*>([\s\S]*?)<\//i);
      const date = chunk.match(/class="[^"]*(?:product-date|valid|date|expire)[^"]*"[^>]*>([\s\S]*?)<\//i);
      const title = name && decode(name[1]);
      const price = offer && euroCents(decode(offer[1]));
      if (title && price) {
        found.push({ title, price, was: normal ? euroCents(decode(normal[1])) : null, mechanism: badge ? decode(badge[1]) || null : null, validText: date ? decode(date[1]) : null });
      }
    }
    if (found.length) method = 'html';
  }
  const seen = new Set();
  const offers = [];
  for (const f of found) {
    const title = f.title.replace(new RegExp(`^${store}\\s+`, 'i'), '').trim();
    const key = `${title}|${f.price}`;
    if (seen.has(key) || !title || !(f.price > 0)) continue;
    seen.add(key);
    offers.push({
      id: `${store}:${hash(key)}`, store, title, brand: null, size: f.size || null,
      price: f.price, was: f.was && f.was > f.price ? f.was : null, mechanism: f.mechanism || null,
      validFrom: today, validTo: f.validTo || (f.validText ? validity(f.validText, today) : null), source: 'folderz', url: null,
    });
  }
  return { offers, method };
}

export async function fetchFolderz(fetchImpl = fetch, store, { today, log = () => {}, keepHtml = false } = {}) {
  const slugs = FOLDERZ_STORES[store] || [store];
  let lastErr = null;
  for (const slug of slugs) {
    const url = `https://www.folderz.nl/winkels/${slug}/aanbiedingen`;
    try {
      const r = await fetchImpl(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Boodschappenbrein/1.0; +persoonlijk gebruik)', Accept: 'text/html' } });
      if (r.status === 404) { lastErr = new Error(`404 voor ${slug}`); continue; }
      if (!r.ok) throw new Error(`${r.status} voor ${slug}`);
      const html = await r.text();
      if (/awsWafIntegration|challenge-container|captcha/i.test(html)) throw new Error('Folderz blokkeert automatische toegang (anti-botcontrole); niet omzeild');
      const res = parseFolderz(html, store, today);
      log(`Folderz ${store}: ${res.offers.length} aanbiedingen (methode: ${res.method})`);
      return { ...res, slug, html: keepHtml || !res.offers.length ? html : null };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('onbekende fout');
}
