// Supermarkten: herkenning op bonnen en weergavenamen.

export const STORES = [
  { id: 'ah', name: 'Albert Heijn', patterns: [/albert\s*heijn/i, /\bah\.nl\b/i, /\bah to go\b/i, /^\s*ah\s*$/im, /\bah\s+(xl|bonus)/i] },
  { id: 'jumbo', name: 'Jumbo', patterns: [/\bjumbo\b/i] },
  { id: 'lidl', name: 'Lidl', patterns: [/\blidl\b/i] },
  { id: 'aldi', name: 'Aldi', patterns: [/\baldi\b/i] },
  { id: 'dirk', name: 'Dirk', patterns: [/\bdirk\b/i, /van den broek/i] },
  { id: 'plus', name: 'PLUS', patterns: [/\bplus\s+(supermarkt|retail)/i, /\bplus\.nl\b/i, /^\s*plus\s*$/im] },
  { id: 'hoogvliet', name: 'Hoogvliet', patterns: [/hoogvliet/i] },
  { id: 'vomar', name: 'Vomar', patterns: [/vomar/i] },
  { id: 'dekamarkt', name: 'DekaMarkt', patterns: [/deka\s*markt/i] },
  { id: 'spar', name: 'SPAR', patterns: [/\bspar\b/i] },
  { id: 'coop', name: 'Coop', patterns: [/\bcoop\b/i] },
  { id: 'poiesz', name: 'Poiesz', patterns: [/poiesz/i] },
  { id: 'picnic', name: 'Picnic', patterns: [/picnic/i] },
  { id: 'ekoplaza', name: 'Ekoplaza', patterns: [/ekoplaza/i] },
  { id: 'nettorama', name: 'Nettorama', patterns: [/nettorama/i] },
  { id: 'kruidvat', name: 'Kruidvat', patterns: [/kruidvat/i] },
  { id: 'etos', name: 'Etos', patterns: [/\betos\b/i] },
  { id: 'trekpleister', name: 'Trekpleister', patterns: [/trekpleister/i] },
  { id: 'action', name: 'Action', patterns: [/\baction\b(?!s)/i, /action\.com/i] },
  { id: 'wibra', name: 'Wibra', patterns: [/\bwibra\b/i] },
];

const BY_ID = Object.fromEntries(STORES.map((s) => [s.id, s]));

export function storeName(id) {
  if (!id) return 'Onbekend';
  return BY_ID[id]?.name || id;
}

/** Herkent de supermarkt in de eerste regels van een bon (of in de hele tekst als fallback). */
export function detectStore(text) {
  const head = text.split('\n').slice(0, 12).join('\n');
  for (const zone of [head, text]) {
    for (const s of STORES) if (s.patterns.some((p) => p.test(zone))) return s.id;
  }
  return null;
}

/** Zet vrije invoer ("AH", "albert heijn", "Jumbo Supermarkten") om naar een winkel-id. */
export function storeFromName(name) {
  if (!name) return null;
  const n = String(name).trim().toLowerCase();
  if (n === 'ah' || n.startsWith('ah ')) return 'ah';
  for (const s of STORES) {
    if (s.id === n || s.name.toLowerCase() === n) return s.id;
    if (s.patterns.some((p) => p.test(name))) return s.id;
  }
  return n.replace(/\s+/g, '-');
}
