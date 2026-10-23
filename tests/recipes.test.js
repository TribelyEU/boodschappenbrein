// Recepten: ingrediënten ontleden, schalen en het JSON-LD van Lekker en Simpel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIngredient, amountText, recipeFromLd, searchRecipes } from '../js/core/recipes.js';

test('ingrediënten ontleden', () => {
  const a = parseIngredient('700 gr kruimige aardappels');
  assert.deepEqual([a.amount, a.unit, a.name, a.pantry], [700, 'gr', 'kruimige aardappels', false]);
  const e = parseIngredient('2-3  eieren');
  assert.deepEqual([e.amount, e.amountTo, e.unit, e.name], [2, 3, '', 'eieren']);
  const o = parseIngredient('2  bosuitjes (optioneel)');
  assert.deepEqual([o.amount, o.name, o.optional], [2, 'bosuitjes', true]);
  const k = parseIngredient('klontje boter');
  assert.deepEqual([k.amount, k.unit, k.name, k.pantry], [null, 'klontje', 'boter', true]);
  assert.equal(parseIngredient('snuf peper en zout').pantry, true);
  assert.equal(parseIngredient('1 tl mosterd').unit, 'tl');
  assert.equal(parseIngredient('1 el olijfolie').pantry, true);
  assert.equal(parseIngredient('½ komkommer').amount, 0.5);
  assert.equal(parseIngredient('1,5 kg kipdijfilet').amount, 1.5);
  assert.equal(parseIngredient('1 kleine ui').name, 'kleine ui');
  assert.equal(parseIngredient('2 teentjes knoflook').name, 'knoflook');
});

test('schalen naar meer personen', () => {
  assert.equal(amountText(parseIngredient('700 gr kruimige aardappels'), 2), '1400 gr');
  assert.equal(amountText(parseIngredient('2-3 eieren'), 2), '4-6');
  assert.equal(amountText(parseIngredient('½ komkommer'), 2), '1');
  assert.equal(amountText(parseIngredient('1 ui'), 1.5), '1½');
  assert.equal(amountText(parseIngredient('klontje boter'), 2), 'klontje');
});

const LD = { '@context': 'https://schema.org', '@graph': [{ '@type': 'Article' }, {
  '@type': 'Recipe', name: 'Stamppot met sla en spekjes', datePublished: '2026-10-19T06:00:00+00:00',
  image: ['https://x/588A1013.jpg', 'https://x/588A1013-500x500.jpg', 'https://x/588A1013-500x375.jpg'],
  recipeYield: ['2', '2 personen'], totalTime: 'PT25M',
  recipeIngredient: ['700 gr kruimige aardappels', '150 gr ijsbergsla', '125 gr spekreepjes'],
  recipeInstructions: [{ '@type': 'HowToStep', text: 'Schil de aardappels' }],
  recipeCategory: ['Hoofdgerecht'], recipeCuisine: ['Hollandse keuken'], keywords: 'aardappel, Stamppot, spekjes' }] };

test('recept uit JSON-LD, zonder bereiding', () => {
  const r = recipeFromLd(LD, 'https://www.lekkerensimpel.com/stamppot-met-sla-en-spekjes/');
  assert.equal(r.name, 'Stamppot met sla en spekjes');
  assert.equal(r.image, 'https://x/588A1013-500x375.jpg');
  assert.equal(r.time, 25);
  assert.equal(r.servings, 2);
  assert.equal(r.ingredients.length, 3);
  assert.deepEqual(r.category, ['Hoofdgerecht']);
  assert.equal(r.date, '2026-10-19');
  assert.ok(!('instructions' in r) && !JSON.stringify(r).includes('Schil'));
  assert.equal(recipeFromLd({ '@graph': [{ '@type': 'Article' }] }, 'x'), null);
  assert.equal(recipeFromLd({ '@type': 'Recipe', name: 'x' }, 'x'), null);
  assert.equal(recipeFromLd({ ...LD['@graph'][1], totalTime: 'PT1H10M' }, 'u').time, 70);
});

test('zoeken', () => {
  const r = recipeFromLd(LD, 'u');
  const pasta = { ...r, name: 'Pasta pesto', ingredients: ['300 gr pasta', 'pesto'], keywords: [], time: 45, category: ['Hoofdgerecht'] };
  assert.deepEqual(searchRecipes([r, pasta], 'stamppot').map((x) => x.name), ['Stamppot met sla en spekjes']);
  assert.deepEqual(searchRecipes([r, pasta], 'spekreepjes').length, 1);
  assert.deepEqual(searchRecipes([r, pasta], '', { maxTime: 30 }).map((x) => x.name), ['Stamppot met sla en spekjes']);
  assert.equal(searchRecipes([r, pasta], 'aardappel spek').length, 1);
});
