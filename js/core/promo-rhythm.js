// Bonus-ritme: uit de eigen bonnen afleiden hoe vaak en hoe diep een product in de aanbieding is,
// en wanneer de volgende aanbieding waarschijnlijk komt.
//
// Wat we wél weten: wanneer jullie iets kochten en of dat met korting was (B-markering, gekoppelde
// BONUS-regel, of BONUS op een online factuur).
// Wat we níet weten: aanbiedingen in weken dat jullie het product niet kochten. Het waargenomen ritme
// is daarom een ondergrens: in werkelijkheid kan een product vaker in de aanbieding zijn geweest.
// Dat staat er in de app ook bij.
//
// AH-bonusweken lopen van maandag t/m zondag; we rekenen daarom in weken (maandag als start).

import { addDays, daysBetween, startOfWeek } from './dates.js';

export const RHYTHM_STATUS = {
  weinig: 'Te weinig aankopen',
  nooit: 'Nooit met korting gekocht',
  soms: 'Af en toe met korting',
  ritme: 'Vast ritme',
  onregelmatig: 'Onregelmatig in de aanbieding',
};

const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * @param {object[]} facts  feiten van één product (uit buildFacts)
 * @param {string} today
 * @param {{ perWeek?: number }} opts  verbruik per week uit het voorraadmodel (optioneel)
 */
export function promoRhythm(facts, today, opts = {}) {
  const rows = facts.filter((f) => f.gross > 0 && f.qty > 0);
  // Per aankoopdag samenvoegen
  const byDate = new Map();
  for (const f of rows) {
    const d = byDate.get(f.date) || { date: f.date, promo: false, gross: 0, discount: 0, qty: 0, knownGross: 0 };
    const promo = f.promo || f.discount < 0;
    d.promo = d.promo || promo;
    d.gross += f.gross;
    d.discount += f.discount;
    d.qty += f.qty;
    if (f.discount < 0) d.knownGross += f.gross; // alleen hier kennen we de normale prijs én de korting
    byDate.set(f.date, d);
  }
  const purchases = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const n = purchases.length;
  const promoPurchases = purchases.filter((p) => p.promo);
  const spend = rows.reduce((t, f) => t + f.net, 0);
  const promoSpend = rows.filter((f) => f.promo || f.discount < 0).reduce((t, f) => t + f.net, 0);
  const saved = -rows.reduce((t, f) => t + Math.min(0, f.discount), 0);

  // Gemiddelde korting: alleen waar korting én normale prijs bekend zijn (niet bij online facturen).
  const known = purchases.filter((p) => p.discount < 0 && p.knownGross > 0);
  const discountPct = known.length ? -known.reduce((t, p) => t + p.discount, 0) / known.reduce((t, p) => t + p.knownGross, 0) : null;

  // Aanbiedingsperiodes: weken met een aankoop in de aanbieding; aaneengesloten weken = één periode.
  const weeks = [...new Set(promoPurchases.map((p) => startOfWeek(p.date)))].sort();
  const episodes = [];
  for (const w of weeks) {
    const last = episodes.at(-1);
    if (last && daysBetween(last.end, w) <= 7) last.end = w;
    else episodes.push({ start: w, end: w });
  }
  const intervals = [];
  for (let i = 1; i < episodes.length; i++) intervals.push(daysBetween(episodes[i - 1].start, episodes[i].start) / 7);

  const base = {
    purchases: n,
    promoPurchases: promoPurchases.length,
    promoShare: n ? promoPurchases.length / n : 0,
    spend,
    promoSpend,
    saved,
    discountPct,
    episodes,
    lastPromo: episodes.at(-1)?.start || null,
    firstPurchase: purchases[0]?.date || null,
    timeline: purchases.map((p) => ({ week: startOfWeek(p.date), promo: p.promo })),
  };

  if (n < 3) return { ...base, status: 'weinig' };
  if (!episodes.length) return { ...base, status: 'nooit' };
  if (episodes.length < 3) return { ...base, status: 'soms' };

  const every = median(intervals);
  const spread = median(intervals.map((x) => Math.abs(x - every)));
  const regular = every >= 1.5 && spread <= Math.max(1, every * 0.3);
  if (!regular) return { ...base, status: 'onregelmatig', every, spread };

  // Volgende verwachte periode: laatste start + ritme. Ligt die al achter ons zonder nieuwe aankoop,
  // dan schuiven we één ritme op en melden we dat het ritme mogelijk is veranderd.
  const thisWeek = startOfWeek(today);
  let next = addDays(base.lastPromo, Math.round(every * 7));
  let missed = 0;
  while (startOfWeek(next) < thisWeek && missed < 6) { next = addDays(next, Math.round(every * 7)); missed++; }
  next = startOfWeek(next);
  const weeksUntil = Math.round(daysBetween(thisWeek, next) / 7);
  const inPromoNow = base.lastPromo === thisWeek;

  // Hoeveel inslaan in de aanbieding: genoeg voor één ritme (tot de volgende aanbieding), minus marge.
  const stockUp = opts.perWeek > 0 ? Math.max(1, Math.round(opts.perWeek * every)) : null;

  return { ...base, status: 'ritme', every, spread, next, weeksUntil, missed, inPromoNow, stockUp };
}

