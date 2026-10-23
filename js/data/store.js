// Applicatiestatus: laadt alles uit IndexedDB, houdt afgeleide berekeningen bij en voert acties uit.

import * as db from './db.js';
import { buildFacts } from '../core/analytics.js';
import { predictStock } from '../core/stock-model.js';
import { savingsAdvice } from '../core/savings.js';
import { rhythmOverview } from '../core/promo-rhythm.js';
import { freezerContents, defaultsFor } from '../core/stockpile.js';
import { offersStatus } from '../core/offers.js';
import { DEFAULT_WATCHLIST, watchOffers } from '../core/watch.js';
import { categoryModel } from '../core/categories.js';
import { proposalToRecords } from '../core/commit.js';
import { aliasKey } from '../core/products.js';
import { buildBackup, validateBackup, BACKUP_TABLES } from '../core/backup.js';
import { generateDemoReceipts } from '../core/demo.js';
import { todayISO } from '../core/dates.js';
import { uid } from '../core/text.js';

export const DEFAULT_SETTINGS = {
  vacations: [],
  compareStores: ['ah', 'jumbo', 'lidl', 'dirk', 'plus', 'aldi'],
  extraStoreCost: 0,
  defaultStore: null,
  priceMatches: {},
  householdName: '',
  // Winkels waar de app aanbiedingen volgt
  myStores: ['ah', 'lidl', 'hoogvliet', 'jumbo', 'dirk', 'action', 'wibra', 'kruidvat'].map((id) => ({ id })),
  freezerCapacity: 40, // grove capaciteit in verpakkingen
  hasFreezer: true,
  offersUrl: '', // leeg = data/aanbiedingen.json naast de app (GitHub Pages)
  watchlist: DEFAULT_WATCHLIST, // volglijst (Koopjes)
  ratings: [], // oordelen over aanbiedingen: { key, watchId, store, title, perUnit, discount, interesting, week, at }
  repeaters: [], // hardlopers: productId's waarvoor de lijst een herinnering geeft
  snoozed: {}, // productId → datum tot wanneer de herinnering stil is
  offerChoices: {}, // aanbiedingssleutel → zelf gekozen variant { name, sizeText, normal }
};

export const state = {
  mode: 'real',
  ready: false,
  receipts: [],
  lines: [],
  products: new Map(),
  aliases: new Map(),
  imports: [],
  adjustments: [],
  list: [],
  meals: [],
  plan: new Map(),
  stockpile: [],
  freezer: [],
  offers: null, // { data, fetchedAt, error }
  history: null, // { data, fetchedAt } bewaarde aanbiedingen per week
  settings: { ...DEFAULT_SETTINGS },
  version: 0,
};

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function changed() { state.version++; cache.version = -1; for (const fn of listeners) fn(); }

export function today() { return todayISO(); }

export async function init() {
  let mode = 'real';
  try { mode = localStorage.getItem('bb-mode') === 'demo' ? 'demo' : 'real'; } catch { /* privémodus */ }
  await openMode(mode);
}

async function openMode(mode) {
  state.mode = mode;
  await db.openDB(mode === 'demo' ? db.DB_NAMES.demo : db.DB_NAMES.real);
  await reload();
  if (mode === 'demo' && state.receipts.length === 0) await seedDemo();
  try { state.offers = (await db.get('market', 'offers')) || null; } catch { state.offers = null; }
  try { state.history = (await db.get('market', 'history')) || null; } catch { state.history = null; }
  state.ready = true;
  changed();
  const age = state.offers?.fetchedAt ? Date.now() - Date.parse(state.offers.fetchedAt) : Infinity;
  // Het bestand is klein (±170 kB): bij elke start even kijken of er een nieuwere versie is,
  // en opnieuw als de app na een uur weer wordt geopend.
  if (age > 60e3) refreshOffers().catch(() => {});
  if (!openMode.watching) {
    openMode.watching = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      const a = state.offers?.fetchedAt ? Date.now() - Date.parse(state.offers.fetchedAt) : Infinity;
      if (a > 3600e3) refreshOffers().catch(() => {});
    });
  }
  const hAge = state.history?.fetchedAt ? Date.now() - Date.parse(state.history.fetchedAt) : Infinity;
  if (hAge > 20 * 3600e3) refreshHistory().catch(() => {});
}

