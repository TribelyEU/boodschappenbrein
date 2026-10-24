// Voorstellen voor gelijkwaardige producten uit het supermarktassortiment (Checkjebon open data:
// gewone winkelprijzen van AH, Jumbo, Lidl, Dirk, Hoogvliet, PLUS en andere; geen aanbiedingen).

import { parseCheckjebon, buildIndex, findCandidates } from './prices.js';
import { parseSize, detectBrand, unitPrice } from './products.js';
import { normalizeText } from './text.js';

export const ASSORTMENT_URL = 'https://raw.githubusercontent.com/supermarkt/checkjebon/main/data/supermarkets.json';
export const ASSORTMENT_STORES = ['ah', 'jumbo', 'lidl', 'dirk', 'hoogvliet', 'plus'];

/** Alleen de winkels die we gebruiken, compact (naam, prijs in centen, inhoud). */
export function compactAssortment(json) {
  const { items } = parseCheckjebon(json);
  const stores = {};
  for (const it of items) {
    if (!ASSORTMENT_STORES.includes(it.store)) continue;
    // AH: ook het productnummer (wi123456), voor de link "Naar AH"
    const id = it.store === 'ah' ? (String(it.url || '').match(/\/wi(\d+)/) || [])[1] : null;
    (stores[it.store] ||= []).push(id ? [it.name, it.price, it.sizeText || '', +id] : [it.name, it.price, it.sizeText || '']);
  }
  return stores;
}

/** Zoekindex over de compacte gegevens. */
export function indexAssortment(stores) {
  const items = [];
  for (const [store, rows] of Object.entries(stores || {})) {
    for (const [name, price, sizeText, id] of rows) {
      // "16=24 rollen": 16 lange rollen = 24 gewone; voor een eerlijke prijs per rol tellen we 24
      const eq = String(name).match(/(\d+)\s*=\s*(\d+)\s*rol/i);
      const size = eq ? { amount: +eq[2], unit: 'st' } : parseSize(sizeText) || parseSize(name);
      items.push({ store, name, price, sizeText, sizeAmount: size?.amount || null, sizeUnit: size?.unit || null, id: id || null });
    }
  }
  return buildIndex(items);
}

// Een andere smaak of soort is geen gelijkwaardig product (cola zero ≠ cola zero cherry, ≠ cola light).
const VARIANTS = ['cherry', 'vanill', 'lemon', 'lime', 'citroen', 'mango', 'perzik', 'framboz', 'aardbei', 'kers', 'cafeine', 'caffein', 'light', 'zero', '0.0', 'alcoholvrij', 'gegrild', 'flinterdun', 'biologisch', 'bio', 'lactosevrij', 'glutenvrij', 'vegan', 'gerookt', 'gemarineerd', 'gekruid', 'kids', 'mini'];
const hasVariant = (text, v) => (` ${text} `).includes(` ${v}`);

const isHouse = (name) => detectBrand(name).house || /^(1 de beste|first choice|g.?woon|jumbo|ah|plus|hoogvliet|dirk)\b/i.test(name);

/**
 * Voorstellen per winkel voor een volgproduct.
 * query: de algemene naam ("Cola zero"); size: de inhoud die jullie kopen (bv. 1500 ml) → zelfde inhoud eerst;
 * preferHouse: huismerken eerst (als jullie zelf een huismerk kopen).
 * @returns {{store, results: {name, price, sizeText, sizeAmount, sizeUnit, unitPrice, sameSize, house}[]}[]}
 */
export function suggestEquivalents(idx, query, { size = null, preferHouse = false, stores = ASSORTMENT_STORES, perStore = 3 } = {}) {
  const out = [];
  for (const store of stores) {
    const q = normalizeText(query);
    const cands = findCandidates(idx, query, { store, size, limit: 40, all: true })
      .filter((c) => !VARIANTS.some((v) => hasVariant(normalizeText(c.item.name), v) && !hasVariant(q, v)));
    const results = cands.map((c) => {
      const it = c.item;
      const sameSize = Boolean(size && it.sizeUnit === size.unit && Math.abs(it.sizeAmount - size.amount) <= size.amount * 0.02);
      return { id: it.id || null, name: it.name, price: it.price, sizeText: it.sizeText, sizeAmount: it.sizeAmount, sizeUnit: it.sizeUnit, unitPrice: c.unitPrice ?? unitPrice(it.price, it.sizeAmount ? { amount: it.sizeAmount, unit: it.sizeUnit } : null), sameSize, house: isHouse(it.name), score: c.score };
    });
    // Eerst de beste naamovereenkomst (afgerond), dan zelfde inhoud, dan huismerk (als gewenst), dan prijs per eenheid.
    const band = (r) => Math.round(r.score * 4) / 4;
    results.sort((a, b) => band(b) - band(a) || (b.sameSize - a.sameSize) || (preferHouse ? b.house - a.house : 0) || (a.unitPrice ?? Infinity) - (b.unitPrice ?? Infinity));
    if (results.length) out.push({ store, results: results.slice(0, perStore) });
  }
  return out;
}

