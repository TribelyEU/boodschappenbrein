// Recepten (Lekker en Simpel): ingrediënten ontleden en schalen, zoeken.
// We bewaren alleen naam, foto, tijd, personen en ingrediënten; de bereiding staat op hun site.

const UNITS = ['gram', 'gr', 'g', 'kilo', 'kg', 'ml', 'cl', 'dl', 'liter', 'l', 'cm', 'el', 'eetlepels?', 'tl', 'theelepels?', 'stuks?', 'teentjes?', 'tenen', 'blikjes?', 'blik', 'pakjes?', 'pak', 'zakjes?', 'zak', 'bosjes?', 'bos', 'takjes?', 'plakjes?', 'plakken', 'bakjes?', 'bak', 'potjes?', 'pot', 'flesjes?', 'kopjes?', 'kop', 'handjes?', 'handvol', 'scheutjes?', 'scheut', 'snufjes?', 'snuf', 'mespuntjes?', 'mespunt', 'klontjes?', 'klont', 'stengels?', 'rollen', 'rol', 'vellen', 'velletjes?', 'bollen', 'bol', 'blaadjes?', 'ons'];
const UNIT_RE = new RegExp(`^(${UNITS.join('|')})\\.?\\s+`, 'i');
// Wat bijna iedereen in huis heeft: standaard niet aangevinkt bij "op de lijst".
const PANTRY = /^(peper|zout|peper en zout|zout en peper|olie|olijfolie|zonnebloemolie|(roomboter|boter)( om in te bakken)?|bloem|suiker|water|kokend water|azijn|ketjap|sojasaus|paprikapoeder|kerriepoeder|komijn|knoflookpoeder|oregano|italiaanse kruiden|chilivlokken|nootmuskaat|kaneel|bakpoeder|mosterd|mayonaise|ketchup|honing|bouillonblokje|bouillon|groentebouillon|kippenbouillon|cayennepeper|gedroogde [a-z ]+|olie of boter)$/i;

/** "zout/peper", "peper & zout", "olie (om in te bakken)" → meestal in huis. */
function isPantry(name) {
  const n = String(name).toLowerCase().replace(/\s*\(.*\)$/, '').replace(/\s*[/&+]\s*|\s*,\s*/g, ' en ').replace(/\s+/g, ' ').trim();
  return PANTRY.test(n) || n.split(' en ').every((part) => PANTRY.test(part.trim()));
}

const num = (s) => {
  if (s == null) return null;
  const t = String(s).replace(',', '.').trim();
  if (/^\d+\/\d+$/.test(t)) { const [a, b] = t.split('/'); return +a / +b; }
  if (t === '½') return 0.5;
  if (t === '¼') return 0.25;
  const m = t.match(/^(\d+)\s*½$/); if (m) return +m[1] + 0.5;
  return Number.isFinite(+t) ? +t : null;
};
const fmt = (n) => {
  if (n == null) return '';
  const r = Math.round(n * 100) / 100;
  if (Math.abs(r - 0.5) < 1e-9) return '½';
  if (Math.abs(r - Math.trunc(r) - 0.5) < 1e-9 && r > 1) return `${Math.trunc(r)}½`;
  return String(r).replace('.', ',');
};

/** "700 gr kruimige aardappels" → { amount: 700, amountTo: null, unit: 'gr', name: 'kruimige aardappels', optional, pantry } */
export function parseIngredient(raw) {
  let s = String(raw).replace(/\s+/g, ' ').trim();
  const OPT = /\(?\s*\b(optioneel|eventueel|evt\.?)\s*\)?/ig;
  const optional = OPT.test(s);
  s = s.replace(OPT, ' ').replace(/\s+/g, ' ').trim();
  let amount = null, amountTo = null, unit = '';
  const m = s.match(/^(\d+\/\d+|\d+(?:[.,]\d+)?(?:\s*½)?|½|¼)(?:\s*(?:-|tot|à)\s*(\d+(?:[.,]\d+)?))?\s*(.*)$/);
  if (m && m[3] !== undefined) {
    amount = num(m[1]); amountTo = m[2] ? num(m[2]) : null; s = m[3];
    const g = s.match(/^(gram|gr|g|kg|ml|cl|dl|l)(\s+|$)/i) || s.match(UNIT_RE);
    if (g) { unit = g[1]; s = s.slice(g[0].length); }
  } else {
    const g = s.match(UNIT_RE);
    if (g && /^(snuf|snufje|klontje|klont|scheutje|scheut|handje|handjevol|handvol|mespuntje|beetje)/i.test(g[1])) { unit = g[1]; s = s.slice(g[0].length); }
  }
  const name = s.replace(/^(een\s+)?(beetje|scheutje|klontje|snufje|handje)\s+/i, '').replace(/[,;]\s*$/, '').trim();
  return { raw: String(raw).trim(), amount, amountTo, unit, name, optional, pantry: isPantry(name) };
}

