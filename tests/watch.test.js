// Volglijst (Koopjes), leren van oordelen, historie en hardlopers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_WATCHLIST, matchesWatch, offerUnitPrice, watchOffers, learned, watchHistory, dealForListItem, newWatchItem, ownLastPurchase } from '../js/core/watch.js';
import { buyingInterval, dueRepeaters, repeaterCandidates } from '../js/core/repeat.js';

const W = Object.fromEntries(DEFAULT_WATCHLIST.map((w) => [w.id, w]));
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
  const item = W.pindakaas;
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
  const h = watchHistory(W.pindakaas, history, { today: '2026-10-30', exceptWeek: '2026-44' });
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
  const own = ownLastPurchase(W.pindakaas, facts, new Map([['p1', { name: 'Pindakaas' }]]));
  assert.deepEqual([own.date, own.perUnit, own.perPack], ['2026-10-01', 665, 399]);
});

test('nieuw volgproduct', () => {
  assert.deepEqual(newWatchItem('Koffiecups', 'stuk'), { id: 'koffiecups', name: 'Koffiecups', terms: ['koffiecups'], exclude: [], unit: 'stuk' });
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
