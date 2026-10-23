#!/usr/bin/env node
// Haalt de aanbiedingen van deze week op en schrijft ze naar data/aanbiedingen.json.
// Gebruik:  node scripts/fetch-offers.mjs            (alle winkels uit STORES)
//           DEBUG_HTML=1 node scripts/fetch-offers.mjs (bewaart ook de opgehaalde Folderz-pagina's in data/debug/)
// Draait automatisch via .github/workflows/aanbiedingen.yml.

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fetchAh, fetchFolderz } from './offer-sources.mjs';
import { fetchStore, PARSERS } from './store-sources.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// AH via de AH-app-API; Jumbo, Dirk, Hoogvliet, Action en Lidl via hun eigen aanbiedingenpagina (één pagina per dag).
// Niet automatisch: Kruidvat weigert automatische toegang (403, okt. 2026) en Wibra heeft geen bruikbare pagina.
// Folderz blokkeert automatische toegang (AWS-WAF-controle); die blokkade omzeilen we niet.
const STORES = (process.env.STORES || 'ah,jumbo,dirk,hoogvliet,lidl,action').split(',').map((s) => s.trim()).filter(Boolean);
const MANUAL = {
  kruidvat: 'Kruidvat weigert automatische toegang tot de website; dat omzeilen we niet.',
  wibra: 'Wibra heeft geen aanbiedingenpagina die automatisch te lezen is.',
};
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' }); // JJJJ-MM-DD
const keepHtml = process.env.DEBUG_HTML === '1';
const log = (...a) => console.log(...a);

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const sources = {};
  const offers = [];
  await mkdir(join(root, 'data', 'debug'), { recursive: true });
  let previous = null;
  try { previous = JSON.parse(await readFile(join(root, 'data', 'aanbiedingen.json'), 'utf8')); } catch { /* geen vorig bestand */ }

  for (const store of STORES) {
    const started = Date.now();
    try {
      if (store === 'ah') {
        try {
          const res = await fetchAh(fetch, { today, log });
          offers.push(...res.offers);
          sources.ah = { ok: true, via: 'ah-app-api', count: res.offers.length, period: res.period };
        } catch (e) {
          log(`AH-API mislukt (${e.message}); terugval op Folderz.`);
          const res = await fetchFolderz(fetch, 'ah', { today, log, keepHtml });
          offers.push(...res.offers);
          sources.ah = { ok: res.offers.length > 0, via: 'folderz', count: res.offers.length, method: res.method, note: `AH-API: ${e.message}` };
          if (res.html) await writeFile(join(root, 'data', 'debug', 'ah.html'), res.html.slice(0, 600000));
        }
      } else if (PARSERS[store]) {
        const res = await fetchStore(fetch, store, { log });
        if (!res.offers.length) {
          await writeFile(join(root, 'data', 'debug', `${store}.html`), res.html.slice(0, 3000000));
          throw new Error('0 aanbiedingen gevonden; de website is waarschijnlijk veranderd');
        }
        offers.push(...res.offers);
        sources[store] = { ok: true, via: 'website', count: res.offers.length };
      } else {
        const res = await fetchFolderz(fetch, store, { today, log, keepHtml });
        offers.push(...res.offers);
        sources[store] = { ok: res.offers.length > 0, via: 'folderz', count: res.offers.length, method: res.method, slug: res.slug };
        if (res.html) await writeFile(join(root, 'data', 'debug', `${store}.html`), res.html.slice(0, 600000));
      }
    } catch (e) {
      // Vorige, nog geldige aanbiedingen van deze winkel bewaren, zodat één mislukte dag niets wegneemt.
      const kept = (previous?.offers || []).filter((o) => o.store === store && o.validTo && o.validTo >= today);
      offers.push(...kept);
      sources[store] = { ok: false, error: e.message, kept: kept.length, count: kept.length };
      log(`${store}: MISLUKT – ${e.message}${kept.length ? ` (${kept.length} eerdere aanbiedingen bewaard)` : ''}`);
    }
    sources[store].ms = Date.now() - started;
    await pause(1500); // vriendelijk tempo
  }

  for (const [store, note] of Object.entries(MANUAL)) if (!sources[store]) sources[store] = { ok: false, manual: true, error: note };

  // Valt alles uit, overschrijf dan niet de vorige (bruikbare) gegevens.
  const total = offers.length;
  const file = join(root, 'data', 'aanbiedingen.json');
  if (!total) {
    let prev = null;
    try { prev = JSON.parse(await readFile(file, 'utf8')); } catch { /* geen vorig bestand */ }
    if (prev?.offers?.length) {
      prev.lastAttempt = { at: new Date().toISOString(), sources };
      await writeFile(file, JSON.stringify(prev));
      log('Geen enkele aanbieding opgehaald; vorig bestand behouden.');
      process.exitCode = 1;
      return;
    }
  }
  const out = { app: 'Boodschappenbrein', version: 1, generatedAt: new Date().toISOString(), today, sources, offers };
  await writeFile(file, JSON.stringify(out));
  await updateHistory(offers);
  log(`\nKlaar: ${total} aanbiedingen.`);
  for (const [s, v] of Object.entries(sources)) log(`  ${s.padEnd(10)} ${v.ok ? 'ok ' : 'NEE'} ${v.count ?? 0}${v.via ? ` via ${v.via}` : ''}${v.method ? ` (${v.method})` : ''}${v.error ? ` – ${v.error}` : ''}${v.note ? ` – ${v.note}` : ''}`);
  // Gedeeltelijk mislukt is geen fout (de app toont het per winkel); helemaal niets wel, zodat GitHub een melding mailt.
  if (!total) process.exitCode = 1;
}

/**
 * Historie: per ISO-week alle aanbiedingen die die week voorbijkwamen (compact), maximaal 52 weken.
 * Hiermee ziet de app "laagste prijs sinds …" en hoe vaak iets per winkel terugkomt. Alleen openbare folderinformatie.
 */
async function updateHistory(offers) {
  const file = join(root, 'data', 'historie.json');
  let hist = { app: 'Boodschappenbrein', version: 1, weeks: {} };
  try { hist = JSON.parse(await readFile(file, 'utf8')); } catch { /* eerste keer */ }
  const d = new Date(today + 'T12:00:00Z');
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const wn = 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  const wk = `${d.getUTCFullYear()}-${String(wn).padStart(2, '0')}`;
  const list = hist.weeks[wk] || [];
  const seen = new Set(list.map((o) => o.id));
  for (const o of offers) {
    if (seen.has(o.id)) continue;
    seen.add(o.id);
    const c = { id: o.id, store: o.store, title: o.title };
    for (const k of ['brand', 'size', 'price', 'was', 'mechanism', 'validFrom', 'validTo']) if (o[k] != null) c[k] = o[k];
    list.push(c);
  }
  hist.weeks[wk] = list;
  const keep = Object.keys(hist.weeks).sort().slice(-52);
  hist.weeks = Object.fromEntries(keep.map((k) => [k, hist.weeks[k]]));
  hist.updatedAt = new Date().toISOString();
  await writeFile(file, JSON.stringify(hist));
  log(`Historie: week ${wk} (${list.length} acties), ${keep.length} weken bewaard.`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
