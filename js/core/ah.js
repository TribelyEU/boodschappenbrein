// Albert Heijn: link om producten in één keer aan het mandje op ah.nl toe te voegen, en de kosten van een gerecht.
import { normalizeText } from './text.js';
import { parseIngredient } from './recipes.js';

// Dubbele slash: iOS geeft deze link niet aan de AH-app (die voegt niets toe), Safari wel aan ah.nl.
export const AH_ADD_URL = 'https://www.ah.nl/mijnlijst//add-multiple';

/** [{id, qty}] → link die alles aan het AH-mandje toevoegt. */
export function ahLink(entries) {
  const sum = new Map();
  for (const e of entries) if (e.id) sum.set(e.id, (sum.get(e.id) || 0) + Math.max(1, Math.round(e.qty || 1)));
  const ps = [...sum].map(([id, n]) => `p=${id}:${n}`);
  return ps.length ? `${AH_ADD_URL}?${ps.join('&')}` : null;
}

export const choiceKey = (name) => `n:${normalizeText(name)}`;

/** Zoekvarianten voor een ingrediënt of lijstproduct: volledig, eerste deel ("kipfilet of kippendijfilet"), zonder bijvoeglijke woorden. */
export function queryVariants(name) {
  const clean = String(name).replace(/\([^)]*\)/g, ' ').replace(/\b(verse|vers|grote|groot|kleine|klein|middelgrote|rijpe|fijngesneden|gesneden|gehakte|halve)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  const first = clean.split(/\s+(?:of|en)\s+|,\s*/i)[0].trim();
  const words = first.split(' ');
  const syn = SYNONYMS.find(([re]) => re.test(first));
  const out = [...(syn ? [syn[1]] : []), clean, first, words.slice(-2).join(' '), words.at(-1)];
  return [...new Set(out.filter((q) => q && q.length >= 2))];
}

// Hoe AH het noemt
const SYNONYMS = [[/parmezaan/i, 'parmigiano reggiano'], [/^(gele )?uien?$/i, 'gele uien'], [/^bosui(tjes)?$/i, 'bosui'], [/^eieren$|^eier?$/i, 'eieren'], [/^zure room$/i, 'zure room'], [/^kippendijen$/i, 'kipdijfilet']];

const BASE = { g: 1, gr: 1, gram: 1, kg: 1000, kilo: 1000, ml: 1, cl: 10, dl: 100, l: 1000, liter: 1000 };
const BASE_UNIT = { g: 'g', gr: 'g', gram: 'g', kg: 'g', kilo: 'g', ml: 'ml', cl: 'ml', dl: 'ml', l: 'ml', liter: 'ml' };

/** Hoeveel verpakkingen van `size` ({amount, unit: g|ml|st}) zijn nodig voor dit ingrediënt ({qty, amount: '1400 gr'})? */
export function packsNeeded(ing, size) {
  const p = ing.amount ? parseIngredient(`${ing.amount} x`) : null;
  const unit = p?.unit ? p.unit.toLowerCase() : '';
  if (p?.amount != null && BASE[unit]) {
    const need = (p.amountTo ?? p.amount) * BASE[unit];
    if (size?.amount && size.unit === BASE_UNIT[unit]) return Math.max(1, Math.ceil(need / size.amount - 0.05));
    return 1;
  }
  const n = ing.amount ? null : ing.qty || 1;
  if (n != null && size?.unit === 'st' && size.amount) return Math.max(1, Math.ceil(n / size.amount));
  if (n != null && (!size || size.unit === 'st')) return n; // per stuk verkocht: 2 paprika's = 2
  return 1; // eetlepels, teentjes, een net uien: één verpakking
}

