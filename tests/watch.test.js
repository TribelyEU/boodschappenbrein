// Volglijst (Koopjes), leren van oordelen, historie en hardlopers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_WATCHLIST, matchesWatch, offerUnitPrice, watchOffers, learned, watchHistory, dealForListItem, newWatchItem, ownLastPurchase } from '../js/core/watch.js';
import { buyingInterval, dueRepeaters, repeaterCandidates } from '../js/core/repeat.js';

const W = Object.fromEntries(DEFAULT_WATCHLIST.map((w) => [w.id, w]));
const PK = { ...W.pindakaas, unit: 'kilo' }; // pindakaas per kilo vergelijken (standaard: per pot)
const m = (id, title, extra = {}) => matchesWatch(W[id], { title, ...extra });

test('volglijst: brede soort, uitzonderingen en woordbegin', () => {
  assert.ok(m('toiletpapier', 'Edet toiletpapier'));
  assert.ok(m('toiletpapier', 'Page Kussenzacht toiletpapier 24 rollen'));
  assert.ok(!m('toiletpapier', 'Edet vochtig toiletpapier maxi pack'));
  assert.ok(m('belegen-kaas', 'Goudse belegen stuk'));
  assert.ok(m('belegen-kaas', 'Beemster belegen plakken'));
  assert.ok(!m('belegen-kaas', 'MILBONA Plakken Goudse jong belegen kaas'));
  assert.ok(m('cola-zero', 'Coca-Cola, Fanta, Sprite of Fuze Tea'));
  assert.ok(m('cola-zero', 'Coca- Cola of Fanta'));
  assert.ok(!m('cola-zero', 'Katja alpaca cola'));
  assert.ok(m('vaatwastabletten', 'Alle Finish vaatwastabletten'));
  assert.ok(m('vaatwastabletten', 'Alle Sun vaatwascapsules en Finish'));
  assert.ok(m('bier', 'Heineken pils of 0.0'));
  assert.ok(!m('bier', 'Alle 0.0 Heineken en Brand'));
  assert.ok(!m('bier', 'Heineken 0.0'));
  assert.ok(m('gehakt', 'De Vleeschmeesters Extra mager rundergehakt'));
  assert.ok(m('gehakt', 'Alle AH Gehakt 300 gram en AH Terra plantaardig rulgehakt 200 gram'));
  assert.ok(!m('gehakt', 'Zigeunergehaktschnitzel'));
  assert.ok(!m('gehakt', 'kip burger, kip donut of kip gehaktbal'));
  assert.ok(m('zalmfilet', 'Verse zalmfilet'));
  assert.ok(!m('zalmfilet', 'OCEAN SEA Gerookte zalm'));
  assert.ok(!m('kipfilet', 'Gerookte kipfilet of kalkoenfilet'));
});

test('prijs per eenheid: per kilo, per liter, multipack, x voor, zonder inhoud', () => {
  const pk = offerUnitPrice({ title: 'Alle Calvé pindakaas 350 gram', mechanism: '2 VOOR 4.99' }, 'kilo');
  assert.deepEqual([pk.packPrice, pk.perUnit, pk.eff.bundle], [250, 714, 2]);
  assert.equal(offerUnitPrice({ title: 'Coca-Cola', size: 'Blik 33 cl', price: 59, mechanism: 'voor 0,59' }, 'liter').perUnit, 179);
  assert.equal(offerUnitPrice({ title: 'Coca-Cola en Fanta 250 ml 4-pack', mechanism: '2 VOOR 4.49' }, 'liter').perUnit, 225);
  assert.equal(offerUnitPrice({ title: 'Hertog Jan pils', size: 'Krat 24 flessen à 30 cl', price: 1496, mechanism: 'voor 14,96' }, 'liter').perUnit, 208);
  const tp = offerUnitPrice({ title: 'Edet toiletpapier', price: 849, was: 1799, mechanism: 'voor 8,49' }, 'rol');
  assert.deepEqual([tp.packPrice, tp.perUnit], [849, null], 'inhoud niet vermeld → geen prijs per rol');
  assert.equal(tp.discount, 0.53);
  const fin = offerUnitPrice({ title: 'Alle Finish vaatwastabletten', mechanism: '2+3 gratis' }, 'tablet');
  assert.deepEqual([fin.packPrice, fin.perUnit, fin.discount], [null, null, 0.6], 'zonder normale prijs: alleen de korting');
  // kilo's worden niet met stuks vergeleken
  assert.equal(offerUnitPrice({ title: 'Kipfilet', size: 'Pak 3 stuks', price: 599 }, 'kilo').perUnit, null);
});

