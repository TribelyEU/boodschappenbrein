#!/usr/bin/env node
// Diagnose: werken de afbeelding- en linkadressen uit data/aanbiedingen.json? Schrijft data/debug/afbeeldingen.json.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(await readFile(join(root, 'data', 'aanbiedingen.json'), 'utf8'));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const out = {};
for (const store of [...new Set(data.offers.map((o) => o.store))]) {
  const list = data.offers.filter((o) => o.store === store);
  const withImg = list.filter((o) => o.image);
  out[store] = { offers: list.length, withImage: withImg.length, withUrl: list.filter((o) => o.url).length, checks: [] };
  for (const o of withImg.slice(0, 2)) {
    for (const [kind, url] of [['image', o.image], ['url', o.url]]) {
      if (!url) continue;
      try {
        const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
        out[store].checks.push({ kind, url, status: r.status, type: r.headers.get('content-type') });
        await r.arrayBuffer();
      } catch (e) { out[store].checks.push({ kind, url, error: e.message }); }
      await new Promise((res) => setTimeout(res, 500));
    }
  }
}
await mkdir(join(root, 'data', 'debug'), { recursive: true });
await writeFile(join(root, 'data', 'debug', 'afbeeldingen.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
