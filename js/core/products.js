// Slim productgeheugen: naam-normalisatie, inhoud, merk en het koppelen van bonregels aan basisproducten.

import { normalizeText, stem, titleCase, uid } from './text.js';
import { guessCategory } from './categories.js';

// Huismerken per winkel. Belangrijk om merkverschillen te bewaren en huismerk-alternatieven te vinden.
export const HOUSE_BRANDS = [
  ['ah biologisch', 'AH Biologisch'], ['ah excellent', 'AH Excellent'], ['ah terra', 'AH Terra'],
  ['ah basic', 'AH Basic'], ['de zaanse hoeve', 'De Zaanse Hoeve'], ['dzh', 'De Zaanse Hoeve'],
  ['de kleine keuken', 'De Kleine Keuken'], ['kl keuken', 'De Kleine Keuken'], ['ah', 'AH'], ['jumbo', 'Jumbo'], ['plus', 'PLUS'],
  ['1 de beste', '1 de Beste'], ['g woon', "g'woon"], ['gwoon', "g'woon"], ['spar', 'SPAR'],
  ['deka', 'Deka'], ['hoogvliet', 'Hoogvliet'], ['vomar', 'Vomar'], ['coop', 'Coop'],
  ['milbona', 'Milbona'], ['cien', 'Cien'], ['w5', 'W5'], ['combino', 'Combino'], ['solevita', 'Solevita'],
  ['crownfield', 'Crownfield'], ['chef select', 'Chef Select'], ['alesto', 'Alesto'], ['freshona', 'Freshona'],
  ['milsani', 'Milsani'], ['lacura', 'Lacura'], ['river', 'River'], ['golden bridge', 'Golden Bridge'],
  ['euroshopper', 'Euroshopper'], ['bio+', 'Bio+'], ['bio plus', 'Bio+'], ['perlenbacher', 'Perlenbacher'],
];

export const A_BRANDS = [
  'campina', 'arla', 'optimel', 'melkunie', 'zuivelhoeve', 'danone', 'alpro', 'activia', 'almhof', 'mona',
  'douwe egberts', 'jacobs', 'lavazza', 'nescafe', 'senseo', 'pickwick', 'lipton', 'unox', 'knorr', 'maggi',
  'calve', 'honig', 'conimex', 'grand italia', 'barilla', 'de cecco', 'bertolli', 'heinz', 'verstegen',
  'verkade', 'tony chocolonely', 'milka', 'lays', 'pringles', 'doritos', 'haribo', 'venco', 'red band',
  'lu', 'liga', 'sultana', 'bolletje', 'peijnenburg', 'quaker', 'kelloggs', 'nutella', 'de ruijter',
  'becel', 'blue band', 'zaanlander', 'old amsterdam', 'beemster', 'leerdammer', 'galbani', 'boursin',
  'coca cola', 'pepsi', 'fanta', 'sprite', 'spa', 'chaudfontaine', 'appelsientje', 'roosvicee', 'karvan cevitam',
  'heineken', 'grolsch', 'amstel', 'hertog jan', 'brand', 'ariel', 'robijn', 'persil', 'omo', 'dreft',
  'finish', 'sun', 'glorix', 'dettol', 'page', 'edet', 'pampers', 'zwitsal', 'nivea', 'dove', 'andrelon',
  'zendium', 'prodent', 'oral b', 'gillette', 'vivera', 'garden gourmet', 'de vegetarische slager',
  'mora', 'iglo', 'dr oetker', 'ben jerry', 'hertog', 'ola', 'magnum', 'chocomel', 'fristi', 'yakult',
  'ketchup heinz', 'mutti', 'zonnatura', 'fairtrade', 'calvé', 'smiths', 'croky', 'duyvis', 'pickwick',
];

// Afkortingen zoals die op kassabonnen voorkomen.
const ABBREVIATIONS = {
  halfv: 'halfvol', hv: 'halfvol', halfvolle: 'halfvol', volle: 'vol', mlk: 'melk', mel: 'melk',
  yogh: 'yoghurt', yog: 'yoghurt', yoghu: 'yoghurt', vla: 'vla', gr: 'griekse',
  volk: 'volkoren', vk: 'volkoren', brd: 'brood', bol: 'bollen', boll: 'bollen',
  toiletp: 'toiletpapier', tp: 'toiletpapier', wcpap: 'toiletpapier', keukenp: 'keukenpapier', kr: 'keukenrol',
  wasm: 'wasmiddel', wasmid: 'wasmiddel', vaatw: 'vaatwas', afw: 'afwasmiddel',
  pindak: 'pindakaas', pindakaa: 'pindakaas', hagels: 'hagelslag',
  aardapp: 'aardappelen', aardap: 'aardappelen', kipfil: 'kipfilet', kipf: 'kipfilet',
  rundergeh: 'rundergehakt', geh: 'gehakt', jb: 'jong belegen', jbel: 'jong belegen', bel: 'belegen',
  sinaas: 'sinaasappel', sinasap: 'sinaasappelsap', mand: 'mandarijnen', kom: 'komkommer', komk: 'komkommer',
  tom: 'tomaten', snoept: 'snoeptomaten', paprik: 'paprika', champ: 'champignons', champign: 'champignons',
  bio: 'biologisch', biol: 'biologisch', ongez: 'ongezoet', gez: 'gezoet', naturel: 'naturel', nat: 'naturel',
  roomb: 'roomboter', marg: 'margarine', zonneb: 'zonnebloem', olijfo: 'olijfolie',
  spagh: 'spaghetti', macar: 'macaroni', rijst: 'rijst', koff: 'koffie', kofie: 'koffie',
  frisd: 'frisdrank', sap: 'sap', chocom: 'chocomel', choc: 'chocolade', choco: 'chocolade',
  bananen: 'banaan', banan: 'banaan', appels: 'appel',
};

