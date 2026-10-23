// Import van tabellen (CSV, Excel, AVG-exports): kolommen herkennen en rijen groeperen tot bonnen.

import { parseNumber, toCents, parseAmount } from './money.js';
import { parseDateValue } from './dates.js';
import { storeFromName } from './stores.js';
import { parseSize } from './products.js';
import { validate, linkDiscounts } from './receipt-parser.js';

/** CSV-parser met ondersteuning voor aanhalingstekens en automatische scheidingstekenherkenning. */
export function parseCSV(text) {
  const src = String(text || '').replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/).find((l) => l.trim()) || '';
  const counts = { ';': 0, ',': 0, '\t': 0, '|': 0 };
  let inQ = false;
  for (const ch of firstLine) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch in counts) counts[ch]++;
  }
  const delim = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0
    ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : ',';

  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') {
      quoted = true;
    } else if (ch === delim) {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return { rows, delimiter: delim };
}

export const FIELDS = [
  { id: 'date', label: 'Datum', required: true, synonyms: ['datum', 'date', 'aankoopdatum', 'transactiedatum', 'besteldatum', 'bezorgdatum', 'orderdatum', 'dag', 'tijdstip', 'purchase date'] },
  { id: 'product', label: 'Product', required: true, synonyms: ['product', 'omschrijving', 'artikel', 'productnaam', 'artikelomschrijving', 'description', 'naam', 'item', 'title', 'titel', 'artikelnaam'] },
  { id: 'qty', label: 'Aantal', synonyms: ['aantal', 'qty', 'quantity', 'hoeveelheid', 'stuks', 'aant'] },
  { id: 'amount', label: 'Bedrag (regeltotaal)', synonyms: ['bedrag', 'totaal', 'regeltotaal', 'totaalprijs', 'prijs totaal', 'amount', 'total', 'betaald', 'subtotaal', 'line total'] },
  { id: 'unitPrice', label: 'Stukprijs', synonyms: ['stukprijs', 'prijs', 'eenheidsprijs', 'price', 'unit price', 'prijs per stuk', 'verkoopprijs'] },
  { id: 'discount', label: 'Korting', synonyms: ['korting', 'bonus', 'discount', 'voordeel', 'bonuskorting', 'kortingsbedrag'] },
  { id: 'store', label: 'Winkel', synonyms: ['winkel', 'supermarkt', 'store', 'filiaal', 'shop', 'merchant', 'winkelnaam'] },
  { id: 'receiptId', label: 'Bon-/ordernummer', synonyms: ['bon', 'bonnummer', 'bon id', 'transactie', 'transactienummer', 'transaction id', 'order', 'ordernummer', 'bestelnummer', 'receipt', 'receipt id', 'kassabon'] },
  { id: 'size', label: 'Inhoud', synonyms: ['inhoud', 'gewicht', 'eenheid', 'unit size', 'size', 'verpakking'] },
  { id: 'brand', label: 'Merk', synonyms: ['merk', 'brand'] },
];

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Zoekt de kopregel (eerste rij met minstens twee herkende kolommen) en stelt een kolomtoewijzing voor. */
export function detectMapping(rows) {
  let headerRow = 0;
  let bestScore = -1;
  let bestMap = {};
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const map = {};
    let score = 0;
    rows[r].forEach((cell, col) => {
      const c = norm(cell);
      if (!c) return;
      for (const f of FIELDS) {
        if (map[f.id] != null) continue;
        const exact = f.synonyms.includes(c);
        const partial = !exact && f.synonyms.some((s) => c.startsWith(s + ' ') || c.endsWith(' ' + s));
        if (exact || partial) { map[f.id] = col; score += exact ? 2 : 1; break; }
      }
    });
    if (score > bestScore) { bestScore = score; bestMap = map; headerRow = r; }
  }
  return { headerRow, mapping: bestMap, confident: bestMap.date != null && bestMap.product != null && (bestMap.amount != null || bestMap.unitPrice != null) };
}

function cellAmount(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return toCents(v);
  const exact = parseAmount(String(v).trim());
  if (exact != null) return exact;
  return toCents(parseNumber(v));
}

/**
 * Zet tabelrijen om in bonvoorstellen, gegroepeerd per bonnummer of anders per datum + winkel.
 * @returns {{ receipts: object[], skipped: {row:number, reason:string}[] }}
 */
export function rowsToReceipts(rows, { headerRow = 0, mapping, defaultStore = null }) {
  const groups = new Map();
  const skipped = [];
  const get = (row, f) => (mapping[f] != null ? row[mapping[f]] : null);

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    const date = parseDateValue(get(row, 'date'));
    const name = String(get(row, 'product') ?? '').trim();
    if (!date || !name) { skipped.push({ row: r + 1, reason: !date ? 'geen geldige datum' : 'geen productnaam' }); continue; }
    const qtyRaw = parseNumber(get(row, 'qty'));
    const qty = qtyRaw == null || qtyRaw === 0 ? 1 : qtyRaw;
    const unit = cellAmount(get(row, 'unitPrice'));
    let amount = cellAmount(get(row, 'amount'));
    if (amount == null && unit != null) amount = Math.round(unit * qty);
    if (amount == null) { skipped.push({ row: r + 1, reason: 'geen bedrag' }); continue; }
    let discount = cellAmount(get(row, 'discount'));
    if (discount != null && discount > 0) discount = -discount;
    const storeRaw = get(row, 'store');
    const store = storeRaw ? storeFromName(storeRaw) : defaultStore;
    const rid = get(row, 'receiptId');
    const key = rid ? `id:${rid}` : `${date}|${store || ''}`;
    if (!groups.has(key)) {
      groups.set(key, { store, date, total: null, subtotal: null, lines: [], warnings: [], rawText: '', externalId: rid ? String(rid) : null });
    }
    const g = groups.get(key);
    const sizeText = get(row, 'size');
    const brand = get(row, 'brand');
    const fullName = brand && !name.toLowerCase().startsWith(String(brand).toLowerCase()) ? `${brand} ${name}` : name;
    const isDiscountRow = amount < 0 && /korting|bonus|actie|voordeel/i.test(name);
    g.lines.push({
      rawName: fullName,
      qty: isDiscountRow ? 1 : qty,
      unitPrice: unit ?? (qty ? Math.round(amount / qty) : amount),
      amount,
      kind: isDiscountRow ? 'discount' : amount < 0 ? 'return' : /statiegeld|emballage/i.test(name) ? 'deposit' : 'product',
      size: parseSize(sizeText ? String(sizeText) : fullName),
      raw: row.join(' | '),
      confidence: 0.95,
      linkedTo: null,
    });
    g.rawText += row.join(' | ') + '\n';
    if (discount) {
      g.lines.push({ rawName: `Korting ${name}`, qty: 1, unitPrice: discount, amount: discount, kind: 'discount', raw: '', confidence: 0.95, linkedTo: g.lines.length - 1 });
    }
  }

  const receipts = [...groups.values()].map((g) => {
    linkDiscounts(g);
    validate(g);
    // Een tabel heeft geen apart bontotaal: we nemen de som, en melden dat dit niet extern gecontroleerd is.
    g.total = g.computedTotal;
    g.check = 'geen-totaal';
    g.warnings = g.warnings.filter((w) => !w.startsWith('Geen totaalbedrag'));
    g.warnings.push('Tabelimport: geen apart bontotaal om tegen te controleren.');
    return g;
  });
  receipts.sort((a, b) => a.date.localeCompare(b.date));
  return { receipts, skipped };
}
