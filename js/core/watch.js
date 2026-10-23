// Volglijst: soorten producten die jullie in de gaten houden (toiletpapier, belegen kaas, …).
// Elke week: alle aanbiedingen van die soort, in alle winkels, met de prijs per kilo/liter/rol/stuk.
// Jullie beoordelen ze (interessant / niet interessant); daaruit leert de app wat een goede prijs is.
//
// Alles wat getoond wordt is een feit: de actieprijs, de inhoud, de prijs per eenheid, wat jullie eerder
// interessant vonden en wat de laagste prijs in de bewaarde aanbiedingen was. Geen schattingen.

import { normalizeText } from './text.js';
import { parseMechanism, offerSize } from './offers.js';
import { effectiveDeal } from './stockpile.js';
import { isoWeek } from './dates.js';
import { detectBrand } from './products.js';

/**
 * Vergelijkingseenheden. base = welke inhoud uit de aanbieding nodig is (g/ml/st); null = per verpakking.
 * choice = tekst in de keuzelijst, label = korte tekst achter de prijs ("€ 1,79 per liter").
 */
export const WATCH_UNITS = {
  kilo: { base: 'g', per: 1000, label: 'kilo', choice: 'per kilo' },
  liter: { base: 'ml', per: 1000, label: 'liter', choice: 'per liter' },
  wasbeurt: { base: 'st', per: 1, label: 'wasbeurt', choice: 'per wasbeurt' },
  rol: { base: 'st', per: 1, label: 'rol', choice: 'per rol' },
  stuk: { base: 'st', per: 1, label: 'stuk', choice: 'per stuk (tablet, cup, ei)' },
  verpakking: { base: null, per: 1, label: 'stuk', choice: 'per stuk (pot, pak, fles)' },
};
/** Oudere namen van eenheden. */
const UNIT_ALIASES = { tablet: 'stuk' };
export const unitKeyOf = (item) => (WATCH_UNITS[item?.unit] ? item.unit : UNIT_ALIASES[item?.unit] || 'stuk');
export const unitOf = (item) => WATCH_UNITS[unitKeyOf(item)];

/** Startlijst. Zoekwoorden: een woord telt ook als begin van een langer woord ("vaatwastablet" → "vaatwastabletten"). */
export const DEFAULT_WATCHLIST = [
  { id: 'toiletpapier', name: 'Toiletpapier', terms: ['toiletpapier', 'wc papier'], exclude: ['vochtig'], unit: 'rol' },
  { id: 'cola-zero', name: 'Cola zero', terms: ['coca cola', 'cola zero', 'pepsi max'], exclude: ['katja', 'snoep', 'drop'], unit: 'liter' },
  { id: 'belegen-kaas', name: 'Belegen kaas', terms: ['belegen'], exclude: ['jong belegen', 'extra belegen'], unit: 'kilo' },
  { id: 'pindakaas', name: 'Pindakaas', terms: ['pindakaas'], exclude: [], unit: 'verpakking' },
  { id: 'bier', name: 'Heineken / Hertog Jan / Leffe blond', terms: ['heineken', 'hertog jan', 'leffe blond', 'leffe'], exclude: ['heineken 0.0', '0.0 heineken', 'hertog jan 0.0', 'tripel', 'weizener', 'radler'], unit: 'liter' },
  { id: 'wasmiddel', name: 'Wasmiddel', terms: ['wasmiddel', 'wascapsules', 'wasparels', 'waspods'], exclude: ['wasverzachter', 'handwas'], unit: 'wasbeurt' },
  { id: 'vaatwastabletten', name: 'Vaatwastabletten', terms: ['vaatwastablet', 'vaatwascapsule', 'vaatwasmiddel'], exclude: ['glansspoel', 'zout', 'reiniger', 'machinereiniger'], unit: 'stuk' },
  { id: 'gehakt', name: 'Gehakt', terms: ['gehakt', 'rundergehakt', 'kipgehakt', 'half om half'], exclude: ['gehaktbal', 'balletjes', 'gehaktschnitzel'], unit: 'kilo' },
  { id: 'kipfilet', name: 'Kipfilet', terms: ['kipfilet', 'kipfilets'], exclude: ['gerookt', 'vleeswaren', 'beleg', 'salade'], unit: 'kilo' },
  { id: 'zalmfilet', name: 'Zalmfilet', terms: ['zalmfilet', 'zalm'], exclude: ['gerookt', 'salade', 'spread', 'sushi'], unit: 'kilo' },
];

