// Dunne laag rond IndexedDB. Elke tabel heeft 'id' (of 'key') als sleutel.

const VERSION = 2; // 2: inslaglijst + vriezer
const SCHEMA = {
  receipts: { keyPath: 'id', indexes: ['date', 'fingerprint', 'loose', 'importId'] },
  lines: { keyPath: 'id', indexes: ['receiptId', 'productId', 'date'] },
  products: { keyPath: 'id', indexes: ['key'] },
  aliases: { keyPath: 'key' },
  imports: { keyPath: 'id', indexes: ['fileHash'] },
  adjustments: { keyPath: 'id', indexes: ['productId'] },
  list: { keyPath: 'id' },
  meals: { keyPath: 'id' },
  plan: { keyPath: 'date' },
  settings: { keyPath: 'key' },
  market: { keyPath: 'id' },
  stockpile: { keyPath: 'id' },
  freezer: { keyPath: 'id', indexes: ['entryId'] },
};

export const DB_NAMES = { real: 'boodschappenbrein', demo: 'boodschappenbrein-demo' };

let db = null;

export async function openDB(name) {
  if (db) db.close();
  db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(name, VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      for (const [store, def] of Object.entries(SCHEMA)) {
        if (d.objectStoreNames.contains(store)) continue;
        const os = d.createObjectStore(store, { keyPath: def.keyPath });
        for (const idx of def.indexes || []) os.createIndex(idx, idx);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('De database is in een ander tabblad geopend. Sluit dat tabblad en probeer opnieuw.'));
  });
  // Vraag de browser om de opslag niet automatisch op te ruimen.
  try { await navigator.storage?.persist?.(); } catch { /* niet ondersteund */ }
  return db;
}

function tx(stores, mode = 'readonly') {
  if (!db) throw new Error('Database is niet geopend.');
  return db.transaction(stores, mode);
}

const done = (t) => new Promise((resolve, reject) => {
  t.oncomplete = () => resolve();
  t.onerror = () => reject(t.error);
  t.onabort = () => reject(t.error || new Error('Opslaan afgebroken.'));
});
const req2p = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

export async function getAll(store) {
  return req2p(tx([store]).objectStore(store).getAll());
}

export async function get(store, key) {
  return req2p(tx([store]).objectStore(store).get(key));
}

export async function put(store, value) {
  const t = tx([store], 'readwrite');
  t.objectStore(store).put(value);
  await done(t);
}

export async function del(store, key) {
  const t = tx([store], 'readwrite');
  t.objectStore(store).delete(key);
  await done(t);
}

/**
 * Atomaire schrijfactie over meerdere tabellen: alles of niets.
 * @param {Record<string, {put?: object[], delete?: any[], clear?: boolean}>} ops
 */
export async function write(ops) {
  const stores = Object.keys(ops);
  const t = tx(stores, 'readwrite');
  for (const s of stores) {
    const os = t.objectStore(s);
    if (ops[s].clear) os.clear();
    for (const k of ops[s].delete || []) os.delete(k);
    for (const v of ops[s].put || []) os.put(v);
  }
  await done(t);
}

export async function estimateUsage() {
  try {
    const e = await navigator.storage.estimate();
    const persisted = await navigator.storage.persisted?.();
    return { usage: e.usage, quota: e.quota, persisted };
  } catch { return null; }
}
