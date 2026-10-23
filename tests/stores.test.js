// Tests voor de aanbiedingen van Jumbo, Dirk, Hoogvliet, Action en Lidl.
// 1. Kleine nagebootste pagina's in dezelfde vorm als de echte websites (altijd).
// 2. Echte pagina's van 23 okt 2026 (alleen lokaal aanwezig in tests/fixtures/stores; anders overgeslagen).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseDirk, parseJumbo, parseHoogvliet, parseAction, parseLidl, devalue, robotsAllows, fetchStore } from '../scripts/store-sources.mjs';
import { parseMechanism } from '../js/core/offers.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Maakt een __NUXT_DATA__-array (devalue-formaat) van een gewoon object, zoals Nuxt dat doet. */
function toDevalue(root) {
  const arr = [];
  const enc = (v) => {
    const i = arr.length;
    arr.push(null);
    if (Array.isArray(v)) arr[i] = v.map(enc);
    else if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = enc(x); arr[i] = o; }
    else arr[i] = v;
    return i;
  };
  enc(root);
  // Nuxt verpakt de toestand in ["Reactive", n]: één keer nadoen.
  arr.push(arr[0]); arr[0] = ['ShallowReactive', arr.length - 1];
  return arr;
}
const nuxtPage = (data) => `<html><body><script type="application/json" data-nuxt-data="nuxt-app" id="__NUXT_DATA__">${JSON.stringify(toDevalue(data))}</script></body></html>`;

test('devalue: verwijzingen, Reactive en Map', () => {
  assert.deepEqual(devalue([{ a: 1, b: 2 }, 'x', ['Reactive', 3], [4], 5]), { a: 'x', b: [5] });
  assert.deepEqual(devalue([['Map', 1, 2], 'k', 'v']), { k: 'v' });
});

test('Dirk: prijs, oude prijs, verpakking, lokale datums', () => {
  const html = nuxtPage({ data: { 'offers-currentOffers': [{ currentOffers: [
    { offerId: 1, headerText: 'Boerenkool grof ', packaging: 'Zak 300 gram.', offerPrice: 0.99, normalPrice: 1.95, textPriceSign: 'ACTIE_\n ', startDate: '2026-10-21T00:00:00.000Z', endDate: '2026-10-27T23:59:00.000Z', products: [{ productInformation: { brand: '1 de Beste' } }] },
    { offerId: 2, headerText: 'Entrecote', packaging: 'Per pak. OP=OP', offerPrice: 4.99, normalPrice: 0, textPriceSign: 'VR, ZA & ZO_actie', startDate: '2026-10-21T00:00:00.000Z', endDate: '2026-10-25T23:59:00.000Z', products: [] },
    { offerId: 3, headerText: 'Coca-Cola', packaging: 'Fles 1,5 liter.', offerPrice: 5, normalPrice: 7.6, textPriceSign: '2 VOOR_', startDate: '2026-10-21T00:00:00.000Z', endDate: '2026-10-27T23:59:00.000Z', products: [] },
  ] }, { currentOffers: [{ offerId: 1, headerText: 'Boerenkool grof ', packaging: 'Zak 300 gram.', offerPrice: 0.99, normalPrice: 1.95, textPriceSign: 'ACTIE_', startDate: '2026-10-21T00:00:00.000Z', endDate: '2026-10-27T23:59:00.000Z', products: [] }] }] } });
  const o = parseDirk(html);
  assert.equal(o.length, 3, 'dubbele aanbieding (in twee categorieën) één keer');
  assert.deepEqual([o[0].title, o[0].size, o[0].price, o[0].was, o[0].validTo, o[0].brand], ['Boerenkool grof', 'Zak 300 gram', 99, 195, '2026-10-27', '1 de Beste']);
  assert.equal(o[1].was, null, 'normale prijs 0 = onbekend');
  assert.equal(o[1].size, 'Per pak');
  assert.equal(o[1].validTo, '2026-10-25');
  assert.deepEqual(parseMechanism(o[2].mechanism, o[2]), { type: 'xvoor', n: 2, total: 500 });
});

