// Kassabonnen van Lidl (uit de Lidl Plus-app: "Kopie kassabon", als schermafbeelding of foto).
//
// Opbouw (gecontroleerd op echte bonnen, aug–okt 2026):
//   Lidl Zoetermeer / adres / OMSCHRIJVING EUR
//   <naam> [<aantal> x <prijs>] <bedrag> <btw-letter A|B|C>
//   "In prijs verlaagd -0,30" / "Lidl Plus korting -2,00" / "KORTING 25% -1,00"   → korting op de regel erboven
//   "1,259 kg x 9,90 EUR/kg"                                                       → gewicht bij de regel erboven
//   "Losse fles PET groot 0,25 A" / "Blik los statiegeld 0,15 A"                   → statiegeld (btw 0%)
//   Aantal N art. / Totaal / Bankpas / Kopie Kaarthouder … / btw-tabel per letter
//   Een "KOPIE RETOURBON" kan in hetzelfde beeld volgen: dat wordt een aparte (negatieve) bon.
//
// Schermafbeeldingen worden met tekstherkenning (OCR) gelezen. Die verwart soms cijfers (0 ↔ 8, 0 ↔ 6, @ voor 0).
// Daarom wordt elk bedrag gecontroleerd tegen drie onafhankelijke bronnen op dezelfde bon: aantal × prijs, het totaal
// per btw-groep (btw-tabel) en het bontotaal (Totaal, Bankpas, kaartbetaling). Is precies één cijfer verwisseld en
// klopt het daarna overal, dan wordt het hersteld en gemarkeerd. Anders blijft het staan en meldt het controlescherm een afwijking.

import { parseAmount } from './money.js';
import { parseSize } from './products.js';
import { validate } from './receipt-parser.js';

export function isLidlReceipt(text) {
  const t = String(text || '');
  return /\blidl\b/i.test(t) && (/OMSCHRIJVING\s+EUR/i.test(t) || /Lidl\s*Plus/i.test(t)) && /\bTotaal\b/i.test(t);
}

/** OCR-ruis in bedragen opruimen: "@,89" → "0,89", "17 , 93" → "17,93", "-2, 00" → "-2,00", "2x 1,99" → "2 x 1,99". */
export function cleanOcrLine(line) {
  return String(line)
    .replace(/[|¦]/g, ' ')
    .replace(/([\d@Oo])\s+([,.])\s*([\d@Oo]{2})\b/g, '$1$2$3')
    .replace(/([\d@Oo][,.])\s+([\d@Oo]{2})\b/g, '$1$2')
    .replace(/(^|[\s\-x])[@Oo](?=[,.][\d@Oo])/g, '$10')
    .replace(/(\d[,.])[@Oo]/g, '$10').replace(/(\d[,.]\d)[@Oo]/g, '$10')
    .replace(/(^|[\s-])0\d([,.]\d{2})(?![.,]?\d)/g, '$10$2') // "06,25": een prijs begint nooit met 0 gevolgd door een cijfer (datums blijven heel)
    .replace(/(\d[,.]\d{2})\d(?=\s*[A-D]?\s*$)/, '$1') // "-1,680": OCR voegt soms een cijfer toe; de controle hierna vangt fouten op
    .replace(/(\d)\s*[xX×]\.?\s*(?=\d)/g, '$1 x ')
    .replace(/\s+/g, ' ')
    .trim();
}

const AMT = '(-?\\d{1,4}[,.]\\d{2})';
const RE_ITEM = new RegExp(`^(.+?)\\s+(?:(\\d{1,3})\\s*x\\s*${AMT}\\s+)?${AMT}\\s*([A-D])?$`, 'i');
const RE_WEIGHT = /^(\d{1,3}[,.]\d{1,3})\s*kg\s*x\s*(\d{1,3}[,.]\d{2})\s*(?:EUR)?\s*\/?\s*kg/i;
const RE_DISCOUNT = /^(in prijs verlaagd|lidl plus korting|korting\b.*|.*\bkorting\s*\d{1,2}\s*%|prijsvoordeel|actie\b.*)\s+(-?\d{1,4}[,.]\d{2})\s*([A-D])?$/i;
const RE_DEPOSIT = /\b(statiegeld|losse fles|blik los|krat|emballage)\b/i;

// Cijfers die OCR op kassabonnen het vaakst verwisselt.
const CONFUSE = { 0: '8693', 8: '036', 6: '058', 9: '04', 3: '8', 5: '6', 1: '7', 7: '1' };

function variants(cents) {
  const neg = cents < 0;
  const s = String(Math.abs(cents)).padStart(3, '0');
  const out = [];
  for (let i = 0; i < s.length; i++) {
    for (const c of CONFUSE[s[i]] || '') {
      const v = +(s.slice(0, i) + c + s.slice(i + 1));
      if (v !== Math.abs(cents)) out.push(neg ? -v : v);
    }
  }
  return out;
}

