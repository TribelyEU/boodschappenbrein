// Uitgavenanalyse. Alle berekeningen werken op "feiten": één feit per productregel (netto, na gekoppelde korting)
// plus losse feiten voor kortingen die niet aan een product te koppelen zijn.
// Statiegeld en niet-boodschappen (koopzegels e.d.) tellen niet mee in boodschappenuitgaven.

import { addDays, daysBetween, startOfMonth, startOfWeek, startOfYear, endOfMonth, daysInMonth, addMonths, isoWeek, formatDate } from './dates.js';
import { UNASSIGNED_DISCOUNT } from './categories.js';

export const GROCERY_KINDS = new Set(['product', 'return', 'discount']);

/**
 * @param {object[]} lines  opgeslagen bonregels
 * @param {Map<string, object>} products
 * @returns {object[]} feiten { date, store, productId, category, brand, house, gross, discount, net, qty, lineId, receiptId }
 */
export function buildFacts(lines, products) {
  const productLineIds = new Set();
  for (const l of lines) if (l.kind === 'product' || l.kind === 'return') productLineIds.add(l.id);
  // Een korting die aan één regel hangt, geldt voor alle regels van hetzelfde artikel op die bon
  // (bv. 3× "RED BAND" en één "BONUS REDBANDSTAZA"): verdelen naar rato van het bedrag.
  const byId = new Map(lines.map((l) => [l.id, l]));
  const groupOf = new Map();
  for (const l of lines) {
    if (l.kind !== 'product') continue;
    const k = `${l.receiptId}|${l.rawName}`;
    if (!groupOf.has(k)) groupOf.set(k, []);
    groupOf.get(k).push(l);
  }
  const discountsByLine = new Map();
  for (const l of lines) {
    if (!(l.kind === 'discount' && l.linkedTo && productLineIds.has(l.linkedTo))) continue;
    const group = [];
    for (const id of [l.linkedTo, ...(l.linkedAlso || [])]) {
      const target = byId.get(id);
      if (!target) continue;
      for (const g of target.kind === 'product' ? groupOf.get(`${target.receiptId}|${target.rawName}`) : [target]) if (!group.includes(g)) group.push(g);
    }
    const sum = group.reduce((t, g) => t + Math.max(0, g.amount), 0);
    let rest = l.amount;
    group.forEach((g, i) => {
      const share = i === group.length - 1 || !sum ? rest : Math.round((l.amount * Math.max(0, g.amount)) / sum);
      rest -= share;
      discountsByLine.set(g.id, (discountsByLine.get(g.id) || 0) + share);
    });
  }
  const facts = [];
  for (const l of lines) {
    if (!GROCERY_KINDS.has(l.kind)) continue;
    if (l.kind === 'discount') {
      if (l.linkedTo && productLineIds.has(l.linkedTo)) continue; // al verrekend bij het product
      facts.push({
        date: l.date, store: l.store, productId: null, category: UNASSIGNED_DISCOUNT.id, brand: null, house: false,
        gross: 0, discount: l.amount, net: l.amount, qty: 0, lineId: l.id, receiptId: l.receiptId, name: l.rawName,
      });
      continue;
    }
    const p = l.productId ? products.get(l.productId) : null;
    const discount = discountsByLine.get(l.id) || 0;
    facts.push({
      date: l.date,
      store: l.store,
      productId: l.productId || null,
      category: p?.category || 'overig',
      brand: l.brand || null,
      house: Boolean(l.house),
      gross: l.amount,
      discount,
      net: l.amount + discount,
      qty: l.qty || 1,
      // Zelf ingevulde inhoud bij het product ("6 x 1,5 l") gaat voor; anders wat op de bon staat
      sizeAmount: (!l.weighed && p?.size?.amount) || l.sizeAmount || null,
      sizeUnit: (!l.weighed && p?.size?.amount ? p.size.unit : l.sizeUnit) || null,
      weighed: Boolean(l.weighed),
      promo: Boolean(l.promo),
      normalUnknown: Boolean(l.normalUnknown),
      lineId: l.id,
      receiptId: l.receiptId,
      name: l.rawName,
    });
  }
  return facts;
}

