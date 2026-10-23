// Back-up en herstel via JSON.

export const BACKUP_TABLES = ['receipts', 'lines', 'products', 'aliases', 'imports', 'adjustments', 'list', 'meals', 'plan', 'settings', 'stockpile', 'freezer'];
export const BACKUP_VERSION = 1;

export function buildBackup(data, now = new Date()) {
  const out = { app: 'Boodschappenbrein', version: BACKUP_VERSION, exportedAt: now.toISOString(), counts: {}, data: {} };
  for (const t of BACKUP_TABLES) {
    out.data[t] = data[t] || [];
    out.counts[t] = out.data[t].length;
  }
  return out;
}

/** Controleert een back-up voordat er iets overschreven wordt. Geeft een lijst foutmeldingen terug (leeg = ok). */
export function validateBackup(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') return ['Dit is geen geldig JSON-bestand.'];
  if (obj.app !== 'Boodschappenbrein') errors.push('Dit bestand is geen Boodschappenbrein-back-up.');
  if (typeof obj.version !== 'number' || obj.version > BACKUP_VERSION) errors.push(`Onbekende back-upversie (${obj.version}).`);
  if (!obj.data || typeof obj.data !== 'object') { errors.push('De back-up bevat geen gegevens.'); return errors; }
  for (const t of BACKUP_TABLES) {
    if (obj.data[t] != null && !Array.isArray(obj.data[t])) errors.push(`Onderdeel “${t}” is beschadigd.`);
  }
  const receiptIds = new Set((obj.data.receipts || []).map((r) => r.id));
  const orphan = (obj.data.lines || []).filter((l) => !receiptIds.has(l.receiptId)).length;
  if (orphan) errors.push(`${orphan} bonregels verwijzen naar een onbekende bon.`);
  const missingId = ['receipts', 'lines', 'products'].some((t) => (obj.data[t] || []).some((x) => !x || !x.id));
  if (missingId) errors.push('Sommige records missen een id.');
  return errors;
}
