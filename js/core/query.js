// Slimme zoekfunctie: Nederlandse vragen omzetten naar gestructureerde berekeningen.
// Geen AI nodig; elk antwoord wordt berekend uit de opgeslagen bonregels en vermeldt waarop het gebaseerd is.

import { addDays, addMonths, startOfMonth, endOfMonth, startOfWeek, startOfYear, MONTH_NAMES, formatDate } from './dates.js';
import { inRange, total, groupBy, priceHistory, priceIncreases } from './analytics.js';
import { CATEGORIES, categoryName } from './categories.js';
import { STORES, storeName } from './stores.js';
import { normalizeText, stem } from './text.js';
import { neededWithin } from './stock-model.js';
import { euro } from './money.js';

const NUMBER_WORDS = { een: 1, twee: 2, drie: 3, vier: 4, vijf: 5, zes: 6, zeven: 7, acht: 8, negen: 9, tien: 10, elf: 11, twaalf: 12, twintig: 20, vijftien: 15 };

const FILLER = new Set(('hoeveel hebben we wij ik heb hebt heeft dit deze die dat het de een aan voor op in bij van uit gegeven uitgegeven ' +
  'besteed kwijt geweest wat zijn is onze ons mijn jullie welke wie waar wanneer gemiddeld betalen betaald betaal kost kosten ' +
  'kopen gekocht koop duurste goedkoopste producten product boodschappen jaar maand week dag vorige vorig afgelopen laatste ' +
  'sinds totaal totale euro geld per stuk kilo liter prijs prijzen sterkst sterkste meest gestegen stijging gestegen? ' +
  'waarschijnlijk moeten volgende binnenkort kunnen besparen bespaard huismerk huismerken a merk merken top dagen weken maanden ' +
  'vandaag gisteren supermarkt winkel en of ook nog al zo veel vaak vaakst hoe er gaan gaat aanbieding aanbiedingen bonus actie acties korting weer verwacht ritme').split(' '));

/** Periode uit de vraag halen. Geeft { from, to, label } of null. */
export function parsePeriod(q, today) {
  const n = normalizeText(q);
  const num = (s) => (/^\d+$/.test(s) ? parseInt(s, 10) : NUMBER_WORDS[s]);
  let m = n.match(/\b(?:laatste|afgelopen)\s+(\d+|\w+)\s+(dag|dagen|week|weken|maand|maanden|jaar)\b/);
  if (m && num(m[1])) {
    const k = num(m[1]);
    const unit = m[2];
    const from = unit.startsWith('dag') ? addDays(today, -k + 1) : unit.startsWith('we') ? addDays(today, -7 * k + 1) : unit.startsWith('maand') ? addDays(addMonths(today, -k), 1) : addDays(addMonths(today, -12 * k), 1);
    return { from, to: today, label: `de laatste ${k} ${unit}` };
  }
  if (/\bvandaag\b/.test(n)) return { from: today, to: today, label: 'vandaag' };
  if (/\bgisteren\b/.test(n)) return { from: addDays(today, -1), to: addDays(today, -1), label: 'gisteren' };
  if (/\b(deze|huidige) week\b/.test(n)) return { from: startOfWeek(today), to: today, label: 'deze week' };
  if (/\b(vorige|afgelopen) week\b/.test(n)) { const s = addDays(startOfWeek(today), -7); return { from: s, to: addDays(s, 6), label: 'vorige week' }; }
  if (/\b(deze|huidige) maand\b/.test(n)) return { from: startOfMonth(today), to: today, label: 'deze maand' };
  if (/\b(vorige|afgelopen) maand\b/.test(n)) { const s = addMonths(startOfMonth(today), -1); return { from: s, to: endOfMonth(s), label: formatDate(s, 'month') }; }
  if (/\b(dit|huidige|lopende) jaar\b/.test(n)) return { from: startOfYear(today), to: today, label: `dit jaar (${today.slice(0, 4)})` };
  if (/\bvorig jaar\b/.test(n)) { const y = +today.slice(0, 4) - 1; return { from: `${y}-01-01`, to: `${y}-12-31`, label: String(y) }; }
  if (/\bafgelopen jaar\b/.test(n)) return { from: addDays(addMonths(today, -12), 1), to: today, label: 'de afgelopen 12 maanden' };
  for (let i = 0; i < 12; i++) {
    if (new RegExp(`\\b${MONTH_NAMES[i]}\\b`).test(n)) {
      const yMatch = n.match(/\b(20\d{2})\b/);
      let y = yMatch ? +yMatch[1] : +today.slice(0, 4);
      if (!yMatch && `${y}-${String(i + 1).padStart(2, '0')}-01` > today) y--;
      const s = `${y}-${String(i + 1).padStart(2, '0')}-01`;
      return { from: s, to: endOfMonth(s), label: `${MONTH_NAMES[i]} ${y}` };
    }
  }
  const y = n.match(/\bin (20\d{2})\b/);
  if (y) return { from: `${y[1]}-01-01`, to: `${y[1]}-12-31`, label: y[1] };
  return null;
}