/**
 * Supermarktassortiment met gewone prijzen (Checkjebon open data), voor voorstellen van gelijkwaardige producten.
 * Wordt alleen geladen als erom gevraagd wordt, en een week bewaard op het apparaat.
 */
export async function loadAssortment({ force = false } = {}) {
  const { compactAssortment, ASSORTMENT_URL } = await import('../core/assortment.js');
  let rec = null;
  try { rec = await db.get('market', 'assortment'); } catch { rec = null; }
  if (rec?.stores && !force && Date.now() - Date.parse(rec.fetchedAt) < 7 * 864e5) return rec;
  try {
    const r = await fetch(ASSORTMENT_URL, { cache: 'no-store' });
    if (!r.ok) throw new Error(`server antwoordde ${r.status}`);
    const stores = compactAssortment(await r.json());
    rec = { id: 'assortment', stores, fetchedAt: new Date().toISOString() };
    await db.put('market', rec);
    return rec;
  } catch (e) {
    if (rec?.stores) return { ...rec, stale: true, error: e.message };
    throw new Error(`Assortiment ophalen lukte niet: ${e.message}`);
  }
}

/** Bewaarde aanbiedingen van eerdere weken (data/historie.json naast de app). Mislukt dit, dan werkt alles gewoon zonder. */
export async function refreshHistory() {
  const base = state.settings.offersUrl ? state.settings.offersUrl.replace(/aanbiedingen\.json(\?.*)?$/, '') : new URL('data/', location.href).href;
  try {
    const r = await fetch(new URL('historie.json', base).href, { cache: 'no-store' });
    if (!r.ok) return null;
    const data = await r.json();
    if (!data?.weeks) return null;
    const rec = { id: 'history', data, fetchedAt: new Date().toISOString() };
    await db.put('market', rec);
    state.history = rec;
    changed();
    return rec;
  } catch { return null; }
}

/** Haalt het aanbiedingenbestand op (zelfde website als de app, of een ingesteld adres). */
export async function refreshOffers() {
  const url = state.settings.offersUrl || new URL('data/aanbiedingen.json', location.href).href;
  let rec;
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status === 404 ? 'bestand niet gevonden (is de wekelijkse ophaalactie al eens gedraaid?)' : `server antwoordde ${r.status}`);
    const data = await r.json();
    if (!Array.isArray(data?.offers)) throw new Error('onverwacht formaat');
    rec = { id: 'offers', data, fetchedAt: new Date().toISOString(), url, error: null };
  } catch (e) {
    rec = { ...(state.offers || { id: 'offers', data: null }), id: 'offers', error: e.message, triedAt: new Date().toISOString(), url };
  }
  await db.put('market', rec);
  state.offers = rec;
  changed();
  return rec;
}

export async function setMode(mode) {
  try { localStorage.setItem('bb-mode', mode); } catch { /* */ }
  await openMode(mode);
}

export async function reload() {
  const [receipts, lines, products, aliases, imports, adjustments, list, meals, plan, settings, stockpile, freezer] = await Promise.all(
    ['receipts', 'lines', 'products', 'aliases', 'imports', 'adjustments', 'list', 'meals', 'plan', 'settings', 'stockpile', 'freezer'].map((s) => db.getAll(s)),
  );
  state.stockpile = stockpile.sort((a, b) => a.name.localeCompare(b.name));
  state.freezer = freezer;
  state.receipts = receipts.sort((a, b) => b.date.localeCompare(a.date));
  state.lines = lines;
  state.products = new Map(products.map((p) => [p.id, p]));
  state.aliases = new Map(aliases.map((a) => [a.key, a.productId]));
  state.imports = imports.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  state.adjustments = adjustments;
  state.list = list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  state.meals = meals;
  state.plan = new Map(plan.map((p) => [p.date, p]));
  const s = Object.fromEntries(settings.map((x) => [x.key, x.value]));
  state.settings = { ...DEFAULT_SETTINGS, ...s };
}