export function inRange(facts, from, to) {
  return facts.filter((f) => f.date >= from && f.date <= to);
}

export function total(facts) {
  let t = 0;
  for (const f of facts) t += f.net;
  return t;
}

export function groupBy(facts, keyFn) {
  const map = new Map();
  for (const f of facts) {
    const k = keyFn(f);
    if (k == null) continue;
    let g = map.get(k);
    if (!g) { g = { key: k, net: 0, gross: 0, discount: 0, qty: 0, count: 0, facts: [] }; map.set(k, g); }
    g.net += f.net; g.gross += f.gross; g.discount += f.discount; g.qty += f.qty; g.count++; g.facts.push(f);
  }
  return [...map.values()].sort((a, b) => b.net - a.net);
}

/** Tijdreeks per week, maand of jaar. */
export function timeSeries(facts, granularity, from, to) {
  const keyOf = (d) => granularity === 'week' ? startOfWeek(d) : granularity === 'maand' ? startOfMonth(d) : d.slice(0, 4) + '-01-01';
  const buckets = new Map();
  let cursor = keyOf(from);
  const end = keyOf(to);
  let guard = 0;
  while (cursor <= end && guard++ < 1000) {
    buckets.set(cursor, 0);
    cursor = granularity === 'week' ? addDays(cursor, 7) : granularity === 'maand' ? addMonths(cursor, 1) : `${+cursor.slice(0, 4) + 1}-01-01`;
  }
  for (const f of facts) {
    if (f.date < from || f.date > to) continue;
    const k = keyOf(f.date);
    if (buckets.has(k)) buckets.set(k, buckets.get(k) + f.net);
  }
  return [...buckets.entries()].map(([key, net]) => ({ key, net, label: bucketLabel(key, granularity) }));
}

export function bucketLabel(key, granularity) {
  if (granularity === 'week') return `wk ${isoWeek(key).week}`;
  if (granularity === 'maand') return formatDate(key, 'month').slice(0, 3);
  return key.slice(0, 4);
}

/**
 * Dashboardcijfers. Feiten (gemeten) en voorspellingen worden apart gelabeld.
 */
export function dashboardStats(facts, today) {
  const monthStart = startOfMonth(today);
  const prevMonthStart = addMonths(monthStart, -1);
  const prevMonthEnd = addDays(monthStart, -1);
  const dayOfMonth = daysBetween(monthStart, today) + 1;
  const prevSameDay = addDays(prevMonthStart, Math.min(dayOfMonth, daysInMonth(prevMonthStart)) - 1);

  const thisMonth = total(inRange(facts, monthStart, today));
  const prevMonthFull = total(inRange(facts, prevMonthStart, prevMonthEnd));
  const prevMonthToDate = total(inRange(facts, prevMonthStart, prevSameDay));
  const ytd = total(inRange(facts, startOfYear(today), today));

  // Gemiddelde per week over de laatste 12 volledige weken waarvoor gegevens bestaan.
  const firstDate = facts.reduce((m, f) => (!m || f.date < m ? f.date : m), null);
  const weekEnd = addDays(startOfWeek(today), -1);
  let weekStart = addDays(startOfWeek(today), -7 * 12);
  if (firstDate && firstDate > weekStart) weekStart = startOfWeek(firstDate);
  const weeks = Math.max(0, Math.round((daysBetween(weekStart, weekEnd) + 1) / 7));
  const avgWeek = weeks >= 2 ? Math.round(total(inRange(facts, weekStart, weekEnd)) / weeks) : null;

  // Voorspelling rest van de maand: gemiddelde dagelijkse uitgaven van de afgelopen 8 weken.
  const histFrom = addDays(today, -56);
  const histDays = firstDate ? Math.min(56, daysBetween(firstDate > histFrom ? firstDate : histFrom, today)) : 0;
  const daysLeft = daysBetween(today, endOfMonth(today));
  let forecast = null;
  if (histDays >= 21) {
    const perDay = total(inRange(facts, addDays(today, -histDays), addDays(today, -1))) / histDays;
    forecast = { restOfMonth: Math.round(perDay * daysLeft), monthTotal: Math.round(thisMonth + perDay * daysLeft), basisDays: histDays, daysLeft };
  }

  return {
    thisMonth, prevMonthFull, prevMonthToDate, ytd, avgWeek, weeksUsed: weeks, forecast,
    monthStart, today, hasData: facts.length > 0, firstDate,
  };
}