function parseStore(q) {
  const n = ' ' + normalizeText(q) + ' ';
  if (/ ah | appie /.test(n)) return 'ah';
  for (const s of STORES) if (n.includes(' ' + normalizeText(s.name) + ' ') || n.includes(' ' + s.id + ' ')) return s.id;
  return null;
}

const CATEGORY_WORDS = {
  'groente-fruit': ['groente', 'fruit', 'groenten'], zuivel: ['zuivel'], 'brood-ontbijt': ['ontbijt'],
  'vlees-vis-vega': ['vlees', 'vis', 'vegetarisch'], houdbaar: ['houdbare', 'houdbaar'], diepvries: ['diepvries'],
  dranken: ['dranken', 'drinken'], snacks: ['snacks', 'snoep'], verzorging: ['verzorging'],
  schoonmaak: ['schoonmaak', 'schoonmaakmiddelen'], huishouden: ['huishoudelijke', 'huishouden'],
};

function parseCategory(q) {
  const tokens = normalizeText(q).split(' ');
  for (const [id, words] of Object.entries(CATEGORY_WORDS)) if (words.some((w) => tokens.includes(w))) return id;
  return null;
}

/** Productwoorden: wat overblijft na het weghalen van vraag-, periode-, winkel- en categoriewoorden. */
function productTerms(q, storeId, categoryId) {
  const skip = new Set([...FILLER, ...MONTH_NAMES, ...Object.keys(NUMBER_WORDS), 'ah', 'appie', 'albert', 'heijn', ...STORES.map((s) => s.id),
    ...(categoryId ? CATEGORY_WORDS[categoryId] : [])]);
  return normalizeText(q).split(' ').filter((t) => t.length >= 3 && !skip.has(t) && !/^\d+$/.test(t)).map(stem);
}

export function findProducts(terms, products) {
  if (!terms.length) return [];
  const out = [];
  for (const p of products.values()) {
    const hay = (p.key + ' ' + normalizeText(p.name)).split(' ').map(stem);
    const all = terms.every((t) => hay.some((h) => h === t || (t.length >= 4 && h.includes(t))));
    if (all) out.push(p);
  }
  return out;
}

/** Ontleedt een vraag tot een intentie met filters. */
export function parseQuery(q, today) {
  const n = normalizeText(q);
  const period = parsePeriod(q, today);
  const store = parseStore(q);
  const category = parseCategory(q);
  let intent = 'zoek';
  if (/(aanbieding|bonus|actie|korting)/.test(n) && /(wanneer|binnenkort|volgende|verwacht|weer|ritme)/.test(n)) intent = 'bonus';
  else if (/besparen|bespaar|besparing/.test(n)) intent = 'besparen';
  else if (/(volgende week|binnenkort|moeten we .*kopen|wat moet ik kopen|bijna op|wat is op)/.test(n)) intent = 'nodig';
  else if (/(gestegen|stijging|duurder geworden|prijsstijging)/.test(n)) intent = 'stijging';
  else if (/(meest gekocht|vaakst|meeste keren)/.test(n)) intent = 'frequent';
  else if (/duurste|meeste geld|grootste uitgaven|top \d+/.test(n)) intent = 'top';
  else if (/gemiddeld/.test(n) && /(betalen|betaald|kost|prijs)/.test(n)) intent = 'gemiddelde';
  else if (/(uitgegeven|besteed|kwijt|uitgaven|gespendeerd|hoeveel geld)/.test(n)) intent = 'uitgaven';
  const topN = (() => {
    const m = n.match(/\b(?:top|duurste|meest gekochte)\s+(\d+|\w+)\b/) || n.match(/\b(\d+|\w+)\s+duurste\b/);
    if (!m) return 10;
    const k = /^\d+$/.test(m[1]) ? +m[1] : NUMBER_WORDS[m[1]];
    return k && k <= 50 ? k : 10;
  })();
  return { intent, period, store, category, terms: productTerms(q, store, category), topN };
}

