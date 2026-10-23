#!/usr/bin/env node
// Haalt nieuwe recepten van lekkerensimpel.com op (via hun openbare sitemap en de receptgegevens op elke pagina)
// en schrijft data/recepten.json. Beleefd: robots.txt wordt gevolgd, max. RECIPE_LIMIT pagina's per keer,
// 2 seconden ertussen. We bewaren alleen naam, foto, tijd, personen en ingrediënten; voor de bereiding linkt de app naar hun site.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { recipeFromLd } from '../js/core/recipes.js';
import { robotsAllows } from './store-sources.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(root, 'data', 'recepten.json');
const B = 'https://www.lekkerensimpel.com';
const UA = 'Mozilla/5.0 (compatible; Boodschappenbrein/1.0; huishoudapp, haalt alleen receptgegevens op)';
const LIMIT = Number(process.env.RECIPE_LIMIT || 30);
const MAX_KEEP = 2000;
// Geen recepten maar overzichten, weekmenu's en nieuws
const NOT_RECIPE = /\/(lekker-en-simpel-weekmenu|weekmenu|best-bekeken|\d+x-|food-photos|en-de-winnaar|ingezonden|winactie|nieuwe-recepten|kookboek|recepten-van-de-week)/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xml' }, redirect: 'follow' });
  if (!r.ok) throw new Error(`HTTP ${r.status} voor ${url}`);
  return r.text();
}

let db = { source: B, recipes: [], skipped: [] };
try { db = { ...db, ...JSON.parse(await readFile(FILE, 'utf8')) }; } catch { /* eerste keer */ }

const robots = await get(`${B}/robots.txt`).catch(() => '');
const index = await get(`${B}/sitemap_index.xml`);
const maps = [...index.matchAll(/<loc>([^<]+post-sitemap\d*\.xml)<\/loc>/g)].map((m) => m[1]);
const urls = [];
for (const m of maps.reverse().slice(0, 4)) { // de nieuwste sitemaps zijn genoeg
  const xml = await get(m);
  for (const u of xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*(?:<lastmod>([^<]+)<\/lastmod>)?/g)) urls.push({ loc: u[1], mod: u[2] || '' });
  await sleep(1000);
}
urls.sort((a, b) => b.mod.localeCompare(a.mod));

const known = new Set([...db.recipes.map((r) => r.url), ...db.skipped]);
const todo = urls.filter((u) => !known.has(u.loc) && !NOT_RECIPE.test(new URL(u.loc).pathname) && robotsAllows(robots, new URL(u.loc).pathname)).slice(0, LIMIT);
let added = 0, skipped = 0, failed = 0;
for (const u of todo) {
  try {
    const page = await get(u.loc);
    let rec = null;
    for (const m of page.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
      try { rec = recipeFromLd(JSON.parse(m[1]), u.loc); } catch { /* ongeldige JSON */ }
      if (rec) break;
    }
    if (rec) { db.recipes.push(rec); added++; } else { db.skipped.push(u.loc); skipped++; }
  } catch (e) { failed++; console.warn(e.message); }
  await sleep(2000);
}

db.recipes.sort((a, b) => String(b.date).localeCompare(String(a.date)));
db.recipes = db.recipes.slice(0, MAX_KEEP);
db.skipped = db.skipped.slice(-6000);
db.generatedAt = new Date().toISOString();
await writeFile(FILE, JSON.stringify(db));
console.log(`Recepten: ${added} nieuw, ${skipped} geen recept, ${failed} mislukt; totaal ${db.recipes.length} (nog ${Math.max(0, urls.filter((u) => !known.has(u.loc)).length - todo.length)} te doen).`);
