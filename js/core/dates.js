// Datums worden opgeslagen als 'JJJJ-MM-DD' strings (lokale kalenderdag, geen tijdzones).

const MONTHS = {
  jan: 1, januari: 1, feb: 2, februari: 2, mrt: 3, maart: 3, mar: 3, apr: 4, april: 4,
  mei: 5, jun: 6, juni: 6, jul: 7, juli: 7, aug: 8, augustus: 8, sep: 9, sept: 9,
  september: 9, okt: 10, oktober: 10, oct: 10, nov: 11, november: 11, dec: 12, december: 12,
};
export const MONTH_NAMES = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli',
  'augustus', 'september', 'oktober', 'november', 'december'];

const pad = (n) => String(n).padStart(2, '0');

export function isoDate(y, m, d) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function isValidDate(y, m, d) {
  if (!(y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Vandaag als ISO-datum in lokale tijd. */
export function todayISO(now = new Date()) {
  return isoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/**
 * Herkent een datum in tekst: 21-10-2026, 21/10/26, 21.10.2026, 2026-10-21, 21 okt 2026.
 * Geeft de eerste geldige datum terug die niet in de toekomst ligt (t.o.v. maxDate).
 */
export function findDate(text, maxDate = null) {
  const candidates = [];
  const re1 = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/g;
  let m;
  while ((m = re1.exec(text))) {
    let y = parseInt(m[3], 10);
    if (y < 100) y += 2000;
    candidates.push({ i: m.index, y, mo: parseInt(m[2], 10), d: parseInt(m[1], 10) });
  }
  const re2 = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  while ((m = re2.exec(text))) {
    candidates.push({ i: m.index, y: +m[1], mo: +m[2], d: +m[3] });
  }
  const re3 = /\b(\d{1,2})\s+([a-z]{3,9})\.?\s+(\d{4})\b/gi;
  while ((m = re3.exec(text))) {
    const mo = MONTHS[m[2].toLowerCase()];
    if (mo) candidates.push({ i: m.index, y: +m[3], mo, d: +m[1] });
  }
  candidates.sort((a, b) => a.i - b.i);
  for (const c of candidates) {
    if (!isValidDate(c.y, c.mo, c.d)) continue;
    const iso = isoDate(c.y, c.mo, c.d);
    if (maxDate && iso > maxDate) continue;
    return iso;
  }
  return null;
}

/** Leest een losse datumwaarde uit een spreadsheetcel (string, Date of Excel-serienummer). */
export function parseDateValue(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !isNaN(value)) {
    return isoDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    // Excel-serienummer (dagen sinds 1899-12-30)
    const ms = Math.round((value - 25569) * 86400000);
    const d = new Date(ms);
    return isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  return findDate(String(value));
}

function toUTC(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function daysBetween(a, b) {
  return Math.round((toUTC(b) - toUTC(a)) / 86400000);
}

export function addDays(iso, n) {
  const d = new Date(toUTC(iso) + n * 86400000);
  return isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Maandag van de week waarin iso valt. */
export function startOfWeek(iso) {
  const d = new Date(toUTC(iso));
  const dow = (d.getUTCDay() + 6) % 7; // maandag = 0
  return addDays(iso, -dow);
}

export function startOfMonth(iso) { return iso.slice(0, 8) + '01'; }
export function startOfYear(iso) { return iso.slice(0, 5) + '01-01'; }

export function daysInMonth(iso) {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function endOfMonth(iso) {
  return iso.slice(0, 8) + pad(daysInMonth(iso));
}

export function addMonths(iso, n) {
  let [y, m, d] = iso.split('-').map(Number);
  m += n;
  while (m > 12) { m -= 12; y++; }
  while (m < 1) { m += 12; y--; }
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return isoDate(y, m, Math.min(d, dim));
}

/** ISO-weeknummer. */
export function isoWeek(iso) {
  const d = new Date(toUTC(iso));
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return { year: d.getUTCFullYear(), week };
}

export function formatDate(iso, style = 'medium') {
  if (!iso) return '–';
  const [y, m, d] = iso.split('-').map(Number);
  if (style === 'short') return `${d} ${MONTH_NAMES[m - 1].slice(0, 3)}`;
  if (style === 'month') return `${MONTH_NAMES[m - 1]} ${y}`;
  return `${d} ${MONTH_NAMES[m - 1].slice(0, 3)} ${y}`;
}

/** Aantal dagen tussen a en b dat NIET binnen een vakantieperiode valt. */
export function effectiveDays(a, b, vacations = []) {
  let days = daysBetween(a, b);
  if (days <= 0 || !vacations.length) return days;
  for (const v of vacations) {
    if (!v.from || !v.to) continue;
    // overlap tussen [a, b) en [from, to]
    const start = v.from > a ? v.from : a;
    const endExclusive = addDays(v.to, 1) < b ? addDays(v.to, 1) : b;
    const overlap = daysBetween(start, endExclusive);
    if (overlap > 0) days -= overlap;
  }
  return Math.max(0, days);
}

/** Lokale kalenderdatum van een ISO-tijdstempel (createdAt is UTC; 01:00 in Amsterdam is nog 'gisteren' in UTC). */
export function localDateOf(timestamp) {
  return todayISO(new Date(timestamp));
}
