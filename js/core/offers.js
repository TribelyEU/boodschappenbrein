// Wekelijkse aanbiedingen (uit data/aanbiedingen.json) koppelen aan jullie eigen producten en
// omrekenen naar een concreet advies: wat, waar, hoeveel en wat het scheelt.
//
// Een aanbieding: { id, store, title, brand?, size?, price?, was?, mechanism?, validFrom?, validTo?, source, url? }
// (bedragen in centen; price = actieprijs zoals de bron die noemt, was = normale prijs per verpakking)
//
// Belangrijk: we vergelijken met wat JULLIE normaal betalen (uit de bonnen), niet met de "van"-prijs
// van de folder. Zo vallen schijnkortingen vanzelf af.

import { productTokens, detectBrand, parseSize } from './products.js';
import { normalizeText, stem } from './text.js';
import { effectiveDeal, adviseDeal, priceStats } from './stockpile.js';
import { neededWithin } from './stock-model.js';
import { daysBetween } from './dates.js';

const num = (s) => Math.round(parseFloat(String(s).replace(',', '.')) * 100);

/**
 * Zet een actietekst om naar een deal voor de rekenmodule.
 * Voorbeelden: "1 + 1 gratis", "2e gratis", "2e halve prijs", "3 voor 4,50", "4 VOOR 10.00",
 * "25% korting", "voor 2.49", "1 euro korting".
 * @returns {{type:string, ...}|null}
 */
export function parseMechanism(text, { price = null, was = null } = {}) {
  // Eigen normalisatie: '+' en '%' moeten blijven staan.
  const t = String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/(\d),(\d)/g, '$1.$2').replace(/€/g, ' ').replace(/\s+/g, ' ').trim();
  let m;
  if ((m = t.match(/(\d+)\s*\+\s*(\d+)(?:\s*gratis)?/))) return { type: 'gratis', buy: +m[1], free: +m[2] };
  if ((m = t.match(/\b(\d+)\s*(?:e|de|ste)\s*gratis/))) return { type: 'gratis', buy: +m[1] - 1, free: 1 };
  if (/\b2\s*(?:e|de)\s*(?:voor\s*de\s*)?halve\s*prijs/.test(t)) return { type: 'tweedehalf' };
  if ((m = t.match(/\b(\d+)\s*(?:stuks\s*)?voor\s*(?:eur\s*)?(\d+(?:\.\d{1,2})?)/))) {
    const n = +m[1];
    if (n >= 2 && n <= 20) return { type: 'xvoor', n, total: num(m[2]) };
  }
  if ((m = t.match(/(\d{1,2})\s*%\s*(?:korting|voordeel)?/)) && !/extra|gratis/.test(t)) return { type: 'pct', pct: +m[1] };
  if ((m = t.match(/(\d+(?:\.\d{2})?)\s*euro\s*korting/) || t.match(/(\d+\.\d{2})\s*korting/))) return was ? { type: 'prijs', price: was - num(m[1]) } : { type: 'eurokorting', amount: num(m[1]) };
  if ((m = t.match(/\bvoor\s*(?:eur\s*)?(\d+\.\d{2})/))) return { type: 'prijs', price: num(m[1]) };
  if (price != null && was != null && price < was) return { type: 'prijs', price };
  return null;
}

const OFFER_STOP = new Set(['ah', 'alle', 'keuze', 'uit', 'het', 'hele', 'assortiment', 'diverse', 'soorten', 'varianten', 'combineren', 'mix', 'match', 'nieuw', 'combi']);

export function offerTokens(offer) {
  const base = productTokens(offer.title).filter((t) => !OFFER_STOP.has(t));
  return [...new Set(base)];
}

// Woord uit de productnaam (token) tegen woorden uit de aanbieding (list):
//  - exact, of meervoud/verbuiging (verschil ≤ 2 letters: maaltijd ↔ maaltijden);
//  - afkorting van de bon (halfv → halfvolle) alleen als het verschil klein is of het woord lang genoeg:
//    zo wordt "rasp" (geraspte kaas) geen "raspberry", "rijstwaf" geen "rijst" en "maaltijd" geen "maaltijdcomponenten".
function covers(token, list) {
  return list.some((u) => {
    if (u === token) return true;
    if (u.startsWith(token)) return token.length >= 4 && u.length - token.length <= 3;
    if (token.startsWith(u)) return u.length >= 4 && token.length - u.length <= 2;
    return false;
  });
}