const norm = (s) => ' ' + normalizeText(String(s || '').replace(/-/g, ' ')) + ' ';

/** Komt de woordgroep voor? Elk woord mag het begin van een langer woord zijn. */
function hasPhrase(text, phrase) {
  const words = normalizeText(String(phrase).replace(/-/g, ' ')).split(' ').filter(Boolean);
  if (!words.length) return false;
  const toks = text.trim().split(' ');
  for (let i = 0; i + words.length <= toks.length; i++) {
    if (words.every((w, j) => (j === words.length - 1 ? toks[i + j].startsWith(w) : toks[i + j] === w))) return true;
  }
  return false;
}

export function matchesWatch(item, offer) {
  const text = norm(`${offer.brand || ''} ${offer.title} ${offer.size || ''}`);
  if (!(item.terms || []).some((t) => hasPhrase(text, t))) return false;
  if ((item.exclude || []).some((t) => hasPhrase(text, t))) return false;
  return true;
}

/**
 * Prijs per eenheid van een aanbieding (in centen), alleen als dat eerlijk te berekenen is:
 * de inhoud is eenduidig en de actieprijs is bekend (een prijs, "x voor €", of een % / gratis-actie mét normale prijs).
 */
/** Korting als fractie (0,5 = de helft), uit de actie zelf: "1+1 gratis" = 0,5, "25%" = 0,25, of van-prijs → actieprijs. */
export function discountOf(deal, was = null) {
  if (!deal) return null;
  switch (deal.type) {
    case 'pct': return deal.pct / 100;
    case 'gratis': return (deal.free || 1) / ((deal.buy || 1) + (deal.free || 1));
    case 'tweedehalf': return 0.25;
    case 'xvoor': return was ? Math.max(0, 1 - deal.total / (deal.n * was)) : null;
    case 'prijs': return was && was > deal.price ? 1 - deal.price / was : null;
    case 'eurokorting': return was ? deal.amount / was : null;
    default: return null;
  }
}

export function offerUnitPrice(offer, unitKey) {
  const unit = WATCH_UNITS[unitKey] || WATCH_UNITS[UNIT_ALIASES[unitKey]] || WATCH_UNITS.stuk;
  const deal = parseMechanism(offer.mechanism, offer) || (offer.price != null ? { type: 'prijs', price: offer.price } : null);
  if (!deal) return { deal: null, discount: null };
  const discount = discountOf(deal, offer.was ?? null);
  const withDiscount = (o) => ({ ...o, discount: discount == null ? null : Math.round(discount * 100) / 100 });
  return withDiscount(unitPriceOf(offer, unit, deal));
}

function unitPriceOf(offer, unit, deal) {
  const needsNormal = deal.type !== 'prijs' && deal.type !== 'xvoor';
  const normal = offer.was ?? (deal.type !== 'prijs' && offer.price != null && !needsNormal ? offer.price : null);
  if (needsNormal && normal == null) return { deal, packPrice: null, perUnit: null };
  const eff = effectiveDeal(deal, normal ?? 0);
  const { size } = offerSize(offer);
  const packPrice = eff.unitPrice;
  if (unit.base == null) return { deal, eff, packPrice, perUnit: packPrice, size: size || null, units: 1 };
  if (!size || size.unit !== unit.base) return { deal, eff, packPrice, perUnit: null, size: size || null };
  const units = size.amount / unit.per;
  return { deal, eff, packPrice, size, units, perUnit: units > 0 ? Math.round(packPrice / units) : null };
}

/** Sleutel van één aanbieding in één week (zodat een oordeel blijft staan zolang de actie loopt). */
export function offerKey(offer) {
  return `${offer.store}|${normalizeText(offer.title)}|${offer.size || ''}|${offer.mechanism || ''}|${offer.validTo || ''}`;
}

/**
 * Wat jullie tot nu toe vonden, per volgproduct: hoogste prijs per eenheid die "interessant" was,
 * laagste die "niet interessant" was.
 */