/**
 * Overzicht voor alle producten.
 * @returns {{ rows: object[], totals: { spend:number, promoSpend:number, saved:number, share:number } }}
 */
export function rhythmOverview(facts, products, today, { predictions } = {}) {
  const byProduct = new Map();
  for (const f of facts) {
    if (!f.productId) continue;
    if (!byProduct.has(f.productId)) byProduct.set(f.productId, []);
    byProduct.get(f.productId).push(f);
  }
  const rows = [];
  for (const [id, list] of byProduct) {
    const p = products.get(id);
    if (!p) continue;
    const r = promoRhythm(list, today, { perWeek: predictions?.get(id)?.perWeek });
    rows.push({ productId: id, name: p.name, category: p.category, ...r, advice: adviceFor(r) });
  }
  const spend = facts.filter((f) => f.gross > 0).reduce((t, f) => t + f.net, 0);
  const promoSpend = facts.filter((f) => f.gross > 0 && (f.promo || f.discount < 0)).reduce((t, f) => t + f.net, 0);
  const saved = -facts.reduce((t, f) => t + Math.min(0, f.discount) + (f.category === 'korting' ? f.net : 0), 0);
  return { rows, totals: { spend, promoSpend, saved, share: spend ? promoSpend / spend : 0 } };
}

/** Korte, eerlijke adviestekst per product (of null als er niets zinnigs te zeggen is). */
export function adviceFor(r) {
  if (r.status === 'ritme') {
    const pct = r.discountPct ? ` (gem. ${Math.round(r.discountPct * 100)}% korting)` : '';
    if (r.inPromoNow) return `Nu in de aanbieding${pct}. Volgende keer pas over ±${Math.round(r.every)} weken${r.stockUp ? `: sla ${r.stockUp} stuks in` : ''}.`;
    if (r.weeksUntil <= 1) return `Aanbieding verwacht ${r.weeksUntil <= 0 ? 'deze' : 'volgende'} week${pct}. Niet nu inslaan.`;
    return `Ongeveer elke ${Math.round(r.every)} weken in de aanbieding${pct}; volgende rond over ${r.weeksUntil} weken.${r.missed ? ' (De vorige verwachte aanbieding staat niet op jullie bonnen.)' : ''}`;
  }
  if ((r.status === 'soms' || r.status === 'onregelmatig') && r.promoPurchases >= 2 && r.promoShare < 0.5 && r.discountPct >= 0.15) {
    return `Komt in de aanbieding (gem. ${Math.round(r.discountPct * 100)}% korting), maar ${Math.round((1 - r.promoShare) * 100)}% van de aankopen was zonder korting.`;
  }
  return null;
}
