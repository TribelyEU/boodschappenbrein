// Tests voor berekeningen en importlogica. Draaien met:  node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import { parseAmount, parseNumber, euro } from '../js/core/money.js';
import { findDate, effectiveDays, addMonths, startOfWeek, parseDateValue } from '../js/core/dates.js';
import { parseReceiptText } from '../js/core/receipt-parser.js';
import { parseCSV, detectMapping, rowsToReceipts } from '../js/core/table-import.js';
import { baseKey, parseSize, detectBrand, matchProduct, unitPrice } from '../js/core/products.js';
import { guessCategory } from '../js/core/categories.js';
import { receiptFingerprint, classifyDuplicates } from '../js/core/dedupe.js';
import { proposalToRecords } from '../js/core/commit.js';
import { buildFacts, total, dashboardStats, priceIncreases, inRange } from '../js/core/analytics.js';
import { predictStock, neededWithin } from '../js/core/stock-model.js';
import { savingsAdvice } from '../js/core/savings.js';
import { parseQuery, parsePeriod, runQuery } from '../js/core/query.js';
import { parseCheckjebon, buildIndex, findCandidates, compareBasket } from '../js/core/prices.js';
import { buildBackup, validateBackup } from '../js/core/backup.js';
import { generateDemoReceipts } from '../js/core/demo.js';
import { addDays } from '../js/core/dates.js';

// ---------- geld en datums ----------
test('bedragen lezen', () => {
  assert.equal(parseAmount('1,09'), 109);
  assert.equal(parseAmount('-0,50'), -50);
  assert.equal(parseAmount('0,50-'), -50);
  assert.equal(parseAmount('€ 12,34'), 1234);
  assert.equal(parseAmount('1.234,56'), 123456);
  assert.equal(parseAmount('12'), null);
  assert.equal(parseNumber('1,5'), 1.5);
  assert.equal(parseNumber('1.234,56'), 1234.56);
  assert.equal(parseNumber('1,234.56'), 1234.56);
  assert.equal(parseNumber(3), 3);
  assert.equal(euro(1234).replace(/\s/g, ' '), '€ 12,34');
});

test('datums herkennen', () => {
  assert.equal(findDate('Datum: 21-10-2026 14:32'), '2026-10-21');
  assert.equal(findDate('21/10/26'), '2026-10-21');
  assert.equal(findDate('2026-10-21'), '2026-10-21');
  assert.equal(findDate('21 okt 2026'), '2026-10-21');
  assert.equal(findDate('31-02-2026 en 01-03-2026'), '2026-03-01'); // ongeldige datum overgeslagen
  assert.equal(findDate('01-12-2030 05-10-2026', '2026-10-22'), '2026-10-05'); // toekomst overgeslagen
  assert.equal(parseDateValue(46316), '2026-10-21'); // Excel-serienummer
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(startOfWeek('2026-10-22'), '2026-10-19');
  assert.equal(effectiveDays('2026-07-01', '2026-07-31', [{ from: '2026-07-10', to: '2026-07-19' }]), 20);
});

// ---------- bonparser ----------
const AH_BON = `
Albert Heijn 1234
Dorpsstraat 1, Ergens
AANTAL OMSCHRIJVING        PRIJS  BEDRAG
       BONUSKAART            xx1234
1      HALFV MELK                  1,09
2      AH BANANEN        0,35      0,70
1      AH VOLKOREN BROOD           2,19
3      CHOCOMEL 1L       1,99      5,97
1      STATIEGELD                  0,15
SUBTOTAAL                         10,10
BONUS CHOCOMEL                    -1,00
TOTAAL                             9,10
UW VOORDEEL                        1,00
BETAALD MET:
PINNEN                             9,10
21-10-2026 18:02
`;

test('AH-bon: regels, korting, statiegeld en totaalcontrole', () => {
  const r = parseReceiptText(AH_BON, { today: '2026-10-22' });
  assert.equal(r.store, 'ah');
  assert.equal(r.date, '2026-10-21');
  assert.equal(r.total, 910);
  assert.equal(r.subtotal, 1010);
  const products = r.lines.filter((l) => l.kind === 'product');
  assert.deepEqual(products.map((l) => [l.rawName, l.qty, l.amount]), [
    ['HALFV MELK', 1, 109], ['AH BANANEN', 2, 70], ['AH VOLKOREN BROOD', 1, 219], ['CHOCOMEL 1L', 3, 597],
  ]);
  const deposit = r.lines.find((l) => l.kind === 'deposit');
  assert.equal(deposit.amount, 15);
  const disc = r.lines.find((l) => l.kind === 'discount');
  assert.equal(disc.amount, -100);
  assert.equal(r.lines[disc.linkedTo].rawName, 'CHOCOMEL 1L');
  assert.equal(r.check, 'ok', r.warnings.join(' | '));
  // "UW VOORDEEL" en betaalregels mogen niet meetellen
  assert.equal(r.lines.length, 6);
});

const LIDL_BON = `
LIDL
Halfvolle melk              1,98 B
  2 X 0,99
Bananen                     0,43 B
0,856 kg x 1,99 EUR/kg
Kipfilet                    5,49 B
Korting                    -1,10
Pindakaas                   2,29 B
te betalen                  9,09
22.10.2026
`;

test('Lidl-bon: aantallenregel, gewichtsregel en korting onder artikel', () => {
  const r = parseReceiptText(LIDL_BON, { today: '2026-10-22' });
  assert.equal(r.store, 'lidl');
  assert.equal(r.date, '2026-10-22');
  const melk = r.lines.find((l) => l.rawName === 'Halfvolle melk');
  assert.equal(melk.qty, 2);
  assert.equal(melk.unitPrice, 99);
  const disc = r.lines.find((l) => l.kind === 'discount');
  assert.equal(r.lines[disc.linkedTo].rawName, 'Kipfilet');
  assert.equal(r.total, 909);
  assert.equal(r.check, 'ok', r.warnings.join(' | '));
});

test('afwijkend totaal wordt gemeld, niet verzwegen', () => {
  const r = parseReceiptText('JUMBO\nMelk 1,09\nBrood 2,00\nTOTAAL 5,00\n01-10-2026');
  assert.equal(r.check, 'afwijking');
  assert.ok(r.warnings.some((w) => w.includes('wijkt af')));
});

test('retour (negatief bedrag) en koopzegels', () => {
  const r = parseReceiptText('ALBERT HEIJN\nMELK 1,09\nRETOUR KAAS -4,99\nKOOPZEGELS 2,00\nTOTAAL -1,90\n01-10-2026');
  assert.equal(r.lines.find((l) => l.rawName.includes('KAAS')).kind, 'return');
  assert.equal(r.lines.find((l) => l.rawName.includes('KOOPZEGELS')).kind, 'nongrocery');
  assert.equal(r.check, 'ok');
});

// ---------- tabelimport ----------
test('CSV met puntkomma, kolomherkenning en groeperen per bon', () => {
  const csv = 'Datum;Winkel;Omschrijving;Aantal;Bedrag;Korting\n21-10-2026;Albert Heijn;Halfvolle melk 1L;2;2,18;\n21-10-2026;Albert Heijn;"Kaas, jong belegen";1;5,89;1,00\n22-10-2026;Lidl;Bananen;1;0,43;\n';
  const { rows } = parseCSV(csv);
  assert.equal(rows[2][2], 'Kaas, jong belegen');
  const det = detectMapping(rows);
  assert.ok(det.confident);
  const { receipts, skipped } = rowsToReceipts(rows, det);
  assert.equal(skipped.length, 0);
  assert.equal(receipts.length, 2);
  const ah = receipts.find((r) => r.store === 'ah');
  assert.equal(ah.lines.length, 3); // 2 producten + 1 korting
  assert.equal(ah.total, 218 + 589 - 100);
});

