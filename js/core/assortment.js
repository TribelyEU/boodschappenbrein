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
    (stores[it.store] ||= []).push([it.name, it.price, it.sizeText || '']);
  }
  return stores;
}

/** Zoekindex over de compacte gegevens. */
export function indexAssortment(stores) {
  const items = [];
  for (const [store, rows] of Object.entries(stores || {})) {
    for (const [name, price, sizeText] of rows) {
      const size = parseSize(sizeText) || parseSize(name);
      items.push({ store, name, price, sizeText, sizeAmount: size?.amount || null, sizeUnit: size?.unit || null });
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
      return { name: it.name, price: it.price, sizeText: it.sizeText, sizeAmount: it.sizeAmount, sizeUnit: it.sizeUnit, unitPrice: c.unitPrice ?? unitPrice(it.price, it.sizeAmount ? { amount: it.sizeAmount, unit: it.sizeUnit } : null), sameSize, house: isHouse(it.name), score: c.score };
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