// ---------- afgeleide gegevens (gecachet per versie) ----------
const cache = { version: -1 };
export function derived() {
  if (cache.version === state.version) return cache;
  const t = today();
  const facts = buildFacts(state.lines, state.products);
  const purchasesByProduct = new Map();
  for (const l of state.lines) {
    if (l.kind !== 'product' || !l.productId || !(l.amount > 0)) continue;
    if (!purchasesByProduct.has(l.productId)) purchasesByProduct.set(l.productId, []);
    purchasesByProduct.get(l.productId).push({ date: l.date, qty: l.qty || 1 });
  }
  const adjByProduct = new Map();
  for (const a of state.adjustments) {
    if (!adjByProduct.has(a.productId)) adjByProduct.set(a.productId, []);
    adjByProduct.get(a.productId).push(a);
  }
  const predictions = new Map();
  for (const [pid, purchases] of purchasesByProduct) {
    const p = state.products.get(pid);
    if (!p) continue;
    predictions.set(pid, predictStock(purchases, adjByProduct.get(pid) || [], {
      today: t, model: p.model || categoryModel(p.category), vacations: state.settings.vacations,
    }));
  }
  const savings = savingsAdvice(facts, state.products, t, { predictions, receipts: state.receipts });
  const rhythm = rhythmOverview(facts, state.products, t, { predictions });
  rhythm.byProduct = new Map(rhythm.rows.map((r) => [r.productId, r]));
  // Online facturen: het gemelde voordeel zit al in de prijzen en staat niet als kortingsregel op de factuur.
  rhythm.totals.reported = state.receipts.reduce((sum, r) => sum + (r.reportedSavings || 0), 0);
  rhythm.totals.saved += rhythm.totals.reported;
  // Vriezer: afgeleid uit aankopen + handmatige correcties
  const freezer = freezerContents(state.stockpile, { lines: state.lines, adjustments: state.adjustments, products: state.products, today: t, vacations: state.settings.vacations, manual: state.freezer });
  const freezerUsed = [...freezer.values()].reduce((sum, f) => sum + f.packs, 0);
  const offerData = state.offers?.data || null;
  const stores = (state.settings.myStores || []).map((x) => x.id);
  const koopjes = (state.settings.watchlist || []).map((item) => watchOffers(item, offerData?.offers || [], { today: t, ratings: state.settings.ratings, stores, choices: state.settings.offerChoices || {} }));
  const offerStatus = offersStatus(offerData, t);
  Object.assign(cache, { version: state.version, facts, predictions, savings, rhythm, freezer, freezerUsed, koopjes, offerStatus, today: t, purchasesByProduct });
  return cache;
}

// ---------- import ----------
export function memory() {
  return { products: new Map(state.products), aliases: new Map(state.aliases) };
}

export function existingFingerprints() {
  return {
    fingerprints: new Set(state.receipts.map((r) => r.fingerprint)),
    loose: new Set(state.receipts.map((r) => r.loose)),
  };
}

export function findImportByHash(hash) {
  return state.imports.find((i) => i.fileHashes?.includes(hash));
}