/** Hoeveelheid als tekst, eventueel geschaald ("700 gr", "4-6", "klontje"). */
export function amountText(ing, factor = 1) {
  if (ing.amount == null) return ing.unit || '';
  const a = fmt(ing.amount * factor);
  const b = ing.amountTo != null ? `-${fmt(ing.amountTo * factor)}` : '';
  return `${a}${b}${ing.unit ? ` ${ing.unit}` : ''}`;
}

const minutes = (iso) => {
  const m = String(iso || '').match(/^P(?:T)?(?:(\d+)H)?(?:(\d+)M)?$/);
  return m && (m[1] || m[2]) ? (+(m[1] || 0) * 60 + +(m[2] || 0)) : null;
};
const servingsOf = (y) => {
  for (const v of [].concat(y || [])) { const n = String(v).match(/\d+/); if (n) return +n[0]; }
  return null;
};
const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&#0?39;|&#8217;|&rsquo;/g, '’').replace(/&quot;/g, '"').replace(/&#8211;|&ndash;/g, '–').replace(/<[^>]+>/g, '').trim();

/** Recipe-object uit de JSON-LD van een receptpagina → compact record (zonder bereiding). */
export function recipeFromLd(ld, url) {
  const nodes = [].concat(ld?.['@graph'] || ld || []);
  const r = nodes.find((n) => [].concat(n?.['@type'] || []).includes('Recipe'));
  if (!r || !Array.isArray(r.recipeIngredient) || !r.recipeIngredient.length) return null;
  const imgs = [].concat(r.image || []).map((i) => (typeof i === 'string' ? i : i?.url)).filter(Boolean);
  return {
    url,
    name: decode(r.name),
    image: imgs.find((i) => /-500x375\./.test(i)) || imgs.find((i) => /-480x270\./.test(i)) || imgs[0] || null,
    time: minutes(r.totalTime) ?? minutes(r.cookTime),
    servings: servingsOf(r.recipeYield),
    ingredients: r.recipeIngredient.map(decode).filter(Boolean),
    category: [].concat(r.recipeCategory || []).map(decode),
    cuisine: [].concat(r.recipeCuisine || []).map(decode),
    keywords: decode(r.keywords).split(',').map((k) => k.trim().toLowerCase()).filter(Boolean),
    date: (r.datePublished || '').slice(0, 10),
    ...ratingOf(r.aggregateRating),
  };
}

/** Beoordeling uit aggregateRating: { rating: 4.7, ratingCount: 23 } (leeg als er geen stemmen zijn). */
export function ratingOf(a) {
  const value = Number(String(a?.ratingValue ?? '').replace(',', '.'));
  const count = Number(a?.ratingCount ?? a?.reviewCount ?? 0);
  return value > 0 && count > 0 ? { rating: Math.round(value * 10) / 10, ratingCount: count } : {};
}

/** Terugval: de sterren van WP Recipe Maker in de pagina zelf. */
export function ratingFromHtml(html) {
  const avg = String(html).match(/wprm-recipe-rating-average[^>]*>\s*([\d.,]+)/);
  const cnt = String(html).match(/wprm-recipe-rating-count[^>]*>\s*(\d+)/);
  return avg && cnt ? ratingOf({ ratingValue: avg[1], ratingCount: cnt[1] }) : {};
}

/** Score om op te sorteren: gemiddelde, getrokken naar 4 bij weinig stemmen (3 stemmen van 5 ≠ 200 stemmen van 4,8). */
export function ratingScore(r, { prior = 4, weight = 5 } = {}) {
  if (!r.rating || !r.ratingCount) return 0;
  return (r.rating * r.ratingCount + prior * weight) / (r.ratingCount + weight);
}

const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Zoeken op woorden in naam, ingrediënten en trefwoorden. Alle woorden moeten voorkomen. */
export function searchRecipes(list, query, { maxTime = null, category = null, limit = 60, sort = 'relevant' } = {}) {
  const words = norm(query).split(/\s+/).filter((w) => w.length >= 2);
  const out = [];
  for (const r of list) {
    if (maxTime && !(r.time && r.time <= maxTime)) continue;
    if (category && !r.category.some((c) => norm(c).includes(norm(category)))) continue;
    const name = norm(r.name);
    const hay = `${name} ${norm(r.ingredients.join(' '))} ${norm(r.keywords.join(' '))}`;
    if (!words.every((w) => hay.includes(w))) continue;
    const score = words.reduce((s, w) => s + (name.includes(w) ? 3 : 1), 0);
    out.push({ r, score });
  }
  if (sort === 'rating') out.sort((a, b) => ratingScore(b.r) - ratingScore(a.r) || b.score - a.score);
  else out.sort((a, b) => b.score - a.score || String(b.r.date).localeCompare(String(a.r.date)));
  return out.slice(0, limit).map((x) => x.r);
}
