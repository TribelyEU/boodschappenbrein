// Inslaglijst: producten waarbij het loont om bij een goede prijs voor meerdere weken in te slaan,
// plus de (afgeleide) vriezervoorraad.
//
// Een inslag-item ("entry") bevat één of meer producten die elkaar vervangen:
//   { id, name, members: [{ productId, role: 'standaard'|'upgrade', maxPrice? }], location: 'kast'|'vriezer',
//     maxWeeks, shelfWeeks?, target?: centen per eenheid (handmatig; leeg = automatisch) }
// Voorbeeld koffiecups: Lidl-cups (standaard) + Starbucks-cups (upgrade, alleen onder een maximumprijs per cup).
//
// Eenheden: als van alle producten de inhoud bekend is in dezelfde eenheid, rekenen we per stuk/kilo/liter
// (zo zijn 16 Lidl-cups en 10 Starbucks-cups vergelijkbaar). Anders per verpakking.

import { predictStock } from './stock-model.js';
import { priceHistory } from './analytics.js';
import { addDays, daysBetween } from './dates.js';
import { categoryModel } from './categories.js';


/** Standaardinstellingen per categorie. Houdbaarheid in de vriezer is een richtlijn; per product aan te passen. */
export function defaultsFor(product) {
  const cat = product?.category;
  const key = product?.key || '';
  if (cat === 'vlees-vis-vega') return { location: 'vriezer', maxWeeks: 8, shelfWeeks: /gehakt/.test(key) ? 12 : 16 };
  if (cat === 'brood-ontbijt' && /(brood|croissant|bol|stok|baguette|kaiser|tijger|pank|focaccia)/.test(key)) return { location: 'vriezer', maxWeeks: 4, shelfWeeks: 10 };
  if (cat === 'diepvries') return { location: 'vriezer', maxWeeks: 8, shelfWeeks: 26 };
  if (cat === 'zuivel' && /(kaas|belegen|geraspt|rasp|pondstuk)/.test(key)) return { location: 'vriezer', maxWeeks: 8, shelfWeeks: 12 };
  if (['huishouden', 'schoonmaak', 'verzorging'].includes(cat)) return { location: 'kast', maxWeeks: 12 };
  if (cat === 'snacks') return { location: 'kast', maxWeeks: 4 };
  if (['houdbaar', 'dranken', 'brood-ontbijt'].includes(cat)) return { location: 'kast', maxWeeks: 12 };
  return { location: 'kast', maxWeeks: 8 };
}

/** Kan dit product redelijkerwijs ingeslagen worden? (zonder vriezer: alleen houdbare dingen) */
export function isStockable(product, { freezer = true } = {}) {
  const d = defaultsFor(product);
  if (d.location === 'vriezer') return freezer;
  return ['huishouden', 'schoonmaak', 'verzorging', 'houdbaar'].includes(product?.category)
    || (product?.category === 'dranken' && !/(vers|smoothie|gekoeld)/.test(product.key))
    || (product?.category === 'brood-ontbijt' && /(pindakaas|hagelslag|vlok|muesli|cruesli|granola|havermout|rijstwafel|cracker|beschuit|jam|stroop|honing|ontbijtkoek)/.test(product.key));
}

const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quantile = (a, q) => {
  const s = [...a].sort((x, y) => x - y);
  if (!s.length) return null;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (pos - lo);
};

/** Bepaalt de rekeneenheid van een item. */
export function entryUnit(entry, lines) {
  const ids = new Set(entry.members.map((m) => m.productId));
  const rel = lines.filter((l) => ids.has(l.productId) && l.kind === 'product' && l.amount > 0);
  if (!rel.length) return { unit: 'pak', label: 'verpakking' };
  if (rel.every((l) => l.weighed)) return { unit: 'g', label: 'kilo', weighed: true };
  const units = new Set(rel.map((l) => (l.weighed ? 'g' : l.sizeUnit || null)));
  if (units.size === 1 && !units.has(null) && rel.every((l) => l.weighed || l.sizeAmount)) {
    const u = [...units][0];
    return { unit: u, label: u === 'st' ? 'stuk' : u === 'g' ? 'kilo' : 'liter' };
  }
  return { unit: 'pak', label: 'verpakking' };
}

/** Hoeveelheid van een bonregel in de eenheid van het item (stuks, gram, ml of pakken). */
function amountOf(line, unit) {
  if (unit === 'pak') return line.qty || 1;
  if (line.weighed) return (line.qty || 0) * 1000; // kg → g
  return (line.qty || 1) * (line.sizeAmount || 0);
}