const STOPWORDS = new Set([
  'de', 'het', 'een', 'van', 'met', 'en', 'in', 'op', 'voor', 'per', 'stuk', 'stuks', 'st', 'pak', 'pakken',
  'fles', 'flessen', 'zak', 'zakje', 'bak', 'bakje', 'doos', 'blik', 'pot', 'tray', 'netje', 'los',
  'ca', 'circa', 'x', 'naturel', 'regular', 'original', 'origineel', 'classic', 'klassiek', 'voordeelpak', 'kilo', 'tros', 'laags', 'laag', 'fairtrade', 'vers', 'verse', 'rollen', 'bonus', 'actie', 'nieuw', 'xl', 'voordeel', 'voordeelverpakking', 'multipack',
]);

const UNIT_MAP = {
  ml: ['ml', 1], milliliter: ['ml', 1], cl: ['ml', 10], dl: ['ml', 100], l: ['ml', 1000], lt: ['ml', 1000], ltr: ['ml', 1000], liter: ['ml', 1000],
  g: ['g', 1], gr: ['g', 1], gram: ['g', 1], kg: ['g', 1000], kilo: ['g', 1000], kilogram: ['g', 1000],
  st: ['st', 1], stk: ['st', 1], stuk: ['st', 1], stuks: ['st', 1], rol: ['st', 1], rollen: ['st', 1],
  wasbeurt: ['st', 1], wasbeurten: ['st', 1], tabs: ['st', 1], tabletten: ['st', 1], zakjes: ['st', 1], pads: ['st', 1], capsules: ['st', 1], cups: ['st', 1], eieren: ['st', 1], luiers: ['st', 1], doekjes: ['st', 1],
};
const UNIT_RE = '(ml|milliliter|cl|dl|ltr|lt|liter|l|kilogram|kilo|kg|gram|gr|g|stuks|stuk|stk|st|rollen|rol|wasbeurten|wasbeurt|tabletten|tabs|zakjes|pads|capsules|cups|eieren|luiers|doekjes)';
const MULTI_RE = new RegExp(`(\\d+)\\s*[x×]\\s*(\\d+(?:[.,]\\d+)?)\\s*${UNIT_RE}\\b`, 'i');
const SINGLE_RE = new RegExp(`(?:^|\\s|per\\s)(\\d+(?:[.,]\\d+)?)\\s*${UNIT_RE}\\b`, 'i');

/**
 * Haalt inhoud uit een naam of inhoudsveld: "1L", "1000ML", "6 x 1 L", "500 gram", "Per 1000 ml".
 * Geeft { amount, unit: 'ml'|'g'|'st', count, rest } of null.
 */
export function parseSize(text) {
  if (!text) return null;
  const s = String(text).replace(/,/g, '.');
  let m = s.match(MULTI_RE);
  if (m) {
    const [unit, f] = UNIT_MAP[m[3].toLowerCase()];
    const per = parseFloat(m[2]) * f;
    const count = parseInt(m[1], 10);
    return { amount: round(per * count), unit, count, rest: s.replace(m[0], ' ').trim() };
  }
  m = s.match(SINGLE_RE);
  if (m) {
    const [unit, f] = UNIT_MAP[m[2].toLowerCase()];
    return { amount: round(parseFloat(m[1]) * f), unit, count: 1, rest: s.replace(m[0], ' ').trim() };
  }
  return null;
}

const round = (n) => Math.round(n * 1000) / 1000;

/** Prijs per kilo/liter/stuk in centen. */
export function unitPrice(cents, size) {
  if (cents == null || !size || !size.amount) return null;
  const base = size.unit === 'st' ? size.amount : size.amount / 1000;
  if (!base) return null;
  return Math.round(cents / base);
}

export function unitLabel(unit) {
  return unit === 'ml' ? 'liter' : unit === 'g' ? 'kilo' : 'stuk';
}

/** Herkent het merk aan het begin van de naam. */
export function detectBrand(name) {
  const n = ' ' + normalizeText(String(name || '').replace(/\+/g, ' plus ')) + ' ';
  for (const [key, label] of HOUSE_BRANDS) {
    if (n.startsWith(' ' + key + ' ')) return { brand: label, house: true, length: key.split(' ').length };
  }
  for (const key of A_BRANDS) {
    const k = normalizeText(key);
    if (n.startsWith(' ' + k + ' ')) return { brand: titleCase(key), house: false, length: k.split(' ').length };
  }
  return { brand: null, house: false, length: 0 };
}