/** Slaat gecontroleerde bonnen op in één transactie, als één terug te draaien import. */
export async function commitReceipts(proposals, { files = [], label = '' } = {}) {
  const importId = uid();
  const mem = memory();
  const receipts = [];
  const lines = [];
  const newProducts = [];
  const newAliases = [];
  for (const p of proposals) {
    const rec = proposalToRecords(p, mem, { importId, source: { type: p.sourceType || 'onbekend', fileName: p.fileName || null } });
    receipts.push(rec.receipt);
    lines.push(...rec.lines);
    newProducts.push(...rec.newProducts);
    newAliases.push(...rec.newAliases);
  }
  const imp = {
    id: importId,
    createdAt: new Date().toISOString(),
    label: label || files.map((f) => f.name).join(', ') || 'Import',
    fileHashes: files.map((f) => f.hash).filter(Boolean),
    fileNames: files.map((f) => f.name),
    receiptIds: receipts.map((r) => r.id),
    productIds: newProducts.map((p) => p.id),
    receiptCount: receipts.length,
    lineCount: lines.length,
    total: receipts.reduce((t, r) => t + (r.total ?? r.computedTotal ?? 0), 0),
  };
  await db.write({
    receipts: { put: receipts }, lines: { put: lines }, products: { put: newProducts }, aliases: { put: newAliases }, imports: { put: [imp] },
  });
  await reload();
  changed();
  return imp;
}

/** Draait een import volledig terug: bonnen, regels en producten die alleen door deze import bestonden. */
export async function undoImport(importId) {
  const imp = state.imports.find((i) => i.id === importId);
  if (!imp) throw new Error('Import niet gevonden.');
  const receiptIds = new Set(imp.receiptIds);
  const lineIds = state.lines.filter((l) => receiptIds.has(l.receiptId)).map((l) => l.id);
  const remaining = new Set(state.lines.filter((l) => !receiptIds.has(l.receiptId)).map((l) => l.productId));
  const orphanProducts = (imp.productIds || []).filter((pid) => !remaining.has(pid));
  const orphanSet = new Set(orphanProducts);
  const aliasDeletes = [...state.aliases.entries()].filter(([, pid]) => orphanSet.has(pid)).map(([k]) => k);
  await db.write({
    receipts: { delete: [...receiptIds] }, lines: { delete: lineIds }, products: { delete: orphanProducts },
    aliases: { delete: aliasDeletes }, imports: { delete: [importId] },
    adjustments: { delete: state.adjustments.filter((a) => orphanSet.has(a.productId)).map((a) => a.id) },
  });
  await reload();
  changed();
}

export async function deleteReceipt(receiptId) {
  const lineIds = state.lines.filter((l) => l.receiptId === receiptId).map((l) => l.id);
  const imp = state.imports.find((i) => i.receiptIds.includes(receiptId));
  const ops = { receipts: { delete: [receiptId] }, lines: { delete: lineIds } };
  if (imp) {
    const rest = imp.receiptIds.filter((id) => id !== receiptId);
    ops.imports = rest.length ? { put: [{ ...imp, receiptIds: rest, receiptCount: rest.length }] } : { delete: [imp.id] };
  }
  await db.write(ops);
  await reload();
  changed();
}

// ---------- productgeheugen ----------
export async function updateProduct(id, patch) {
  const p = state.products.get(id);
  if (!p) return;
  const next = { ...p, ...patch };
  if (patch.category) next.categorySource = 'manual';
  await db.put('products', next);
  state.products.set(id, next);
  changed();
}

/** Koppelt één bonregel aan een ander product en onthoudt dit voor de toekomst. */
export async function relinkLine(lineId, productId) {
  const line = state.lines.find((l) => l.id === lineId);
  if (!line) return;
  const alias = { key: aliasKey(line.rawName), productId, createdAt: new Date().toISOString() };
  const same = state.lines.filter((l) => aliasKey(l.rawName) === alias.key).map((l) => ({ ...l, productId }));
  await db.write({ lines: { put: same }, aliases: { put: [alias] } });
  await reload();
  changed();
}