/** Aantal AH-verpakkingen voor een lijstregel: de hoeveelheid uit het weekmenu ("350 gr", "700 gr + 400 gr") of het aantal. */
export function packsForListItem(item, size) {
  const parts = String(item.note || '').split(/\s*\+\s*/).map((t) => parseIngredient(`${t} x`)).filter((p) => p.amount != null && BASE[p.unit?.toLowerCase()]);
  if (!parts.length && size?.unit === 'st' && size.amount && !item.note) return Math.max(1, Math.ceil((item.qty || 1) / size.amount)); // 2 uien, net van 3
  if (!parts.length || !size?.amount) return Math.max(1, item.qty || 1);
  const unit = BASE_UNIT[parts[0].unit.toLowerCase()];
  if (parts.some((p) => BASE_UNIT[p.unit.toLowerCase()] !== unit) || size.unit !== unit) return Math.max(1, item.qty || 1);
  const need = parts.reduce((t, p) => t + (p.amountTo ?? p.amount) * BASE[p.unit.toLowerCase()], 0);
  return Math.max(1, Math.ceil(need / size.amount - 0.05));
}

/**
 * Kosten van de boodschappen voor een gerecht: hele verpakkingen, zonder wat meestal in huis is en zonder optionele dingen.
 * priceFor(name) → { price (centen per verpakking), size, name, source } | null
 */
export function dishCost(ingredients, priceFor) {
  let total = 0;
  const lines = [];
  const missing = [];
  for (const ing of ingredients) {
    if (ing.pantry || ing.optional) continue;
    const pr = priceFor(ing.name);
    if (!pr?.price) { missing.push(ing.name); continue; }
    const packs = packsNeeded(ing, pr.size);
    total += pr.price * packs;
    lines.push({ ing, packs, ...pr, cost: pr.price * packs });
  }
  return { total: missing.length ? null : total, partial: total, lines, missing };
}

// ---------- ingrediënt → AH-product ----------
const STOPWORDS = new Set(['ah', 'de', 'het', 'een', 'en', 'of', 'van', 'voor', 'in', 'op', 'naturel', 'basic']);
// Woorden die het een ánder product maken (of een duurdere variant): flink lager rangschikken
const PENALTY = new Set(['biologisch', 'bio', 'excellent', 'glutenvrij', 'lactosevrij', 'terra', 'plantaardig', 'alternatief', 'kids', 'mini', 'light', 'rauwkost', 'soep', 'kopsoep', 'saus', 'chips', 'kronkels', 'ribbelchips', 'krokantjes', 'rijstzoutjes', 'zoutjes', 'reep', 'chutney', 'mix', 'lasagne', 'pie', 'salade', 'saladeschotel', 'spread', 'smeerkaas', 'worst', 'grillworst', 'hapje', 'groentehapje', 'tapenade', 'advocaat', 'gemalen', 'poeder', 'kruiden', 'pesto', 'dip', 'snack', 'snacks', 'koekjes', 'drank', 'sap', 'yoghurtdrank', 'babyvoeding', 'olvarit', 'diepvries', 'gedroogd', 'gedroogde', 'ingelegd', 'ingelegde', 'pot', 'gegrild', 'gebraden', 'speculoos', 'speculoospasta', 'miso', 'roasted', 'croutons', 'chocoladepasta', 'bolletjes', 'amsterdamse', 'zilveruitjes', 'gesneden', 'schijfjes', 'gebakken', 'rondeel', 'buitenbeentjes', 'grootverpakking', 'verspakket', 'roerbakgroente', 'wok', 'luxe', 'gerijpte', 'gemarineerde', 'gemarineerd', 'magere', 'mager', 'kalkoen', 'advocaat', 'chutney', 'pers']);
// Gewone omschrijvingen van het basisproduct: tellen niet als "extra woord" (AH Gele uien = uien, AH Witte champignons = champignons)
const NEUTRAL = ['gele', 'witte', 'verse', 'vers', 'scharrel', 'hollandse', 'naturel', 'original', 'origineel', 'kruimige', 'kruimig', 'vastkokende', 'vastkokend', 'grote', 'middelgrote', 'jonge', 'halfvolle', 'volle'];
const NEUTRAL_SET = new Set(NEUTRAL);
const FILLER = new Set(['stuks', 'stuk', 'per', 'pak', 'zak', 'bak', 'kg', 'g', 'gram', 'ml', 'l', 'liter', 'cl', 'los', 'ca', 'circa']);
/** Stam van een Nederlands woord: meervoud weg (uien → ui, aardappelen/aardappels → aardappel, eieren → ei). */
export function stem(w) {
  if (w.length <= 3) return w;
  if (w.endsWith('tjes') && w.length > 6) return w.slice(0, -4);       // bosuitjes → bosui
  if (w.endsWith('jes') && w.length > 5) return w.slice(0, -3);        // worteltjes → wortel(t)
  if (w.endsWith('eren') && w.length > 5) return w.slice(0, -4);       // eieren → ei
  if (w.endsWith('ën')) return w.slice(0, -2);                            // knieën
  if (w.endsWith('en') && w.length >= 4) { const b = w.slice(0, -2); return /(.)\1$/.test(b) ? b.slice(0, -1) : b; } // tomaten → tomat, uien → ui
  if (w.endsWith("'s")) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);        // champignons → champignon
  return w;
}
const stemEq = (a, b) => { const x = stem(a), y = stem(b); return x === y || (x.length >= 4 && (x + 'e' === y || y + 'e' === x || x + 'se' === y || y + 'se' === x)) || x.replace(/e$/, '') === y.replace(/e$/, ''); };
const wordsOf = (t) => normalizeText(String(t).replace(/-/g, ' ')).split(' ').filter((w) => w.length > 1 && !/^\d/.test(w));