export function learned(ratings, watchId) {
  const all = (ratings || []).filter((r) => r.watchId === watchId);
  const own = all.filter((r) => r.perUnit != null);
  const yes = own.filter((r) => r.interesting).map((r) => r.perUnit);
  const no = own.filter((r) => !r.interesting).map((r) => r.perUnit);
  // Zonder prijs per eenheid (inhoud onbekend): leren op de korting zelf
  const pYes = all.filter((r) => r.perUnit == null && r.discount != null && r.interesting).map((r) => r.discount);
  const pNo = all.filter((r) => r.perUnit == null && r.discount != null && !r.interesting).map((r) => r.discount);
  return {
    count: all.length,
    maxYes: yes.length ? Math.max(...yes) : null,
    minNo: no.length ? Math.min(...no) : null,
    minYesDiscount: pYes.length ? Math.min(...pYes) : null,
    maxNoDiscount: pNo.length ? Math.max(...pNo) : null,
  };
}

/** Label op basis van eerdere oordelen: 'koopje', 'duur' of null (nog niet te zeggen). */
export function labelFor(u, L) {
  if (u.perUnit != null) {
    if (L.maxYes != null && u.perUnit <= L.maxYes && (L.minNo == null || u.perUnit < L.minNo)) return 'koopje';
    if (L.minNo != null && u.perUnit >= L.minNo && (L.maxYes == null || u.perUnit > L.maxYes)) return 'duur';
    return null;
  }
  if (u.discount != null) {
    if (L.minYesDiscount != null && u.discount >= L.minYesDiscount && (L.maxNoDiscount == null || u.discount > L.maxNoDiscount)) return 'koopje';
    if (L.maxNoDiscount != null && u.discount <= L.maxNoDiscount && (L.minYesDiscount == null || u.discount < L.minYesDiscount)) return 'duur';
  }
  return null;
}

/**
 * Aanbiedingen voor één volgproduct deze week, met oordeel en label.
 *  - label 'koopje': even goedkoop of goedkoper dan iets wat jullie eerder interessant vonden
 *  - label 'duur':   even duur of duurder dan iets wat jullie eerder niet interessant vonden (wordt ingeklapt)
 */
export function watchOffers(item, offers, { today, ratings = [], stores = null } = {}) {
  const mine = (ratings || []);
  const L = learned(mine, item.id);
  const out = [];
  for (const o of offers || []) {
    if (stores && !stores.includes(o.store)) continue;
    if (o.validTo && o.validTo < today) continue;
    if (o.validFrom && o.validFrom > today) continue;
    if (!matchesWatch(item, o)) continue;
    const eq = equivalentOf(item, o);
    if (item.onlyEquiv && hasEquivalents(item) && !eq) continue;
    const u = offerUnitPrice(o, unitKeyOf(item));
    const key = offerKey(o);
    const rating = mine.find((r) => r.key === key) || null;
    // Het eigen oordeel telt niet mee voor het label van dezelfde aanbieding (anders is alles wat je aantikt een 'koopje').
    const Lx = rating ? learned(mine.filter((r) => r.key !== key), item.id) : L;
    out.push({ offer: o, key, ...u, rating, label: labelFor(u, Lx), equiv: eq });
  }
  // Goedkoopste per eenheid eerst; zonder eenheidsprijs achteraan
  out.sort((a, b) => (a.perUnit ?? Infinity) - (b.perUnit ?? Infinity) || (a.packPrice ?? Infinity) - (b.packPrice ?? Infinity));
  return { item, offers: out, learned: L };
}

// ---------- historie (bewaarde aanbiedingen van eerdere weken) ----------

export const weekKey = (iso) => { const w = isoWeek(iso); return `${w.year}-${String(w.week).padStart(2, '0')}`; };

/**
 * Wat de bewaarde aanbiedingen zeggen over dit volgproduct: laagste prijs per eenheid en in welke weken
 * het per winkel in de aanbieding was.
 * history: { weeks: { '2026-43': [offer, …] } }
 */
