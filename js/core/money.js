// Alle bedragen worden intern als hele centen (integers) opgeslagen.
// Zo voorkomen we afrondingsfouten met zwevendekommagetallen.

const AMOUNT_RE = /^(-)?\s*€?\s*(-)?\s*(\d{1,3}(?:[.\s]\d{3})*|\d+)[,.](\d{2})\s*(-)?$/;

/**
 * Leest een bonbedrag zoals "1,09", "-0,50", "0,50-", "€ 12,34" of "1.234,56".
 * Geeft centen terug, of null als het geen geldig bedrag met twee decimalen is.
 */
export function parseAmount(input) {
  if (input == null) return null;
  const s = String(input).trim().replace(/−/g, '-');
  const m = s.match(AMOUNT_RE);
  if (!m) return null;
  const whole = parseInt(m[3].replace(/[.\s]/g, ''), 10);
  const cents = whole * 100 + parseInt(m[4], 10);
  const negative = Boolean(m[1] || m[2] || m[5]);
  return negative ? -cents : cents;
}

/**
 * Leest een algemeen getal uit een spreadsheetcel: "1,5", "1.5", "1.234,56", "1,234.56", 3.
 * Geeft een Number terug of null.
 */
export function parseNumber(input) {
  if (input == null || input === '') return null;
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  let s = String(input).trim().replace(/[€\s]/g, '').replace(/−/g, '-');
  let negative = false;
  if (s.endsWith('-')) { negative = true; s = s.slice(0, -1); }
  if (s.startsWith('-')) { negative = !negative ? true : negative; s = s.slice(1); }
  if (!/^[\d.,]+$/.test(s)) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // De laatste scheidingsteken is het decimaalteken.
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma > -1) {
    const parts = s.split(',');
    s = parts.length === 2 ? parts.join('.') : parts.join('');
  } else if (lastDot > -1) {
    const parts = s.split('.');
    // "1.234" met precies drie cijfers na de punt en meerdere groepen = duizendtal
    if (parts.length > 2) s = parts.join('');
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/** Zet een getal in euro's om naar centen (afgerond). */
export function toCents(euros) {
  if (euros == null || !Number.isFinite(euros)) return null;
  return Math.round(euros * 100);
}

const fmt = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' });
const fmtShort = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

/** Formatteert centen als "€ 12,34". */
export function euro(cents, { short = false } = {}) {
  if (cents == null || !Number.isFinite(cents)) return '–';
  return (short ? fmtShort : fmt).format(cents / 100);
}

/** Som van centen, null-waarden genegeerd. */
export function sumCents(values) {
  let t = 0;
  for (const v of values) if (Number.isFinite(v)) t += v;
  return t;
}

/** Percentage verandering van a naar b, of null als a 0 is. */
export function pctChange(from, to) {
  if (!from) return null;
  return (to - from) / Math.abs(from);
}

export function pct(value, digits = 0) {
  if (value == null || !Number.isFinite(value)) return '–';
  return `${value >= 0 ? '+' : '−'}${Math.abs(value * 100).toFixed(digits).replace('.', ',')}%`;
}