/** Voegt product `fromId` samen met `toId`: alle aankopen verhuizen, de oude naam wordt een alias. */
export async function mergeProducts(fromId, toId) {
  if (fromId === toId) return;
  const moved = state.lines.filter((l) => l.productId === fromId).map((l) => ({ ...l, productId: toId }));
  const aliases = [...new Set(moved.map((l) => aliasKey(l.rawName)))].map((key) => ({ key, productId: toId, createdAt: new Date().toISOString() }));
  const otherAliases = [...state.aliases.entries()].filter(([, pid]) => pid === fromId).map(([key]) => ({ key, productId: toId, createdAt: new Date().toISOString() }));
  const adj = state.adjustments.filter((a) => a.productId === fromId).map((a) => ({ ...a, productId: toId }));
  const list = state.list.filter((i) => i.productId === fromId).map((i) => ({ ...i, productId: toId }));
  // Inslaglijst: lid omzetten (en dubbele leden samenvoegen)
  const stock = state.stockpile.filter((e) => e.members.some((m) => m.productId === fromId)).map((e) => {
    const members = [];
    for (const m of e.members.map((x) => (x.productId === fromId ? { ...x, productId: toId } : x))) if (!members.some((x) => x.productId === m.productId)) members.push(m);
    return { ...e, members };
  });
  await db.write({
    lines: { put: moved }, aliases: { put: [...aliases, ...otherAliases] }, products: { delete: [fromId] }, adjustments: { put: adj }, list: { put: list }, stockpile: { put: stock },
  });
  await reload();
  changed();
}

// ---------- voorraad ----------
export async function adjustStock(productId, level) {
  const a = { id: uid(), productId, level, date: today(), createdAt: new Date().toISOString() };
  await db.put('adjustments', a);
  state.adjustments.push(a);
  changed();
  return a;
}

export async function undoAdjustment(id) {
  await db.del('adjustments', id);
  state.adjustments = state.adjustments.filter((a) => a.id !== id);
  changed();
}

// ---------- boodschappenlijst ----------
export async function addToList(item) {
  const existing = state.list.find((i) => !i.checked && ((item.productId && i.productId === item.productId) || i.name.toLowerCase() === item.name.toLowerCase()));
  if (existing) {
    const next = { ...existing, qty: (existing.qty || 1) + (item.qty || 1) };
    await db.put('list', next);
  } else {
    await db.put('list', {
      id: uid(), name: item.name, qty: item.qty || 1, productId: item.productId || null, category: item.category || null,
      checked: false, source: item.source || 'handmatig', note: item.note || '', store: item.store || null, addedAt: new Date().toISOString(), order: Date.now(),
    });
  }
  await reloadList();
}

export async function updateListItem(id, patch) {
  const it = state.list.find((i) => i.id === id);
  if (!it) return;
  await db.put('list', { ...it, ...patch, ...(patch.checked != null ? { checkedAt: patch.checked ? new Date().toISOString() : null } : {}) });
  await reloadList();
}

export async function removeListItems(ids) {
  await db.write({ list: { delete: ids } });
  await reloadList();
}

async function reloadList() {
  state.list = (await db.getAll('list')).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  changed();
}

// ---------- inslaglijst en vriezer ----------
export async function saveStockpile(entry) {
  const first = state.products.get(entry.members?.[0]?.productId);
  const d = defaultsFor(first);
  const e = {
    id: entry.id || uid(), name: entry.name || first?.name || 'Inslagproduct',
    members: entry.members || [], location: entry.location || d.location,
    maxWeeks: entry.maxWeeks ?? d.maxWeeks, shelfWeeks: entry.shelfWeeks ?? d.shelfWeeks ?? null,
    target: entry.target ?? null, createdAt: entry.createdAt || new Date().toISOString(),
  };
  await db.put('stockpile', e);
  state.stockpile = (await db.getAll('stockpile')).sort((a, b) => a.name.localeCompare(b.name));
  changed();
  return e;
}
export async function deleteStockpile(id) {
  await db.write({ stockpile: { delete: [id] }, freezer: { delete: state.freezer.filter((f) => f.entryId === id).map((f) => f.id) } });
  state.stockpile = state.stockpile.filter((e) => e.id !== id);
  state.freezer = state.freezer.filter((f) => f.entryId !== id);
  changed();
}
export async function freezerAction(entryId, type, qty = null) {
  const rec = { id: uid(), entryId, type, qty, date: today(), createdAt: new Date().toISOString() };
  await db.put('freezer', rec);
  state.freezer.push(rec);
  changed();
  return rec;
}
export async function undoFreezerAction(id) {
  await db.del('freezer', id);
  state.freezer = state.freezer.filter((f) => f.id !== id);
  changed();
}