export function watchHistory(item, history, { today, exceptWeek = null } = {}) {
  const weeks = Object.keys(history?.weeks || {}).sort();
  let lowest = null;
  const byStore = new Map();
  for (const wk of weeks) {
    for (const o of history.weeks[wk]) {
      if (!matchesWatch(item, o)) continue;
      if (!byStore.has(o.store)) byStore.set(o.store, new Set());
      byStore.get(o.store).add(wk);
      if (wk === exceptWeek) continue;
      const u = offerUnitPrice(o, unitKeyOf(item));
      if (u.perUnit != null && (!lowest || u.perUnit < lowest.perUnit)) lowest = { perUnit: u.perUnit, store: o.store, week: wk, title: o.title };
    }
  }
  const rhythm = [];
  for (const [store, set] of byStore) {
    const list = [...set].sort();
    const nums = list.map(weekNumber);
    const gaps = nums.slice(1).map((n, i) => n - nums[i]).filter((g) => g > 0);
    // "Elke ±N weken" pas bij minstens 3 keer en een redelijk vast patroon
    let every = null;
    if (gaps.length >= 2) {
      const sorted = [...gaps].sort((a, b) => a - b);
      const med = sorted[Math.floor(sorted.length / 2)];
      if (gaps.every((g) => Math.abs(g - med) <= 1)) every = med;
    }
    rhythm.push({ store, weeks: list, every, last: list.at(-1) });
  }
  rhythm.sort((a, b) => b.weeks.length - a.weeks.length);
  return { weeksKept: weeks.length, firstWeek: weeks[0] || null, lowest, rhythm };
}

/** Weeknummer als doorlopend getal (jaar × 53 + week), voor afstanden tussen weken. */
function weekNumber(wk) {
  const [y, w] = wk.split('-').map(Number);
  // ISO-jaren hebben 52 of 53 weken; bij jaarovergang een kleine onnauwkeurigheid, verwaarloosbaar voor "elke ±N weken"
  return y * 52.18 + w;
}

/** Nieuw volgproduct uit een vrije naam ("Koffiecups" → zoekwoord "koffiecups"). */
export function newWatchItem(name, unit = 'stuk') {
  const clean = String(name || '').trim();
  const id = normalizeText(clean).replace(/\s+/g, '-') || `item-${Date.now()}`;
  return { id, name: clean, terms: [normalizeText(clean)], exclude: [], unit: WATCH_UNITS[unit] ? unit : 'stuk', ref: null, equiv: [], onlyEquiv: false };
}

/**
 * Wat jullie zelf voor dit soort product betaalden (uit de bonnen): de laatste aankoop, per eenheid als de inhoud bekend is.
 */
export function ownLastPurchase(item, facts, products = new Map()) {
  const unit = unitOf(item);
  let last = null;
  for (const f of facts || []) {
    if (!f.productId || !(f.net > 0)) continue;
    const pname = products.get(f.productId)?.name || '';
    if (!matchesWatch(item, { title: `${f.name} ${pname}` })) continue;
    if (last && f.date < last.date) continue;
    let perUnit = null;
    if (unit.base == null) perUnit = Math.round(f.net / (f.qty || 1));
    else if (f.weighed && unit.base === 'g') perUnit = Math.round(f.net / f.qty);
    else if (f.sizeAmount && f.sizeUnit === unit.base) perUnit = Math.round(f.net / ((f.qty || 1) * (f.sizeAmount / unit.per)));
    last = { date: f.date, store: f.store, name: pname || f.name, perPack: Math.round(f.net / (f.qty || 1)), perUnit, promo: f.promo || f.discount < 0 };
  }
  return last;
}

/**
 * Is dit lijstproduct deze week ergens in de aanbieding? Eerst via de volglijst (brede soort),
 * anders alleen bij een duidelijke naamovereenkomst. Geeft de beste aanbieding of null.
 */