/**
 * Voert een vraag uit.
 * @returns {{ title:string, answer:string, basis:string, rows?:object[], kind:'feit'|'schatting'|'voorspelling'|'onbekend' }}
 */
export function runQuery(q, ctx) {
  const { facts, products, predictions, savings, today } = ctx;
  const p = parseQuery(q, today);
  const scope = (def) => p.period || def;
  const filterFacts = (period) => {
    let f = inRange(facts, period.from, period.to);
    if (p.store) f = f.filter((x) => x.store === p.store);
    if (p.category) f = f.filter((x) => x.category === p.category);
    return f;
  };
  const matched = findProducts(p.terms, products);
  const productIds = new Set(matched.map((x) => x.id));
  const where = [p.store ? `bij ${storeName(p.store)}` : '', p.category ? `in ${categoryName(p.category).toLowerCase()}` : ''].filter(Boolean).join(' ');

  if (!facts.length && p.intent !== 'zoek') {
    return { kind: 'onbekend', title: 'Nog geen gegevens', answer: 'Importeer eerst kassabonnen; daarna kan ik dit uitrekenen.', basis: '' };
  }

  switch (p.intent) {
    case 'uitgaven': {
      const period = scope({ from: startOfYear(today), to: today, label: `dit jaar (${today.slice(0, 4)})` });
      let f = filterFacts(period);
      if (p.terms.length) {
        if (!matched.length) return { kind: 'onbekend', title: 'Product niet gevonden', answer: `Geen producten gevonden voor “${p.terms.join(' ')}”.`, basis: '' };
        f = f.filter((x) => productIds.has(x.productId));
      }
      const t = total(f);
      const rows = groupBy(f.filter((x) => x.productId), (x) => x.productId).slice(0, 12).map((g) => ({ label: products.get(g.key)?.name || '?', value: euro(g.net), productId: g.key }));
      return {
        kind: 'feit',
        title: `Uitgaven ${p.terms.length ? `aan ${matched.length === 1 ? matched[0].name.toLowerCase() : p.terms.join(' ')} ` : ''}${where} ${period.label}`.replace(/\s+/g, ' '),
        answer: euro(t),
        basis: `${f.length} bonregels van ${period.from} t/m ${period.to}${p.terms.length ? `; producten: ${matched.map((x) => x.name).slice(0, 8).join(', ')}${matched.length > 8 ? '…' : ''}` : ''}.`,
        rows: p.terms.length || p.store || p.category ? rows : undefined,
      };
    }
    case 'top': {
      const period = scope({ from: addDays(today, -365), to: today, label: 'de afgelopen 12 maanden' });
      const f = filterFacts(period).filter((x) => x.productId);
      const groups = groupBy(f, (x) => x.productId).slice(0, p.topN);
      return {
        kind: 'feit',
        title: `Top ${p.topN}: waar gaat het meeste geld naartoe (${period.label}${where ? ' ' + where : ''})`,
        answer: groups.length ? `${groups.length} producten` : 'Geen aankopen in deze periode.',
        basis: 'Gesorteerd op totaal betaald bedrag (na korting). Hoogste stukprijs zien? Open een product.',
        rows: groups.map((g) => ({ label: products.get(g.key)?.name || '?', value: euro(g.net), sub: `${g.count}× gekocht`, productId: g.key })),
      };
    }
    case 'gemiddelde': {
      if (!matched.length) return { kind: 'onbekend', title: 'Welk product?', answer: 'Noem een product, bijvoorbeeld: “Hoeveel betalen we gemiddeld voor koffie?”', basis: '' };
      const period = scope({ from: addDays(today, -365), to: today, label: 'de afgelopen 12 maanden' });
      const f = filterFacts(period);
      const rows = [];
      let paid = 0;
      let qty = 0;
      for (const prod of matched) {
        const h = priceHistory(f, prod.id);
        if (!h.length) continue;
        const q2 = h.reduce((t, x) => t + x.qty, 0);
        const n2 = h.reduce((t, x) => t + x.net, 0);
        paid += n2; qty += q2;
        const withBase = h.filter((x) => x.perBase != null);
        const perBase = withBase.length ? Math.round(withBase.reduce((t, x) => t + x.perBase, 0) / withBase.length) : null;
        rows.push({ label: prod.name, value: euro(Math.round(n2 / q2)), sub: perBase != null ? `${euro(perBase)} per ${withBase[0].weighed || withBase[0].sizeUnit === 'g' ? 'kilo' : withBase[0].sizeUnit === 'ml' ? 'liter' : 'stuk'} · ${h.length} aankopen` : `${h.length} aankopen`, productId: prod.id });
      }
      if (!qty) return { kind: 'feit', title: 'Geen aankopen', answer: `Geen aankopen gevonden ${period.label}.`, basis: '' };
      return { kind: 'feit', title: `Gemiddelde prijs per verpakking (${period.label})`, answer: euro(Math.round(paid / qty)), basis: `Betaald bedrag na korting gedeeld door aantal (${Math.round(qty)} stuks/kg). Verpakkingen kunnen verschillen; zie de prijs per kilo/liter hieronder.`, rows };
    }
    case 'stijging': {
      const inc = priceIncreases(facts, products, today, { minPct: 0.03 }).slice(0, p.topN);
      return {
        kind: 'feit',
        title: 'Sterkste prijsstijgingen',
        answer: inc.length ? `${inc.length} producten` : 'Nog geen duidelijke prijsstijgingen te zien.',
        basis: 'Normale prijs (zonder korting) in de laatste 90 dagen vs. 90–365 dagen geleden; minimaal 2 aankopen per periode.',
        rows: inc.map((x) => ({ label: x.name + (x.brand ? ` (${x.brand})` : ''), value: `+${Math.round(x.change * 100)}%`, sub: `${euro(x.before)} → ${euro(x.after)}`, productId: x.productId })),
      };
    }
    case 'frequent': {
      const period = scope({ from: addDays(today, -180), to: today, label: 'de afgelopen 6 maanden' });
      const groups = groupBy(filterFacts(period).filter((x) => x.productId && x.gross > 0), (x) => x.productId).sort((a, b) => b.count - a.count).slice(0, p.topN);
      return { kind: 'feit', title: `Meest gekocht (${period.label})`, answer: `${groups.length} producten`, basis: 'Aantal keer op een bon.', rows: groups.map((g) => ({ label: products.get(g.key)?.name || '?', value: `${g.count}×`, sub: euro(g.net), productId: g.key })) };
    }
    case 'nodig': {
      const days = /volgende week/.test(normalizeText(q)) ? 10 : 7;
      const rows = [];
      for (const [id, pred] of predictions) {
        if (!neededWithin(pred, days)) continue;
        const prod = products.get(id);
        if (!prod) continue;
        rows.push({ label: prod.name, value: pred.status.label, sub: pred.daysLeft > 0 ? `±${Math.round(pred.daysLeft)} dagen` : 'naar schatting al op', productId: id, sort: pred.daysLeft });
      }
      rows.sort((a, b) => a.sort - b.sort);
      return { kind: 'voorspelling', title: 'Waarschijnlijk nodig binnen een week', answer: rows.length ? `${rows.length} producten` : 'Niets met voldoende zekerheid.', basis: 'Voorspelling op basis van aankoopritme; producten met te weinig gegevens zijn weggelaten.', rows };
    }
    case 'bonus': {
      const all = ctx.rhythm?.rows || [];
      let rows = p.terms.length ? all.filter((r) => productIds.has(r.productId)) : all.filter((r) => r.status === 'ritme');
      if (p.terms.length && !rows.length) return { kind: 'onbekend', title: 'Product niet gevonden', answer: `Geen producten gevonden voor “${p.terms.join(' ')}”.`, basis: '' };
      rows = rows.sort((a, b) => (a.status === 'ritme' ? a.weeksUntil : 99) - (b.status === 'ritme' ? b.weeksUntil : 99) || b.spend - a.spend);
      const first = rows[0];
      const answer = !rows.length ? 'Nog geen vast ritme gevonden.'
        : p.terms.length && rows.length === 1 ? (first.status === 'ritme' ? (first.inPromoNow ? 'Nu' : first.weeksUntil <= 0 ? 'Deze week' : first.weeksUntil === 1 ? 'Volgende week' : `Over ±${first.weeksUntil} weken`) : 'Geen vast ritme')
          : `${rows.filter((r) => r.status === 'ritme').length} producten met ritme`;
      return {
        kind: 'voorspelling',
        title: p.terms.length ? `Wanneer in de aanbieding: ${matched.map((x) => x.name).slice(0, 3).join(', ')}` : 'Verwachte aanbiedingen (Bonus-ritme)',
        answer,
        basis: 'Afgeleid uit de weken waarin jullie dit met korting kochten. Aanbiedingen in weken zonder aankoop ziet de app niet.',
        rows: rows.slice(0, 20).map((r) => ({ label: r.name, value: r.status === 'ritme' ? (r.inPromoNow ? 'nu' : r.weeksUntil <= 0 ? 'deze week' : `over ${r.weeksUntil} wk`) : '—', sub: r.advice || `${r.promoPurchases} van ${r.purchases} keer met korting`, productId: r.productId })),
      };
    }
    case 'besparen': {
      if (!savings?.enoughData) return { kind: 'onbekend', title: 'Nog te weinig gegevens', answer: savings?.reason || 'Importeer meer bonnen.', basis: '' };
      const huismerk = /huismerk/.test(normalizeText(q));
      const list = savings.advice.filter((a) => a.kind === 'theoretisch' && (!huismerk || a.type === 'alternatief'));
      const sum = list.reduce((t, a) => t + a.monthly, 0);
      return { kind: 'schatting', title: huismerk ? 'Besparen met goedkopere merken' : 'Besparingsmogelijkheden', answer: list.length ? `±${euro(sum)} per maand` : 'Geen onderbouwde besparing gevonden.', basis: 'Theoretische besparing op basis van uw eigen aankopen en prijzen; geen garantie.', rows: list.map((a) => ({ label: a.title, value: euro(a.monthly), sub: a.explanation, productId: a.productId })) };
    }
    default: {
      if (matched.length) {
        return { kind: 'feit', title: 'Gevonden producten', answer: `${matched.length} producten`, basis: 'Tik op een product voor alle aankopen en prijzen.', rows: matched.slice(0, 30).map((x) => ({ label: x.name, value: categoryName(x.category), productId: x.id })) };
      }
      return { kind: 'onbekend', title: 'Vraag niet herkend', answer: 'Probeer bijvoorbeeld: “Hoeveel hebben we dit jaar aan melk uitgegeven?” of “Wat zijn onze tien duurste producten?”', basis: '' };
    }
  }
}

export const EXAMPLE_QUESTIONS = [
  'Hoeveel hebben we dit jaar aan melk uitgegeven?',
  'Wat zijn onze tien duurste producten?',
  'Hoeveel betalen we gemiddeld voor koffie?',
  'Welke boodschappen zijn het sterkst in prijs gestegen?',
  'Wat hebben we afgelopen maand bij Albert Heijn uitgegeven?',
  'Hoeveel kunnen we besparen op huismerken?',
  'Welke producten moeten we volgende week waarschijnlijk kopen?',
  'Wat komt binnenkort in de aanbieding?',
];

export { CATEGORIES };
