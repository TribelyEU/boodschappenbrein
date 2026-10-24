// Opzoeken van producten bij ingrediënten en lijstregels: eigen aankopen, gekozen AH-producten en het AH-assortiment.
import { state, derived, loadAssortment, setSetting } from './store.js';
import { findProducts } from '../core/query.js';
import { productTokens, parseSize } from '../core/products.js';
import { priceStats } from '../core/stockpile.js';
import { indexAssortment } from '../core/assortment.js';
import { choiceKey, queryVariants, rankForIngredient, cheapestCover } from '../core/ah.js';

/** Het eigen product (uit de bonnen) dat het vaakst gekocht is en bij deze naam past. */
export function matchIngredient(name) {
  const hits = findProducts(productTokens(name), state.products);
  if (!hits.length) return null;
  const counts = new Map(hits.map((p) => [p.id, 0]));
  for (const l of state.lines) if (counts.has(l.productId)) counts.set(l.productId, counts.get(l.productId) + 1);
  return hits.sort((a, b) => counts.get(b.id) - counts.get(a.id))[0];
}

let assortment = null;
let loading = null;
/** AH-assortiment (zoekindex); laadt één keer. Geeft null zolang het nog niet geladen is als `wait` false is. */
export async function assortmentIndex() {
  if (assortment) return assortment;
  loading ||= loadAssortment().then((rec) => (assortment = indexAssortment({ ah: rec.stores.ah || [] }))).finally(() => { loading = null; });
  return loading;
}
export const assortmentReady = () => assortment;

/** AH-producten die bij deze naam passen (beste eerst). Eigen productnaam eerst, dan steeds algemener. */
export function ahSearch(idx, name, { productName = null, limit = 8, withScore = false } = {}) {
  const items = idx.ahItems ||= idx.items.filter((it) => it.store === 'ah' && it.id);
  const tries = [...(productName ? [productName.replace(/^ah\s+/i, '')] : []), ...queryVariants(name)];
  for (const q of tries) {
    const res = rankForIngredient(items, q, { limit, withScore });
    if (res.length) return res;
  }
  return [];
}

export const ahChoice = (name) => (state.settings.ahChoices || {})[choiceKey(name)] || null;
export async function saveAhChoices(map) {
  await setSetting('ahChoices', { ...(state.settings.ahChoices || {}), ...map });
}

/** Voorstel voor één lijstregel/ingrediënt: eerder gekozen, anders de beste zoektreffer. */
export function ahSuggest(idx, name, productId = null) {
  const chosen = ahChoice(name);
  if (chosen) return { ...chosen, chosen: true };
  const p = productId ? state.products.get(productId) : null;
  const ownAh = p && state.lines.some((l) => l.productId === p.id && l.store === 'ah');
  const top = ahSearch(idx, name, { productName: ownAh ? p.name : null })[0];
  return top ? { id: top.id, name: top.name, price: top.price, sizeText: top.sizeText } : null;
}

/** Prijs van één verpakking voor de kosten van een gerecht: eigen keuze, eigen laatste prijs, anders AH. */
export function priceFor(name, ing = null) {
  const c = ahChoice(name);
  if (c?.price) return { price: c.price, size: parseSize(c.sizeText) || parseSize(c.name), name: c.name, source: 'ah' };
  const p = matchIngredient(name);
  if (p) {
    const st = priceStats(derived().facts, p.id);
    if (st.observations && st.packPrice && !st.weighed) return { price: Math.round(st.packPrice), size: st.packSize, name: p.name, source: 'eigen' };
  }
  if (!assortment) return null;
  const top = cheapestCover(ahSearch(assortment, name, { withScore: true }), ing);
  return top ? { price: top.price, size: top.sizeAmount ? { amount: top.sizeAmount, unit: top.sizeUnit } : null, name: top.name, source: 'ah' } : null;
}