export function dealForListItem(name, { offers = [], watchlist = [], ratings = [], today, stores = null, matchByName = null }) {
  const asOffer = { title: name };
  const item = watchlist.find((w) => matchesWatch(w, asOffer));
  if (item) {
    const r = watchOffers(item, offers, { today, ratings, stores });
    const usable = r.offers.filter((x) => x.label !== 'duur' && x.rating?.interesting !== false);
    const best = usable.find((x) => x.label === 'koopje') || usable[0];
    return best ? { ...best, watch: item, count: usable.length } : null;
  }
  if (!matchByName) return null;
  const hits = offers.filter((o) => (!stores || stores.includes(o.store)) && (!o.validTo || o.validTo >= today) && (!o.validFrom || o.validFrom <= today) && matchByName(o));
  if (!hits.length) return null;
  const withPrice = hits.map((o) => ({ offer: o, ...offerUnitPrice(o, 'stuk') }));
  withPrice.sort((a, b) => (a.packPrice ?? Infinity) - (b.packPrice ?? Infinity));
  return { ...withPrice[0], count: hits.length };
}

// ---------- equivalenten: wat jullie nu kopen en wat daarmee gelijkwaardig is ----------

const nameWords = (name) => normalizeText(String(name || '').replace(/-/g, ' ')).split(' ').filter((w) => w.length >= 2 && !/^\d/.test(w));

/** Hoort deze aanbieding bij een equivalent (zelfde winkel als die is ingevuld, en alle woorden van de naam erin)? */
function matchesEntry(entry, offer) {
  if (!entry?.name) return false;
  // Een A-merk (Coca-Cola, Calvé) is in elke winkel hetzelfde; een huismerk alleen in die winkel.
  const brand = detectBrand(entry.name);
  const anyStore = brand.brand && !brand.house;
  if (entry.store && !anyStore && entry.store !== offer.store) return false;
  const toks = norm(`${offer.brand || ''} ${offer.title} ${offer.size || ''}`).trim().split(' ');
  const words = nameWords(entry.name);
  return words.length > 0 && words.every((w) => toks.some((t) => t.startsWith(w)));
}

export const hasEquivalents = (item) => Boolean(item?.ref?.name || item?.equiv?.length);

/** 'ref' als de aanbieding het product is dat jullie nu kopen, 'equiv' bij een gelijkwaardig product, anders null. */
export function equivalentOf(item, offer) {
  if (item?.ref && matchesEntry(item.ref, offer)) return 'ref';
  if ((item?.equiv || []).some((e) => matchesEntry(e, offer))) return 'equiv';
  return null;
}

/**
 * Normale prijs (uit de bonnen) van een eigen product, in de eenheid van het volgproduct.
 * priceStats komt uit stockpile.js (mediaan van de normale prijzen; perBase = per kilo/liter/stuk).
 */
export function normalPriceIn(item, stats) {
  if (!stats?.observations) return null;
  const unit = unitOf(item);
  if (unit.base == null) return { perUnit: stats.packPrice ?? stats.typical, per: unit.label };
  const baseOfStats = stats.unitLabel === 'kilo' ? 'g' : stats.unitLabel === 'liter' ? 'ml' : stats.unitLabel === 'stuk' ? 'st' : null;
  if (stats.perBase && baseOfStats === unit.base) return { perUnit: stats.typical, per: unit.label };
  if (stats.packSize?.amount && stats.packSize.unit === unit.base && stats.packPrice) return { perUnit: Math.round(stats.packPrice / (stats.packSize.amount / unit.per)), per: unit.label };
  return { perPack: stats.packPrice ?? stats.typical, per: 'verpakking' };
}

/** Eigen producten die bij dit volgproduct passen (voor de keuzelijst), meest gekocht eerst. */
export function ownCandidates(item, facts, products) {
  const by = new Map();
  for (const f of facts || []) {
    if (!f.productId || !(f.gross > 0)) continue;
    const p = products.get(f.productId);
    if (!p || !matchesWatch(item, { title: `${f.name} ${p.name}` })) continue;
    const c = by.get(f.productId) || { productId: f.productId, name: p.name, raw: f.name, stores: new Map(), count: 0, last: f.date };
    c.count++;
    c.stores.set(f.store, (c.stores.get(f.store) || 0) + 1);
    if (f.date >= c.last) { c.last = f.date; c.raw = f.name; }
    by.set(f.productId, c);
  }
  return [...by.values()].map((c) => ({ ...c, store: [...c.stores.entries()].sort((a, b) => b[1] - a[1])[0][0] })).sort((a, b) => b.count - a.count);
}