test('leren van oordelen: koopje en duur', () => {
  const item = PK;
  const offers = [
    { store: 'ah', title: 'Calvé pindakaas 350 gram', mechanism: '2 VOOR 4.99', validTo: '2026-10-25' }, // 7,14/kg
    { store: 'lidl', title: 'Pindakaas 600 gram', price: 299, mechanism: 'voor 2,99', validTo: '2026-10-25' }, // 4,98/kg
    { store: 'jumbo', title: 'Pindakaas 350 gram', price: 349, mechanism: 'voor 3,49', validTo: '2026-10-25' }, // 9,97/kg
  ];
  const r0 = watchOffers(item, offers, { today: '2026-10-23' });
  assert.deepEqual(r0.offers.map((x) => x.offer.store), ['lidl', 'ah', 'jumbo'], 'goedkoopste per kilo eerst');
  assert.ok(r0.offers.every((x) => x.label === null), 'zonder oordelen geen label');
  const ratings = [
    { key: 'a', watchId: 'pindakaas', perUnit: 500, interesting: true },
    { key: 'b', watchId: 'pindakaas', perUnit: 900, interesting: false },
  ];
  assert.deepEqual(learned(ratings, 'pindakaas'), { count: 2, maxYes: 500, minNo: 900, minYesDiscount: null, maxNoDiscount: null });
  const r = watchOffers(item, offers, { today: '2026-10-23', ratings });
  const label = Object.fromEntries(r.offers.map((x) => [x.offer.store, x.label]));
  assert.deepEqual(label, { lidl: 'koopje', ah: null, jumbo: 'duur' });
  // korting zonder inhoud: leren op de korting
  const vw = watchOffers(W.vaatwastabletten, [{ store: 'jumbo', title: 'Alle Finish vaatwastabletten', mechanism: '2+3 gratis' }, { store: 'ah', title: 'Alle Sun vaatwascapsules', mechanism: '25% KORTING' }],
    { today: '2026-10-23', ratings: [{ key: 'x', watchId: 'vaatwastabletten', perUnit: null, discount: 0.5, interesting: true }, { key: 'y', watchId: 'vaatwastabletten', perUnit: null, discount: 0.25, interesting: false }] });
  assert.deepEqual(vw.offers.map((x) => x.label), ['koopje', 'duur']);
});

test('verlopen en nog niet begonnen acties tellen niet mee', () => {
  const r = watchOffers(W.pindakaas, [
    { store: 'ah', title: 'Pindakaas 350 g', price: 199, validTo: '2026-10-20' },
    { store: 'lidl', title: 'Pindakaas 350 g', price: 199, validFrom: '2026-10-26', validTo: '2026-11-01' },
    { store: 'dirk', title: 'Pindakaas 350 g', price: 199, validFrom: '2026-10-21', validTo: '2026-10-27' },
  ], { today: '2026-10-23' });
  assert.deepEqual(r.offers.map((x) => x.offer.store), ['dirk']);
});

test('historie: laagste prijs en hoe vaak het per winkel terugkomt', () => {
  const o = (store, price) => ({ store, title: 'Pindakaas 350 gram', price, mechanism: `voor ${(price / 100).toFixed(2).replace('.', ',')}` });
  const history = { weeks: { '2026-35': [o('ah', 199)], '2026-38': [o('ah', 229), o('lidl', 149)], '2026-41': [o('ah', 219)], '2026-44': [o('ah', 199)] } };
  const h = watchHistory(PK, history, { today: '2026-10-30', exceptWeek: '2026-44' });
  assert.equal(h.lowest.perUnit, 426);
  assert.equal(h.lowest.store, 'lidl');
  const ah = h.rhythm.find((r) => r.store === 'ah');
  assert.deepEqual(ah.weeks, ['2026-35', '2026-38', '2026-41', '2026-44']);
  assert.equal(ah.every, 3);
});

