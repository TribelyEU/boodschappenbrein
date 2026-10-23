// Tekst-hulpfuncties voor het vergelijken van productnamen.

export function stripDiacritics(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Kleine letters, geen accenten, alleen letters/cijfers/spaties. */
export function normalizeText(s) {
  return stripDiacritics(String(s || '').toLowerCase())
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9%.,]+/g, ' ')
    .replace(/(?<!\d)[.,]|[.,](?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Alleen letters en cijfers, zonder spaties: "AH Halfv. Melk" -> "ahhalfvmelk". */
export function compact(s) {
  return stripDiacritics(String(s || '').toLowerCase()).replace(/[^a-z0-9]/g, '');
}

/** Eenvoudige Nederlandse stam: meervoud en buigings-e weg, dubbele klinkers samen. */
export function stem(token) {
  let t = token;
  if (/^\d/.test(t)) return t;
  if (t.length > 5 && t.endsWith('en')) t = t.slice(0, -2);
  else if (t.length > 4 && t.endsWith('s') && !t.endsWith('ss')) t = t.slice(0, -1);
  else if (t.length > 5 && t.endsWith('e')) t = t.slice(0, -1);
  t = t.replace(/(aa|ee|oo|uu)/g, (m) => m[0]);
  t = t.replace(/([bcdfghjklmnpqrstvwxz])\1$/, '$1');
  return t;
}

export function titleCase(s) {
  return String(s || '').toLowerCase().replace(/(^|\s)(\p{L})/gu, (m, sp, ch) => sp + ch.toUpperCase());
}

/** Levenshtein-afstand (voor korte strings). */
export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Gelijkenis 0..1 op basis van Levenshtein. */
export function similarity(a, b) {
  if (!a && !b) return 1;
  const d = levenshtein(a, b);
  return 1 - d / Math.max(a.length, b.length);
}

/**
 * Gelijkenis tussen een (afgekorte) bonnaam en een volledige naam.
 * Elke token uit `short` moet als prefix of als losse letters-in-volgorde in `long` voorkomen.
 */
export function abbreviationScore(short, long) {
  const s = compact(short);
  const l = compact(long);
  if (!s || !l) return 0;
  if (l.includes(s) || s.includes(l)) return Math.min(s.length, l.length) / Math.max(s.length, l.length) * 0.5 + 0.5;
  // letters van s in volgorde in l (subsequence)
  let j = 0;
  for (let i = 0; i < l.length && j < s.length; i++) if (l[i] === s[j]) j++;
  const subseq = j / s.length;
  return subseq * 0.7 + similarity(s, l) * 0.3;
}

export function uid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Korte, stabiele hash (FNV-1a, hex). */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export async function sha256Hex(buffer) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