test('Jumbo: actielabels, prijs per 100 g, alleen-online overslaan', () => {
  const promo = (id, title, tag, subtitle = null) => ({ id, title, subtitle, active: true, hidden: false, tags: [{ text: tag }], start: { iso: '2026-10-21T00:01:00+02:00' }, end: { iso: '2026-10-27T23:59:59+01:00' }, url: `/aanbiedingen/x/${id}` });
  const html = nuxtPage({ data: { nuTab: { activeTab: { runtimes: [{ sections: [
    { promotions: [promo('1', 'Alle Finish vaatwastabletten', '2+3 gratis')] },
    { categories: [{ promotions: [
      promo('2', 'Unox rookworst', 'voor 2,99', 'Alle verpakkingen à 275-285 gram'),
      promo('3', 'Varkenshaas', '1,19 per 100g'),
      promo('4', 'Grüner Veltliner', '1,00 korting', 'Fles 750 ml<br />Oostenrijk'),
      promo('5', 'Red Bull', 'voor 29,99 · Alleen online'),
      promo('1', 'Alle Finish vaatwastabletten', '2+3 gratis'),
    ] }] },
  ] }] } } } });
  const o = parseJumbo(html);
  assert.deepEqual(o.map((x) => x.title), ['Alle Finish vaatwastabletten', 'Unox rookworst', 'Varkenshaas', 'Grüner Veltliner']);
  assert.deepEqual(parseMechanism(o[0].mechanism, o[0]), { type: 'gratis', buy: 2, free: 3 });
  assert.equal(o[1].price, 299);
  assert.deepEqual([o[2].price, o[2].size], [119, '100 g']);
  assert.equal(o[3].price, null, '1,00 korting is geen prijs');
  assert.equal(o[3].size, 'Fles 750 ml · Oostenrijk');
  assert.equal(o[0].validTo, '2026-10-27');
});