/** Vrij zoeken in het assortiment ("cola zero 1,5"), per winkel. */
export function searchAssortment(idx, text, { stores = ASSORTMENT_STORES, perStore = 4 } = {}) {
  const size = parseSize(text);
  const query = size ? size.rest : text;
  return suggestEquivalents(idx, query, { size, stores, perStore });
}

const STOP = new Set(['alle', 'en', 'of', 'voor', 'de', 'het', 'van', 'met', 'in', 'per', 'stuk', 'stuks', 'gram', 'g', 'kg', 'kilo', 'ml', 'cl', 'l', 'liter', 'pak', 'pakken', 'verpakking', 'verpakkingen', 'm', 'u', 'v', 'mu', 'v']);

/**
 * Welke producten van deze winkel vallen onder deze actie? Op de woorden van de actietitel zelf, mét merk
 * ("Alle Perla Huisblends … capsules voor Nespresso" → Perla Huisblends-capsules, niet Starbucks).
 * Het merk moet erin staan als de actie een merk noemt.
 */
export function productsForOffer(idx, offer, { limit = 40 } = {}) {
  const title = String(offer.title || '').replace(/^alle\s+/i, '').replace(/\*+$/, '');
  // "A en B" / "A of B" / "A, B": elk deel apart; "capsules voor Nespresso" → "capsules" (voor … is een toevoeging)
  const parts = title.split(/\s+(?:en|of)\s+|,\s*/i).map((p) => p.replace(/\bvoor\s+\S+/gi, ' ').trim()).filter(Boolean);
  const wordsOf = (t) => normalizeText(t.replace(/-/g, ' ')).split(' ').filter((w) => w.length >= 2 && !STOP.has(w) && !/^\d/.test(w));
  const storeItems = idx.items.filter((it) => it.store === offer.store);
  for (const it of storeItems) if (!it._words) it._words = normalizeText(it.name.replace(/-/g, ' ')).split(' ');
  // Merk: bekend merk, of het eerste woord als dat bij minstens 3 producten van deze winkel vooraan staat (Perla, Calvé, …)
  const firstWordCount = (w) => storeItems.reduce((n, it) => n + (it._words[0] === w ? 1 : 0), 0);
  const brandOf = (part) => {
    const b = detectBrand(part);
    if (b.brand) return normalizeText(b.brand).split(' ');
    const w = wordsOf(part)[0];
    return w && w.length >= 3 && firstWordCount(w) >= 3 ? [w] : [];
  };
  const prefix = (t, w) => t === w || (w.length >= 4 && (t.startsWith(w) || (w.startsWith(t) && t.length >= 4)));
  const has = (toks, w) => toks.some((t) => prefix(t, w));
  // Het hoofdwoord moet als heel woord of als einde van een samenstelling voorkomen: "gehakt" in "rundergehakt", niet in "gehaktbal"
  const hasHead = (toks, w) => toks.some((t) => t === w || t === `${w}s` || t === `${w}en` || (w.length >= 5 && t.endsWith(w)));
  let inherited = [];
  const rules = [];
  for (const part of parts) {
    const words = wordsOf(part);
    if (!words.length) continue;
    const own = brandOf(part);
    const brandWords = own.length ? own : inherited;
    if (own.length) inherited = own;
    const rest = words.filter((w) => !brandWords.includes(w));
    const head = rest.length ? rest[rest.length - 1] : null;
    rules.push({ rest, brandWords, head, need: rest.length >= 3 ? rest.length - 1 : rest.length });
  }
  const out = [];
  for (const it of storeItems) {
    const toks = it._words;
    let best = 0;
    for (const r of rules) {
      if (r.brandWords.length && !r.brandWords.every((w, i) => toks[i] && prefix(toks[i], w))) continue; // merk vooraan
      if (r.head && !hasHead(toks, r.head)) continue;
      const hits = r.rest.filter((w) => has(toks, w) || hasHead(toks, w)).length;
      if (hits >= r.need) best = Math.max(best, hits + r.brandWords.length);
    }
    if (best) out.push({ name: it.name, price: it.price, sizeText: it.sizeText, sizeAmount: it.sizeAmount, sizeUnit: it.sizeUnit, hits: best });
  }
  return out.sort((a, b) => b.hits - a.hits || a.price - b.price).slice(0, limit);
}