/**
 * Welke eigen producten passen bij deze aanbieding?
 * Een product past als álle woorden van zijn basisnaam (zonder merk en inhoud) in de aanbieding voorkomen.
 * @returns {{productId, score, brandMatch:boolean|null}[]}
 */
// Woorden die van een product iets anders maken. Staat zo'n woord in de aanbieding maar niet in jullie
// product, dan is het een ander product (vochtig toiletpapier ≠ toiletpapier, gemarineerde kipfilet ≠ kipfilet).
const QUALIFIERS = ['vochtig', 'gemarineerd', 'marinade', 'gerookt', 'gepaneerd', 'gegrild', 'gekruid', 'mini', 'light', 'zero', 'lactosevrij',
  'glutenvrij', 'vegan', 'vegetarisch', 'plantaardig', 'kids', 'baby', 'drink', 'shake', 'reep', 'repen', 'koek', 'chips', 'saus', 'soep',
  'smoothie', 'ijs', 'poeder', 'capsule', 'pads', 'bonen', 'gemalen', 'oploskoffie', 'decafe', 'cafeinevrij', 'biologisch', 'bio'];

function qualifiersIn(text) {
  const n = ' ' + normalizeText(text) + ' ';
  return QUALIFIERS.filter((q) => n.includes(' ' + q) || (q.length >= 6 && n.includes(q)));
}

