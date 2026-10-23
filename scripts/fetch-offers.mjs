#!/usr/bin/env node
// Haalt de aanbiedingen van deze week op en schrijft ze naar data/aanbiedingen.json.
// Gebruik:  node scripts/fetch-offers.mjs            (alle winkels uit STORES)
//           DEBUG_HTML=1 node scripts/fetch-offers.mjs (bewaart ook de opgehaalde Folderz-pagina's in data/debug/)
// Draait automatisch via .github/workflows/aanbiedingen.yml.

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fetchAh, fetchFolderz } from './offer-sources.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Standaard alleen AH. Folderz blokkeert automatische toegang (AWS-WAF-controle, okt. 2026); die blokkade omzeilen we niet.
// Andere winkels kunnen later worden toegevoegd zodra er een bron is die automatische toegang toestaat.
const STORES = (process.env.STORES || 'ah').split(',').map((s) => s.trim()).filter(Boolean);
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' }); // JJJJ-MM-DD
const keepHtml = process.env.DEBUG_HTML === '1';
const log = (...a) => console.log(...a);

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const sources = {};
  const offers = [];
  await mkdir(join(root, 'data', 'debug'), { recursive: true });

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
      } else {
        const res = await fetchFolderz(fetch, store, { today, log, keepHtml });
        offers.push(...res.offers);
        sources[store] = { ok: res.offers.length > 0, via: 'folderz', count: res.offers.length, method: res.method, slug: res.slug };
        if (res.html) await writeFile(join(root, 'data', 'debug', `${store}.html`), res.html.slice(0, 600000));
      }
    } catch (e) {
      sources[store] = { ok: false, error: e.message };
      log(`${store}: MISLUKT – ${e.message}`);
    }
    sources[store].ms = Date.now() - started;
    await pause(1500); // vriendelijk tempo
  }

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
  log(`\nKlaar: ${total} aanbiedingen.`);
  for (const [s, v] of Object.entries(sources)) log(`  ${s.padEnd(10)} ${v.ok ? 'ok ' : 'NEE'} ${v.count ?? 0}${v.via ? ` via ${v.via}` : ''}${v.method ? ` (${v.method})` : ''}${v.error ? ` – ${v.error}` : ''}${v.note ? ` – ${v.note}` : ''}`);
  // Gedeeltelijk mislukt is geen fout (de app toont het per winkel); helemaal niets wel, zodat GitHub een melding mailt.
  if (!total) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