test('lijstregel: aanbieding via de volglijst, anders alleen bij duidelijke naam', () => {
  const offers = [
    { store: 'hoogvliet', title: 'Edet toiletpapier', price: 849, was: 1799, mechanism: 'voor 8,49', validTo: '2026-10-27' },
    { store: 'dirk', title: 'Bloemkool', price: 99, mechanism: 'voor 0,99', validTo: '2026-10-27' },
  ];
  const d1 = dealForListItem('WC papier', { offers, watchlist: DEFAULT_WATCHLIST, today: '2026-10-23' });
  assert.equal(d1.offer.store, 'hoogvliet');
  const d2 = dealForListItem('Bloemkool', { offers, watchlist: DEFAULT_WATCHLIST, today: '2026-10-23', matchByName: (o) => /bloemkool/i.test(o.title) });
  assert.equal(d2.offer.store, 'dirk');
  assert.equal(dealForListItem('Brood', { offers, watchlist: DEFAULT_WATCHLIST, today: '2026-10-23', matchByName: () => false }), null);
});

test('eigen aankoop als referentie (per kilo bij bekende inhoud)', () => {
  const facts = [
    { productId: 'p1', name: 'Calvé pindakaas 600g', net: 449, qty: 1, sizeAmount: 600, sizeUnit: 'g', date: '2026-09-01', store: 'ah' },
    { productId: 'p1', name: 'Calvé pindakaas 600g', net: 399, qty: 1, sizeAmount: 600, sizeUnit: 'g', date: '2026-10-01', store: 'ah', promo: true },
  ];
  const own = ownLastPurchase(PK, facts, new Map([['p1', { name: 'Pindakaas' }]]));
  assert.deepEqual([own.date, own.perUnit, own.perPack], ['2026-10-01', 665, 399]);
});

test('nieuw volgproduct', () => {
  assert.deepEqual(newWatchItem('Koffiecups', 'stuk'), { id: 'koffiecups', name: 'Koffiecups', terms: ['koffiecups'], exclude: [], unit: 'stuk', refs: [], equiv: [], onlyEquiv: false });
});

test('hardlopers: gebruikelijke tussentijd en herinnering', () => {
  const buys = (dates) => dates.map((date) => ({ date }));
  const p = new Map([
    ['cups', buys(['2026-08-01', '2026-08-29', '2026-09-26'])], // elke 28 dagen
    ['melk', buys(['2026-10-01', '2026-10-04', '2026-10-08', '2026-10-11'])],
    ['eenmalig', buys(['2026-09-01'])],
  ]);
  assert.deepEqual(buyingInterval(p.get('cups')), { every: 28, last: '2026-09-26', times: 3 });
  assert.equal(buyingInterval(p.get('eenmalig')), null);
  assert.deepEqual(dueRepeaters({ repeaters: ['cups'], purchasesByProduct: p, today: '2026-10-10' }), [], 'na 14 dagen nog niet');
  assert.equal(dueRepeaters({ repeaters: ['cups'], purchasesByProduct: p, today: '2026-10-22' }).length, 1, 'na 26 dagen wel');
  assert.equal(dueRepeaters({ repeaters: ['cups'], purchasesByProduct: p, today: '2026-10-22', snoozed: { cups: '2026-10-29' } }).length, 0, 'nu niet = een week stil');
  assert.equal(dueRepeaters({ repeaters: ['cups'], purchasesByProduct: p, today: '2026-10-22', onList: new Set(['cups']) }).length, 0);
  assert.deepEqual(repeaterCandidates(p, new Map([['cups', { name: 'Koffiecups' }], ['melk', { name: 'Melk' }]])).map((c) => c.productId), ['cups'], 'melk (elke 3-4 dagen) is geen hardloper');
});

