// Demomodus: FICTIEVE bonnen om de app te verkennen. Deze worden in een aparte database opgeslagen
// en nooit vermengd met echte gegevens.

import { addDays, daysBetween, startOfWeek } from './dates.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// naam op bon, prijs in centen, gemiddeld verbruik per week (stuks), winkel-voorkeur
const CATALOG = [
  ['AH Halfvolle melk 1L', 109, 6, 'ah'], ['Campina Halfvolle melk 1L', 159, 1, 'ah'], ['AH Volkoren brood', 219, 3, 'ah'],
  ['AH Bananen', 35, 10, 'ah'], ['AH Griekse yoghurt 1000G', 289, 1.5, 'ah'], ['AH Jong belegen kaas 500G', 589, 0.8, 'ah'],
  ['AH Roomboter 250G', 299, 0.5, 'ah'], ['Douwe Egberts Aroma rood 500G', 789, 0.5, 'ah'], ['AH Snelkookrijst 1KG', 239, 0.3, 'ah'],
  ['AH Spaghetti 500G', 129, 0.7, 'ah'], ['AH Kipfilet 600G', 799, 1, 'ah'], ['AH Rundergehakt 500G', 549, 0.7, 'ah'],
  ['Page Toiletpapier 12 rollen', 649, 0.4, 'ah'], ['Robijn Wasmiddel 1,5L', 999, 0.25, 'ah'], ['Lays Chips Naturel 225G', 249, 1.5, 'ah'],
  ['AH Appels Elstar 1KG', 279, 1, 'ah'], ['AH Komkommer', 99, 2, 'ah'], ['AH Pindakaas 600G', 349, 0.3, 'ah'],
  ['Optimel Drinkyoghurt 1L', 199, 1, 'ah'], ['AH Hagelslag melk 400G', 229, 0.4, 'ah'],
  ['Halfvolle melk 1L', 99, 3, 'lidl'], ['Milbona Griekse yoghurt 1000G', 199, 1, 'lidl'], ['Volkoren brood', 159, 1, 'lidl'],
  ['Bananen', 29, 4, 'lidl'], ['W5 Wasmiddel 1,5L', 499, 0.1, 'lidl'],
];

// Fictief Bonus-ritme per product: [om de hoeveel weken in de aanbieding, startweek]
const PROMO_CYCLES = {
  'Douwe Egberts Aroma rood 500G': [5, 1], 'Page Toiletpapier 12 rollen': [6, 2], 'Robijn Wasmiddel 1,5L': [7, 3],
  'Lays Chips Naturel 225G': [4, 0], 'AH Kipfilet 600G': [3, 1], 'Campina Halfvolle melk 1L': [4, 2],
  'AH Griekse yoghurt 1000G': [5, 4], 'AH Pindakaas 600G': [6, 0], 'Optimel Drinkyoghurt 1L': [4, 1],
};
const STOCKABLE = new Set(['Douwe Egberts Aroma rood 500G', 'Page Toiletpapier 12 rollen', 'Robijn Wasmiddel 1,5L', 'AH Pindakaas 600G', 'Lays Chips Naturel 225G', 'AH Kipfilet 600G']);

/** Maakt ~6 maanden fictieve bonnen. Elke bon is een "bonvoorstel" zoals de parser het oplevert. */
export function generateDemoReceipts(today, seed = 7) {
  const rand = rng(seed);
  const receipts = [];
  const start = addDays(today, -190);
  for (let d = 0; d <= 190; d++) {
    const date = addDays(start, d);
    const dow = new Date(date + 'T12:00:00').getDay();
    const store = dow === 6 ? 'ah' : dow === 3 ? 'lidl' : rand() < 0.12 ? 'ah' : null;
    if (!store) continue;
    const lines = [];
    const factor = store === 'ah' && dow === 6 ? 7 / 1.15 : 3.5;
    for (const [name, price, perWeek, pref] of CATALOG) {
      if (pref !== store) continue;
      const expected = (perWeek * factor) / 7;
      let qty = Math.round(expected + (rand() - 0.5) * Math.max(1, expected * 0.6));
      if (expected < 1) qty = rand() < expected ? 1 : 0;
      const cyc0 = PROMO_CYCLES[name];
      const week0 = Math.floor(daysBetween(startOfWeek(start), startOfWeek(date)) / 7);
      if (qty <= 0 && store === 'ah' && dow === 6 && cyc0 && (week0 + cyc0[1]) % cyc0[0] === 0 && STOCKABLE.has(name)) qty = 1; // in de aanbieding: toch kopen
      if (qty <= 0) continue;
      // Lichte inflatie, plus een fictieve prijsverhoging van 20% op koffie halverwege
      const inflation = (1 + (d / 190) * 0.03) * (name.includes('Douwe') && d > 110 ? 1.2 : 1);
      const unit = Math.round(price * inflation);
      lines.push({ rawName: name, qty, unitPrice: unit, amount: unit * qty, kind: 'product', raw: '', confidence: 1, linkedTo: null });
      const cyc = PROMO_CYCLES[name];
      const week = Math.floor(daysBetween(startOfWeek(start), startOfWeek(date)) / 7);
      const onPromo = store === 'ah' && (cyc ? (week + cyc[1]) % cyc[0] === 0 : rand() < 0.06);
      if (onPromo) {
        const product = lines.at(-1);
        product.promo = true;
        if (STOCKABLE.has(name)) { product.qty = qty * 2; product.amount = unit * qty * 2; } // inslaan
        const disc = -Math.round(product.amount * (cyc ? 0.3 : 0.25));
        lines.push({ rawName: `BONUS ${name}`, qty: 1, unitPrice: disc, amount: disc, kind: 'discount', raw: '', confidence: 1, linkedTo: lines.length - 1 });
      }
    }
    if (!lines.length) continue;
    const total = lines.reduce((t, l) => t + l.amount, 0);
    receipts.push({ store, date, total, computedTotal: total, check: 'ok', lines, warnings: [], rawText: '(demobon – fictief)' });
  }
  return receipts;
}