// ---------- productgeheugen ----------
test('zelfde basisproduct uit verschillende omschrijvingen', () => {
  const k = baseKey('AH Halfvolle melk 1L');
  assert.equal(k, 'halfvol melk');
  assert.equal(baseKey('Melk halfvol 1000ML'), k);
  assert.equal(baseKey('AH melk halfvol'), k);
  assert.equal(baseKey('HALFV MELK'), k);
  assert.equal(baseKey('Campina Halfvolle melk 1 liter'), k);
  assert.equal(detectBrand('Campina Halfvolle melk').brand, 'Campina');
  assert.equal(detectBrand('AH Halfvolle melk').house, true);
  assert.notEqual(baseKey('AH Volle melk'), k);
});

test('inhoud en prijs per eenheid', () => {
  assert.deepEqual(parseSize('AH Halfvolle melk 1L').amount, 1000);
  assert.equal(parseSize('6 x 1 L').amount, 6000);
  assert.equal(parseSize('Per 1000 ml').unit, 'ml');
  assert.equal(parseSize('500 gram').amount, 500);
  assert.equal(parseSize('Page 12 rollen').unit, 'st');
  assert.equal(unitPrice(109, { amount: 1000, unit: 'ml' }), 109);
  assert.equal(unitPrice(289, { amount: 500, unit: 'g' }), 578);
});

test('categorieën', () => {
  assert.equal(guessCategory('AH Halfvolle melk').id, 'zuivel');
  assert.equal(guessCategory('Chocomel').id, 'dranken');
  assert.equal(guessCategory('Pindakaas').id, 'brood-ontbijt');
  assert.equal(guessCategory('Kipfilet').id, 'vlees-vis-vega');
  assert.equal(guessCategory('Page toiletpapier').id, 'huishouden');
  assert.equal(guessCategory('Bananen').id, 'groente-fruit');
  assert.equal(guessCategory('xyz').id, 'overig');
});

test('leren van handmatige koppeling', () => {
  const memory = { products: new Map(), aliases: new Map() };
  const prop = parseReceiptText('ALBERT HEIJN\nHALFV MELK 1,09\nTOTAAL 1,09\n01-10-2026');
  const first = proposalToRecords(prop, memory, { importId: 'i1', source: {} });
  const melkId = first.lines[0].productId;
  // Een rare OCR-variant wordt handmatig aan hetzelfde product gekoppeld …
  const p2 = parseReceiptText('ALBERT HEIJN\nH4LFV MLK 1,09\nTOTAAL 1,09\n02-10-2026');
  p2.lines[0].productId = melkId;
  const second = proposalToRecords(p2, memory, { importId: 'i2', source: {} });
  assert.equal(second.newAliases.length, 1);
  // … en wordt de volgende keer automatisch herkend.
  assert.equal(matchProduct('H4LFV MLK', memory).method, 'geleerd');
});

// ---------- dubbele imports ----------
test('dubbele bonnen herkennen', () => {
  const a = parseReceiptText(AH_BON, { today: '2026-10-22' });
  const b = parseReceiptText(AH_BON, { today: '2026-10-22' });
  assert.equal(receiptFingerprint(a), receiptFingerprint(b));
  const existing = { fingerprints: new Set([receiptFingerprint(a)]), loose: new Set() };
  assert.deepEqual(classifyDuplicates([b], existing), ['dubbel']);
  assert.deepEqual(classifyDuplicates([b, b], { fingerprints: new Set(), loose: new Set() }), ['nieuw', 'dubbel']);
});

// ---------- analyse ----------
function storeAll(proposals) {
  const memory = { products: new Map(), aliases: new Map() };
  const lines = [];
  for (const p of proposals) lines.push(...proposalToRecords(p, memory, { importId: 'x', source: {} }).lines);
  return { memory, lines };
}

test('geen dubbeltellingen: kortingen en statiegeld', () => {
  const r = parseReceiptText(AH_BON, { today: '2026-10-22' });
  const { memory, lines } = storeAll([r]);
  const facts = buildFacts(lines, memory.products);
  // boodschappen = bon (910) − statiegeld (15)
  assert.equal(total(facts), 895);
  const choc = facts.find((f) => f.name === 'CHOCOMEL 1L');
  assert.equal(choc.net, 497);
  assert.equal(choc.gross, 597);
});

test('ongekoppelde korting telt als aparte post', () => {
  const r = parseReceiptText('ALBERT HEIJN\nMELK 1,09\nKASSAKORTING -0,50\nTOTAAL 0,59\n01-10-2026');
  // kassakorting zonder productnaam en vorige regel is product -> koppelt aan melk; maak hem los:
  r.lines[1].linkedTo = null;
  const { memory, lines } = storeAll([r]);
  const facts = buildFacts(lines, memory.products);
  assert.equal(total(facts), 59);
  assert.ok(facts.some((f) => f.category === 'korting' && f.net === -50));
});

test('dashboard: maand, vorige maand, voorspelling alleen met genoeg historie', () => {
  const today = '2026-10-22';
  const receipts = generateDemoReceipts(today);
  const { memory, lines } = storeAll(receipts);
  const facts = buildFacts(lines, memory.products);
  const s = dashboardStats(facts, today);
  const manual = facts.filter((f) => f.date >= '2026-10-01' && f.date <= today).reduce((t, f) => t + f.net, 0);
  assert.equal(s.thisMonth, manual);
  assert.ok(s.avgWeek > 0);
  assert.ok(s.forecast && s.forecast.restOfMonth > 0);
  const few = dashboardStats(inRange(facts, '2026-10-15', today), today);
  assert.equal(few.forecast, null);
});

test('prijsstijging wordt gevonden (demo: koffie +20%)', () => {
  const today = '2026-10-22';
  const { memory, lines } = storeAll(generateDemoReceipts(today));
  const facts = buildFacts(lines, memory.products);
  const inc = priceIncreases(facts, memory.products, today);
  assert.ok(inc.some((x) => /aroma/i.test(x.name)), JSON.stringify(inc.map((x) => x.name)));
});

// ---------- voorraadmodel ----------
const weekly = (start, n, qty, step = 7) => Array.from({ length: n }, (_, i) => ({ date: addDays(start, i * step), qty }));

test('voorraad: voorbeeld melk (8 pakken, ±6 per week)', () => {
  const purchases = [...weekly('2026-08-01', 10, 6), { date: '2026-10-10', qty: 8 }];
  const p3 = predictStock(purchases, [], { today: '2026-10-13', model: 'snel' });
  assert.equal(p3.status.id, 'voldoende');
  assert.ok(Math.abs(p3.perWeek - 6) < 0.6, `perWeek ${p3.perWeek}`);
  const p8 = predictStock(purchases, [], { today: '2026-10-18', model: 'snel' });
  assert.equal(p8.status.id, 'bijna');
  const p14 = predictStock(purchases, [], { today: '2026-10-24', model: 'snel' });
  assert.equal(p14.status.id, 'op');
});

test('voorraad: onvoldoende gegevens en onregelmatig', () => {
  assert.equal(predictStock([{ date: '2026-10-01', qty: 1 }, { date: '2026-10-08', qty: 1 }], [], { today: '2026-10-10' }).status.id, 'onvoldoende');
  const irregular = [{ date: '2026-01-01', qty: 1 }, { date: '2026-01-03', qty: 1 }, { date: '2026-04-20', qty: 1 }, { date: '2026-04-22', qty: 1 }, { date: '2026-09-30', qty: 1 }];
  const r = predictStock(irregular, [], { today: '2026-10-05', model: 'onregelmatig' });
  assert.equal(r.status.id, 'onvoldoende');
});

test('voorraad: correctie "op" zet voorraad op nul en versnelt het tempo', () => {
  const purchases = weekly('2026-08-01', 10, 6);
  const last = purchases.at(-1).date; // 2026-10-03
  const before = predictStock(purchases, [], { today: addDays(last, 3), model: 'snel' });
  assert.equal(before.status.id, 'voldoende');
  const after = predictStock(purchases, [{ date: addDays(last, 3), level: 'op' }], { today: addDays(last, 3), model: 'snel' });
  assert.equal(after.status.id, 'op');
  assert.ok(after.ratePerDay > before.ratePerDay);
});