test('vergelijkingseenheid per stuk (pot) en per stuk (tablet)', () => {
  const pot = offerUnitPrice({ title: 'Alle Calvé pindakaas 350 gram', mechanism: '2 VOOR 4.99' }, 'verpakking');
  assert.deepEqual([pot.perUnit, pot.packPrice], [250, 250], 'per pot');
  const tab = offerUnitPrice({ title: 'Finish Quantum vaatwastabletten 40 stuks', price: 999, mechanism: 'voor 9,99' }, 'stuk');
  assert.equal(tab.perUnit, 25, 'per tablet');
  assert.equal(offerUnitPrice({ title: 'Finish', price: 999 }, 'tablet').perUnit, null, 'oude naam "tablet" werkt nog; zonder aantal geen prijs per stuk');
});

test('equivalenten: wat jullie nu kopen en gelijkwaardige huismerken', async () => {
  const { equivalentOf, normalPriceIn, ownCandidates } = await import('../js/core/watch.js');
  const item = { ...W['cola-zero'], ref: { name: 'AH Cola zero', store: 'ah' }, equiv: [{ name: 'Freeway cola zero', store: 'lidl' }, { name: 'Jumbo cola zero', store: 'jumbo' }] };
  assert.equal(equivalentOf(item, { store: 'ah', title: 'AH Cola zero sugar 1,5 liter' }), 'ref');
  assert.equal(equivalentOf(item, { store: 'lidl', title: 'Freeway Cola Zero 1,5L' }), 'equiv');
  assert.equal(equivalentOf(item, { store: 'ah', title: 'Freeway Cola Zero' }), null, 'winkel moet kloppen');
  assert.equal(equivalentOf(item, { store: 'jumbo', title: 'Coca-Cola zero 1,5 liter' }), null);
  const only = watchOffers({ ...item, onlyEquiv: true }, [
    { store: 'lidl', title: 'Freeway Cola Zero', size: '1,5 l', price: 79, validTo: '2026-10-27' },
    { store: 'jumbo', title: 'Coca-Cola', size: '1,5 l', price: 199, validTo: '2026-10-27' },
  ], { today: '2026-10-23' });
  assert.deepEqual(only.offers.map((x) => x.offer.store), ['lidl'], 'alleen gelijkwaardige tonen');
  assert.equal(only.offers[0].perUnit, 53);
  // normale prijs uit de bonnen omrekenen naar de eenheid
  assert.deepEqual(normalPriceIn(item, { observations: 3, perBase: true, unitLabel: 'liter', typical: 100, packPrice: 150, packSize: { amount: 1500, unit: 'ml' } }), { perUnit: 100, per: 'liter' });
  assert.deepEqual(normalPriceIn(item, { observations: 3, perBase: false, unitLabel: 'verpakking', typical: 150, packPrice: 150, packSize: { amount: 1500, unit: 'ml' } }), { perUnit: 100, per: 'liter' });
  assert.deepEqual(normalPriceIn(item, { observations: 2, perBase: false, typical: 150, packPrice: 150, packSize: null }), { perPack: 150, per: 'verpakking' });
  const facts = [
    { productId: 'a', name: 'AH COLA ZERO', gross: 150, store: 'ah', date: '2026-10-01' },
    { productId: 'a', name: 'AH COLA ZERO', gross: 150, store: 'ah', date: '2026-10-08' },
    { productId: 'b', name: 'Coca-Cola zero 1.5l', gross: 245, store: 'lidl', date: '2026-08-23' },
    { productId: 'c', name: 'Halfvolle melk', gross: 109, store: 'ah', date: '2026-10-08' },
  ];
  const cands = ownCandidates(item, facts, new Map([['a', { name: 'Cola zero' }], ['b', { name: 'Coca-Cola zero' }], ['c', { name: 'Halfvolle melk' }]]));
  assert.deepEqual(cands.map((c) => [c.productId, c.store, c.count]), [['a', 'ah', 2], ['b', 'lidl', 1]]);
});

