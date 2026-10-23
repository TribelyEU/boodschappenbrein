// Prijsvergelijking tussen supermarkten.
//
// Bron (koppelbaar): de open prijsdata van Checkjebon.nl (github.com/supermarkt/checkjebon, dagelijks bijgewerkt).
// Formaat: [{ n: winkel-id, c: weergavenaam, u: product-url-prefix, d: [{ n: naam, l: link, p: prijs, s: inhoud }] }]
// Deze bron bevat GEEN aanbiedingsinformatie en Aldi heeft er geen prijzen in. Dat tonen we eerlijk.
//
// Andere bronnen kunnen later worden toegevoegd via registerPriceSource(); ze moeten hetzelfde
// genormaliseerde formaat opleveren: { store, storeName, name, price (centen), size, url }.

import { parseSize, productTokens, unitPrice } from './products.js';
import { normalizeText } from './text.js';
import { guessCategory } from './categories.js';

export const PRICE_SOURCES = {
  checkjebon: {
    id: 'checkjebon',
    name: 'Checkjebon.nl open data',
    dataUrl: 'https://raw.githubusercontent.com/supermarkt/checkjebon/main/data/supermarkets.json',
    commitsUrl: 'https://api.github.com/repos/supermarkt/checkjebon/commits?path=data/supermarkets.json&per_page=1',
    infoUrl: 'https://github.com/supermarkt/checkjebon',
    notes: 'Gratis open data, dagelijks bijgewerkt door een vrijwilligersproject. Geen aanbiedingen, geen Aldi. Lidl via boodschaapje.nl.',
  },
};

const STORE_ALIASES = { ah: 'ah', jumbo: 'jumbo', lidl: 'lidl', aldi: 'aldi', dirk: 'dirk', plus: 'plus', hoogvliet: 'hoogvliet', vomar: 'vomar', dekamarkt: 'dekamarkt', spar: 'spar', poiesz: 'poiesz', ekoplaza: 'ekoplaza' };

/** Zet Checkjebon-JSON om naar genormaliseerde prijsregels. */
export function parseCheckjebon(json) {
  if (!Array.isArray(json)) throw new Error('Onverwacht formaat: verwacht een lijst met supermarkten.');
  const items = [];
  const stores = [];
  for (const s of json) {
    if (!s || typeof s.n !== 'string' || !Array.isArray(s.d)) continue;
    const store = STORE_ALIASES[s.n] || s.n;
    stores.push({ id: store, name: s.c || s.n, count: s.d.length });
    for (const p of s.d) {
      if (typeof p?.n !== 'string' || typeof p?.p !== 'number' || !(p.p > 0)) continue;
      const size = parseSize(p.s) || parseSize(p.n);
      items.push({
        store,
        name: p.n,
        price: Math.round(p.p * 100),
        sizeText: p.s || '',
        sizeAmount: size?.amount || null,
        sizeUnit: size?.unit || null,
        url: s.u && p.l ? s.u + p.l : null,
      });
    }
  }
  return { items, stores };
}

/** Bouwt een zoekindex (token -> itemindexen) voor snelle matching op tienduizenden producten. */
export function buildIndex(items) {
  const index = new Map();
  items.forEach((it, i) => {
    if (!it.tokens) it.tokens = productTokens(it.name);
    for (const t of it.tokens) {
      const k = t.slice(0, 4);
      if (!index.has(k)) index.set(k, []);
      index.get(k).push(i);
    }
  });
  return { items, index };
}

// Kwalificaties die een ander product maken als ze niet in de vraag staan.
const QUALIFIERS = ['vochtig', 'choco', 'mini', 'snack', 'drink', 'shak', 'smoothie', 'reep', 'koek', 'chips', 'gedroog', 'gezouten', 'biologisch', 'lactosevrij', 'lactofree', 'houdbar', 'light', 'zero', 'glutenvrij', 'vegan', 'kids', 'mini', 'baby', 'protein', 'proteine'];

