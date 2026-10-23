#!/usr/bin/env node
// Diagnose: hoe biedt lekkerensimpel.com recepten aan? Schrijft data/debug/recepten-probe.json.
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const B = 'https://www.lekkerensimpel.com';
const out = {};
async function get(path) {
  try {
    const r = await fetch(B + path, { headers: { 'User-Agent': UA, Accept: '*/*' }, redirect: 'follow' });
    const text = await r.text();
    return { status: r.status, type: r.headers.get('content-type'), text };
  } catch (e) { return { error: e.message, text: '' }; }
}
for (const p of ['/robots.txt', '/sitemap_index.xml', '/wp-json/', '/wp-json/wp/v2/categories?per_page=100&_fields=id,name,slug,count',
  '/wp-json/wp/v2/posts?per_page=3&_fields=id,link,title,date,categories,featured_media,yoast_head_json']) {
  const r = await get(p);
  out[p] = { status: r.status, type: r.type, error: r.error, sample: r.text.slice(0, p === '/wp-json/' ? 1500 : 6000) };
  await new Promise((res) => setTimeout(res, 800));
}
try {
  const sm = await get('/post-sitemap.xml');
  const urls = [...sm.text.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*(?:<lastmod>([^<]+)<\/lastmod>)?/g)].map((m) => ({ loc: m[1], mod: m[2] }));
  out.sitemap = { count: urls.length, first: urls.slice(0, 5), last: urls.slice(-5) };
  const recent = [...urls].sort((x, y) => String(y.mod).localeCompare(String(x.mod))).slice(0, 2);
  out.pages = [];
  for (const u of recent) {
    const r = await get(u.loc.replace(B, ''));
    const lds = [...r.text.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    out.pages.push({ link: u.loc, status: r.status, size: r.text.length, ldCount: lds.length, ld: lds.map((s) => s.slice(0, 9000)), wprm: /wprm-recipe/.test(r.text), tasty: /tasty-recipes/.test(r.text) });
    await new Promise((res) => setTimeout(res, 1500));
  }
} catch (e) { out.pageError = e.message; }
await mkdir(join(root, 'data', 'debug'), { recursive: true });
await writeFile(join(root, 'data', 'debug', 'recepten-probe.json'), JSON.stringify(out, null, 1));
console.log(Object.entries(out).map(([k, v]) => `${k}: ${v.status ?? ''}`).join('\n'));
