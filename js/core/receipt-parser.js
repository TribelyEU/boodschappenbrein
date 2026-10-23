// Zet de tekst van een kassabon (uit PDF, OCR of geplakt) om in gestructureerde bonregels.
//
// Ondersteunde regelvormen (bedragen altijd aan het eind van de regel):
//   "1 HALFV MELK 1,09"                 aantal, naam, bedrag           (AH)
//   "2 AH BANANEN 0,35 0,70"            aantal, naam, stukprijs, bedrag (AH)
//   "Halfvolle melk 1,98 B"             naam, bedrag, btw-code         (Lidl/Jumbo)
//   "   2 x 0,99"                       aantallen-regel bij vorige artikel
//   "Kaas jong belegen 3 x 2,49 7,47"   naam, aantal x prijs, bedrag
//   "0,856 kg x 1,99 /kg 1,70"          gewichtsregel
//   "BONUS AHHALFVOLLEMELK -0,30"       korting (wordt aan een artikel gekoppeld als dat lukt)
//   "STATIEGELD 0,15" / "EMBALLAGE -0,25"
//
// Alles wat niet zeker herkend wordt, krijgt een lage zekerheid en komt in het controlescherm.

import { parseAmount } from './money.js';
import { findDate } from './dates.js';
import { detectStore } from './stores.js';
import { abbreviationScore, compact, normalizeText } from './text.js';
import { parseSize } from './products.js';
import { isAhInvoice, parseAhInvoice } from './ah-invoice.js';

const AMT = '(-?\\s?\\d{1,4}[,.]\\d{2}-?)';
const VAT = '(?:\\s+[A-D]|\\s+\\d{1,2}%)?'; // btw-code achter het bedrag
const TAIL = `\\s*(?:€|eur)?\\s*`;

const RE_QTY_NAME_UNIT_TOTAL = new RegExp(`^(\\d{1,3})\\s+(.+?)\\s+${AMT}\\s+${AMT}${VAT}$`, 'i');
const RE_QTY_NAME_TOTAL = new RegExp(`^(\\d{1,3})\\s+(.+?)\\s+${AMT}${VAT}$`, 'i');
const RE_NAME_QTYX_TOTAL = new RegExp(`^(.+?)\\s+(\\d{1,3})\\s*[xX×]\\s*${AMT}\\s+${AMT}${VAT}$`, 'i');
const RE_NAME_TOTAL = new RegExp(`^(.+?)\\s+${AMT}${VAT}${TAIL}$`, 'i');
const RE_QTYX_ONLY = new RegExp(`^(\\d{1,3})\\s*[xX×]\\s*${AMT}(?:\\s+${AMT})?${VAT}$`, 'i');
const RE_WEIGHT = /(\d{1,3}[,.]\d{1,3})\s*kg\s*[xX×@*]\s*(?:€\s*)?(\d{1,3}[,.]\d{2})/i;
const RE_AMOUNT_ONLY = new RegExp(`^${AMT}${VAT}$`);