test('wat jullie nu kopen: meerdere producten (max 3), oude enkele keuze blijft werken', async () => {
  const { refsOf, equivalentOf } = await import('../js/core/watch.js');
  const bier = { ...W.bier, refs: [{ name: 'Leffe blond', store: 'ah' }, { name: 'Hertog Jan pils', store: 'ah' }, { name: 'Heineken pils', store: 'ah' }, { name: 'te veel', store: 'ah' }] };
  assert.equal(refsOf(bier).length, 3);
  assert.equal(equivalentOf(bier, { store: 'dirk', title: 'Hertog Jan pils' }), 'ref', 'A-merk: in elke winkel');
  assert.equal(equivalentOf(bier, { store: 'lidl', title: 'Leffe Blond' }), 'ref');
  assert.deepEqual(refsOf({ ref: { name: 'AH Cola zero', store: 'ah' } }), [{ name: 'AH Cola zero', store: 'ah' }]);
});

test('assortiment: voorstellen voor gelijkwaardige producten (zelfde inhoud, huismerk)', async () => {
  const { indexAssortment, suggestEquivalents, searchAssortment } = await import('../js/core/assortment.js');
  const { entryPriceIn, equivalentOf } = await import('../js/core/watch.js');
  const idx = indexAssortment({
    ah: [['AH Cola zero sugar', 39, '330 ml'], ['Coca-Cola Zero sugar', 279, '1,5 l'], ['AH Cola zero sugar cherry 6-pack', 329, '6 x 0,33 l']],
    jumbo: [['Jumbo Cola Zero Sugar 1,5 L', 89, '1.5 L'], ['Jumbo Cola Zero Sugar 6 x 1,5 L', 534, '6 x 1.5 L'], ['Jumbo Cola Light 1,5 L', 95, '1.5 L']],
    dirk: [['1 de Beste Cola zero', 95, '1,5 liter'], ['1 de Beste Cola zero', 209, '6 x 500 ml']],
  });
  const res = suggestEquivalents(idx, 'Cola zero', { size: { amount: 1500, unit: 'ml' }, preferHouse: true, stores: ['ah', 'jumbo', 'dirk'] });
  const by = Object.fromEntries(res.map((g) => [g.store, g.results.map((r) => r.name)]));
  assert.equal(by.jumbo[0], 'Jumbo Cola Zero Sugar 1,5 L', 'zelfde inhoud eerst');
  assert.ok(!by.jumbo.includes('Jumbo Cola Light 1,5 L'), 'light is geen zero');
  assert.ok(!by.ah.some((n) => /cherry/i.test(n)), 'smaakvariant valt af');
  assert.equal(by.dirk[0], '1 de Beste Cola zero');
  assert.equal(searchAssortment(idx, 'cola zero 1,5 liter', { stores: ['jumbo'] })[0].results[0].name, 'Jumbo Cola Zero Sugar 1,5 L');
  // prijs van zo'n equivalent per liter, en herkennen in een aanbieding
  const item = { ...W['cola-zero'], equiv: [{ name: 'Jumbo Cola Zero Sugar 1,5 L', store: 'jumbo', price: 89, size: { amount: 1500, unit: 'ml', count: 1 } }] };
  assert.deepEqual(entryPriceIn(item, item.equiv[0]), { perUnit: 59, per: 'liter' });
  assert.equal(equivalentOf(item, { store: 'jumbo', title: 'Jumbo Cola Zero 1,5 liter' }), 'equiv', '"sugar" en inhoud hoeven niet in de titel');
  assert.deepEqual(entryPriceIn({ unit: 'stuk' }, { price: 349, size: { amount: 600, unit: 'g', count: 60 } }), { perUnit: 6, per: 'stuk' }, '60 x 10 g = 60 tabletten');
});

