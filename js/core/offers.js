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
import { effectiveDeal, adviseDeal, priceStats, entryUnit } from './stockpile.js';
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

const OFFER_STOP = new Set(['ah', 'alle', 'keuze', 'uit', 'het', 'hele', 'assortiment', 'diverse', 'soorten', 'varianten', 'combineren', 'mix', 'match', 'nieuw', 'combi', 'jumbo', 'dirk', 'hoogvliet', 'lidl', 'action', 'kruidvat', 'wibra']);

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
  'smoothie', 'ijs', 'poeder', 'capsule', 'pads', 'bonen', 'gemalen', 'oploskoffie', 'decafe', 'cafeinevrij', 'biologisch', 'bio', 'zoete', 'zoet'];

function qualifiersIn(text) {
  const n = ' ' + normalizeText(text) + ' ';
  return QUALIFIERS.filter((q) => n.includes(' ' + q) || (q.length >= 6 && n.includes(q)));
}

/** Hoofdwoorden van een aanbieding: eerste en laatste woord van elk alternatief ("A, B of C"). */
function headOf(offer) {
  if (offer._heads) return offer._heads;
  const alts = String(offer.title || '').split(/\s+of\s+|,|\s+&\s+|\s+en\s+|\//i);
  const heads = [];
  for (const a of alts) {
    const t = productTokens(a).filter((x) => !OFFER_STOP.has(x));
    if (!t.length) continue;
    heads.push(t[t.length - 1]);
    if (t.length <= 2) heads.push(t[0]);
  }
  return (offer._heads = heads);
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
    // Eén woord ("spinazie", "cola") moet het hoofdwoord zijn, niet een smaakje: "Gewassen spinazie" wel,
    // "Borek stick spinazie feta" en "Katja alpaca cola"-snoep niet.
    if (kt.length === 1 && !headOf(offer).some((h) => covers(kt[0], [h]))) continue;
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

// ---------------- Inhoud en eenheid ----------------

const UNITS = {
  ml: ['ml', 1], cl: ['ml', 10], dl: ['ml', 100], l: ['ml', 1000], lt: ['ml', 1000], ltr: ['ml', 1000], liter: ['ml', 1000], milliliter: ['ml', 1],
  g: ['g', 1], gr: ['g', 1], gram: ['g', 1], kg: ['g', 1000], kilo: ['g', 1000], kilogram: ['g', 1000],
  st: ['st', 1], stuk: ['st', 1], stuks: ['st', 1], rol: ['st', 1], rollen: ['st', 1], wasbeurten: ['st', 1], wasbeurt: ['st', 1],
  tabs: ['st', 1], tabletten: ['st', 1], zakjes: ['st', 1], pads: ['st', 1], capsules: ['st', 1], cups: ['st', 1], eieren: ['st', 1], luiers: ['st', 1], doekjes: ['st', 1],
};
const U = '(milliliter|ml|cl|dl|ltr|lt|liter|l|kilogram|kilo|kg|gram|gr|g|stuks|stuk|st|rollen|rol|wasbeurten|wasbeurt|tabletten|tabs|zakjes|pads|capsules|cups|eieren|luiers|doekjes)';
const N = '(\\d+(?:\\.\\d+)?)';
const unitOf = (u, n) => { const [unit, f] = UNITS[u.toLowerCase()]; return { amount: Math.round(parseFloat(n) * f * 1000) / 1000, unit }; };

/**
 * Alle inhouden die in een tekst genoemd worden.
 * "6 x 0,33 l" → 1980 ml · "24 blikken à 33cl" → 7920 ml · "320 - 350 gram" → bereik · "750 of 900 gram" → twee opties.
 * @returns {{ options: {amount, unit}[], ranges: {min, max, unit}[], per: {amount, unit}|null }}
 */
export function sizesIn(text) {
  let t = ' ' + String(text || '').toLowerCase().replace(/(\d),(\d)/g, '$1.$2').replace(/[àá]/g, 'a').replace(/–/g, '-') + ' ';
  const options = []; const ranges = []; let per = null;
  const eat = (re, fn) => { t = t.replace(re, (...m) => { fn(m); return ' § '; }); };
  // prijs per 100 g / per kilo (Jumbo, Hoogvliet): de prijs geldt voor die hoeveelheid
  // ("per stuk" zonder aantal is geen inhoud: dat stuk kan zelf een pak van 6 zijn)
  eat(new RegExp(`\\bper\\s*${N}?\\s*${U}\\b`, 'g'), (m) => { const u = unitOf(m[2], m[1] || '1'); if (m[1] || u.unit !== 'st') per = u; });
  // 6 x 0,33 l · 24 blikken a 33cl · 4 stuks van 125 gram
  eat(new RegExp(`(\\d+)\\s*(?:x|×|[a-z]+\\s+(?:a|van))\\s*${N}\\s*${U}\\b`, 'g'), (m) => { const one = unitOf(m[3], m[2]); options.push({ amount: Math.round(one.amount * +m[1] * 1000) / 1000, unit: one.unit, count: +m[1] }); });
  // 8-packs 250 ml · 6-pack blik a 33 cl · 250 ml 4-pack → aantal × inhoud
  eat(new RegExp(`(\\d+)\\s*-?\\s*packs?\\s+(?:[a-z]+\\s+){0,2}(?:a\\s+)?${N}\\s*${U}\\b(?!\\s*(?:of|/))`, 'g'), (m) => { const one = unitOf(m[3], m[2]); options.push({ amount: Math.round(one.amount * +m[1] * 1000) / 1000, unit: one.unit, count: +m[1] }); });
  eat(new RegExp(`${N}\\s*${U}\\s+(\\d+)\\s*-?\\s*packs?\\b`, 'g'), (m) => { const one = unitOf(m[2], m[1]); options.push({ amount: Math.round(one.amount * +m[3] * 1000) / 1000, unit: one.unit, count: +m[3] }); });
  // "16=24 rollen" → 24 gewone rollen
  eat(/(\d+)\s*=\s*(\d+)\s*(?:rollen|rol)\b/g, (m) => { options.push({ amount: +m[2], unit: 'st' }); });
  // 2-pack · 4 pack (aantal stuks)
  eat(/\b(\d+)\s*-?\s*pack\b/g, (m) => { options.push({ amount: +m[1], unit: 'st' }); });
  // 320 - 350 gram · 175-218 g · 500-1000 g
  eat(new RegExp(`${N}\\s*(?:-|tot)\\s*${N}\\s*${U}\\b`, 'g'), (m) => { const a = unitOf(m[3], m[1]); const b = unitOf(m[3], m[2]); ranges.push({ min: Math.min(a.amount, b.amount), max: Math.max(a.amount, b.amount), unit: a.unit }); });
  // 750 of 900 gram · 80 of 125 gram
  eat(new RegExp(`${N}\\s*(?:of|/|en)\\s*(?:[a-z]+\\s+)?${N}\\s*${U}\\b`, 'g'), (m) => { options.push(unitOf(m[3], m[1]), unitOf(m[3], m[2])); });
  // losse inhouden
  eat(new RegExp(`(?:^|[^\\d.])${N}\\s*${U}\\b`, 'g'), (m) => { options.push(unitOf(m[2], m[1])); });
  return { options, ranges, per };
}

const sameAmount = (a, b) => a && b && a.unit === b.unit && Math.abs(a.amount - b.amount) <= Math.max(0.5, b.amount * 0.02);

/**
 * De inhoud van de verpakking waar de actieprijs voor geldt.
 * Bij meerdere mogelijkheden ("150 of 400 gram", "320 - 350 gram") alleen als jullie eigen verpakking ertussen zit;
 * anders is het niet eerlijk te vergelijken (null).
 * @returns {{ size: {amount, unit}|null, how: 'exact'|'per'|'zelfde-als-jullie'|null }}
 */
export function offerSize(offer, own = null) {
  for (const src of [offer.size, offer.title]) {
    const { options, ranges, per } = sizesIn(src);
    if (per) return { size: per, how: 'per' };
    const same = (a, b) => a.unit === b.unit && Math.abs(a.amount - b.amount) <= Math.max(0.5, b.amount * 0.002);
    const distinct = options.filter((o, i) => options.findIndex((x) => same(x, o)) === i);
    if (!distinct.length && !ranges.length) continue;
    if (distinct.length === 1 && !ranges.length) return { size: distinct[0], how: 'exact' };
    if (own && (distinct.some((o) => sameAmount(o, own)) || ranges.some((r) => r.unit === own.unit && own.amount >= r.min - 0.5 && own.amount <= r.max + 0.5))) {
      return { size: own, how: 'zelfde-als-jullie' };
    }
    return { size: null, how: null, ambiguous: true };
  }
  return { size: null, how: null };
}

/** Basiseenheden (kilo, liter of stuks) in een verpakking. */
const baseOf = (size) => (size ? (size.unit === 'st' ? size.amount : size.amount / 1000) : null);
const unitName = (unit) => (unit === 'st' ? 'stuk' : unit === 'g' ? 'kilo' : unit === 'ml' ? 'liter' : 'verpakking');

/** Wat jullie zelf normaal betalen, per kilo/liter/stuk als de inhoud bekend is. */
function ownReference(stats) {
  if (!stats.observations) return null;
  const size = stats.packSize || null;
  if (stats.perBase) return { perBase: stats.typical, size, unit: size?.unit || (stats.unitLabel === 'kilo' ? 'g' : stats.unitLabel === 'liter' ? 'ml' : 'st') };
  if (size?.amount) return { perBase: Math.round(stats.typical / baseOf(size)), size, unit: size.unit };
  return { perPack: stats.typical, size: null, unit: null };
}

/**
 * Advies voor één aanbieding × één eigen product.
 * ctx: { facts, lines, adjustments, products, today, vacations, stockpile, predictions, freezerFree }
 *
 * Er wordt alleen vergeleken als dat eerlijk kan:
 *  - inhoud van de aanbieding én van jullie product bekend, zelfde soort eenheid (gewicht, volume of stuks)
 *    → per kilo, liter of stuk;
 *  - inhoud aan één of beide kanten onbekend → alleen per verpakking, en alleen in dezelfde winkel waar jullie
 *    het product kopen (dan is het vrijwel zeker dezelfde verpakking);
 *  - een %-korting of x+y gratis heeft de normale prijs in díe winkel nodig: de "van"-prijs van de aanbieding,
 *    of wat jullie daar zelf betaalden. Een AH-prijs wordt nooit als normale prijs van een andere winkel gebruikt.
 */
export function adviseOffer(offer, match, ctx) {
  const product = ctx.products.get(match.productId);
  const deal = parseMechanism(offer.mechanism, offer) || (offer.price != null ? { type: 'prijs', price: offer.price } : null);
  if (!deal) return null;
  const stats = priceStats(ctx.facts, product.id);
  const own = ownReference(stats);
  const sameStore = (ctx.facts || []).some((f) => f.productId === product.id && f.store === offer.store);
  const { size: offerSz, how: sizeHow } = offerSize(offer, own?.size || stats.packSize);
  const daysLeft = offer.validTo ? daysBetween(ctx.today, offer.validTo) : 7;
  const base = { offer, productId: product.id, name: product.name, brandMatch: match.brandMatch, daysLeft, deal, offerSize: offerSz, sizeHow };

  // Normale prijs van de aanbiedingsverpakking in die winkel (nodig voor %, gratis, 2e halve prijs, eurokorting).
  let normal = offer.was ?? null;
  if (normal == null && sameStore) {
    const here = priceStats((ctx.facts || []).filter((f) => f.store === offer.store), product.id);
    if (here.observations) {
      if (offerSz && here.perBase) normal = Math.round(here.typical * baseOf(offerSz));
      else if (offerSz && here.packSize && sameAmount(here.packSize, offerSz)) normal = here.packPrice;
      else if (!offerSz) normal = here.packPrice;
    }
  }
  const needsNormal = deal.type !== 'prijs' && deal.type !== 'xvoor';
  if (needsNormal && normal == null) return null;

  // 1. Op de inslaglijst → volledig inslagadvies (per eenheid van het inslagproduct)
  const entry = (ctx.stockpile || []).find((e) => e.members.some((m) => m.productId === product.id));
  if (entry) {
    if (!offerSz && !sameStore) return null; // andere winkel, inhoud onbekend: niet eerlijk te vergelijken
    if (offerSz && own?.unit && offerSz.unit !== own.unit) return null;
    if (!sameStore && entryUnit(entry, ctx.lines).unit === 'pak') return null; // jullie inhoud onbekend: per verpakking vergelijken kan alleen in dezelfde winkel
    const a = adviseDeal(entry, product.id, { ...deal, normal: normal ?? undefined, size: offerSz || undefined }, ctx);
    if (a.verdict !== 'inslaan' && a.verdict !== 'redelijk') return { ...base, kind: 'inslag', verdict: a.verdict, saving: 0, advice: a };
    return { ...base, kind: 'inslag', entryId: entry.id, verdict: a.verdict, qty: a.buyPacks, saving: Math.max(0, a.saving || 0), effBase: a.effBase, unitLabel: a.unitLabel, advice: a };
  }

  // 2. Vast gekocht product: vergelijk met wat jullie normaal betalen
  if (!own || !stats.observations || stats.observations < 2) return null;
  const eff = effectiveDeal(deal, normal ?? 0);
  const qtys = ctx.lines.filter((l) => l.productId === product.id && l.kind === 'product').map((l) => l.qty || 1);
  const typicalQty = Math.max(1, Math.round(median(qtys) || 1));

  let effBase; let ownBase; let unitLabel; let packBase; let ownPackBase;
  if (own.perBase != null && offerSz) {
    if (offerSz.unit !== own.unit) return null; // gewicht ≠ volume ≠ stuks
    packBase = baseOf(offerSz);
    ownPackBase = baseOf(own.size) || packBase;
    effBase = Math.round(eff.unitPrice / packBase);
    ownBase = own.perBase;
    unitLabel = unitName(offerSz.unit);
  } else if (sameStore && (!offerSz || !own.size || own.perPack != null)) {
    // Zelfde winkel, inhoud niet aan beide kanten bekend: per verpakking
    if (own.perBase != null && !own.size) return null;
    packBase = 1; ownPackBase = 1;
    effBase = eff.unitPrice;
    ownBase = own.perPack ?? (own.size ? Math.round(own.perBase * baseOf(own.size)) : null);
    if (ownBase == null) return null;
    unitLabel = 'verpakking';
  } else {
    return null; // andere winkel en inhoud niet vergelijkbaar
  }

  const discountVsYou = ownBase ? 1 - effBase / ownBase : 0;
  const compare = { effBase, ownBase, unitLabel, sizeKnown: packBase !== 1 || unitLabel !== 'verpakking' };
  if (discountVsYou < 0.12) return { ...base, ...compare, kind: 'vast', verdict: 'niet', saving: 0, discountVsYou };
  // Zoveel aanbiedingsverpakkingen als nodig voor wat jullie normaal in één keer kopen, in hele actiebundels
  const needBase = typicalQty * ownPackBase;
  const packs = Math.max(1, Math.ceil(needBase / packBase - 0.15));
  const qty = Math.ceil(packs / eff.bundle) * eff.bundle;
  const saving = Math.round(qty * (packBase * ownBase - eff.unitPrice));
  const pred = ctx.predictions?.get(product.id);
  const needSoon = pred ? neededWithin(pred, Math.max(1, daysLeft)) : false;
  return { ...base, ...compare, kind: 'vast', verdict: 'inslaan', qty, saving, discountVsYou, needSoon, bundle: eff.bundle, dealLabel: eff.label };
}

/**
 * Bij een andere winkel dan waar jullie het kopen is een vage naam ("Maaltijd", "Cola") te weinig:
 * dan vergelijk je een AH-maaltijdbox van € 6,99 met een Jumbo-magnetronmaaltijd. Daar is óf een
 * specifiekere naam nodig (minstens twee woorden), óf hetzelfde merk.
 */
function crossStoreOk(offer, match, products, storesOf) {
  const bought = storesOf.get(match.productId);
  if (!bought || bought.has(offer.store)) return true;
  const p = products.get(match.productId);
  const words = (p?.key || '').split(' ').filter(Boolean);
  if (words.length >= 2 || match.brandMatch === true) return true;
  // Eén woord: alleen bij een korte, duidelijke titel ("Verse zalmfilet", "Sable druiven").
  return offerTokens(offer).length <= 2;
}

/**
 * Het weekoverzicht: alle relevante aanbiedingen in jullie winkels, per winkel gegroepeerd.
 * @returns {{ items: object[], byStore: Map<string, object[]>, total: number, considered: number }}
 */
export function weeklyAdvice(data, ctx, { stores = null, limitPerStore = 12 } = {}) {
  const offers = (data?.offers || []).filter((o) => (!stores || stores.includes(o.store)) && (!o.validTo || o.validTo >= ctx.today) && (!o.validFrom || o.validFrom <= ctx.today));
  const brandOf = brandsByProduct(ctx.lines);
  const storesOf = new Map();
  for (const f of ctx.facts || []) {
    if (!f.productId) continue;
    if (!storesOf.has(f.productId)) storesOf.set(f.productId, new Set());
    storesOf.get(f.productId).add(f.store);
  }
  const best = new Map(); // productId|store → beste advies
  for (const o of offers) {
    for (const m of matchOffer(o, ctx.products, brandOf).filter((m) => crossStoreOk(o, m, ctx.products, storesOf)).slice(0, 2)) {
      let a;
      try { a = adviseOffer(o, m, ctx); } catch { a = null; }
      if (!a || a.verdict === 'niet' || a.verdict === 'onbekend' || !(a.saving > 0)) continue;
      // Meer dan de helft goedkoper dan wat jullie normaal betalen, in een andere winkel? Dan is het
      // vrijwel zeker een ander (kleiner of eenvoudiger) product: niet tonen.
      if (a.kind === 'vast' && a.discountVsYou > 0.5 && !storesOf.get(a.productId)?.has(o.store)) continue;
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