const SKIP = [
  /bonuskaart/i, /air\s*miles/i, /\bbtw\b/i, /\bpinnen\b/i, /\bpin\b/i, /betaald/i, /\bbetaling\b/i, /terminal/i,
  /merchant/i, /autori[sz]atie/i, /transactie/i, /\bpoi\b/i, /periode/i, /\bkassa\b/i, /filiaal/i, /bedankt/i,
  /dank u/i, /tot ziens/i, /www\./i, /\btel\b/i, /telefoon/i, /omschrijving/i, /^\s*aantal/i, /kaartnr/i,
  /contactloos/i, /maestro/i, /v\s*pay/i, /mastercard/i, /\bvisa\b/i, /debit/i, /wisselgeld/i, /contant/i,
  /^\s*[*=\-_ ]+\s*$/, /uw voordeel/i, /totaal voordeel/i, /^\s*waarvan/i, /bonus box/i, /spaarzegel.*saldo/i,
  /\bleesmethode\b/i, /\bkaart\b.*\d{4}/i, /\bterm\b/i, /\btrans\b/i, /\bok\b\s*$/i, /koopzegels?\s+gespaard/i,
  /aantal artikelen/i, /bonus\s*nr/i, /airmiles\s*nr/i, /^\s*spaaracties/i, /espaarzegels/i, /^\s*\d+\s*artikel(en)?\s*$/i, /openingstijden/i, /klantenservice/i, /kvk/i, /iban/i,
];
const TOTAL_RE = /^\s*(totaal|te betalen|totaalbedrag|total|eindtotaal)\b(?!\s*voordeel)/i;
// AH zet het aantal artikelen vóór SUBTOTAAL: "31 SUBTOTAAL 65,70".
const SUBTOTAL_RE = /^\s*(?:\d{1,4}\s+)?sub\s*-?\s*totaal\b/i;
const DISCOUNT_RE = /\b(bonus|korting|kassakorting|actie|voordeel|promo|kortingsbon|zegel\s*korting|2e\s*halve|1\s*\+\s*1|gratis|prijsvoordeel|aanbieding|lidl plus|personal|mijn ah miles|miles)\b/i;
const DEPOSIT_RE = /\b(statiegeld|statieg|emballage|leeg\s*goed|lege flessen|retour\s*fles|flessen?\s*retour)\b/i;
const NONGROCERY_RE = /\b(koopzegels?|spaarzegels?|cadeaukaart|giftcard|postzegels?|tegoedbon|opwaardeer|lotto|staatsloterij)\b/i;

/** AH-kassabonnen (PDF uit de app) vermelden de winkelnaam niet; herken ze aan bestandsnaam en vaste kenmerken. */
export function storeFromHints(text, fileName = '') {
  if (/^ah[_\s-]|albert.?heijn/i.test(fileName || '')) return 'ah';
  const ahMarks = [/koopzegels premium/i, /bonus box/i, /mijn ah miles/i, /espaarzegels/i, /\bah bonus\b/i, /aantal\s+omschrijving\s+prijs\s+bedrag/i];
  if (ahMarks.filter((r) => r.test(text)).length >= 2) return 'ah';
  return null;
}

