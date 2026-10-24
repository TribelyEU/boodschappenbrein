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

import { ahLink, packsNeeded, dishCost, queryVariants } from '../js/core/ah.js';

test('AH-link', () => {
  assert.equal(ahLink([{ id: 1525, qty: 1 }, { id: 197393, qty: 2 }, { id: null }]), 'https://www.ah.nl/mijnlijst//add-multiple?p=1525:1&p=197393:2');
  assert.equal(ahLink([]), null);
  assert.equal(ahLink([{ id: 5, qty: 1 }, { id: 5, qty: 2 }]), 'https://www.ah.nl/mijnlijst//add-multiple?p=5:3');
});

test('zoekvarianten', () => {
  assert.deepEqual(queryVariants('kipfilet of kippendijfilet').slice(0, 2), ['kipfilet of kippendijfilet', 'kipfilet']);
  assert.equal(queryVariants('(verse) spinazie')[0], 'spinazie');
  assert.ok(queryVariants('kleine ui').includes('ui'));
});

test('verpakkingen en kosten van een gerecht', () => {
  assert.equal(packsNeeded({ qty: 1, amount: '1400 gr' }, { amount: 1500, unit: 'g' }), 1);
  assert.equal(packsNeeded({ qty: 1, amount: '1400 gr' }, { amount: 1000, unit: 'g' }), 2);
  assert.equal(packsNeeded({ qty: 1, amount: '1 kg' }, { amount: 500, unit: 'g' }), 2);
  assert.equal(packsNeeded({ qty: 1, amount: '750 ml' }, { amount: 1000, unit: 'ml' }), 1);
  assert.equal(packsNeeded({ qty: 4, amount: '' }, { amount: 6, unit: 'st' }), 1);
  assert.equal(packsNeeded({ qty: 2, amount: '' }, null), 2);
  assert.equal(packsNeeded({ qty: 1, amount: '2 tenen' }, { amount: 3, unit: 'st' }), 1);
  assert.equal(packsNeeded({ qty: 1, amount: '1 tl' }, { amount: 100, unit: 'g' }), 1);
  const prices = { orzo: { price: 199, size: { amount: 500, unit: 'g' } }, kipfilet: { price: 549, size: { amount: 300, unit: 'g' } } };
  const ings = [{ name: 'orzo', qty: 1, amount: '600 gr' }, { name: 'kipfilet', qty: 1, amount: '300 gr' }, { name: 'peper', qty: 1, amount: '', pantry: true }];
  const c = dishCost(ings, (n) => prices[n]);
  assert.equal(c.total, 199 * 2 + 549);
  assert.equal(dishCost([...ings, { name: 'saffraan', qty: 1, amount: '' }], (n) => prices[n]).total, null);
});

import { rankForIngredient, stem } from '../js/core/ah.js';

test('ingrediënt → AH-product: geen ander product mét het ingrediënt', () => {
  const items = [
    { name: 'AH Rode bieten met ui', price: 219, id: 1 }, { name: 'AH Gele uien 1 kg', price: 99, id: 2 },
    { name: 'Knorr Champignonsaus', price: 115, id: 3 }, { name: 'AH Witte champignons', price: 109, id: 4 },
    { name: 'AH Truffelsalami met Parmezaanse kaas', price: 329, id: 5 }, { name: 'AH Kopsoep champignon', price: 99, id: 6 },
    { name: 'AH Kastanjechampignons', price: 149, id: 7 }, { name: 'AH Biologisch Witte champignons', price: 199, id: 8 },
  ];
  assert.equal(rankForIngredient(items, 'ui')[0].id, 2);
  assert.ok(!rankForIngredient(items, 'ui').some((x) => x.id === 1) || rankForIngredient(items, 'ui')[0].id === 2);
  assert.equal(rankForIngredient(items, 'champignons')[0].id, 4);
  assert.ok(!rankForIngredient(items, 'champignons').some((x) => x.id === 3)); // champignonsaus is geen champignon
  const more = [
    { name: 'AH Amsterdamse uien', price: 79, id: 10 }, { name: 'AH Gele uien', price: 89, id: 11 },
    { name: 'AH Rondeel eieren M L', price: 419, id: 12 }, { name: 'AH Scharreleieren M', price: 249, id: 13 },
    { name: 'AH Gebakken spekreepjes', price: 289, id: 14 }, { name: 'AH Spekreepjes gerookt', price: 479, id: 15 },
    { name: 'AH Champignon schijfjes', price: 99, id: 16 }, { name: 'AH Witte champignons', price: 109, id: 17 },
  ];
  more.push({ name: 'AH Verse roomkaas met ananas', price: 239, id: 18 }, { name: 'MonChou Original verse roomkaas', price: 195, id: 19 },
    { name: 'AH Scharrel gerookte kipfilet', price: 299, id: 20 }, { name: 'AH Scharrel kipfilet naturel', price: 299, id: 21 });
  assert.equal(rankForIngredient(more, 'roomkaas')[0].id, 19);    // gewone roomkaas, niet met ananas
  assert.equal(rankForIngredient(more, 'kipfilet')[0].id, 21);
  assert.equal(rankForIngredient(more, 'ui')[0].id, 11);          // geen zilveruitjes in het zuur
  assert.equal(rankForIngredient(more, 'eieren')[0].id, 13);      // scharreleieren = eieren
  assert.equal(rankForIngredient(more, 'spekreepjes')[0].id, 15);
  assert.equal(rankForIngredient(more, 'champignons')[0].id, 17);
  assert.equal(stem('uien'), 'ui');
  assert.equal(stem('aardappelen'), stem('aardappels'));
  assert.equal(stem('bosuitjes'), 'bosui');
});

import { packsForListItem } from '../js/core/ah.js';
test('aantal AH-verpakkingen voor een lijstregel', () => {
  assert.equal(packsForListItem({ qty: 1, note: '350 gr' }, { amount: 150, unit: 'g' }), 3);
  assert.equal(packsForListItem({ qty: 1, note: '700 gr + 400 gr' }, { amount: 1000, unit: 'g' }), 2);
  assert.equal(packsForListItem({ qty: 2, note: '' }, { amount: 6, unit: 'st' }), 1);
  assert.equal(packsForListItem({ qty: 8, note: '' }, { amount: 6, unit: 'st' }), 2);
  assert.equal(packsForListItem({ qty: 2, note: '' }, null), 2);
  assert.equal(packsForListItem({ qty: 1, note: 'Lidl: voor 0,99' }, { amount: 500, unit: 'g' }), 1);
  assert.equal(packsForListItem({ qty: 1, note: '2 tenen' }, { amount: 2, unit: 'st' }), 1);
});