test('voorraad: vakantie telt niet als verbruik', () => {
  const purchases = weekly('2026-06-01', 8, 6);
  const last = purchases.at(-1).date;
  const today = addDays(last, 14);
  const noVac = predictStock(purchases, [], { today, model: 'snel' });
  const vac = predictStock(purchases, [], { today, model: 'snel', vacations: [{ from: addDays(last, 1), to: addDays(last, 12) }] });
  assert.equal(noVac.status.id, 'op');
  assert.equal(vac.status.id, 'voldoende');
  assert.ok(neededWithin(noVac, 7));
});

// ---------- besparingen ----------
test('besparingen alleen met genoeg gegevens', () => {
  const r = savingsAdvice([], new Map(), '2026-10-22');
  assert.equal(r.enoughData, false);
});

test('besparing: goedkoper merk uit eigen aankopen', () => {
  const today = '2026-10-22';
  const proposals = [];
  for (let i = 0; i < 12; i++) {
    const date = addDays('2026-05-01', i * 14);
    proposals.push({ store: 'ah', date, total: null, lines: [
      { rawName: 'Campina Halfvolle melk 1L', qty: 4, unitPrice: 159, amount: 636, kind: 'product' },
      ...(i % 3 === 0 ? [{ rawName: 'AH Halfvolle melk 1L', qty: 4, unitPrice: 109, amount: 436, kind: 'product' }] : []),
    ] });
  }
  const { memory, lines } = storeAll(proposals);
  const facts = buildFacts(lines, memory.products);
  const res = savingsAdvice(facts, memory.products, today);
  const alt = res.advice.find((a) => a.type === 'alternatief');
  assert.ok(alt, JSON.stringify(res.advice.map((a) => a.title)));
  assert.equal(alt.kind, 'theoretisch');
  // ≈ 0,50 per liter × 4 liter per 2 weken ≈ €4,30 per maand
  assert.ok(alt.monthly > 350 && alt.monthly < 500, String(alt.monthly));
});

// ---------- zoeken ----------
test('vragen ontleden', () => {
  const today = '2026-10-22';
  const q1 = parseQuery('Hoeveel hebben we dit jaar aan melk uitgegeven?', today);
  assert.equal(q1.intent, 'uitgaven');
  assert.equal(q1.period.from, '2026-01-01');
  assert.deepEqual(q1.terms, ['melk']);
  const q2 = parseQuery('Wat hebben we afgelopen maand bij Albert Heijn uitgegeven?', today);
  assert.equal(q2.store, 'ah');
  assert.equal(q2.period.from, '2026-09-01');
  assert.equal(q2.period.to, '2026-09-30');
  assert.deepEqual(q2.terms, []);
  assert.equal(parseQuery('Wat zijn onze tien duurste producten?', today).topN, 10);
  assert.equal(parseQuery('Welke boodschappen zijn het sterkst in prijs gestegen?', today).intent, 'stijging');
  assert.equal(parseQuery('Hoeveel kunnen we besparen op huismerken?', today).intent, 'besparen');
  assert.equal(parseQuery('Welke producten moeten we volgende week waarschijnlijk kopen?', today).intent, 'nodig');
  assert.equal(parseQuery('Hoeveel betalen we gemiddeld voor koffie?', today).intent, 'gemiddelde');
  assert.equal(parsePeriod('laatste 3 maanden', today).from, '2026-07-23');
});

test('zoekvraag rekent echt uit', () => {
  const today = '2026-10-22';
  const { memory, lines } = storeAll(generateDemoReceipts(today));
  const facts = buildFacts(lines, memory.products);
  const res = runQuery('Hoeveel hebben we dit jaar aan melk uitgegeven?', { facts, products: memory.products, predictions: new Map(), today });
  const expected = facts.filter((f) => f.date >= '2026-01-01' && f.productId && /melk/i.test(memory.products.get(f.productId).key)).reduce((t, f) => t + f.net, 0);
  assert.equal(res.answer, euro(expected));
  assert.equal(res.kind, 'feit');
});

// ---------- prijsvergelijking ----------
test('Checkjebon-data: matching en mandvergelijking (echte data-uittreksel)', () => {
  const json = JSON.parse(readFileSync(new URL('./fixtures/checkjebon-sample.json', import.meta.url)));
  const { items, stores } = parseCheckjebon(json);
  assert.ok(items.length > 100);
  assert.equal(stores.find((s) => s.id === 'aldi').count, 0);
  const idx = buildIndex(items);
  const ahMelk = findCandidates(idx, 'halfvolle melk', { store: 'ah' });
  assert.ok(ahMelk.length);
  assert.ok(ahMelk.every((c) => /halfvol/i.test(c.item.name)));
  assert.ok(!/biologisch/i.test(ahMelk[0].item.name), 'zonder "biologisch" in de vraag geen bio als eerste keus');
  const list = [{ key: 'm', name: 'halfvolle melk', qty: 6, amount: 1000, unit: 'ml' }, { key: 'p', name: 'pindakaas', qty: 1 }];
  const cmp = compareBasket(list, idx, { stores: ['ah', 'jumbo', 'dirk', 'aldi'], extraStoreCost: 200 });
  assert.equal(cmp.single.find((s) => s.stores[0] === 'aldi').found, 0);
  const best = cmp.single[0];
  assert.ok(best.complete);
  for (const p of cmp.pairs) assert.ok(p.total >= p.productsTotal);
});

// ---------- back-up ----------
test('back-up valideren', () => {
  const ok = buildBackup({ receipts: [{ id: 'r1' }], lines: [{ id: 'l1', receiptId: 'r1' }], products: [{ id: 'p1' }] });
  assert.deepEqual(validateBackup(ok), []);
  assert.ok(validateBackup({ app: 'x' }).length);
  const broken = buildBackup({ receipts: [], lines: [{ id: 'l1', receiptId: 'weg' }] });
  assert.ok(validateBackup(broken).some((e) => e.includes('onbekende bon')));
  assert.deepEqual(JSON.parse(JSON.stringify(ok)), ok);
});

test('prijzen: onzekere match telt niet mee, eerlijk vergelijkingstotaal', () => {
  const json = [
    { n: 'ah', c: 'AH', u: 'x/', d: [{ n: 'AH Bananen tros', l: 'b', p: 1.35, s: 'Tros' }, { n: 'AH Pindakaas', l: 'p', p: 2.0, s: '600 g' }] },
    { n: 'dirk', c: 'Dirk', u: 'y/', d: [{ n: 'Dr. Oetker Kloppudding banaan', l: 'k', p: 0.95, s: '74 g' }, { n: '1 de Beste Pindakaas', l: 'q', p: 1.48, s: '600 g' }] },
  ];
  const idx = buildIndex(parseCheckjebon(json).items);
  const cmp = compareBasket([{ key: 'b', name: 'Bananen', qty: 1 }, { key: 'p', name: 'Pindakaas', qty: 1 }], idx, { stores: ['ah', 'dirk'] });
  assert.equal(cmp.perItem[0].byStore.dirk, undefined, 'pudding is geen banaan');
  assert.ok(cmp.perItem[0].unsureByStore.dirk.length);
  assert.equal(cmp.commonCount, 1);
  assert.equal(cmp.single.find((s) => s.stores[0] === 'dirk').commonTotal, 148);
  assert.equal(cmp.single.find((s) => s.stores[0] === 'ah').commonTotal, 200);
});

// ---------- echte AH-documenten (geanonimiseerd), oktober 2026 ----------
const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
// Echte bonnen staan alleen lokaal (niet in de openbare repository); ontbreken ze, dan worden deze tests overgeslagen.
const HAS_REAL = existsSync(new URL('./fixtures/ah-kassabon-2026-10-02.txt', import.meta.url));
const realTest = (name, fn) => test(name, { skip: HAS_REAL ? false : 'echte bonnen niet aanwezig' }, fn);

