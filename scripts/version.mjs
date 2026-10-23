// Versie van de app = hash over alle app-bestanden. `node scripts/version.mjs` schrijft version.json;
// de test controleert dat die klopt, zodat een nieuwe versie nooit ongemerkt online komt.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['index.html', 'sw.js', 'manifest.webmanifest', 'css', 'js'];

function walk(p) {
  const full = path.join(ROOT, p);
  if (fs.statSync(full).isDirectory()) return fs.readdirSync(full).sort().flatMap((f) => walk(path.join(p, f)));
  return [p];
}

export function appHash() {
  const h = createHash('sha256');
  for (const f of FILES.flatMap(walk)) { h.update(f.replace(/\\/g, '/')); h.update(fs.readFileSync(path.join(ROOT, f))); }
  return h.digest('hex').slice(0, 12);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const v = appHash();
  fs.writeFileSync(path.join(ROOT, 'version.json'), JSON.stringify({ v }) + '\n');
  console.log('version.json →', v);
}