test('Hoogvliet: per-prijs, 2 voor, 1+1, en geen vaste prijzen/online/bezorging', () => {
  const item = (sku, name, top, bottom, regular, final, type = 'ACTIE') => ({ sku, name, display_name: name, discount_label_top: top, discount_label_bottom: bottom,
    price_range: { minimum_price: { regular_price: { value: regular }, final_price: { value: final } } },
    promotion_meta_data: { actietype: type, valid_from: '2026-10-21 00:00:00+00', valid_to: '2026-10-27 00:00:00+00' } });
  const data = { props: { pageProps: { promotionPeriods: [{ validFrom: '2026-10-21 00:00:00', validTo: '2026-10-27 23:59:59', groups: [{ items: [
    item('1', 'Spruiten verpakt', 'per zak', 0.99, 1.49, 0.99),
    item('2', 'Trostomaten los', 'per 500 gram', 0.79, 0.95, 0.79),
    item('3', 'Druiven of mango', '2 voor', 3.99, 6.78, 3.99, 'Kies & Mix 2 voor'),
    item('4', 'Gemengd gehakt', '1 + 1 Gratis', undefined, 9.18, 4.59, '1 + 1 Gratis'),
    item('5', 'Geraspte kaas', 'per stuk', 3.99, 3.99, 3.99, 'Vast Laag'),
    item('6', 'Zaanse mayonaise', 'per stuk', 1.49, 1.49, 1.49, 'online only'),
    item('7', 'Optimel', 'bij 12.50 gratis bezorging', undefined, 1.39, 1.39, 'gsk'),
  ] }] }] } } };
  const o = parseHoogvliet(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`);
  assert.deepEqual(o.map((x) => x.title), ['Spruiten verpakt', 'Trostomaten los', 'Druiven of mango', 'Gemengd gehakt']);
  assert.deepEqual([o[0].price, o[0].was, o[0].size], [99, 149, null]);
  assert.deepEqual([o[1].price, o[1].size], [79, '500 gram']);
  assert.deepEqual(parseMechanism(o[2].mechanism, o[2]), { type: 'xvoor', n: 2, total: 399 });
  assert.deepEqual(parseMechanism(o[3].mechanism, o[3]), { type: 'gratis', buy: 1, free: 1 });
  assert.equal(o[3].price, null, 'bij 1+1 geen losse prijs (de site rekent de prijs per stuk al om)');
  assert.equal(o[0].validTo, '2026-10-27');
});

test('Action: weekactie uit de RSC-gegevens', () => {
  const p = { id: '3227320', title: 'Bleekspray', description: '1 liter | diverse varianten', brand: 'Fabulosa', isDeal: true, href: 'https://www.action.com/nl-nl/p/3227320/bleekspray/',
    price: { current: { amount: 1.48 }, original: { amount: 1.77 } }, stickers: [{ code: 'IS_DEAL', value: 'Weekactie', subValue: '21-10 t/m 27-10' }] };
  const q = { ...p, id: '1', title: 'Gewoon product', isDeal: false };
  const flight = `0:["$","x",null,{"product":${JSON.stringify(p)}}]\n1:["$","y",null,{"product":${JSON.stringify(q)}}]`;
  const html = `<script>self.__next_f.push([1,${JSON.stringify(flight)}])</script>`;
  const o = parseAction(html);
  assert.equal(o.length, 1);
  assert.deepEqual([o[0].title, o[0].size, o[0].brand, o[0].price, o[0].was], ['Bleekspray', '1 liter', 'Fabulosa', 148, 177]);
  assert.match(o[0].validTo, /-10-27$/);
});

test('Lidl: gewone prijs en Lidl Plus-prijs uit data-grid-data', () => {
  const a = { productId: 1, fullTitle: 'Gewassen spinazie', brand: { showBrand: false }, storeStartDate: 1792360800, storeEndDate: 1792965599, canonicalUrl: '/p/spinazie/p1',
    regionsPrices: { 1: { currentPrice: { price: 0.99, oldPrice: 1.79, packaging: { text: 'Zak 450 gram' } } } } };
  const b = { productId: 2, fullTitle: 'CHEF SELECT & YOU Andijvie', brand: { showBrand: true, name: 'CHEF SELECT' }, storeStartDate: 1792360800, storeEndDate: 1792965599,
    regionsPrices: { 1: { currentLidlPlusPrice: { price: { price: 1.59, oldPrice: 1.99, packaging: { text: '500-1000 g' } }, lidlPlusText: 'met Lidl Plus' } } } };
  const attr = (x) => JSON.stringify(x).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const o = parseLidl(`<div data-grid-data="${attr(a)}"></div><div data-grid-data="${attr(b)}"></div>`);
  assert.deepEqual([o[0].title, o[0].price, o[0].was, o[0].size, o[0].validFrom, o[0].validTo], ['Gewassen spinazie', 99, 179, 'Zak 450 gram', '2026-10-19', '2026-10-25']);
  assert.equal(o[1].title, 'CHEF SELECT & YOU Andijvie');
  assert.match(o[1].mechanism, /Lidl Plus/);
  assert.deepEqual(parseMechanism(o[1].mechanism, o[1]), { type: 'prijs', price: 159 });
});

test('robots.txt: verboden pad wordt niet opgehaald, toegestaan pad wel', async () => {
  assert.equal(robotsAllows('User-agent: *\nDisallow: /acties', '/acties'), false);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /search\nAllow: /', '/aanbiedingen'), true);
  assert.equal(robotsAllows('User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /mijn/', '/aanbiedingen'), true);
  assert.equal(robotsAllows('User-agent: *\nDisallow: *sort=', '/c/x?sort=1'), false);
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    if (url.endsWith('/robots.txt')) return { ok: true, status: 200, text: async () => 'User-agent: *\nDisallow: /aanbiedingen' };
    return { ok: true, status: 200, text: async () => '' };
  };
  await assert.rejects(fetchStore(fakeFetch, 'dirk'), /robots\.txt/);
  assert.equal(calls.length, 1, 'de pagina zelf is niet opgevraagd');
});

test('blokkade (403) wordt gemeld en niet omzeild', async () => {
  const calls = [];
  const fakeFetch = async (url) => { calls.push(url); return url.endsWith('robots.txt') ? { ok: true, status: 200, text: async () => '' } : { ok: false, status: 403, text: async () => 'Access Denied' }; };
  await assert.rejects(fetchStore(fakeFetch, 'jumbo'), /weigert automatische toegang/);
  assert.equal(calls.length, 2, 'één poging, geen herhaling met andere instellingen');
});

// ---------- echte pagina's (lokaal) ----------
const real = (s) => join(here, 'fixtures', 'stores', `${s}.html`);
const realTest = (s, name, fn) => test(name, { skip: existsSync(real(s)) ? false : 'echte pagina niet aanwezig' }, () => fn(readFileSync(real(s), 'utf8')));
const usable = (o) => parseMechanism(o.mechanism, o) || o.price != null;

realTest('dirk', 'echte Dirk-pagina (23 okt 2026)', (html) => {
  const o = parseDirk(html);
  assert.equal(o.length, 116);
  assert.ok(o.every(usable));
  const bk = o.find((x) => /Boerenkool grof/.test(x.title));
  assert.deepEqual([bk.price, bk.was, bk.validTo], [99, 195, '2026-10-27']);
});
realTest('jumbo', 'echte Jumbo-pagina (23 okt 2026)', (html) => {
  const o = parseJumbo(html);
  assert.ok(o.length >= 100, `${o.length}`);
  assert.ok(o.every(usable));
  assert.ok(!o.some((x) => /alleen online/i.test(x.mechanism)));
  assert.equal(o.find((x) => x.title === 'Unox rookworst').price, 299);
});
realTest('hoogvliet', 'echte Hoogvliet-pagina (23 okt 2026)', (html) => {
  const o = parseHoogvliet(html);
  assert.ok(o.length >= 120, `${o.length}`);
  assert.ok(o.every(usable));
  assert.ok(!o.some((x) => /bezorging/i.test(x.mechanism || '')));
  const dc = o.find((x) => /Douwe Egberts koffiecapsules/i.test(x.title));
  assert.ok(dc && dc.price === 389, 'DE-koffiecapsules 3,89');
});
realTest('action', 'echte Action-pagina (23 okt 2026)', (html) => {
  const o = parseAction(html);
  assert.equal(o.length, 23);
  assert.equal(o.find((x) => x.title === 'Bleekspray').price, 148);
});
realTest('lidl', 'echte Lidl-pagina (23 okt 2026)', (html) => {
  const o = parseLidl(html);
  assert.ok(o.length >= 70, `${o.length}`);
  const sp = o.find((x) => x.title === 'Gewassen spinazie');
  assert.deepEqual([sp.price, sp.was], [99, 179]);
  assert.ok(o.some((x) => /Lidl Plus/.test(x.mechanism)));
});