realTest('echte AH-kassabon: subtotaal met aantal, statiegeld, bonus, koopzegels', () => {
  const r = parseReceiptText(fx('ah-kassabon-2026-10-02.txt'), { today: '2026-10-23' });
  assert.equal(r.store, 'ah'); // zonder "Albert Heijn" op de bon, herkend aan kenmerken
  assert.equal(r.date, '2026-10-02');
  assert.equal(r.total, 3499);
  assert.equal(r.check, 'ok', r.warnings.join(' | '));
  assert.ok(!r.lines.some((l) => /SUBTOTAAL/.test(l.rawName)), '"12 SUBTOTAAL" is geen artikel');
  assert.equal(r.lines.find((l) => l.kind === 'deposit').amount, 50);
  assert.equal(r.lines.find((l) => l.kind === 'nongrocery').rawName, 'KOOPZEGELS PREMIUM');
  const komk = r.lines.find((l) => l.rawName === 'KOMKOMMER');
  assert.equal(komk.qty, 2);
  assert.ok(komk.promo, 'B = Bonus-artikel');
  const disc = r.lines.find((l) => l.rawName === 'BONUS AHKOMKOMMERP');
  assert.equal(r.lines[disc.linkedTo].rawName, 'KOMKOMMER');
});

realTest('echte AH-kassabon: kortingscodes koppelen (COTED\'ORCHOC, MBAHSNOEPGRO)', () => {
  const r = parseReceiptText(fx('ah-kassabon-2026-10-16.txt'), { today: '2026-10-23' });
  assert.equal(r.check, 'ok');
  assert.equal(r.total, 5812);
  const link = (name) => { const d = r.lines.find((l) => l.rawName === name); return d.linkedTo != null ? r.lines[d.linkedTo].rawName : null; };
  assert.equal(link("BONUS COTED'ORCHOC"), "COTE D'OR");
  assert.equal(link('BONUS MBAHSNOEPGRO'), 'SNOEPGROENTE');
  // Niet op naam te koppelen, maar GOODNOODLES is het enige Bonus-artikel zonder korting → afgeleid
  assert.equal(link('BONUS ALLEKNORR'), 'GOODNOODLES');
  assert.ok(r.lines.find((l) => l.rawName === 'BONUS ALLEKNORR').inferred);
});

realTest('echte AH-kassabon: betalen met Miles is een bonbrede korting', () => {
  const r = parseReceiptText(fx('ah-kassabon-2026-10-10-miles.txt'), { today: '2026-10-23' });
  assert.equal(r.check, 'ok');
  const miles = r.lines.find((l) => /MILES/.test(l.rawName));
  assert.equal(miles.kind, 'discount');
  assert.equal(miles.linkedTo, null);
});

realTest('echte AH-factuur (online bestelling): specificatie, doorlopende namen, statiegeld retour', () => {
  const r = parseReceiptText(fx('ah-factuur-2026-10-06.txt'), { today: '2026-10-23' });
  assert.equal(r.sourceType, 'ah-factuur');
  assert.equal(r.store, 'ah');
  assert.equal(r.date, '2026-10-06');
  assert.equal(r.total, 10510);
  assert.equal(r.check, 'ok', r.warnings.join(' | '));
  assert.equal(r.reportedSavings, 2085);
  assert.ok(!r.lines.some((l) => /zie specificatie/.test(l.rawName)), 'samenvatting van pagina 1 niet dubbel tellen');
  const sap = r.lines.find((l) => /Vers geperst sap/.test(l.rawName));
  assert.equal(sap.qty, 3);
  assert.equal(sap.amount, 500);
  assert.ok(sap.promo && sap.normalUnknown, 'BONUS op losse regel hoort bij het artikel erboven');
  const kaas = r.lines.filter((l) => /Goudse Belegen/.test(l.rawName));
  assert.equal(kaas.length, 1, 'multipack-kopregel niet als extra artikel');
  const retour = r.lines.filter((l) => l.kind === 'deposit' && l.amount < 0);
  assert.equal(retour.reduce((t, l) => t + l.amount, 0), -880);
  const products = r.lines.filter((l) => l.kind === 'product').reduce((t, l) => t + l.amount, 0);
  assert.equal(products, 10270); // "Boodschappen, zie specificatie 102,70"
});

realTest('echte AH-documenten: bon-afkorting en factuurnaam worden één product', () => {
  const memory = { products: new Map(), aliases: new Map() };
  const a = proposalToRecords(parseReceiptText(fx('ah-kassabon-2026-10-02.txt')), memory, { importId: 'a', source: {} });
  const b = proposalToRecords(parseReceiptText(fx('ah-factuur-2026-10-06.txt')), memory, { importId: 'b', source: {} });
  const melkA = a.lines.find((l) => l.rawName === 'DZH HV MELK').productId;
  const melkB = b.lines.find((l) => /Zaanse Hoeve Halfvolle melk/.test(l.rawName)).productId;
  assert.equal(melkA, melkB);
  assert.equal(memory.products.get(melkA).category, 'zuivel');
  const cordon = b.lines.find((l) => /cordon bleu/.test(l.rawName));
  assert.equal(memory.products.get(cordon.productId).category, 'vlees-vis-vega');
});

realTest('korting wordt verdeeld over alle regels van hetzelfde artikel', () => {
  const memory = { products: new Map(), aliases: new Map() };
  const { lines } = proposalToRecords(parseReceiptText(fx('ah-kassabon-2026-10-16.txt')), memory, { importId: 'x', source: {} });
  const facts = buildFacts(lines, memory.products);
  const redBand = facts.filter((f) => f.name === 'RED BAND');
  assert.equal(redBand.length, 3);
  assert.equal(redBand.reduce((t, f) => t + f.discount, 0), -240);
  assert.ok(redBand.every((f) => f.discount < 0 && f.net > 0));
  assert.equal(total(facts), 5812 - 15); // bon minus statiegeld, niets dubbel of kwijt
});

test('AH: bij meerdere kandidaten wordt een korting niet gegokt', () => {
  const r = parseReceiptText('Albert Heijn\n1 KAAS 4,00 B\n1 WORST 3,00 B\n2 SUBTOTAAL 7,00\nBONUS ONBEKEND -1,00\nTOTAAL 6,00\n01-10-2026');
  assert.equal(r.lines.find((l) => l.kind === 'discount').linkedTo, null);
});

// ---------- Bonus-ritme ----------
import { promoRhythm, rhythmOverview, adviceFor } from '../js/core/promo-rhythm.js';

// Wekelijkse aankoop; elke `cycle` weken in de aanbieding met 30% korting.
function rhythmFacts({ weeks = 20, cycle = 5, start = '2026-05-04', price = 400, offset = 0 }) {
  const out = [];
  for (let w = 0; w < weeks; w++) {
    const promo = (w + offset) % cycle === 0;
    const date = addDays(start, w * 7 + 1); // dinsdag
    out.push({ productId: 'p', date, gross: price, discount: promo ? -Math.round(price * 0.3) : 0, net: promo ? price - Math.round(price * 0.3) : price, qty: 1, promo });
  }
  return out;
}

test('ritme: vast patroon van elke 5 weken, met volgende verwachte week', () => {
  const facts = rhythmFacts({});
  const today = addDays('2026-05-04', 20 * 7); // maandag na de laatste week
  const r = promoRhythm(facts, today, { perWeek: 2 });
  assert.equal(r.status, 'ritme');
  assert.equal(r.every, 5);
  assert.ok(Math.abs(r.discountPct - 0.3) < 0.01);
  assert.equal(r.promoPurchases, 4);
  assert.equal(r.stockUp, 10); // 2 per week × 5 weken
  // laatste aanbieding in week 15 (start 2026-08-17), volgende verwacht 5 weken later
  assert.equal(r.lastPromo, addDays('2026-05-04', 15 * 7));
  assert.equal(r.next, addDays('2026-05-04', 20 * 7));
  assert.equal(r.weeksUntil, 0);
  assert.match(adviceFor(r), /deze week/);
});

