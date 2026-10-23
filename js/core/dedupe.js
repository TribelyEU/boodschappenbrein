// Voorkomen van dubbele imports.

import { hashString } from './text.js';

/**
 * Vingerafdruk van een bon: winkel, datum, totaal en de gesorteerde regelbedragen.
 * Twee keer dezelfde bon (ook via een andere bestandssoort) geeft dezelfde vingerafdruk.
 */
export function receiptFingerprint(receipt) {
  const amounts = receipt.lines.map((l) => l.amount).sort((a, b) => a - b).join(',');
  const total = receipt.total ?? receipt.lines.reduce((t, l) => t + l.amount, 0);
  return `${receipt.store || '?'}|${receipt.date || '?'}|${total}|${receipt.lines.length}|${hashString(amounts)}`;
}

/** Vingerafdruk die ook werkt als het aantal regels door OCR-verschillen licht afwijkt. */
export function looseFingerprint(receipt) {
  const total = receipt.total ?? receipt.lines.reduce((t, l) => t + l.amount, 0);
  return `${receipt.store || '?'}|${receipt.date || '?'}|${total}`;
}

/**
 * Bepaalt per voorgestelde bon of die al bestaat.
 * @param {object[]} proposals
 * @param {{ fingerprints: Set<string>, loose: Set<string> }} existing
 * @returns {('nieuw'|'dubbel'|'mogelijk-dubbel')[]}
 */
export function classifyDuplicates(proposals, existing) {
  const seen = new Set();
  return proposals.map((p) => {
    const fp = receiptFingerprint(p);
    const lf = looseFingerprint(p);
    if (existing.fingerprints.has(fp) || seen.has(fp)) return 'dubbel';
    seen.add(fp);
    if (p.total != null && p.total !== 0 && existing.loose.has(lf)) return 'mogelijk-dubbel';
    return 'nieuw';
  });
}