/** Gecombineerde verbruiksvoorspelling van alle producten in het item (in de eenheid van het item). */
export function entryPrediction(entry, { lines, adjustments = [], products, today, vacations = [] }) {
  const { unit } = entryUnit(entry, lines);
  const ids = new Set(entry.members.map((m) => m.productId));
  const purchases = lines.filter((l) => ids.has(l.productId) && l.kind === 'product' && l.amount > 0).map((l) => ({ date: l.date, qty: amountOf(l, unit) }));
  const adj = adjustments.filter((a) => ids.has(a.productId));
  const first = products.get(entry.members[0]?.productId);
  const pred = predictStock(purchases, adj, { today, vacations, model: first?.model || categoryModel(first?.category) });
  return { ...pred, unit };
}

/**
 * Prijsstatistiek van één product, per eenheid (kilo/liter/stuk) als dat kan, anders per verpakking.
 * typical = mediaan normale prijs, paid = mediaan betaalde prijs, best = laagste betaalde prijs,
 * autoTarget = 25%-punt van de betaalde prijzen (een "goede prijs" voor jullie). Pas vanaf 4 aankopen.
 */
export function priceStats(facts, productId) {
  const hist = priceHistory(facts, productId);
  if (!hist.length) return { observations: 0 };
  const base = hist.filter((h) => h.perBase != null);
  const useBase = base.length >= Math.max(1, Math.ceil(hist.length * 0.6));
  const rows = useBase ? base : hist;
  const paid = rows.map((h) => (useBase ? h.perBase : h.paidPerUnit));
  const normal = rows.filter((h) => !h.normalUnknown).map((h) => (useBase ? h.perBaseNormal : h.normalPerUnit));
  const bestIdx = paid.indexOf(Math.min(...paid));
  const packSizes = hist.filter((h) => h.sizeAmount).map((h) => `${h.sizeAmount}|${h.sizeUnit}`);
  const commonSize = packSizes.length ? [...packSizes.reduce((m, k) => m.set(k, (m.get(k) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1])[0][0].split('|') : null;
  const lastNormal = [...rows].reverse().find((h) => !h.discounted && !h.normalUnknown);
  return {
    observations: rows.length,
    perBase: useBase,
    unitLabel: useBase ? (hist[0].weighed || hist[0].sizeUnit === 'g' ? 'kilo' : hist[0].sizeUnit === 'ml' ? 'liter' : 'stuk') : 'verpakking',
    typical: normal.length ? Math.round(median(normal)) : Math.round(median(paid)),
    paid: Math.round(median(paid)),
    best: Math.round(paid[bestIdx]),
    bestAt: { date: rows[bestIdx].date, store: rows[bestIdx].store },
    autoTarget: paid.length >= 4 ? Math.round(quantile(paid, 0.25)) : null,
    packPrice: lastNormal ? lastNormal.normalPerUnit : hist.at(-1).normalPerUnit,
    packSize: commonSize ? { amount: +commonSize[0], unit: commonSize[1] } : null,
    weighed: hist.some((h) => h.weighed),
  };
}


/**
 * Effectieve prijs per verpakking van een actie, en het minimale aantal (bundel) om de actie te krijgen.
 * @param {{type:string, price?:number, pct?:number, buy?:number, free?:number, n?:number, total?:number}} deal (bedragen in centen)
 * @param {number} normal normale prijs per verpakking (centen)
 */
export function effectiveDeal(deal, normal) {
  switch (deal.type) {
    case 'prijs': return { unitPrice: deal.price, bundle: 1, label: `actieprijs` };
    case 'pct': return { unitPrice: Math.round(normal * (1 - deal.pct / 100)), bundle: 1, label: `${deal.pct}% korting` };
    case 'gratis': {
      const buy = deal.buy || 1; const free = deal.free || 1;
      return { unitPrice: Math.round((normal * buy) / (buy + free)), bundle: buy + free, label: `${buy}+${free} gratis` };
    }
    case 'tweedehalf': return { unitPrice: Math.round(normal * 0.75), bundle: 2, label: '2e halve prijs' };
    case 'eurokorting': return { unitPrice: Math.max(0, normal - deal.amount), bundle: 1, label: `${(deal.amount / 100).toFixed(2).replace('.', ',')} korting` };
    case 'xvoor': return { unitPrice: Math.round(deal.total / deal.n), bundle: deal.n, label: `${deal.n} voor ${(deal.total / 100).toFixed(2).replace('.', ',')}` };
    default: throw new Error('Onbekend actietype');
  }
}

/**
 * Advies voor één aanbieding.
 * @param {object} entry   inslag-item
 * @param {string} productId  het product in de aanbieding (lid van het item)
 * @param {object} deal    zie effectiveDeal; deal.normal (centen per verpakking) mag leeg zijn → uit historie
 * @param {object} ctx     { facts, lines, adjustments, products, today, vacations, freezerFree?: aantal pakken ruimte }
 */
export function adviseDeal(entry, productId, deal, ctx) {
  const member = entry.members.find((m) => m.productId === productId);
  if (!member) throw new Error('Product hoort niet bij dit item.');
  const stats = priceStats(ctx.facts, productId);
  const normal = deal.normal ?? stats.packPrice;
  if (normal == null && deal.type !== 'prijs' && deal.type !== 'xvoor') return { verdict: 'onbekend', reasons: ['Normale prijs onbekend: vul die in.'], warnings: [] };
  const eff = effectiveDeal(deal, normal);
  const reasons = [];
  const warnings = [];

  // Prijs per eenheid van deze verpakking
  const size = deal.size || stats.packSize;
  const { unit } = entryUnit(entry, ctx.lines);
  if (deal.size && unit !== 'pak' && deal.size.unit !== unit) {
    const kind = (u) => (u === 'g' ? 'gewicht' : u === 'ml' ? 'inhoud in liters' : 'stuks');
    return { verdict: 'onbekend', reasons: [`Niet te vergelijken: deze aanbieding is in ${kind(deal.size.unit)}, jullie product in ${kind(unit)}.`], warnings: [] };
  }
  if (deal.size && unit === 'pak' && stats.packSize && !(stats.packSize.unit === deal.size.unit && Math.abs(stats.packSize.amount - deal.size.amount) <= deal.size.amount * 0.02)) {
    return { verdict: 'onbekend', reasons: ['Andere verpakking dan jullie kopen en de inhoud van jullie eigen verpakking is niet bekend genoeg om per stuk/kilo te vergelijken.'], warnings: [] };
  }
  const perPackBase = unit !== 'pak' && size?.amount ? size.amount : null; // basiseenheden per verpakking
  const toPerBase = (packCents) => (perPackBase ? Math.round(packCents / (unit === 'st' ? perPackBase : perPackBase / 1000)) : packCents);
  const effBase = toPerBase(eff.unitPrice);
  const unitLabel = unit === 'pak' || !perPackBase ? 'verpakking' : unit === 'st' ? 'stuk' : unit === 'g' ? 'kilo' : 'liter';

  // Referentie: standaardproduct (wat jullie normaal kopen)
  const standard = entry.members.find((m) => m.role !== 'upgrade') || member;
  const stdStats = standard.productId === productId ? stats : priceStats(ctx.facts, standard.productId);
  const refTypical = stdStats.perBase === Boolean(perPackBase) ? stdStats.typical : null;

  // Drempel
  let threshold;
  let thresholdLabel;
  if (member.role === 'upgrade') {
    threshold = member.maxPrice ?? refTypical;
    thresholdLabel = member.maxPrice != null ? 'jullie maximum voor dit merk' : 'de normale prijs van jullie standaardproduct';
  } else {
    threshold = entry.target ?? stats.autoTarget ?? (stats.typical ? Math.round(stats.typical * 0.85) : null);
    thresholdLabel = entry.target != null ? 'jullie doelprijs' : stats.autoTarget != null ? 'een goede prijs voor jullie (beste kwart)' : '15% onder de normale prijs';
  }

  let verdict;
  if (threshold == null) verdict = 'onbekend';
  else if (effBase <= threshold) verdict = 'inslaan';
  else if (member.role !== 'upgrade' && stats.typical && effBase < stats.typical) verdict = 'redelijk';
  else verdict = 'niet';

  if (threshold != null) reasons.push(`${eff.label}: ${fmt(effBase)} per ${unitLabel}, ${effBase <= threshold ? 'onder' : 'boven'} ${thresholdLabel} (${fmt(threshold)}).`);
  if (stats.best != null && effBase < stats.best) reasons.push(`Goedkoper dan jullie ooit betaalden (laagste: ${fmt(stats.best)}).`);

  // Hoeveel: aanvullen tot maximale voorraad
  const pred = entryPrediction(entry, ctx);
  const perWeek = pred.ratePerDay ? pred.ratePerDay * 7 : null; // in eenheid van het item
  const packUnits = unit === 'pak' ? 1 : perPackBase; // eenheid per verpakking
  let buyPacks = null;
  let stockWeeks = null;
  if (perWeek && packUnits) {
    const current = pred.status.id === 'onvoldoende' ? 0 : pred.estimatedStock || 0;
    stockWeeks = current / perWeek;
    const maxUnits = perWeek * entry.maxWeeks;
    let room = Math.max(0, (maxUnits - current) / packUnits);
    if (entry.location === 'vriezer' && ctx.freezerFree != null) {
      if (ctx.freezerFree < room) warnings.push(`Vriezer bijna vol: ruimte voor ±${Math.max(0, Math.floor(ctx.freezerFree))} verpakkingen.`);
      room = Math.min(room, Math.max(0, ctx.freezerFree));
    }
    buyPacks = Math.floor(room / eff.bundle) * eff.bundle;
    if (buyPacks === 0 && room >= eff.bundle * 0.6) buyPacks = eff.bundle;
    reasons.push(`Nog ±${stockWeeks.toFixed(1).replace('.', ',')} weken voorraad; maximum ${entry.maxWeeks} weken.`);
  } else {
    warnings.push('Verbruik nog onbekend (te weinig aankopen); aantal is een gok.');
    buyPacks = eff.bundle;
  }
  if (entry.location === 'vriezer' && entry.shelfWeeks && perWeek && packUnits) {
    const weeksOfThis = (buyPacks * packUnits) / perWeek + (stockWeeks || 0);
    if (weeksOfThis > entry.shelfWeeks) warnings.push(`Let op: dat is meer dan ${entry.shelfWeeks} weken; langer dan aangeraden in de vriezer.`);
  }

  const coversWeeks = buyPacks && perWeek && packUnits ? (buyPacks * packUnits) / perWeek : null;
  const normalPack = stats.packPrice ?? normal;
  const saving = buyPacks && normalPack ? Math.round(buyPacks * (normalPack - eff.unitPrice)) : null;
  if (member.role === 'upgrade' && refTypical != null && effBase > refTypical) reasons.push(`Kost ${fmt(effBase - refTypical)} per ${unitLabel} meer dan jullie standaard.`);
  if (verdict === 'niet') buyPacks = 0;

  return { verdict, effPack: eff.unitPrice, effBase, unitLabel, bundle: eff.bundle, threshold, buyPacks, saving, stockWeeks, coversWeeks, reasons, warnings, dealLabel: eff.label };
}

/**
 * Voorstellen voor de inslaglijst: vaak gekochte, houdbare (of invriesbare) producten met
 * grote prijsverschillen of diepe acties. Bedrag = geschatte besparing per maand als jullie
 * altijd tegen een goede prijs zouden kopen (theoretisch).
 */
export function suggestEntries(facts, products, today, { existing = new Set(), freezer = true, rhythm } = {}) {
  const from = addDays(today, -180);
  const window = facts.filter((f) => f.productId && f.gross > 0 && f.date >= from);
  const first = window.reduce((m, f) => (!m || f.date < m ? f.date : m), null);
  if (!first) return [];
  const months = Math.max(0.5, (daysBetween(first, today) + 1) / 30.44);
  const byProduct = new Map();
  for (const f of window) { if (!byProduct.has(f.productId)) byProduct.set(f.productId, []); byProduct.get(f.productId).push(f); }
  const out = [];
  for (const [id, list] of byProduct) {
    const p = products.get(id);
    if (!p || existing.has(id) || !isStockable(p, { freezer })) continue;
    const dates = new Set(list.map((f) => f.date));
    if (dates.size < 3) continue;
    let stats = priceStats(list, id);
    if (!stats.perBase) {
      // Inhoud onbekend: alleen dezelfde verpakking (zelfde bonomschrijving) met elkaar vergelijken.
      const counts = new Map();
      for (const f of list) counts.set(f.name, (counts.get(f.name) || 0) + 1);
      const main = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      stats = priceStats(list.filter((f) => f.name === main), id);
    }
    const spendPerMonth = list.reduce((t, f) => t + f.net, 0) / months;
    const spread = stats.typical && stats.best != null ? Math.max(0, 1 - stats.best / stats.typical) : 0;
    const depth = rhythm?.get(id)?.discountPct || 0;
    const gain = Math.max(spread, depth);
    if (gain < 0.1) continue;
    const monthly = Math.round(spendPerMonth * gain * 0.6); // 0,6: niet alles valt in een goede week
    if (monthly < 50) continue;
    const d = defaultsFor(p);
    out.push({ productId: id, name: p.name, monthly, gain, location: d.location, purchases: dates.size,
      reason: `${dates.size}× gekocht, prijsverschil tot ${Math.round(gain * 100)}%${d.location === 'vriezer' ? ', kan de vriezer in' : ''}` });
  }
  return out.sort((a, b) => b.monthly - a.monthly);
}

/**
 * Afgeleide vriezervoorraad, zonder bijhouden: koopt u van een vriezer-item meer dan normaal,
 * dan gaat de app ervan uit dat het extra deel is ingevroren. Wat er nog ligt, volgt uit de
 * verbruiksvoorspelling (oudste eerst op). Handmatig: 'erbij' (zelf ingevroren) en 'leeg'.
 * @param {object[]} entries  inslag-items met location 'vriezer'
 * @param {object[]} manual   { id, entryId, type: 'erbij'|'leeg', qty?, date }
 * @returns {Map<entryId, { packs:number, batches:{date, qty}[], oldestWeeks:number|null, overdue:boolean, unit }>}
 */
export function freezerContents(entries, { lines, adjustments = [], products, today, vacations = [], manual = [] }) {
  const result = new Map();
  for (const entry of entries.filter((e) => e.location === 'vriezer')) {
    const { unit } = entryUnit(entry, lines);
    const ids = new Set(entry.members.map((m) => m.productId));
    const own = lines.filter((l) => ids.has(l.productId) && l.kind === 'product' && l.amount > 0);
    // Per aankoopdag
    const byDate = new Map();
    for (const l of own) byDate.set(l.date, (byDate.get(l.date) || 0) + amountOf(l, unit));
    const buys = [...byDate.entries()].map(([date, qty]) => ({ date, qty })).sort((a, b) => a.date.localeCompare(b.date));
    const typical = median(buys.map((b) => b.qty)) || 0;
    const mine = manual.filter((m) => m.entryId === entry.id).sort((a, b) => a.date.localeCompare(b.date));
    const lastClear = mine.filter((m) => m.type === 'leeg').at(-1)?.date || '0000';
    const sizes = own.filter((l) => l.sizeAmount).map((l) => l.sizeAmount);
    const packSize = unit === 'pak' ? 1 : unit === 'g' && own.every((l) => l.weighed) ? 1000 : median(sizes) || 1;
    // Handmatige invoer is in verpakkingen; omrekenen naar de eenheid van het item.
    const batches = [
      ...buys.filter((b) => b.qty > typical && b.date > lastClear).map((b) => ({ date: b.date, qty: b.qty - typical, source: 'inslag' })),
      ...mine.filter((m) => m.type === 'erbij' && m.date >= lastClear).map((m) => ({ date: m.date, qty: m.qty * packSize, source: 'handmatig' })),
    ].sort((a, b) => a.date.localeCompare(b.date));
    const pred = entryPrediction(entry, { lines, adjustments, products, today, vacations });
    const totalBatches = batches.reduce((t, b) => t + b.qty, 0);
    // Wat er nog in de vriezer ligt: niet meer dan de geschatte totale voorraad minus een normale verse portie.
    const fromModel = pred.status.id === 'onvoldoende' || pred.estimatedStock == null
      ? totalBatches // geen schatting: dan nemen we niets weg (gebruiker kan "leeg" tikken)
      : Math.max(0, pred.estimatedStock - typical);
    const manualQty = batches.filter((b) => b.source === 'handmatig').reduce((t, b) => t + b.qty, 0);
    let left = Math.min(totalBatches, fromModel + manualQty);
    // FIFO: oudste eerst op → wat overblijft zijn de nieuwste partijen
    const remaining = [];
    for (const b of [...batches].reverse()) {
      if (left <= 0) break;
      const q = Math.min(b.qty, left);
      remaining.unshift({ ...b, qty: q });
      left -= q;
    }
    const packs = remaining.reduce((t, b) => t + b.qty, 0) / packSize;
    const oldest = remaining[0]?.date || null;
    const oldestWeeks = oldest ? daysBetween(oldest, today) / 7 : null;
    result.set(entry.id, {
      packs: Math.round(packs * 10) / 10, batches: remaining.map((b) => ({ ...b, packs: Math.round((b.qty / packSize) * 10) / 10 })), oldest, oldestWeeks, unit, packSize,
      overdue: Boolean(entry.shelfWeeks && oldestWeeks != null && oldestWeeks > entry.shelfWeeks * 0.8),
      estimated: pred.status.id !== 'onvoldoende',
    });
  }
  return result;
}

function fmt(cents) {
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(cents / 100);
}