test('ritme: nu in de aanbieding → inslaan tot de volgende keer', () => {
  const facts = rhythmFacts({ offset: 1 }); // aanbieding in weken 4, 9, 14, 19
  const today = addDays('2026-05-04', 19 * 7 + 3);
  const r = promoRhythm(facts, today, { perWeek: 1 });
  assert.equal(r.status, 'ritme');
  assert.ok(r.inPromoNow);
  assert.match(adviceFor(r), /sla 5 stuks in/);
});

test('ritme: te weinig, nooit, soms en onregelmatig', () => {
  assert.equal(promoRhythm(rhythmFacts({ weeks: 2 }), '2026-10-01').status, 'weinig');
  assert.equal(promoRhythm(rhythmFacts({ cycle: 999, offset: 1 }), '2026-10-01').status, 'nooit');
  assert.equal(promoRhythm(rhythmFacts({ weeks: 8 }), '2026-10-01').status, 'soms');
  const irregular = rhythmFacts({ weeks: 30, cycle: 999, offset: 1 });
  for (const w of [0, 2, 11, 13, 27]) { irregular[w].promo = true; irregular[w].discount = -100; }
  assert.equal(promoRhythm(irregular, '2026-12-01').status, 'onregelmatig');
});

test('ritme: online factuur (BONUS zonder bekende korting) telt als aanbieding, korting% onbekend', () => {
  const facts = rhythmFacts({ weeks: 6, cycle: 2 }).map((f) => ({ ...f, discount: 0, net: f.gross, normalUnknown: f.promo }));
  const r = promoRhythm(facts, '2026-07-01');
  assert.equal(r.promoPurchases, 3);
  assert.equal(r.discountPct, null);
});

realTest('ritme op echte AH-bonnen: totalen en aandeel in de aanbieding', () => {
  const memory = { products: new Map(), aliases: new Map() };
  const lines = [];
  for (const f of ['ah-kassabon-2026-10-02.txt', 'ah-factuur-2026-10-06.txt', 'ah-kassabon-2026-10-10-miles.txt', 'ah-kassabon-2026-10-16.txt']) {
    lines.push(...proposalToRecords(parseReceiptText(fx(f)), memory, { importId: f, source: {} }).lines);
  }
  const facts = buildFacts(lines, memory.products);
  const { rows, totals } = rhythmOverview(facts, memory.products, '2026-10-23');
  assert.ok(totals.share > 0.2 && totals.share < 0.8, String(totals.share));
  assert.ok(totals.saved > 0);
  // met 4 documenten is er nog nergens een "vast ritme"
  assert.ok(rows.every((r) => r.status !== 'ritme'));
  const komk = rows.find((r) => r.name === 'Komkommer');
  assert.equal(komk.purchases, 2);
  assert.equal(komk.promoPurchases, 1);
});

test('zoeken: wanneer komt iets in de aanbieding', () => {
  const today = '2026-10-23';
  const memory = { products: new Map(), aliases: new Map() };
  const lines = [];
  for (const r of generateDemoReceipts(today)) lines.push(...proposalToRecords(r, memory, { importId: 'd', source: {} }).lines);
  const facts = buildFacts(lines, memory.products);
  const rhythm = rhythmOverview(facts, memory.products, today);
  const q = parseQuery('Wanneer is toiletpapier weer in de aanbieding?', today);
  assert.equal(q.intent, 'bonus');
  assert.deepEqual(q.terms, ['toiletpapier']);
  const res = runQuery('Wanneer is toiletpapier weer in de aanbieding?', { facts, products: memory.products, predictions: new Map(), rhythm, today });
  assert.equal(res.kind, 'voorspelling');
  assert.equal(res.rows.length, 1);
  assert.match(res.answer, /^(Nu|Deze week|Volgende week|Over ±\d+ weken)$/);
  assert.equal(parseQuery('Wat komt binnenkort in de aanbieding?', today).intent, 'bonus');
});

// ---------- Inslaglijst en vriezer ----------
import { effectiveDeal, adviseDeal, priceStats, suggestEntries, freezerContents, entryUnit, entryPrediction, defaultsFor } from '../js/core/stockpile.js';

function buys(name, list, store = 'lidl') {
  // list: [[date, qty, unitPrice, discountTotal?]]
  return list.map(([date, qty, unit, disc]) => ({ store, date, total: null, lines: [
    { rawName: name, qty, unitPrice: unit, amount: unit * qty, kind: 'product', promo: Boolean(disc) },
    ...(disc ? [{ rawName: `KORTING ${name}`, qty: 1, unitPrice: -disc, amount: -disc, kind: 'discount', linkedTo: 0 }] : []),
  ] }));
}

test('actietypes omrekenen naar prijs per verpakking', () => {
  assert.deepEqual(effectiveDeal({ type: 'gratis', buy: 1, free: 1 }, 600), { unitPrice: 300, bundle: 2, label: '1+1 gratis' });
  assert.equal(effectiveDeal({ type: 'gratis', buy: 2, free: 1 }, 600).unitPrice, 400);
  assert.equal(effectiveDeal({ type: 'tweedehalf' }, 600).unitPrice, 450);
  assert.equal(effectiveDeal({ type: 'xvoor', n: 3, total: 500 }, 0).unitPrice, 167);
  assert.equal(effectiveDeal({ type: 'pct', pct: 25 }, 600).unitPrice, 450);
  assert.equal(effectiveDeal({ type: 'prijs', price: 399 }, 600).bundle, 1);
});

function cupsScenario() {
  const lidl = buys('Lidl koffiecups 16 stuks', Array.from({ length: 12 }, (_, i) => [addDays('2026-05-01', i * 14), 2, 279]));
  const sb = buys('Starbucks koffiecups 10 stuks', [['2026-06-10', 2, 549, 440], ['2026-08-20', 2, 549, 440]], 'ah');
  const { memory, lines } = storeAll([...lidl, ...sb].sort((a, b) => a.date.localeCompare(b.date)));
  const facts = buildFacts(lines, memory.products);
  const pid = (re) => [...memory.products.values()].find((p) => re.test(p.name) || re.test(p.key)).id;
  return { memory, lines, facts, lidlId: lines.find((l) => /Lidl/.test(l.rawName)).productId, sbId: lines.find((l) => /Starbucks/.test(l.rawName)).productId, pid };
}

test('inslag: koffiecups met Starbucks als upgrade, per cup vergeleken', () => {
  const s = cupsScenario();
  assert.notEqual(s.lidlId, s.sbId, 'merken blijven aparte producten');
  const entry = { id: 'e1', name: 'Koffiecups', location: 'kast', maxWeeks: 12, members: [{ productId: s.lidlId, role: 'standaard' }, { productId: s.sbId, role: 'upgrade' }] };
  assert.equal(entryUnit(entry, s.lines).unit, 'st');
  const ctx = { facts: s.facts, lines: s.lines, products: s.memory.products, today: '2026-10-23' };
  // Starbucks 1+1: €2,75 per pak van 10 = 27 cent per cup; Lidl normaal 279/16 = 17 cent → niet
  const a = adviseDeal(entry, s.sbId, { type: 'gratis', buy: 1, free: 1 }, ctx);
  assert.equal(a.verdict, 'niet');
  assert.equal(a.unitLabel, 'stuk');
  assert.equal(a.effBase, 28); // 549 / 2 = 274,5 → 275 per pak → 27,5 → 28 cent per cup
  assert.equal(a.buyPacks, 0);
  // Met een zelfgekozen maximum van 30 cent per cup wél
  entry.members[1].maxPrice = 30;
  const b = adviseDeal(entry, s.sbId, { type: 'gratis', buy: 1, free: 1 }, ctx);
  assert.equal(b.verdict, 'inslaan');
  assert.ok(b.buyPacks >= 2 && b.buyPacks % 2 === 0, String(b.buyPacks));
  assert.ok(b.reasons.some((r) => /meer dan jullie standaard/.test(r)));
});

