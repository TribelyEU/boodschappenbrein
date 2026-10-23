// version.json moet bij de huidige bestanden horen, anders ziet de app op de telefoon de update niet.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { appHash } from '../scripts/version.mjs';

test('version.json is bijgewerkt (draai: node scripts/version.mjs)', () => {
  const { v } = JSON.parse(fs.readFileSync(new URL('../version.json', import.meta.url), 'utf8'));
  assert.equal(v, appHash());
});
