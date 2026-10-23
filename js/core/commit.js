// Omzetten van een (gecontroleerd) bonvoorstel naar opslagrecords, inclusief productkoppeling.

import { uid } from './text.js';
import { matchProduct, createProduct, detectBrand, parseSize, aliasKey, baseKey } from './products.js';
import { receiptFingerprint, looseFingerprint } from './dedupe.js';
import { validate } from './receipt-parser.js';

/**
 * Bepaalt per regel aan welk product die gekoppeld wordt (zonder iets op te slaan).
 * Wordt gebruikt in het controlescherm. Respecteert handmatige keuzes (line.productId / line.newProductName).
 */
export function resolveLines(proposal, memory) {
  return proposal.lines.map((l) => {
    if (l.kind !== 'product' && l.kind !== 'return') return { ...l, match: null };
    if (l.productId) return { ...l, match: { productId: l.productId, confidence: 1, method: 'handmatig' } };
    return { ...l, match: matchProduct(l.rawName, memory) };
  });
}

/**
 * @param {object} proposal  bonvoorstel (na controle)
 * @param {{ products: Map, aliases: Map }} memory  productgeheugen (wordt bijgewerkt in deze Maps)
 * @param {{ importId: string, source: object }} meta
 * @returns {{ receipt, lines, newProducts, newAliases }}
 */
export function proposalToRecords(proposal, memory, meta) {
  validate(proposal);
  const receiptId = uid();
  const newProducts = [];
  const newAliases = [];
  const lineIds = proposal.lines.map(() => uid());
  const lines = proposal.lines.map((l, i) => {
    let productId = null;
    if (l.kind === 'product' || l.kind === 'return') {
      if (l.productId && memory.products.has(l.productId)) {
        productId = l.productId;
      } else {
        const m = matchProduct(l.rawName, memory);
        productId = m.productId;
        if (!productId) {
          const p = createProduct(l.rawName, m.key || baseKey(l.rawName));
          if (l.category) { p.category = l.category; p.categorySource = 'manual'; }
          memory.products.set(p.id, p);
          newProducts.push(p);
          productId = p.id;
        }
      }
      // Handmatige keuze in het controlescherm = leren voor de volgende keer.
      if (l.productId || l.learn) {
        const ak = aliasKey(l.rawName);
        if (memory.aliases.get(ak) !== productId) {
          memory.aliases.set(ak, productId);
          newAliases.push({ key: ak, productId, createdAt: new Date().toISOString() });
        }
      }
    }
    const brand = detectBrand(l.rawName);
    const size = l.size || parseSize(l.rawName);
    return {
      id: lineIds[i],
      receiptId,
      idx: i,
      date: proposal.date,
      store: proposal.store,
      rawName: l.rawName,
      qty: l.qty ?? 1,
      unitPrice: l.unitPrice ?? null,
      amount: l.amount,
      kind: l.kind,
      productId,
      brand: brand.brand,
      house: brand.house,
      sizeAmount: l.weighed ? null : size?.amount ?? null,
      sizeUnit: l.weighed ? null : size?.unit ?? null,
      weighed: Boolean(l.weighed),
      promo: Boolean(l.promo),
      normalUnknown: Boolean(l.normalUnknown),
      linkedTo: l.linkedTo != null && lineIds[l.linkedTo] ? lineIds[l.linkedTo] : null,
      linkedAlso: l.linkedTo != null && l.linkedAlso?.length ? l.linkedAlso.map((j) => lineIds[j]).filter(Boolean) : undefined,
      raw: l.raw || '',
      confidence: l.confidence ?? null,
    };
  });

  const receipt = {
    id: receiptId,
    store: proposal.store,
    date: proposal.date,
    total: proposal.total,
    computedTotal: proposal.computedTotal,
    check: proposal.check,
    warnings: proposal.warnings || [],
    fingerprint: receiptFingerprint(proposal),
    loose: looseFingerprint(proposal),
    importId: meta.importId,
    source: meta.source,
    externalId: proposal.externalId || null,
    reportedSavings: proposal.reportedSavings ?? null,
    rawText: proposal.rawText || '',
    lineCount: lines.length,
    createdAt: new Date().toISOString(),
  };
  return { receipt, lines, newProducts, newAliases };
}