/** Prijshistorie van een product: per aankoop de betaalde stukprijs en (indien bekend) prijs per kilo/liter/stuk. */
export function priceHistory(facts, productId) {
  return facts
    .filter((f) => f.productId === productId && f.gross > 0 && f.qty > 0)
    .map((f) => {
      const paidPerUnit = Math.round(f.net / f.qty);
      const normalPerUnit = Math.round(f.gross / f.qty);
      let perBase = null;
      let perBaseNormal = null;
      if (f.weighed) { perBase = paidPerUnit; perBaseNormal = normalPerUnit; } // al per kilo
      else if (f.sizeAmount && f.sizeUnit) {
        const base = f.sizeUnit === 'st' ? f.sizeAmount : f.sizeAmount / 1000;
        if (base) { perBase = Math.round(paidPerUnit / base); perBaseNormal = Math.round(normalPerUnit / base); }
      }
      return { date: f.date, store: f.store, brand: f.brand, house: f.house, qty: f.qty, paidPerUnit, normalPerUnit, discounted: f.discount < 0 || f.promo, normalUnknown: f.normalUnknown, perBase, perBaseNormal, sizeAmount: f.sizeAmount, sizeUnit: f.sizeUnit, weighed: f.weighed, net: f.net, name: f.name };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Vergelijkbare prijs: prijs per kilo/liter/stuk als bekend, anders normale stukprijs van dezelfde verpakking. */
function comparablePrice(h) {
  return h.perBaseNormal ?? h.normalPerUnit;
}

/**
 * Opvallende prijsstijgingen: normale (niet-actie) prijs in de laatste 90 dagen vs. 90–365 dagen geleden.
 * Alleen bij ≥2 aankopen in beide periodes, zelfde merk/inhoud-groep.
 */
export function priceIncreases(facts, products, today, { minPct = 0.08 } = {}) {
  const recentFrom = addDays(today, -90);
  const oldFrom = addDays(today, -365);
  const groups = groupBy(facts.filter((f) => f.productId && f.gross > 0 && f.qty > 0), (f) => `${f.productId}|${f.brand || ''}|${f.weighed ? 'kg' : (f.sizeAmount || '')}`);
  const out = [];
  for (const g of groups) {
    // Factuurregels met BONUS hebben geen bekende normale prijs: niet meenemen.
    const hist = priceHistory(g.facts, g.facts[0].productId).filter((h) => !h.normalUnknown);
    const recent = hist.filter((h) => h.date >= recentFrom).map(comparablePrice);
    const old = hist.filter((h) => h.date >= oldFrom && h.date < recentFrom).map(comparablePrice);
    if (recent.length < 2 || old.length < 2) continue;
    const med = (a) => { const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
    const before = med(old);
    const after = med(recent);
    const change = (after - before) / before;
    if (change >= minPct) {
      const p = products.get(g.facts[0].productId);
      out.push({ productId: p?.id, name: p?.name || g.facts[0].name, brand: g.facts[0].brand, before: Math.round(before), after: Math.round(after), change, samples: recent.length + old.length, perBase: hist.some((h) => h.perBase != null) });
    }
  }
  return out.sort((a, b) => b.change - a.change);
}