test('inslag: hoeveelheid tot maximale voorraad, in hele actiebundels', () => {
  const s = cupsScenario();
  const entry = { id: 'e1', name: 'Koffiecups', location: 'kast', maxWeeks: 12, members: [{ productId: s.lidlId, role: 'standaard' }] };
  const ctx = { facts: s.facts, lines: s.lines, products: s.memory.products, today: '2026-10-20' };
  const pred = entryPrediction(entry, ctx);
  assert.ok(Math.abs(pred.perWeek - 16) < 1.5, `±16 cups per week, was ${pred.perWeek}`);
  const a = adviseDeal(entry, s.lidlId, { type: 'tweedehalf' }, ctx);
  assert.equal(a.verdict, 'inslaan');
  // 12 weken × 16 cups = 192 cups minus huidige voorraad, in pakken van 16, veelvoud van 2
  assert.ok(a.buyPacks >= 8 && a.buyPacks <= 12 && a.buyPacks % 2 === 0, String(a.buyPacks));
  assert.equal(a.saving, Math.round(a.buyPacks * (279 - 209)));
});

test('inslag: doelprijs = beste kwart van betaalde prijzen, pas vanaf 4 aankopen', () => {
  const s = cupsScenario();
  const st = priceStats(s.facts, s.sbId);
  assert.equal(st.observations, 2);
  assert.equal(st.autoTarget, null);
  const l = priceStats(s.facts, s.lidlId);
  assert.equal(l.perBase, true);
  assert.equal(l.unitLabel, 'stuk');
  assert.equal(l.autoTarget, 17);
});

test('inslag: voorstellen alleen voor houdbare producten met prijsverschil', () => {
  const today = '2026-10-23';
  const { memory, lines } = storeAll(generateDemoReceipts(today));
  const facts = buildFacts(lines, memory.products);
  const sug = suggestEntries(facts, memory.products, today, { freezer: true });
  const names = sug.map((x) => x.name.toLowerCase());
  assert.ok(names.some((n) => /toiletpapier|wasmiddel|aroma|pindakaas/.test(n)), names.join(', '));
  assert.ok(!names.some((n) => /banaan|komkommer|appels/.test(n)), 'geen verse groente/fruit');
  const noFreezer = suggestEntries(facts, memory.products, today, { freezer: false });
  assert.ok(!noFreezer.some((x) => x.location === 'vriezer'));
  assert.equal(defaultsFor({ category: 'vlees-vis-vega', key: 'gehakt rund' }).shelfWeeks, 12);
});

test('vriezer: extra gekocht = ingevroren, oudste eerst op, handmatig leeg', () => {
  const list = Array.from({ length: 10 }, (_, i) => [addDays('2026-08-03', i * 7), i === 6 ? 3 : 1, 699]);
  const { memory, lines } = storeAll(buys('AH Kipfilet 600G', list, 'ah'));
  const id = lines[0].productId;
  const entry = { id: 'k', name: 'Kipfilet', location: 'vriezer', maxWeeks: 8, shelfWeeks: 16, members: [{ productId: id, role: 'standaard' }] };
  const ctx = { lines, products: memory.products, today: addDays('2026-08-03', 6 * 7 + 1) };
  const f1 = freezerContents([entry], ctx).get('k');
  assert.equal(f1.batches.length, 1);
  assert.ok(f1.packs > 1.5 && f1.packs <= 2, String(f1.packs)); // 2 extra pakken ingevroren
  assert.equal(f1.oldest, addDays('2026-08-03', 42));
  // Na "leeg" is er niets meer
  const f2 = freezerContents([entry], { ...ctx, manual: [{ entryId: 'k', type: 'leeg', date: ctx.today }] }).get('k');
  assert.equal(f2.packs, 0);
  // Zelf iets ingevroren
  const f3 = freezerContents([entry], { ...ctx, manual: [{ entryId: 'k', type: 'leeg', date: ctx.today }, { entryId: 'k', type: 'erbij', qty: 1, date: ctx.today }] }).get('k');
  assert.ok(f3.packs > 0);
});

test('vriezer: te lang bewaard wordt gemeld', () => {
  const list = Array.from({ length: 6 }, (_, i) => [addDays('2026-03-02', i * 7), i === 1 ? 4 : 1, 549]);
  const { memory, lines } = storeAll(buys('AH Rundergehakt 500G', list, 'ah'));
  const entry = { id: 'g', name: 'Gehakt', location: 'vriezer', maxWeeks: 8, shelfWeeks: 12, members: [{ productId: lines[0].productId, role: 'standaard' }] };
  const f = freezerContents([entry], { lines, products: memory.products, today: addDays('2026-03-09', 7 * 14), manual: [] }).get('g');
  assert.ok(f.packs > 0, 'partij nog aanwezig: na lang niet kopen is verbruik onbekend en wordt niets weggerekend');
  assert.ok(f.overdue);
  assert.ok(f.oldestWeeks > 12);
});

test('inslag: verschillende verpakkingen zonder inhoud tellen niet als prijsverschil', () => {
  const props = [
    ...buys('AH CROISSANT', [['2026-10-02', 1, 299], ['2026-10-09', 1, 299], ['2026-10-16', 1, 299]], 'ah'),
    ...buys('CROISSANTS', [['2026-10-05', 1, 119]], 'ah'),
  ];
  const { memory, lines } = storeAll(props);
  assert.equal(new Set(lines.map((l) => l.productId)).size, 1, 'zelfde basisproduct');
  const sug = suggestEntries(buildFacts(lines, memory.products), memory.products, '2026-10-23', { freezer: true });
  assert.equal(sug.length, 0);
});

// ---------- Wekelijkse aanbiedingen ----------
import { parseMechanism, matchOffer, weeklyAdvice, brandsByProduct, offersStatus } from '../js/core/offers.js';

test('actieteksten herkennen (AH en Folderz)', () => {
  assert.deepEqual(parseMechanism('1 + 1 gratis'), { type: 'gratis', buy: 1, free: 1 });
  assert.deepEqual(parseMechanism('2 + 1 GRATIS'), { type: 'gratis', buy: 2, free: 1 });
  assert.deepEqual(parseMechanism('2e gratis'), { type: 'gratis', buy: 1, free: 1 });
  assert.deepEqual(parseMechanism('3e gratis'), { type: 'gratis', buy: 2, free: 1 });
  assert.deepEqual(parseMechanism('2e halve prijs'), { type: 'tweedehalf' });
  assert.deepEqual(parseMechanism('2E HALVE PRIJS'), { type: 'tweedehalf' });
  assert.deepEqual(parseMechanism('4 VOOR 10.00'), { type: 'xvoor', n: 4, total: 1000 });
  assert.deepEqual(parseMechanism('3 voor 4,50'), { type: 'xvoor', n: 3, total: 450 });
  assert.deepEqual(parseMechanism('55% KORTING'), { type: 'pct', pct: 55 });
  assert.deepEqual(parseMechanism('voor 2.49'), { type: 'prijs', price: 249 });
  assert.deepEqual(parseMechanism('1 euro korting', { was: 499 }), { type: 'prijs', price: 399 });
  assert.deepEqual(parseMechanism('2.50 EURO KORTING'), { type: 'eurokorting', amount: 250 }, 'AH-groepsactie zonder prijs');
  assert.deepEqual(parseMechanism('2e GRATIS'), { type: 'gratis', buy: 1, free: 1 });
  assert.deepEqual(parseMechanism('VOOR 0.99'), { type: 'prijs', price: 99 });
  assert.deepEqual(parseMechanism('', { price: 349, was: 599 }), { type: 'prijs', price: 349 });
  assert.equal(parseMechanism('25% extra inhoud'), null);
  assert.equal(parseMechanism('Op = op'), null);
});