/** Splitst één OCR-tekst in losse bonnen (kassabon + eventueel retourbon). */
function segments(lines) {
  const out = [];
  let cur = [];
  for (const l of lines) {
    if (/^(kopie\s+)?retourbon$/i.test(l) && cur.some((x) => /^totaal\b/i.test(x))) { out.push(cur); cur = []; }
    else if (/^kopie kassabon$/i.test(l) && cur.some((x) => /^totaal\b/i.test(x))) { out.push(cur); cur = []; }
    cur.push(l);
  }
  out.push(cur);
  return out.filter((s) => s.some((x) => /^totaal\b/i.test(x)));
}

function dateOf(seg, today) {
  const text = seg.join('\n');
  const found = [];
  const add = (d, m, y) => {
    if (y < 100) y += 2000;
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return;
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (!today || iso <= today) found.push(iso);
  };
  let m;
  const re1 = /\b(\d{2})[-.](\d{2})[-.](\d{4})\b/g;
  while ((m = re1.exec(text))) add(+m[1], +m[2], +m[3]);
  const re2 = /\b(\d{2})\.(\d{2})\.(\d{2})\b/g; // voettekst "10.10.26"
  while ((m = re2.exec(text))) add(+m[1], +m[2], +m[3]);
  if (!found.length) return null;
  const count = found.reduce((c, d) => c.set(d, (c.get(d) || 0) + 1), new Map());
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

/** Bontotaal: meerderheid van "Totaal", "Bankpas"/"Contant", "Totaal EUR …" (kaartbetaling) en de btw-tabel. */
function totalOf(seg, vatTotal) {
  const votes = [];
  for (const l of seg) {
    let m;
    if ((m = l.match(/^totaal\s+(?:eur\s+)?(-?\d{1,5}[,.]\d{2})$/i))) votes.push(parseAmount(m[1]));
    else if ((m = l.match(/^totaal\s+(-?\d{1,5})\s(\d{2})$/i))) votes.push(parseAmount(`${m[1]},${m[2]}`)); // "Totaal -8 45"
    if ((m = l.match(/^(bankpas|contant|pinpas|creditcard)\s+(-?\d{1,5}[,.]\d{2})$/i))) votes.push(parseAmount(m[2]));
    if ((m = l.match(/totaal\s+eur\s+(-?\d{1,5}[,.]\d{2})/i))) votes.push(parseAmount(m[1]));
  }
  if (vatTotal != null) votes.push(vatTotal);
  if (!votes.length) return null;
  const count = votes.reduce((c, v) => c.set(v, (c.get(v) || 0) + 1), new Map());
  const best = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
  return { total: best[0], agreed: best[1], of: votes.length };
}

/** btw-tabel: "B 9 15,62 1,41 17,03" → { B: 1703 } (bedragen inclusief btw per letter). */
function vatTable(seg) {
  const out = {};
  let inTable = false;
  for (const l of seg) {
    if (/bedr\s*\.?\s*excl/i.test(l)) { inTable = true; continue; }
    if (!inTable) continue;
    const m = l.match(/^([A-D])\s+(\S+)\s+(-?\d{1,5}[,.]\d{2})\s+(-?\d{1,5}[,.]\d{2})\s+(-?\d{1,5}[,.]\d{2})$/i);
    if (m) {
      const rate = /^\d{1,2}$/.test(m[2]) ? +m[2] : m[2] === '@' || m[2] === 'O' ? 0 : null;
      out[m[1].toUpperCase()] = { rate, excl: parseAmount(m[3]), vat: parseAmount(m[4]), incl: parseAmount(m[5]) };
      continue;
    }
    if (Object.keys(out).length) break;
  }
  // Binnen de tabel moet gelden: excl + btw = incl, en btw ≈ excl × tarief. Precies één verkeerd gelezen getal
  // dat beide weer laat kloppen, wordt hersteld; is het niet eenduidig, dan telt de tabel niet mee.
  const okRow = (r) => r.excl + r.vat === r.incl && (r.rate == null || Math.abs(Math.round((r.excl * r.rate) / 100) - r.vat) <= 2);
  for (const [k, r] of Object.entries(out)) {
    if (okRow(r)) continue;
    const fixes = [];
    for (const f of ['excl', 'vat', 'incl']) for (const v of variants(r[f])) { const t = { ...r, [f]: v }; if (okRow(t)) fixes.push(t); }
    if (fixes.length === 1) out[k] = fixes[0];
    else out[k].unreliable = true;
  }
  return out;
}

function parseSegment(seg, opts) {
  const result = {
    store: 'lidl', date: dateOf(seg, opts.today || null), total: null, subtotal: null, lines: [], warnings: [],
    rawText: seg.join('\n'), sourceType: 'lidl-bon', reportedSavings: null,
  };
  const isReturn = seg.some((l) => /^(kopie\s+)?retourbon$/i.test(l));
  let started = false;
  for (const l of seg) {
    if (/^omschrijving\b/i.test(l)) { started = true; continue; }
    if (!started) continue;
    if (/^aantal\s+\d+\s*art/i.test(l) || /^totaal\b/i.test(l)) break;
    if (/^-{3,}$/.test(l) || /^reden\s*:/i.test(l)) continue;
    let m = l.match(RE_WEIGHT);
    if (m) {
      const prev = result.lines.at(-1);
      if (prev && prev.kind === 'product') {
        prev.qty = parseFloat(m[1].replace(',', '.'));
        prev.unitPrice = parseAmount(m[2]);
        prev.weighed = true;
        prev.raw += '\n' + l;
      }
      continue;
    }
    m = l.match(RE_DISCOUNT);
    if (m) {
      const amount = -Math.abs(parseAmount(m[2]));
      const prevIdx = [...result.lines].map((x, i) => [x, i]).reverse().find(([x]) => x.kind === 'product')?.[1] ?? null;
      result.lines.push({ rawName: m[1].trim(), qty: 1, unitPrice: amount, amount, kind: 'discount', raw: l, confidence: 0.9, linkedTo: prevIdx, vat: m[3]?.toUpperCase() || result.lines[prevIdx]?.vat || null });
      continue;
    }
    m = l.match(RE_ITEM);
    if (m && /[a-z]{2,}/i.test(m[1])) {
      // OCR leest de 'l' van een inhoud vaak als 1: "Coca-Cola zero 1.51" is 1.5l
      // "Lunchbox/drinkfles-0538827": het artikelnummer achter de naam hoort er niet bij (OCR maakt er soms "-0@538827" van)
      const name = m[1].replace(/\s{2,}/g, ' ').trim().replace(/\s*-\s*[0@Oo]?[@\d]{5,}$/, '').replace(/\b([0-2][.,][0-9])1$/, '$1l');
      const qty = m[2] ? +m[2] : 1;
      const unit = m[3] ? parseAmount(m[3]) : parseAmount(m[4]);
      let amount = parseAmount(m[4]);
      if (isReturn && amount > 0) amount = -amount;
      const kind = RE_DEPOSIT.test(name) ? 'deposit' : amount < 0 ? 'return' : 'product';
      result.lines.push({
        rawName: name, qty, unitPrice: Math.abs(unit), amount, kind, weighed: false, size: kind === 'product' || kind === 'return' ? parseSize(name) : null,
        raw: l, confidence: 0.85, linkedTo: null, vat: m[5]?.toUpperCase() || null, promo: false,
      });
    }
  }
  // Producten met korting eronder zijn actieproducten.
  for (const d of result.lines) if (d.kind === 'discount' && d.linkedTo != null) result.lines[d.linkedTo].promo = true;

  repair(result, seg);
  validate(result);
  if (result.repaired) result.warnings.push(`Tekstherkenning: ${result.repaired} bedrag${result.repaired === 1 ? '' : 'en'} hersteld met de totaalcontrole (gemarkeerd). Kijk ze even na.`);
  return result;
}

/** OCR-cijfers herstellen met aantal × prijs, de btw-tabel en het bontotaal. */
function repair(result, seg) {
  let repaired = 0;
  const mark = (l, what) => { l.repaired = true; l.repairedFrom = { what, amount: l.amount, unitPrice: l.unitPrice }; l.confidence = Math.min(l.confidence, 0.7); repaired++; };

  // 1. Aantal × stukprijs = bedrag
  for (const l of result.lines) {
    if (l.kind === 'discount' || l.weighed || !(l.qty > 1)) continue;
    const want = Math.abs(l.amount);
    if (l.qty * l.unitPrice === want) continue;
    const u = variants(l.unitPrice).find((v) => v * l.qty === want);
    if (u != null) { mark(l, 'stukprijs'); l.unitPrice = u; continue; }
    const a = variants(want).find((v) => v === l.qty * l.unitPrice);
    if (a != null) { mark(l, 'bedrag'); l.amount = Math.sign(l.amount || 1) * a; }
  }

  // Gewogen artikelen: het bedrag is leidend, de kiloprijs volgt ("1,259 kg x 9,98" bij 12,46 → 9,90).
  for (const l of result.lines) {
    if (!l.weighed || Math.abs(Math.round(l.qty * l.unitPrice) - Math.abs(l.amount)) <= 1) continue;
    const u = variants(l.unitPrice).find((v) => Math.abs(Math.round(l.qty * v) - Math.abs(l.amount)) <= 1);
    if (u != null) { mark(l, 'stukprijs'); l.unitPrice = u; }
  }

  // 2. Bontotaal: eerst uit Totaal / Bankpas / kaartbetaling; de btw-tabel alleen als die het niet eenduidig maken.
  const table = vatTable(seg);
  const vatSum = Object.keys(table).length && !Object.values(table).some((v) => v.unreliable) ? Object.values(table).reduce((t, v) => t + v.incl, 0) : null;
  let t = totalOf(seg, null);
  if (!t || t.agreed < 2) t = totalOf(seg, vatSum) || t;
  if (t) {
    result.total = t.total;
    if (t.agreed < 2 && t.of > 1) result.warnings.push('Het totaalbedrag was niet eenduidig te lezen; controleer het.');
  }

  // 3. Statiegeld kent vaste bedragen (0,10 / 0,15 / 0,25 per stuk): "6,15" voor een blikje is 0,15.
  const DEPOSITS = [10, 15, 25];
  for (const l of result.lines) {
    if (l.kind !== 'deposit' || DEPOSITS.includes(l.unitPrice)) continue;
    const u = variants(l.unitPrice).find((v) => DEPOSITS.includes(v));
    if (u != null) { mark(l, 'bedrag'); l.unitPrice = u; l.amount = Math.sign(l.amount || 1) * u * (l.qty || 1); }
  }

  // 4. Klopt de som niet? Zoek het kleinste aantal verkeerd gelezen cijfers (1, anders 2) waarmee het precies klopt:
  //    eerst per btw-groep (als de btw-tabel zelf met het totaal klopt), daarna over de hele bon.
  //    Alleen bij precies één oplossing wordt er iets aangepast. Regels waar aantal × prijs al klopt, blijven staan.
  const locked = (l) => (l.qty > 1 && !l.weighed && l.qty * l.unitPrice === Math.abs(l.amount))
    || (l.weighed && Math.abs(Math.round(l.qty * l.unitPrice) - Math.abs(l.amount)) <= 1);
  // OCR leest een 0 het vaakst verkeerd (als 6, 8, 9 of @). Bij twee mogelijkheden wint de enige die een 0 terugzet.
  const toZero = (from, to) => { const a = String(Math.abs(from)).padStart(3, '0'); const b = String(Math.abs(to)).padStart(3, '0'); return [...b].some((c, i) => c === '0' && a[i] !== '0'); };
  const pick = (list) => {
    if (list.length === 1) return list[0];
    const zero = list.filter((fix) => fix.every(([l, a]) => toZero(l.amount, a)));
    return zero.length === 1 ? zero[0] : null;
  };
  const solve = (lines, diff) => {
    const opts = lines.filter((l) => !locked(l)).map((l) => ({ l, alts: variants(l.amount) }));
    const one = [];
    for (const o of opts) for (const a of o.alts) if (a - o.l.amount === diff) one.push([[o.l, a]]);
    if (one.length) return pick(one);
    const two = [];
    for (let i = 0; i < opts.length; i++) for (let j = i + 1; j < opts.length; j++) {
      for (const a of opts[i].alts) for (const b of opts[j].alts) {
        if (a - opts[i].l.amount + b - opts[j].l.amount === diff) two.push([[opts[i].l, a], [opts[j].l, b]]);
        if (two.length > 6) return null;
      }
    }
    return two.length ? pick(two) : null;
  };
  const apply = (fixes) => {
    for (const [l, alt] of fixes) {
      mark(l, 'bedrag');
      l.amount = alt;
      if (l.kind === 'discount') l.unitPrice = alt;
      else if (!l.weighed) l.unitPrice = Math.round(Math.abs(alt) / (l.qty || 1));
    }
  };
  const total = () => result.lines.reduce((x, l) => x + l.amount, 0);
  if (result.total != null && total() !== result.total) {
    if (vatSum === result.total) {
      for (const [letter, v] of Object.entries(table)) {
        const group = result.lines.filter((l) => l.vat === letter);
        const diff = v.incl - group.reduce((x, l) => x + l.amount, 0);
        if (diff) { const f = solve(group, diff); if (f) apply(f); }
      }
    }
    if (total() !== result.total) { const f = solve(result.lines, result.total - total()); if (f) apply(f); }
  }
  result.repaired = repaired;
}

/**
 * @returns {object} de (eerste) bon; extra bonnen in hetzelfde beeld (retourbon) staan in .extra
 */
export function parseLidlReceipt(text, opts = {}) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').map(cleanOcrLine).filter(Boolean);
  const segs = segments(lines);
  const parsed = (segs.length ? segs : [lines]).map((s) => parseSegment(s, opts));
  const [first, ...extra] = parsed;
  if (extra.length) first.extra = extra;
  first.rawText = String(text || '');
  return first;
}