/** Komt queryword w voor als woord of als einde van een samenstelling (kastanjechampignons, rundergehakt)? Niet als begin (champignonsaus). */
function wordHit(tok, w) {
  if (stemEq(tok, w)) return 'exact';
  // scharreleieren = eieren: samenstelling met een gewone omschrijving vooraan telt als hetzelfde woord
  for (const n of NEUTRAL) if (tok.startsWith(n) && tok.length > n.length + 2 && stemEq(tok.slice(n.length), w)) return 'exact';
  const sw = stem(w);
  if ((w.length >= 4 && tok.endsWith(w)) || (sw.length >= 4 && (tok.endsWith(sw) || stem(tok).endsWith(sw)))) return 'compound';
  return null;
}

/**
 * Rangschik AH-producten voor een ingrediënt. items: [{name, price, sizeText, id, ...}].
 * Regels: alle woorden moeten voorkomen vóór "met"/"en" (anders is het iets anders mét dit ingrediënt);
 * minder extra woorden is beter; huismerk (AH) en lagere prijs bij gelijke stand.
 */
export function rankForIngredient(items, query, { limit = 8 } = {}) {
  const q = wordsOf(query).filter((w) => !STOPWORDS.has(w) && !FILLER.has(w));
  if (!q.length) return [];
  const out = [];
  for (const it of items) {
    const all = wordsOf(it.name);
    const cut = all.findIndex((w, i) => i > 0 && (w === 'met' || w === 'in' || w === 'op'));
    const head = (cut > 0 ? all.slice(0, cut) : all).filter((w) => !STOPWORDS.has(w) && !FILLER.has(w));
    let exact = 0, compound = 0, ok = true;
    for (const w of q) {
      const hits = head.map((t) => wordHit(t, w));
      if (hits.includes('exact')) exact++; else if (hits.includes('compound')) compound++; else { ok = false; break; }
    }
    if (!ok) continue;
    const extra = Math.max(0, head.filter((w) => !NEUTRAL_SET.has(w) || q.includes(w)).length - q.length);
    const bad = all.filter((w) => PENALTY.has(w) && !q.includes(w)).length;
    const lastIsHead = head.length && (wordHit(head.at(-1), q.at(-1)) || wordHit(head[0], q.at(-1))) ? 1 : 0;
    const score = exact * 2 + compound + lastIsHead - extra * 0.8 - bad * 1.5 - (cut > 0 ? 1 : 0);
    out.push({ it, score, house: /^ah\b/i.test(it.name) });
  }
  out.sort((a, b) => b.score - a.score || (b.house - a.house) || a.it.price - b.it.price);
  return out.slice(0, limit).map((x) => x.it);
}