// Een woord uit de zoekvraag past als het exact voorkomt, of als woordbegin van een langer woord
// ("melk" in "melkchocolade" niet, want dat is een ander product — daarom alleen voor afkortingen ≥ 5 tekens).
function tokenMatch(q, t) {
  if (q === t) return true;
  if (q.length >= 5 && t.startsWith(q) && t.length - q.length <= 3) return true; // halfvol -> halfvoll, banan -> banans
  return false;
}

/**
 * Zoekt kandidaten in de prijsdata voor een gezocht product.
 * Alle woorden uit de zoekterm moeten voorkomen. Extra woorden en ontbrekende kwalificaties verlagen de score.
 * @returns {{item, score, unitPrice}[]} gesorteerd: beste match, daarna laagste prijs per eenheid
 */
export function findCandidates(idx, query, { store = null, limit = 5, size = null } = {}) {
  const qTokens = productTokens(query);
  if (!qTokens.length) return [];
  const seed = idx.index.get(qTokens[0].slice(0, 4)) || [];
  const out = [];
  const qNorm = normalizeText(query);
  const qCat = guessCategory(query);
  for (const i of seed) {
    const it = idx.items[i];
    if (store && it.store !== store) continue;
    if (!qTokens.every((q) => it.tokens.some((t) => tokenMatch(q, t)))) continue;
    const extra = it.tokens.length - qTokens.length;
    let score = 1 - Math.min(0.6, extra * 0.15);
    if (extra === 0) score += 0.2; // precies het gezochte product (zonder merk/inhoud)
    for (const qual of QUALIFIERS) {
      const inItem = it.tokens.some((t) => t.includes(qual.slice(0, 6)));
      const inQuery = qNorm.includes(qual.slice(0, 6));
      if (inItem && !inQuery) score -= 0.25;
    }
    if (size && it.sizeUnit && size.unit !== it.sizeUnit) score -= 0.4;
    // Andere productcategorie (bv. "bananen" vs. Haribo-snoepbananen): sterk afwaarderen.
    if (qCat.confidence > 0) {
      if (!it.cat) it.cat = guessCategory(it.name);
      if (it.cat.confidence > 0 && it.cat.id !== qCat.id) score -= 0.5;
    }
    const up = unitPrice(it.price, it.sizeAmount ? { amount: it.sizeAmount, unit: it.sizeUnit } : null);
    out.push({ item: it, score, unitPrice: up, uncertain: score < 0.95 });
  }
  if (!out.length) return [];
  const best = Math.max(...out.map((c) => c.score));
  const top = out.filter((c) => c.score >= best - 0.1 && c.score > 0.3);
  // Prijs per eenheid alleen vergelijken binnen dezelfde eenheid (gram vs. stuks is niet vergelijkbaar).
  const unitCount = new Map();
  for (const c of top) unitCount.set(c.item.sizeUnit, (unitCount.get(c.item.sizeUnit) || 0) + 1);
  const mainUnit = size?.unit && unitCount.has(size.unit) ? size.unit : [...unitCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return top
    .filter((c) => c.item.sizeUnit === mainUnit || mainUnit == null)
    .sort((a, b) => (a.unitPrice ?? Infinity) - (b.unitPrice ?? Infinity) || a.item.price - b.item.price)
    .slice(0, limit);
}

/**
 * Kosten van een gewenste hoeveelheid bij één kandidaat.
 * Als de gewenste inhoud bekend is, rekenen we met hele verpakkingen die minstens die hoeveelheid dekken.
 */
export function costFor(candidate, need) {
  const it = candidate.item;
  if (need.amount && need.unit && it.sizeAmount && it.sizeUnit === need.unit) {
    const packs = Math.max(1, Math.ceil((need.amount * need.qty - 1e-6) / it.sizeAmount));
    return { packs, cost: packs * it.price };
  }
  return { packs: need.qty, cost: need.qty * it.price };
}

/**
 * Vergelijkt een volledige lijst per winkel en per combinatie van twee winkels.
 * @param {{key:string, name:string, qty:number, amount?:number, unit?:string, pinned?:Record<string,string>}[]} list
 * @param {object} idx  prijsindex
 * @param {{ stores: string[], extraStoreCost?: number }} opts  extraStoreCost in centen (reistijd/-kosten voor een tweede winkel)
 */
export function compareBasket(list, idx, { stores, extraStoreCost = 0 }) {
  const perItem = list.map((need) => {
    const byStore = {};
    const unsureByStore = {};
    for (const s of stores) {
      let cands = findCandidates(idx, need.name, { store: s, limit: 4, size: need.amount ? { unit: need.unit } : null });
      const pinnedUrl = need.pinned?.[s];
      if (pinnedUrl) {
        const pinnedItem = idx.items.find((x) => x.store === s && x.url === pinnedUrl);
        if (pinnedItem) cands = [{ item: pinnedItem, score: 1, unitPrice: unitPrice(pinnedItem.price, pinnedItem.sizeAmount ? { amount: pinnedItem.sizeAmount, unit: pinnedItem.sizeUnit } : null), pinned: true }];
      }
      // Onzekere matches tellen niet mee in het totaal: liever "ontbreekt" dan een verkeerde prijs.
      // Ze worden wel aangeboden, zodat de gebruiker de juiste keuze kan vastzetten.
      const unsure = cands.filter((c) => c.uncertain && !c.pinned);
      cands = cands.filter((c) => c.pinned || !c.uncertain);
      if (!cands.length && unsure.length) unsureByStore[s] = unsure;
      if (cands.length) {
        const options = cands.map((c) => ({ ...c, ...costFor(c, need) })).sort((a, b) => a.cost - b.cost);
        byStore[s] = options[0];
        byStore[s].alternatives = options.slice(1);
      }
    }
    return { need, byStore, unsureByStore };
  });

  // Eerlijke vergelijking: alleen producten die in álle winkels (met data) zeker gevonden zijn.
  const activeStores = stores.filter((s) => perItem.some((x) => x.byStore[s]));
  const common = perItem.filter((x) => activeStores.every((s) => x.byStore[s]));
  const single = stores.map((s) => {
    const found = perItem.filter((x) => x.byStore[s]);
    return {
      stores: [s],
      total: found.reduce((t, x) => t + x.byStore[s].cost, 0),
      found: found.length,
      missing: perItem.filter((x) => !x.byStore[s]).map((x) => x.need.name),
      complete: found.length === perItem.length,
      commonTotal: activeStores.includes(s) ? common.reduce((t, x) => t + x.byStore[s].cost, 0) : null,
    };
  });

  const pairs = [];
  for (let a = 0; a < stores.length; a++) {
    for (let b = a + 1; b < stores.length; b++) {
      const sa = stores[a];
      const sb = stores[b];
      let t = 0;
      let found = 0;
      const assignment = [];
      for (const x of perItem) {
        const ca = x.byStore[sa];
        const cb = x.byStore[sb];
        if (!ca && !cb) { assignment.push(null); continue; }
        found++;
        const pick = !cb || (ca && ca.cost <= cb.cost) ? sa : sb;
        assignment.push(pick);
        t += x.byStore[pick].cost;
      }
      const usesBoth = assignment.includes(sa) && assignment.includes(sb);
      pairs.push({
        stores: [sa, sb], total: t + (usesBoth ? extraStoreCost : 0), productsTotal: t, extra: usesBoth ? extraStoreCost : 0,
        found, complete: found === perItem.length, assignment, usesBoth,
      });
    }
  }

  const rank = (arr) => arr.sort((x, y) => (y.found - x.found) || (x.total - y.total));
  return { perItem, commonCount: common.length, single: rank(single), pairs: rank(pairs).filter((p) => p.usesBoth).slice(0, 5) };
}