function cleanName(name) {
  return name.replace(/\s{2,}/g, ' ').replace(/^[*#\s]+|[*#\s]+$/g, '').trim();
}

/**
 * Hoofdfunctie. Geeft een "bonvoorstel" terug dat in het controlescherm getoond wordt.
 * @param {string} text
 * @param {{ today?: string }} opts
 */
export function parseReceiptText(text, opts = {}) {
  const rawText = String(text || '').replace(/\r/g, '');
  const lines = rawText.split('\n').map((l) => l.replace(/\t/g, ' ').replace(/\s+$/, '')).filter((l) => l.trim());
  if (isAhInvoice(rawText)) return parseAhInvoice(rawText, opts);
  const result = {
    store: detectStore(rawText) || storeFromHints(rawText, opts.fileName),
    date: findDate(rawText, opts.today || null),
    total: null,
    subtotal: null,
    lines: [],
    warnings: [],
    rawText,
  };

  let pendingName = null;
  let inPaymentSection = false;

  for (let idx = 0; idx < lines.length; idx++) {
    const original = lines[idx];
    const line = original.trim().replace(/\s+/g, ' ');

    if (TOTAL_RE.test(line) && !SUBTOTAL_RE.test(line)) {
      const amounts = line.match(/-?\d{1,5}[,.]\d{2}-?/g);
      if (amounts && result.total == null) result.total = parseAmount(amounts[amounts.length - 1]);
      inPaymentSection = true;
      pendingName = null;
      continue;
    }
    if (SUBTOTAL_RE.test(line)) {
      const amounts = line.match(/-?\d{1,5}[,.]\d{2}-?/g);
      if (amounts) result.subtotal = parseAmount(amounts[amounts.length - 1]);
      pendingName = null;
      continue;
    }
    if (inPaymentSection) continue; // alles na TOTAAL is betaalinformatie (en samenvattingen zoals "uw voordeel")
    if (SKIP.some((re) => re.test(line))) { pendingName = null; continue; }

    // Aparte aantallen-regel: "2 x 0,99" (hoort bij het vorige of volgende artikel)
    let m = line.match(RE_QTYX_ONLY);
    if (m) {
      const qty = parseInt(m[1], 10);
      const unit = parseAmount(m[2]);
      const total = m[3] ? parseAmount(m[3]) : null;
      const prev = result.lines[result.lines.length - 1];
      if (pendingName) {
        pushProduct(result, pendingName, qty, unit, total ?? qty * unit, original, 0.85);
        pendingName = null;
      } else if (prev && prev.kind === 'product' && Math.abs(prev.amount - qty * unit) <= 1) {
        prev.qty = qty;
        prev.unitPrice = unit;
        prev.raw += '\n' + original;
      } else if (prev && total != null && prev.kind === 'product') {
        prev.qty = qty;
        prev.unitPrice = unit;
        prev.raw += '\n' + original;
        prev.confidence = Math.min(prev.confidence, 0.6);
      }
      continue;
    }

    // Gewichtsregel: "0,856 kg x 1,99 /kg [1,70]"
    const w = line.match(RE_WEIGHT);
    if (w) {
      const kg = parseFloat(w[1].replace(',', '.'));
      const perKg = parseAmount(w[2]);
      const trailing = line.slice(w.index + w[0].length).match(/(-?\d{1,4}[,.]\d{2}-?)\s*[A-D]?\s*$/);
      const prev = result.lines[result.lines.length - 1];
      const expected = Math.round(kg * perKg);
      const before = cleanName(line.slice(0, w.index));
      if (before && /[a-z]{3,}/i.test(before)) {
        pushProduct(result, before, kg, perKg, trailing ? parseAmount(trailing[1]) : expected, original, 0.8, true);
      } else if (pendingName) {
        pushProduct(result, pendingName, kg, perKg, trailing ? parseAmount(trailing[1]) : expected, original, 0.8, true);
        pendingName = null;
      } else if (prev && prev.kind === 'product' && Math.abs(prev.amount - expected) <= 2) {
        prev.qty = kg;
        prev.weighed = true;
        prev.unitPrice = perKg;
        prev.raw += '\n' + original;
      }
      continue;
    }

    // Regels met een bedrag aan het eind
    m = line.match(RE_NAME_QTYX_TOTAL);
    if (m && /[a-z]{2,}/i.test(m[1])) {
      const name = cleanName(m[1]);
      const qty = parseInt(m[2], 10);
      const unit = parseAmount(m[3]);
      const total = parseAmount(m[4]);
      classifyAndPush(result, name, qty, unit, total, original, Math.abs(qty * unit - Math.abs(total)) <= 1 ? 0.95 : 0.6);
      pendingName = null;
      continue;
    }
    m = line.match(RE_QTY_NAME_UNIT_TOTAL);
    if (m && /[a-z]{2,}/i.test(m[2])) {
      const qty = parseInt(m[1], 10);
      const unit = parseAmount(m[3]);
      const total = parseAmount(m[4]);
      const consistent = Math.abs(qty * unit - Math.abs(total)) <= 1;
      classifyAndPush(result, cleanName(m[2]), qty, unit, total, original, consistent ? 0.95 : 0.55);
      pendingName = null;
      continue;
    }
    m = line.match(RE_QTY_NAME_TOTAL);
    if (m && /[a-z]{2,}/i.test(m[2]) && parseInt(m[1], 10) > 0 && parseInt(m[1], 10) < 100) {
      const qty = parseInt(m[1], 10);
      const total = parseAmount(m[3]);
      classifyAndPush(result, cleanName(m[2]), qty, total != null ? Math.round(total / qty) : null, total, original, 0.85);
      pendingName = null;
      continue;
    }
    m = line.match(RE_NAME_TOTAL);
    if (m && /[a-z]{2,}/i.test(m[1])) {
      const total = parseAmount(m[2]);
      classifyAndPush(result, cleanName(m[1]), 1, total, total, original, 0.8);
      pendingName = null;
      continue;
    }
    m = line.match(RE_AMOUNT_ONLY);
    if (m && pendingName) {
      const total = parseAmount(m[1]);
      classifyAndPush(result, pendingName, 1, total, total, original, 0.7);
      pendingName = null;
      continue;
    }

    // Regel zonder bedrag: mogelijk een (afgebroken) productnaam.
    if (/[a-z]{3,}/i.test(line) && line.length < 48 && result.lines.length + (pendingName ? 1 : 0) > -1) {
      pendingName = pendingName ? cleanName(pendingName + ' ' + line) : cleanName(line);
      if (pendingName.length > 60) pendingName = null;
    }
  }

  linkDiscounts(result);
  validate(result);
  return result;
}

function pushProduct(result, name, qty, unitPrice, amount, raw, confidence, weighed = false) {
  result.lines.push({
    rawName: name,
    qty,
    unitPrice,
    amount,
    kind: amount < 0 ? 'return' : 'product',
    weighed,
    size: weighed ? null : parseSize(name),
    raw,
    confidence: amount < 0 ? Math.min(confidence, 0.6) : confidence,
    linkedTo: null,
    // Op AH-bonnen betekent een losse "B" achter het bedrag: Bonus-artikel (actieprijs/-korting).
    promo: result.store === 'ah' && /\d[,.]\d{2}\s+B\s*$/.test(raw.split('\n')[0]),
  });
}

function classifyAndPush(result, name, qty, unitPrice, amount, raw, confidence) {
  if (amount == null) return;
  if (DEPOSIT_RE.test(name)) {
    result.lines.push({ rawName: name, qty, unitPrice, amount, kind: 'deposit', raw, confidence: 0.9, linkedTo: null });
    return;
  }
  if (NONGROCERY_RE.test(name)) {
    result.lines.push({ rawName: name, qty, unitPrice, amount, kind: 'nongrocery', raw, confidence: 0.85, linkedTo: null });
    return;
  }
  if (DISCOUNT_RE.test(name) || (amount < 0 && /%/.test(name))) {
    result.lines.push({ rawName: name, qty: 1, unitPrice: amount, amount: amount > 0 ? -amount : amount, kind: 'discount', raw, confidence: amount < 0 ? 0.9 : 0.6, linkedTo: null });
    return;
  }
  pushProduct(result, name, qty, unitPrice, amount, raw, confidence);
}

/** Koppelt kortingsregels aan het best passende artikel (op naam, anders het direct voorafgaande artikel). */
export function linkDiscounts(result) {
  const products = result.lines.map((l, i) => ({ l, i })).filter((x) => x.l.kind === 'product');
  result.lines.forEach((line, i) => {
    if (line.kind !== 'discount' || line.linkedTo != null) return;
    // AH-kortingscodes: "BONUS MBAHSNOEPGRO" → "SNOEPGRO" (MB = mix & match, AH = huismerk)
    const label = line.rawName.replace(DISCOUNT_RE, ' ').replace(/\b(ah|jumbo|lidl)\b/gi, ' ').replace(/[-\d,.%€]+/g, ' ').trim()
      .replace(/^(mb)?(ah)?(?=[a-z]{4,})/i, '');
    let best = null;
    if (compact(label).length >= 3) {
      for (const p of products) {
        const s = abbreviationScore(label, p.l.rawName);
        if (!best || s > best.s) best = { s, i: p.i };
      }
    }
    if (best && best.s >= 0.75) {
      line.linkedTo = best.i;
      line.confidence = Math.min(line.confidence, best.s >= 0.9 ? 0.95 : 0.8);
      return;
    }
    // Woord uit de artikelnaam zit in de kortingscode ("AHNEDAARDBEI" ↔ "AARDBEI NED",
    // "MBAHVERSSAPS" ↔ "AH SAP" + "GEKOELD SAP"). Mix & match kan meerdere artikelen raken.
    const code = compact(label);
    if (code.length >= 4) {
      const groups = new Map();
      for (const p of products) {
        if (result.store === 'ah' && !p.l.promo) continue;
        const words = normalizeText(p.l.rawName).split(' ').filter((w) => w.length >= 3 && !/^(ah|mb)$/.test(w) && /^[a-z]+$/.test(w));
        if (words.some((w) => code.includes(w))) if (!groups.has(p.l.rawName)) groups.set(p.l.rawName, p.i);
      }
      if (groups.size >= 1 && groups.size <= 3) {
        const [first, ...rest] = [...groups.values()];
        line.linkedTo = first;
        if (rest.length) line.linkedAlso = rest;
        line.confidence = Math.min(line.confidence, 0.75);
        return;
      }
    }
    // Korting direct onder het artikel (Jumbo, Lidl): koppel aan vorige productregel.
    // Niet bij AH (daar staat het kortingsblok ná het subtotaal) en niet bij betalen met Miles (bonbrede korting).
    const prev = result.lines[i - 1];
    if (result.store !== 'ah' && !/miles/i.test(line.rawName) && prev && prev.kind === 'product' && compact(label).length < 3) {
      line.linkedTo = i - 1;
      line.confidence = Math.min(line.confidence, 0.8);
    }
  });

  // AH: precies één niet-herleidbare korting en precies één Bonus-artikel (B) zonder korting?
  // Dan hoort die korting vrijwel zeker daarbij (bv. "BONUS ALLEKNORR" bij "GOODNOODLES" = Knorr).
  // Bij meer kandidaten wordt niet gegokt.
  if (result.store === 'ah') {
    const open = result.lines.filter((l) => l.kind === 'discount' && l.linkedTo == null && !/miles/i.test(l.rawName));
    if (open.length === 1) {
      const withDiscount = new Set(result.lines.filter((l) => l.kind === 'discount' && l.linkedTo != null).map((l) => result.lines[l.linkedTo].rawName));
      const groups = new Map();
      result.lines.forEach((l, j) => {
        if (l.kind === 'product' && l.promo && !withDiscount.has(l.rawName)) groups.set(l.rawName, j);
      });
      if (groups.size === 1) {
        open[0].linkedTo = [...groups.values()][0];
        open[0].confidence = Math.min(open[0].confidence, 0.7);
        open[0].inferred = true;
      }
    }
  }
}

/** Controleert of de som van de regels overeenkomt met het bontotaal. */
export function validate(result) {
  const sum = result.lines.reduce((t, l) => t + (l.amount || 0), 0);
  result.computedTotal = sum;
  result.warnings = (result.warnings || []).filter((w) => !w.startsWith('Som') && !w.startsWith('Geen totaal'));
  if (result.total == null) {
    result.check = 'geen-totaal';
    result.warnings.push('Geen totaalbedrag gevonden op de bon. Controleer de regels handmatig.');
  } else if (Math.abs(sum - result.total) <= 1) {
    result.check = 'ok';
  } else {
    result.check = 'afwijking';
    result.warnings.push(`Som van de regels (${(sum / 100).toFixed(2).replace('.', ',')}) wijkt af van het bontotaal (${(result.total / 100).toFixed(2).replace('.', ',')}).`);
  }
  if (!result.date) result.warnings.push('Geen datum herkend.');
  if (!result.store) result.warnings.push('Supermarkt niet herkend.');
  if (!result.lines.length) result.warnings.push('Geen artikelen herkend.');
  return result;
}
