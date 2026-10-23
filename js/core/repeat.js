// Hardlopers: producten die jullie steeds opnieuw kopen (koffiecups, wc-papier, luiers).
// Geen voorraadschatting: alleen "jullie kopen dit meestal om de ±N weken, en het is nu M weken geleden".

import { daysBetween } from './dates.js';

const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };

/**
 * Aankoopritme van één product: mediaan aantal dagen tussen aankoopdagen.
 * @param {{date:string}[]} purchases
 */
export function buyingInterval(purchases) {
  const days = [...new Set(purchases.map((p) => p.date))].sort();
  if (days.length < 3) return null;
  const gaps = days.slice(1).map((d, i) => daysBetween(days[i], d)).filter((g) => g > 0);
  const every = median(gaps);
  return every ? { every: Math.round(every), last: days.at(-1), times: days.length } : null;
}

/**
 * Herinneringen voor de lijst: hardlopers waarvan de gebruikelijke tussentijd (bijna) om is.
 * @returns {{productId, every, last, since}[]}
 */
export function dueRepeaters({ repeaters = [], purchasesByProduct, today, snoozed = {}, onList = new Set() }) {
  const out = [];
  for (const id of repeaters) {
    if (onList.has(id)) continue;
    if (snoozed[id] && snoozed[id] >= today) continue;
    const iv = buyingInterval(purchasesByProduct.get(id) || []);
    if (!iv) continue;
    const since = daysBetween(iv.last, today);
    // Een paar dagen vóór het gebruikelijke moment al melden: dan kan het mee met de volgende boodschappen.
    if (since >= Math.max(3, iv.every - 3)) out.push({ productId: id, ...iv, since });
  }
  return out.sort((a, b) => b.since / b.every - a.since / a.every);
}

/** Voorstellen voor hardlopers: minstens 3 keer gekocht, met een redelijk vaste tussentijd. */
export function repeaterCandidates(purchasesByProduct, products) {
  const out = [];
  for (const [id, purchases] of purchasesByProduct) {
    const iv = buyingInterval(purchases);
    if (!iv || iv.every < 5) continue;
    out.push({ productId: id, name: products.get(id)?.name || '?', ...iv });
  }
  return out.sort((a, b) => b.times - a.times || a.name.localeCompare(b.name));
}