export function matchOffer(offer, products, brandOf = new Map()) {
  const ot = offer._tokens || (offer._tokens = offerTokens(offer));
  if (!ot.length) return [];
  const offerQuals = offer._quals || (offer._quals = qualifiersIn(offer.title));
  const offerBrand = normalizeText(offer.brand || detectBrand(offer.title).brand || '');
  const out = [];
  for (const p of products.values()) {
    const kt = p.key.split(' ').filter(Boolean);
    if (!kt.length || (kt.length === 1 && kt[0].length < 4)) continue;
    if (!kt.every((t) => covers(t, ot))) continue;
    if (offerQuals.length) {
      const mine = qualifiersIn(`${p.name} ${p.key}`);
      if (offerQuals.some((q) => !mine.includes(q))) continue;
    }
    const myBrand = normalizeText(brandOf.get(p.id) || '');
    const brandMatch = offerBrand && myBrand ? offerBrand === myBrand || offerBrand.startsWith(myBrand) || myBrand.startsWith(offerBrand) : null;
    const score = kt.length / ot.length + (brandMatch ? 0.3 : brandMatch === false ? -0.2 : 0);
    out.push({ productId: p.id, score, brandMatch });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Meest gekochte merk per product (uit de bonregels). */
export function brandsByProduct(lines) {
  const counts = new Map();
  for (const l of lines) {
    if (!l.productId || l.kind !== 'product' || !l.brand) continue;
    const m = counts.get(l.productId) || new Map();
    m.set(l.brand, (m.get(l.brand) || 0) + 1);
    counts.set(l.productId, m);
  }
  const out = new Map();
  for (const [id, m] of counts) out.set(id, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  return out;
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };

/**
 * Advies voor één aanbieding × één eigen product.
 * ctx: { facts, lines, adjustments, products, today, vacations, stockpile, predictions, freezerFree }
 */
export function adviseOffer(offer, match, ctx) {
  const product = ctx.products.get(match.productId);
  const deal = parseMechanism(offer.mechanism, offer) || (offer.price != null ? { type: 'prijs', price: offer.price } : null);
  if (!deal) return null;
  const size = parseSize(offer.size || '') || parseSize(offer.title);
  const stats = priceStats(ctx.facts, product.id);
  const normal = offer.was ?? (stats.packSize && size && stats.packSize.amount === size.amount ? stats.packPrice : null) ?? stats.packPrice ?? null;
  const daysLeft = offer.validTo ? daysBetween(ctx.today, offer.validTo) : 7;
  const base = { offer, productId: product.id, name: product.name, brandMatch: match.brandMatch, daysLeft, deal };

  // 1. Op de inslaglijst → volledig inslagadvies
  const entry = (ctx.stockpile || []).find((e) => e.members.some((m) => m.productId === product.id));
  if (entry) {
    if (normal == null && deal.type !== 'prijs' && deal.type !== 'xvoor') return null; // ook eurokorting heeft een normale prijs nodig
    const a = adviseDeal(entry, product.id, { ...deal, normal, size: size || undefined }, ctx);
    if (a.verdict !== 'inslaan' && a.verdict !== 'redelijk') return { ...base, kind: 'inslag', verdict: a.verdict, saving: 0, advice: a };
    return { ...base, kind: 'inslag', entryId: entry.id, verdict: a.verdict, qty: a.buyPacks, saving: Math.max(0, a.saving || 0), effBase: a.effBase, unitLabel: a.unitLabel, advice: a };
  }

  // 2. Vast gekocht product: vergelijk met wat jullie normaal betalen
  if (!stats.observations || stats.observations < 2) return null;
  if (normal == null && deal.type !== 'prijs' && deal.type !== 'xvoor') return null;
  const eff = effectiveDeal(deal, normal ?? 0);
  // Per eenheid vergelijken als dat kan
  let effBase = eff.unitPrice;
  let unitLabel = 'verpakking';
  if (stats.perBase && size?.amount) {
    const unitAmount = size.unit === 'st' ? size.amount : size.amount / 1000;
    effBase = Math.round(eff.unitPrice / unitAmount);
    unitLabel = stats.unitLabel;
  } else if (stats.perBase) {
    return null; // inhoud van de aanbieding onbekend: niet eerlijk te vergelijken
  }
  const discountVsYou = stats.typical ? 1 - effBase / stats.typical : 0;
  if (discountVsYou < 0.12) return { ...base, kind: 'vast', verdict: 'niet', saving: 0, discountVsYou };
  const qtys = ctx.lines.filter((l) => l.productId === product.id && l.kind === 'product').map((l) => l.qty || 1);
  const typicalQty = Math.max(1, Math.round(median(qtys) || 1));
  const qty = Math.ceil(typicalQty / eff.bundle) * eff.bundle;
  const perPackNormalForYou = stats.perBase && size?.amount ? stats.typical * (size.unit === 'st' ? size.amount : size.amount / 1000) : stats.typical;
  const saving = Math.round(qty * (perPackNormalForYou - eff.unitPrice));
  const pred = ctx.predictions?.get(product.id);
  const needSoon = pred ? neededWithin(pred, Math.max(1, daysLeft)) : false;
  return { ...base, kind: 'vast', verdict: 'inslaan', qty, saving, effBase, unitLabel, discountVsYou, needSoon, bundle: eff.bundle, dealLabel: eff.label };
}

/**
 * Het weekoverzicht: alle relevante aanbiedingen in jullie winkels, per winkel gegroepeerd.
 * @returns {{ items: object[], byStore: Map<string, object[]>, total: number, considered: number }}
 */
export function weeklyAdvice(data, ctx, { stores = null, limitPerStore = 12 } = {}) {
  const offers = (data?.offers || []).filter((o) => (!stores || stores.includes(o.store)) && (!o.validTo || o.validTo >= ctx.today));
  const brandOf = brandsByProduct(ctx.lines);
  const best = new Map(); // productId|store → beste advies
  for (const o of offers) {
    for (const m of matchOffer(o, ctx.products, brandOf).slice(0, 2)) {
      let a;
      try { a = adviseOffer(o, m, ctx); } catch { a = null; }
      if (!a || a.verdict === 'niet' || a.verdict === 'onbekend' || !(a.saving > 0)) continue;
      const k = `${a.productId}|${o.store}`;
      if (!best.has(k) || best.get(k).saving < a.saving) best.set(k, a);
    }
  }
  const items = [...best.values()].sort((a, b) => (b.kind === 'inslag') - (a.kind === 'inslag') || (b.needSoon ? 1 : 0) - (a.needSoon ? 1 : 0) || b.saving - a.saving);
  const byStore = new Map();
  for (const it of items) {
    if (!byStore.has(it.offer.store)) byStore.set(it.offer.store, []);
    const list = byStore.get(it.offer.store);
    if (list.length < limitPerStore) list.push(it);
  }
  const ordered = new Map([...byStore.entries()].sort((a, b) => b[1].reduce((t, x) => t + x.saving, 0) - a[1].reduce((t, x) => t + x.saving, 0)));
  return { items, byStore: ordered, total: items.reduce((t, x) => t + x.saving, 0), considered: offers.length };
}

/** Controle van het aanbiedingenbestand + leeftijd. */
export function offersStatus(data, today) {
  if (!data || !Array.isArray(data.offers)) return { ok: false, reason: 'Nog geen aanbiedingen geladen.' };
  if (!data.generatedAt) return { ok: false, reason: 'De eerste ophaalactie op GitHub heeft nog niet gedraaid.' };
  const age = data.generatedAt ? daysBetween(data.generatedAt.slice(0, 10), today) : null;
  return {
    ok: true, age, stale: age == null || age > 8, count: data.offers.length,
    sources: data.sources || {}, generatedAt: data.generatedAt || null,
  };
}

export { stem };