test('zelf gekozen variant: inhoud en normale prijs bij "A of B" en "2e gratis"', async () => {
  const { applyChoice, sizeOptionsOf } = await import('../js/core/watch.js');
  const o = { store: 'ah', title: 'Alle AH Gehakt 300 gram en AH Terra plantaardig rulgehakt 200 gram', mechanism: '2e GRATIS', validTo: '2026-10-25' };
  assert.deepEqual(sizeOptionsOf(o).map((s) => s.amount), [300, 200]);
  const r0 = watchOffers(W.gehakt, [o], { today: '2026-10-23' });
  assert.equal(r0.offers[0].perUnit, null, 'zonder keuze geen kiloprijs');
  const key = r0.offers[0].key;
  const r = watchOffers(W.gehakt, [o], { today: '2026-10-23', choices: { [key]: { name: 'AH Rundergehakt', sizeText: '300 g', normal: 419 } } });
  assert.equal(r.offers[0].packPrice, 210, '2e gratis van 4,19 = 2,10 per pak');
  assert.equal(r.offers[0].perUnit, 700, '€ 2,10 voor 300 g = € 7,00 per kilo');
  assert.equal(applyChoice(o, null), o);
});

test('producten bij een actie: merk en hoofdwoord uit de actietitel (Perla, niet Starbucks)', async () => {
  const { indexAssortment, productsForOffer } = await import('../js/core/assortment.js');
  const idx = indexAssortment({ ah: [
    ['Perla Huisblends Aroma snelfiltermaling', 799, '500 g'], ['Perla Huisblends Lungo classic capsules', 499, '20 stuks'],
    ['Perla Biologisch Espresso dark capsules', 349, '10 stuks'], ['Perla Superiore Origins Colombia capsules', 399, '10 stuks'],
    ['Starbucks Nespresso Colombia capsules', 469, '10 stuks'], ['AH Paracetamol 500mg zachte capsules', 229, '20 stuks'],
    ['AH Gemengd gehakt', 359, '300 g'], ['AH Rundergehakt', 499, '300 g'], ['AH Gehaktbal naturel', 269, '105 g'], ['AH Terra Plantaardig rulgehakt', 159, '200 g'], ['AH Terra Plantaardige sojadrink', 69, '1 l'],
  ] });
  const names = (title) => productsForOffer(idx, { store: 'ah', title }).map((r) => r.name);
  const perla = names('Alle Perla Huisblends snelfiltermaling 500 gram en capsules voor Nespresso 10 stuks');
  assert.ok(perla.includes('Perla Huisblends Lungo classic capsules'));
  assert.ok(perla.includes('Perla Huisblends Aroma snelfiltermaling'));
  assert.ok(!perla.some((n) => /Starbucks|Paracetamol/.test(n)), perla.join(', '));
  const gehakt = names('Alle AH Gehakt 300 gram en AH Terra plantaardig rulgehakt 200 gram*');
  assert.ok(gehakt.includes('AH Rundergehakt') && gehakt.includes('AH Gemengd gehakt') && gehakt.includes('AH Terra Plantaardig rulgehakt'));
  assert.ok(!gehakt.includes('AH Gehaktbal naturel') && !gehakt.includes('AH Terra Plantaardige sojadrink'), gehakt.join(', '));
});

test('zelf ingevulde inhoud bij een product: per liter vergelijken ook als de bon het niet noemt', async () => {
  const { buildFacts } = await import('../js/core/analytics.js');
  const { priceStats } = await import('../js/core/stockpile.js');
  const { normalPriceIn } = await import('../js/core/watch.js');
  const { parseOwnSize, sizeText } = await import('../js/core/products.js');
  const size = parseOwnSize('6 x 1,5 l');
  assert.deepEqual([size.amount, size.unit, size.count], [9000, 'ml', 6]);
  assert.equal(sizeText({ amount: 9000, unit: 'ml', count: 6 }), '6 x 1,5 liter');
  const products = new Map([['p', { id: 'p', name: 'Cola zero sugar 6 pack', category: 'dranken', size }]]);
  const lines = [1, 2, 3].map((i) => ({ id: `l${i}`, receiptId: `r${i}`, productId: 'p', date: `2026-09-0${i}`, store: 'ah', rawName: 'AH COLA ZERO 6PACK', qty: 1, unitPrice: 449, amount: 449, kind: 'product' }));
  const facts = buildFacts(lines, products);
  assert.equal(facts[0].sizeAmount, 9000);
  const st = priceStats(facts, 'p');
  assert.deepEqual(normalPriceIn({ unit: 'liter' }, st), { perUnit: 50, per: 'liter' }, '€ 4,49 voor 9 liter = € 0,50 per liter');
});