// ---------- weekmenu ----------
export async function saveMeal(meal) {
  const m = { id: meal.id || uid(), name: meal.name, ingredients: meal.ingredients || [], kids: Boolean(meal.kids), favorite: Boolean(meal.favorite), notes: meal.notes || '' };
  await db.put('meals', m);
  state.meals = await db.getAll('meals');
  changed();
  return m;
}
export async function deleteMeal(id) {
  await db.del('meals', id);
  state.meals = state.meals.filter((m) => m.id !== id);
  changed();
}
export async function setPlan(date, mealId) {
  if (mealId) await db.put('plan', { date, mealId });
  else await db.del('plan', date);
  state.plan = new Map((await db.getAll('plan')).map((p) => [p.date, p]));
  changed();
}

// ---------- instellingen ----------
export async function setSetting(key, value) {
  await db.put('settings', { key, value });
  state.settings = { ...state.settings, [key]: value };
  changed();
}

// ---------- prijsdata ----------
export async function savePriceData(record) { await db.put('market', record); changed(); }
export async function loadPriceData(id = 'checkjebon') { return db.get('market', id); }

// ---------- back-up ----------
export async function exportBackup() {
  const data = {};
  for (const t of BACKUP_TABLES) data[t] = await db.getAll(t);
  return buildBackup(data);
}

export async function restoreBackup(obj) {
  const errors = validateBackup(obj);
  if (errors.length) throw new Error(errors.join(' '));
  const ops = {};
  for (const t of BACKUP_TABLES) ops[t] = { clear: true, put: obj.data[t] || [] };
  await db.write(ops); // één transactie: bij een fout blijft de oude situatie intact
  await reload();
  changed();
}

export async function wipeAll() {
  const ops = {};
  for (const t of [...BACKUP_TABLES, 'market']) ops[t] = { clear: true };
  await db.write(ops);
  await reload();
  changed();
}

async function seedDemo() {
  const receipts = generateDemoReceipts(today()).map((r) => ({ ...r, sourceType: 'demo' }));
  await commitReceipts(receipts, { label: 'Demogegevens (fictief)' });
  const byName = (re) => [...state.products.values()].find((p) => re.test(p.key) || re.test(p.name));
  const seed = [
    [/toiletpapier/, {}], [/aroma/, {}], [/kipfilet/, { location: 'vriezer' }],
  ];
  for (const [re, extra] of seed) {
    const p = byName(re);
    if (p) await saveStockpile({ name: p.name, members: [{ productId: p.id, role: 'standaard' }], ...extra });
  }
  const robijn = [...state.products.values()].find((p) => /wasmiddel/.test(p.key));
  const w5 = state.lines.find((l) => /^W5/.test(l.rawName))?.productId;
  if (robijn) await saveStockpile({ name: 'Wasmiddel', members: [{ productId: robijn.id, role: 'standaard' }, ...(w5 && w5 !== robijn.id ? [{ productId: w5, role: 'standaard' }] : [])] });
  await saveMeal({ name: 'Pasta bolognese', kids: true, favorite: true, ingredients: [{ name: 'Spaghetti', qty: 1 }, { name: 'Rundergehakt', qty: 1 }, { name: 'Pastasaus', qty: 1 }] });
  await saveMeal({ name: 'Kip met rijst en komkommer', kids: true, ingredients: [{ name: 'Kipfilet', qty: 1 }, { name: 'Snelkookrijst', qty: 1 }, { name: 'Komkommer', qty: 1 }] });
}

export { db };