function offerScenario() {
  const today = '2026-10-23';
  const props = [
    ...buys('Page Toiletpapier 12 rollen', Array.from({ length: 8 }, (_, i) => [addDays('2026-06-01', i * 14), 1, 649]), 'ah'),
    ...buys('AH Halfvolle melk 1L', Array.from({ length: 10 }, (_, i) => [addDays('2026-08-01', i * 7), 4, 109]), 'ah'),
    ...buys('Robijn Wasmiddel 1,5L', Array.from({ length: 4 }, (_, i) => [addDays('2026-05-01', i * 35), 1, 999]), 'ah'),
  ];
  const { memory, lines } = storeAll(props);
  const facts = buildFacts(lines, memory.products);
  const id = (re) => lines.find((l) => re.test(l.rawName)).productId;
  return { today, memory, lines, facts, tp: id(/Page/), melk: id(/melk/), was: id(/Robijn/) };
}

test('aanbieding koppelen: zelfde basisproduct, merk wordt meegewogen', () => {
  const s = offerScenario();
  const brands = brandsByProduct(s.lines);
  const m1 = matchOffer({ title: 'Page Kussenzacht toiletpapier 24 rollen', brand: 'Page' }, s.memory.products, brands);
  assert.equal(m1[0].productId, s.tp);
  assert.equal(m1[0].brandMatch, true);
  const m2 = matchOffer({ title: 'Alle Robijn wasmiddelen' }, s.memory.products, brands);
  assert.equal(m2[0].productId, s.was);
  assert.equal(matchOffer({ title: 'Haribo Goudbeertjes' }, s.memory.products, brands).length, 0);
  assert.equal(matchOffer({ title: 'AH Volle melk 1L' }, s.memory.products, brands).length, 0, 'volle melk ≠ halfvolle melk');
});

test('aanbieding koppelen: geen losse woorddelen (echte fouten uit de eerste AH-run)', () => {
  const { memory, lines } = storeAll([
    ...buys('DZH RASP', [['2026-10-01', 1, 249], ['2026-10-08', 1, 249]], 'ah'),
    ...buys('AH RIJSTWAF', [['2026-10-01', 2, 89]], 'ah'),
    ...buys('AH SOEPGROEN', [['2026-10-01', 1, 129]], 'ah'),
    ...buys('MAALTIJD', [['2026-10-01', 1, 699]], 'ah'),
  ]);
  const brands = brandsByProduct(lines);
  const names = (title) => matchOffer({ title }, memory.products, brands).map((m) => memory.products.get(m.productId).name);
  assert.deepEqual(names('Clipper Glow for it raspberry & lemon'), []);
  assert.deepEqual(names('Alle Lassie en Tilda rijst'), []);
  assert.deepEqual(names('Alle AH Verse soepen 500 gram'), []);
  assert.deepEqual(names('Alle De Vegetarische Slager maaltijdcomponenten'), []);
  assert.deepEqual(names('Alle AH Uit Eigen Keuken maaltijden'), ['Maaltijd'], 'meervoud mag wel');
  assert.deepEqual(names('AH Geraspte kaas'), [], 'geraspt ≠ rasp');
});

test('aanbieding koppelen: ander soort product valt af (vochtig, gemarineerd)', () => {
  const { memory, lines } = storeAll([
    ...buys('Page Toiletpapier 12 rollen', [['2026-10-01', 1, 649], ['2026-10-15', 1, 649]], 'ah'),
    ...buys('AH Scharrel kipfilet 2 stuks', [['2026-10-01', 1, 449]], 'ah'),
  ]);
  const brands = brandsByProduct(lines);
  const names = (title) => matchOffer({ title }, memory.products, brands).map((m) => memory.products.get(m.productId).name);
  assert.deepEqual(names('Edet vochtig toiletpapier maxi pack'), []);
  assert.deepEqual(names('AH Scharrel kipfilet gemarineerd'), []);
  assert.equal(names('Page Kussenzacht toiletpapier 24 rollen').length, 1);
  assert.equal(names('AH Scharrel kipfilet 600 g').length, 1);
});

test('weekoverzicht: inslagadvies, vast product, schijnkorting en verlopen actie', () => {
  const s = offerScenario();
  const entry = { id: 'tp', name: 'Toiletpapier', location: 'kast', maxWeeks: 12, members: [{ productId: s.tp, role: 'standaard' }] };
  const ctx = { facts: s.facts, lines: s.lines, products: s.memory.products, today: s.today, stockpile: [entry], predictions: new Map() };
  const data = { generatedAt: '2026-10-20T06:00:00Z', offers: [
    { id: 1, store: 'kruidvat', title: 'Page toiletpapier 12 rollen', price: 487, was: 649, mechanism: '2e halve prijs', validTo: '2026-10-26', source: 'folderz' },
    { id: 2, store: 'ah', title: 'AH Halfvolle melk 1L', size: '1 l', price: 109, was: 125, mechanism: '1 + 1 gratis', validTo: '2026-10-26', source: 'ah' },
    { id: 3, store: 'ah', title: 'Robijn wasmiddel 1,5 l', size: '1,5 l', price: 999, was: 1299, mechanism: 'voor 9.99', validTo: '2026-10-26', source: 'ah' }, // "korting" t.o.v. hoge van-prijs, maar = normale prijs voor jullie
    { id: 4, store: 'jumbo', title: 'Page toiletpapier 12 rollen', mechanism: '1+1 gratis', was: 649, validTo: '2026-10-01', source: 'folderz' }, // verlopen
  ] };
  const res = weeklyAdvice(data, ctx, { stores: ['ah', 'kruidvat', 'jumbo'] });
  const keys = res.items.map((i) => `${i.offer.store}:${i.name}`);
  assert.ok(keys.includes('kruidvat:Page toiletpapier'), keys.join(', '));
  assert.ok(keys.includes('ah:Halfvolle melk'), keys.join(', '));
  assert.ok(!keys.some((k) => k.includes('Wasmiddel')), 'schijnkorting valt af');
  assert.ok(!keys.some((k) => k.startsWith('jumbo')), 'verlopen actie valt af');
  const tp = res.items.find((i) => i.name === 'Page toiletpapier');
  assert.equal(tp.kind, 'inslag');
  assert.ok(tp.qty >= 2 && tp.qty % 2 === 0);
  const melk = res.items.find((i) => i.name === 'Halfvolle melk');
  assert.equal(melk.kind, 'vast');
  assert.equal(melk.qty, 4); // normaal 4 pakken, 1+1 → veelvoud van 2
  assert.equal(melk.saving, Math.round(4 * (109 - 63))); // jullie betalen 1,09; met 1+1 op 1,25 → 0,63
  assert.equal([...res.byStore.keys()][0], 'kruidvat');
});

test('aanbiedingenbestand: status en ouderdom', () => {
  assert.equal(offersStatus(null, '2026-10-23').ok, false);
  assert.equal(offersStatus({ generatedAt: null, offers: [] }, '2026-10-23').ok, false, 'leeg beginbestand');
  const st = offersStatus({ generatedAt: '2026-10-12T05:00:00Z', offers: [{}] }, '2026-10-23');
  assert.equal(st.stale, true);
  assert.equal(st.age, 11);
});

// ---------- inhoud en eenheid bij aanbiedingen ----------
import { sizesIn, offerSize, adviseOffer } from '../js/core/offers.js';

