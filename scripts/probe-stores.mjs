#!/usr/bin/env node
// Diagnose: haalt per winkel de aanbiedingenpagina en robots.txt op en bewaart ze in data/debug/.
// Alleen handmatig (Run workflow met "debug" aan). Eén verzoek per pagina, met pauzes.

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'data', 'debug');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

const PAGES = {
  jumbo: ['https://www.jumbo.com/robots.txt', 'https://www.jumbo.com/aanbiedingen/nu'],
  dirk: ['https://www.dirk.nl/robots.txt', 'https://www.dirk.nl/aanbiedingen'],
  hoogvliet: ['https://www.hoogvliet.com/robots.txt', 'https://www.hoogvliet.com/aanbiedingen'],
  action: ['https://www.action.com/robots.txt', 'https://www.action.com/nl-nl/weekactie/'],
  lidl: ['https://www.lidl.nl/robots.txt', 'https://www.lidl.nl/c/aanbiedingen/a10008785'],
  kruidvat: ['https://www.kruidvat.nl/robots.txt', 'https://www.kruidvat.nl/acties'],
};

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
await mkdir(dir, { recursive: true });
const summary = {};
for (const [store, urls] of Object.entries(PAGES)) {
  for (const url of urls) {
    const name = `${store}-${url.endsWith('robots.txt') ? 'robots.txt' : 'page.html'}`;
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*', 'Accept-Language': 'nl-NL,nl;q=0.9' }, redirect: 'follow' });
      const body = await r.text();
      await writeFile(join(dir, name), body.slice(0, 3_000_000));
      summary[name] = { status: r.status, finalUrl: r.url, bytes: body.length, type: r.headers.get('content-type') };
    } catch (e) {
      summary[name] = { error: e.message };
    }
    console.log(name, JSON.stringify(summary[name]));
    await pause(2000);
  }
}
await writeFile(join(dir, 'summary.json'), JSON.stringify(summary, null, 1));