/** Tokens die de basisproduct-identiteit bepalen (zonder merk, inhoud en vulwoorden). */
export function productTokens(name) {
  const size = parseSize(name);
  let text = size ? size.rest : String(name || '');
  text = normalizeText(text).replace(/\b\d+(?:[.,]\d+)?\s*%/g, ' ');
  const brand = detectBrand(text);
  let tokens = text.split(' ').filter(Boolean);
  if (brand.length) tokens = tokens.slice(brand.length);
  const out = [];
  for (let t of tokens) {
    if (/^\d+([.,]\d+)?$/.test(t)) continue;
    if (STOPWORDS.has(t)) continue;
    if (ABBREVIATIONS[t]) t = ABBREVIATIONS[t];
    for (const part of t.split(' ')) {
      if (part.length < 2 || STOPWORDS.has(part)) continue;
      out.push(stem(part));
    }
  }
  // Alleen een merknaam ("RED BAND", "OPTIMEL"): gebruik het merk als productnaam.
  if (!out.length && brand.length) for (const t of tokens.length ? [] : text.split(' ').slice(0, brand.length)) if (t.length >= 2) out.push(stem(t));
  return [...new Set(out)];
}

/** Basissleutel: "AH Halfvolle melk 1L", "Melk halfvol 1000ML" en "AH melk halfvol" -> "halfvol melk". */
export function baseKey(name) {
  return productTokens(name).sort().join(' ');
}

/** Sleutel voor geleerde aliassen: exacte (genormaliseerde) bonomschrijving. */
export function aliasKey(rawName) {
  return normalizeText(rawName);
}

/** Leesbare productnaam zonder merk en inhoud. */
export function displayName(rawName) {
  const size = parseSize(rawName);
  let text = (size ? size.rest : rawName).trim();
  const brand = detectBrand(text);
  if (brand.length) text = text.split(/\s+/).slice(brand.length).join(' ');
  text = text.replace(/\s+/g, ' ').trim();
  const words = normalizeText(text).split(' ').filter(Boolean).map((w) => (ABBREVIATIONS[w] && ABBREVIATIONS[w].length > w.length ? ABBREVIATIONS[w] : w));
  const label = words.map((w) => (w === 'halfvol' ? 'halfvolle' : w)).join(' ');
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : titleCase(rawName);
}

function tokenOverlap(a, b) {
  if (!a.length || !b.length) return 0;
  let hits = 0;
  for (const t of a) if (b.some((u) => u === t || (t.length >= 4 && u.startsWith(t)) || (u.length >= 4 && t.startsWith(u)))) hits++;
  return hits / Math.max(a.length, b.length);
}

/**
 * Koppelt een bonregel aan een product.
 * Volgorde: geleerde alias -> exacte basissleutel -> fuzzy match (alleen bij hoge zekerheid).
 * Geeft { productId|null, key, confidence, method } terug.
 */
export function matchProduct(rawName, { products, aliases }) {
  const ak = aliasKey(rawName);
  const alias = aliases.get(ak);
  if (alias && products.has(alias)) return { productId: alias, key: products.get(alias).key, confidence: 1, method: 'geleerd' };
  const key = baseKey(rawName);
  if (!key) return { productId: null, key, confidence: 0, method: 'geen' };
  for (const p of products.values()) {
    if (p.key === key) return { productId: p.id, key, confidence: 0.95, method: 'sleutel' };
  }
  const tokens = key.split(' ');
  let best = null;
  for (const p of products.values()) {
    const score = tokenOverlap(tokens, p.key.split(' '));
    if (!best || score > best.score) best = { p, score };
  }
  if (best && best.score >= 0.99) return { productId: best.p.id, key, confidence: 0.85, method: 'gelijkenis' };
  // Afgekorte bonnaam tegenover volledige naam ("TIJGER VOLK" ↔ "Tijger volkoren heel"):
  // alle woorden van de kortste sleutel komen voor in de langste, met hoogstens één woord verschil.
  let sub = null;
  for (const p of products.values()) {
    const other = p.key.split(' ');
    const [small, large] = tokens.length <= other.length ? [tokens, other] : [other, tokens];
    if (small.length < 2 || large.length - small.length > 1) continue;
    const covered = small.every((t) => large.some((u) => u === t || (t.length >= 4 && u.startsWith(t)) || (u.length >= 4 && t.startsWith(u))));
    if (covered && (!sub || other.length < sub.len)) sub = { p, len: other.length };
  }
  if (sub) return { productId: sub.p.id, key, confidence: 0.75, method: 'gelijkenis' };
  return { productId: null, key, confidence: 0, method: 'nieuw' };
}

/** Maakt een nieuw productrecord vanuit een bonregel. */
export function createProduct(rawName, key) {
  const cat = guessCategory(rawName + ' ' + displayName(rawName));
  return {
    id: uid(),
    key: key || baseKey(rawName),
    name: displayName(rawName),
    category: cat.id,
    categorySource: 'auto',
    favorite: false,
    createdAt: new Date().toISOString(),
  };
}