test('inhoud uit actieteksten: multipacks, trays, bereik, opties, per 100 g', () => {
  const one = (t, own) => offerSize({ size: t }, own).size;
  assert.deepEqual(one('6 x 0,33 l'), { amount: 1980, unit: 'ml', count: 6 });
  assert.deepEqual(one('Tray met 24 blikken à 33cl'), { amount: 7920, unit: 'ml', count: 24 });
  assert.deepEqual(one('Zak 1 kilo'), { amount: 1000, unit: 'g' });
  assert.deepEqual(one('Alle doosjes à 20 zakjes'), { amount: 20, unit: 'st' });
  assert.deepEqual(one('12 rollen'), { amount: 12, unit: 'st' });
  assert.deepEqual(offerSize({ size: '100 g', mechanism: '1,19 per 100g' }).size, { amount: 100, unit: 'g' });
  assert.deepEqual(one('per 500 gram'), { amount: 500, unit: 'g' });
  // meerdere mogelijkheden: alleen als jullie verpakking erbij hoort
  assert.equal(one('Kuip 70 - 210 gram'), null);
  assert.deepEqual(one('Kuip 70 - 210 gram', { amount: 150, unit: 'g' }), { amount: 150, unit: 'g' });
  assert.equal(one('Bak 150 gram of bak 400 gram', { amount: 250, unit: 'g' }), null);
  assert.deepEqual(one('Schaal 750 of 900 gram', { amount: 900, unit: 'g' }), { amount: 900, unit: 'g' });
  assert.equal(one('4 x 0,5 l/6 x 0,33 l'), null, 'twee verschillende packs');
  assert.equal(one('Per stuk'), null);
  assert.equal(sizesIn('Verse zalmfilet').options.length, 0);
});

test('aanbieding vergelijken op inhoud: per liter, andere verpakking, andere eenheid', () => {
  const { memory, lines } = storeAll([
    ...buys('AH Cola 1,5L', Array.from({ length: 6 }, (_, i) => [addDays('2026-08-01', i * 7), 2, 150]), 'ah'), // € 1,00 per liter
    ...buys('Pampers Baby Dry 44 luiers', Array.from({ length: 4 }, (_, i) => [addDays('2026-08-01', i * 14), 1, 1320]), 'ah'), // € 0,30 per luier
  ]);
  const facts = buildFacts(lines, memory.products);
  const ctx = { facts, lines, products: memory.products, today: '2026-10-23', stockpile: [], predictions: new Map() };
  const cola = lines.find((l) => /Cola/.test(l.rawName)).productId;
  const pampers = lines.find((l) => /Pampers/.test(l.rawName)).productId;
  const adv = (offer, pid) => adviseOffer({ validTo: '2026-10-27', ...offer }, { productId: pid, brandMatch: null }, ctx);

  // 6 x 0,33 l voor 2,99 = € 1,51 per liter → duurder dan jullie € 1,00, hoewel het "per pak" goedkoper lijkt dan 2 flessen
  const a = adv({ store: 'jumbo', title: 'Cola blikjes', size: '6 x 0,33 l', price: 299, mechanism: 'voor 2,99' }, cola);
  assert.equal(a.unitLabel, 'liter');
  assert.equal(a.effBase, 151);
  assert.equal(a.ownBase, 100);
  assert.equal(a.verdict, 'niet');

  // 1,5 l voor 0,99 per fles bij Dirk: € 0,66 per liter → wel voordelig; besparing per liter gerekend
  const b = adv({ store: 'dirk', title: 'Cola', size: 'Fles 1,5 liter', price: 99, mechanism: 'voor 0,99' }, cola);
  assert.equal(b.verdict, 'inslaan');
  assert.equal(b.qty, 2);
  assert.equal(b.saving, 2 * (150 - 99));

  // Grotere verpakking: 2 liter voor 1,40 → 0,70 per liter; jullie kopen normaal 3 liter → 2 flessen (4 l) wordt 2
  const c = adv({ store: 'dirk', title: 'Cola', size: '2 liter', price: 140 }, cola);
  assert.equal(c.effBase, 70);
  assert.equal(c.qty, 2);
  assert.equal(c.saving, Math.round(2 * (2 * 100 - 140)));

  // Andere winkel zonder inhoud: niet vergelijken
  assert.equal(adv({ store: 'jumbo', title: 'Cola', price: 99, mechanism: 'voor 0,99' }, cola), null);
  // Gewicht tegenover volume: niet vergelijken
  assert.equal(adv({ store: 'dirk', title: 'Cola', size: '500 gram', price: 99 }, cola), null);
  // %-korting bij een andere winkel zonder van-prijs: AH-prijs is géén normale prijs van Jumbo
  assert.equal(adv({ store: 'jumbo', title: 'Cola', size: '1,5 liter', mechanism: '25% korting' }, cola), null);
  // ...maar met de van-prijs van die winkel wel
  const d = adv({ store: 'jumbo', title: 'Cola', size: '1,5 liter', was: 180, mechanism: '50% korting' }, cola);
  assert.equal(d.effBase, 60);

  // Luiers: 2+2 gratis met van-prijs 16,00 voor 50 stuks → € 0,16 per luier tegen jullie € 0,30
  const e = adv({ store: 'jumbo', title: 'Pampers Baby Dry', size: '50 luiers', was: 1600, mechanism: '2+2 gratis' }, pampers);
  assert.equal(e.unitLabel, 'stuk');
  assert.equal(e.effBase, 16);
  assert.equal(e.qty, 4, 'hele bundel van 4');
});

test('inslag: aanbieding in een andere eenheid wordt niet vergeleken', () => {
  const { memory, lines } = storeAll(buys('Lidl Koffiecups 20 stuks', Array.from({ length: 5 }, (_, i) => [addDays('2026-07-01', i * 14), 2, 329]), 'lidl'));
  const facts = buildFacts(lines, memory.products);
  const pid = lines[0].productId;
  const entry = { id: 'k', name: 'Koffiecups', location: 'kast', maxWeeks: 12, members: [{ productId: pid, role: 'standaard' }] };
  const ctx = { facts, lines, products: memory.products, today: '2026-10-23', stockpile: [entry], predictions: new Map(), adjustments: [], vacations: [] };
  const a = adviseOffer({ store: 'ah', title: 'Koffiecups', size: '250 gram', price: 299, validTo: '2026-10-27' }, { productId: pid, brandMatch: null }, ctx);
  assert.equal(a, null);
  const b = adviseOffer({ store: 'ah', title: 'Koffiecups 36 stuks', price: 499, validTo: '2026-10-27' }, { productId: pid, brandMatch: null }, ctx);
  assert.equal(b.kind, 'inslag');
  assert.equal(b.unitLabel, 'stuk');
  assert.equal(b.effBase, 14); // 4,99 / 36
});

test('Aldi-bon: gewicht en aantal staan boven de naam, btw-code achter €', () => {
  const text = `ALDI
Schepenenveld 6, 2712 BW Zoetermeer
1,068 kg x 0,85 €/kg
BANANEN LOS PER KG 0,91 € B
1,084 kg x 0,85 €/kg
BANANEN LOS PER KG 0,92 € B
1,068 kg x 0,85 €/kg
BANANEN LOS PER KG 0,91 € B
2 x 3,28 €
TOILETPAPIER 3-LAAGS 6,56 € C
SUBTOTAAL EUR 9,30
TE BETALEN 9,30 €
KLANTTICKET`;
  const r = parseReceiptText(text, {});
  assert.equal(r.store, 'aldi');
  assert.equal(r.total, 930);
  assert.deepEqual(r.lines.map((l) => l.rawName), ['BANANEN LOS PER KG', 'BANANEN LOS PER KG', 'BANANEN LOS PER KG', 'TOILETPAPIER 3-LAAGS']);
  assert.equal(r.lines[3].qty, 2);
  assert.equal(r.lines[3].amount, 656);
  assert.ok(!r.warnings.some((w) => /wijkt af/.test(w)));
});

test('OCR-fouten: scheidingsteken, "Totaary" en "korting" onder het totaal', () => {
  const text = `Jumbo supermarkten
VP PASTA POMODORO 5° 49
ACTIE NESPRESSO CUPS -11/98
Totaary 6,58
Maestro
Totaal korting -1,10`;
  const r = parseReceiptText(text, {});
  assert.equal(r.lines.find((l) => /PASTA/.test(l.rawName)).amount, 549);
  assert.equal(r.lines.find((l) => /NESPRESSO/.test(l.rawName)).amount, -1198);
  assert.equal(r.total, 658);
});
