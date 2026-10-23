// Factuur van een online bestelling bij Albert Heijn (ah.nl → Mijn bestellingen → factuur-PDF).
//
// Opbouw (gecontroleerd op echte facturen, oktober 2026):
//   pagina 1  kopgegevens + samenvatting per btw-groep (NIET de artikelen; wordt overgeslagen)
//   "Specificatie"  artikelen:  <naam> [BONUS] <aantal> <btw%|Geen> <excl> <btw> <incl>
//             lange namen lopen door:  naam-regel / "3 9% 4,59 0,41 5,00" / "BONUS"
//             multipacks hebben een kopregel ("… 2-pack") gevolgd door de echte regel
//   "Overig"  Statiegeld, Statiegeld retour (negatief), Verpakkingsmateriaal, Koopzegels, Bezorgkosten
//   "Totaal inclusief btw 117,46"  en  "Uw voordeel 7,96 is in het totaalbedrag verwerkt"
//
// Belangrijk: prijzen op de factuur zijn al ná bonuskorting. De normale prijs staat er niet op,
// dus BONUS-regels krijgen promo=true en normalUnknown=true (niet gebruikt voor prijsstijgingen).

import { parseAmount } from './money.js';
import { findDate } from './dates.js';
import { parseSize } from './products.js';
import { validate } from './receipt-parser.js';

export function isAhInvoice(text) {
  return /\bFactuur\b/.test(text) && /\bSpecificatie\b/.test(text) && /Inclusief btw/i.test(text) && /(Albert Heijn|ah\.nl)/i.test(text);
}

const NUM = '(-?\\d{1,4},\\d{2})';
// [naam] [aantal] btw excl btw-bedrag incl
const RE_ITEM = new RegExp(`^(.*?)\\s*(?:(\\d{1,4})\\s+)?(\\d{1,2}%|Geen)\\s+${NUM}\\s+${NUM}\\s+${NUM}$`, 'i');

export function parseAhInvoice(text, opts = {}) {
  const rawText = String(text).replace(/\r/g, '');
  const lines = rawText.split('\n').map((l) => l.trim().replace(/\s+/g, ' ')).filter(Boolean);
  const result = {
    store: 'ah',
    date: null,
    total: null,
    subtotal: null,
    lines: [],
    warnings: [],
    rawText,
    sourceType: 'ah-factuur',
    reportedSavings: null,
    externalId: null,
  };
  const deliv = rawText.match(/Afleverdatum\s+(.+)/i);
  result.date = (deliv && findDate(deliv[1], opts.today || null)) || findDate(rawText, opts.today || null);
  const tot = rawText.match(/Totaal inclusief btw\s+(-?\d{1,5},\d{2})/i);
  if (tot) result.total = parseAmount(tot[1]);
  const save = rawText.match(/Uw voordeel\s+(\d{1,5},\d{2})/i);
  if (save) result.reportedSavings = parseAmount(save[1]);
  const order = rawText.match(/Factuurnummer\s+([\w-]+)/i);
  if (order) result.externalId = order[1];

  let section = null; // null = vóór specificatie, 'items', 'statiegeld', 'retour', 'overig'
  let pendingName = null;
  for (const line of lines) {
    if (/^Specificatie$/i.test(line)) { section = 'items'; pendingName = null; continue; }
    if (!section) continue;
    if (/^Pagina \d+ van \d+/i.test(line) || /^Omschrijving\b/i.test(line) || /^(Datum|Factuurnummer|Debiteurnummer|Uw bestelling|Afleverdatum|Bezorgadres)\b/i.test(line)) continue;
    if (/^\d{4}\s?[A-Z]{2}\s/.test(line)) continue; // postcode-regel van het adres
    if (/^Overig$/i.test(line)) { section = 'overig'; pendingName = null; continue; }
    if (/^Statiegeld retour$/i.test(line)) { section = 'retour'; continue; }
    if (/^Statiegeld$/i.test(line)) { section = 'statiegeld'; continue; }
    if (/^(Verpakkingsmateriaal|Verrekeningen)$/i.test(line)) { section = 'overig'; continue; }
    if (/^Totaal\b/i.test(line) || /^Betaald$/i.test(line)) break;
    if (/^BONUS$/i.test(line)) { const prev = result.lines.at(-1); if (prev) prev.promo = prev.normalUnknown = prev.kind === 'product'; continue; }

    const m = line.match(RE_ITEM);
    if (!m) { pendingName = line; continue; } // (deel van) een productnaam of multipack-kopregel
    let name = m[1].trim();
    if (!name && pendingName) name = pendingName;
    pendingName = null;
    const qty = m[2] ? parseInt(m[2], 10) : 1;
    const amount = parseAmount(m[6]);
    const promo = /\bBONUS$/i.test(name);
    name = name.replace(/\s*\bBONUS$/i, '').trim();

    let kind = 'product';
    if (/^\+?\s*Statiegeld/i.test(name) || section === 'statiegeld' || section === 'retour') kind = 'deposit';
    else if (section === 'overig') kind = 'nongrocery';
    else if (/koopzegels|plastic tas|bezorgkosten/i.test(name)) kind = 'nongrocery';
    if (kind === 'nongrocery' && amount === 0) continue; // bv. gratis bezorging

    result.lines.push({
      rawName: kind === 'deposit' && section === 'retour' ? `Statiegeld retour: ${name}` : name.replace(/^\+\s*/, ''),
      qty,
      unitPrice: qty ? Math.round(amount / qty) : amount,
      amount,
      kind,
      size: kind === 'product' ? parseSize(name) : null,
      raw: line,
      confidence: 0.97,
      linkedTo: null,
      promo: kind === 'product' && promo,
      normalUnknown: kind === 'product' && promo,
    });
  }

  validate(result);
  if (result.reportedSavings) result.warnings.push(`AH meldt €${(result.reportedSavings / 100).toFixed(2).replace('.', ',')} voordeel; dat zit al in de artikelprijzen verwerkt.`);
  return result;
}
