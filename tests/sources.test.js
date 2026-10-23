// Tests voor het wekelijkse aanbiedingen-script (met nagebootste antwoorden; geen internet nodig).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAh, parseAhSection, parseFolderz, fetchFolderz } from '../scripts/offer-sources.mjs';
import { parseMechanism } from '../js/core/offers.js';

const AH_META = { periods: [{ bonusStartDate: '2026-10-19', bonusEndDate: '2026-10-25', tabs: [{ urlMetadataList: [
  { bonusType: 'NATIONAL', description: 'Zuivel' }, { bonusType: 'NATIONAL', description: 'Huishouden' }, { bonusType: 'PERSONAL', description: 'Voor jou' },
] }] }] };
const AH_SECTIONS = {
  Zuivel: { bonusGroupOrProducts: [
    { product: { webshopId: 1525, title: 'AH Halfvolle melk', brand: 'AH', salesUnitSize: '1 l', currentPrice: 0.99, priceBeforeBonus: 1.29, bonusMechanism: '25% korting' } },
    { bonusGroup: { id: 'g1', segmentDescription: 'Alle Optimel', discountDescription: '2e halve prijs', exampleFromPrice: 2.29, exampleForPrice: 1.72, products: [] } },
  ] },
  Huishouden: { bonusGroupOrProducts: [
    { bonusGroup: { id: 'g2', segmentDescription: 'Page toiletpapier', discountDescription: '1 + 1 gratis', products: [
      { webshopId: 9, title: 'Page Kussenzacht toiletpapier', brand: 'Page', salesUnitSize: '12 rollen', currentPrice: 8.49, priceBeforeBonus: 8.49 },
    ] } },
  ] },
};

function mockFetch(calls) {
  return async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', headers: opts.headers || {} });
    const u = new URL(url);
    const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
    if (u.pathname.endsWith('/token/anonymous')) return json({ access_token: 'tok', refresh_token: 'r' });
    if (u.pathname.endsWith('/bonuspage/v3/metadata')) return json(AH_META);
    if (u.pathname.endsWith('/bonuspage/v2/section')) return json(AH_SECTIONS[u.searchParams.get('category')] || {});
    return json({}, 404);
  };
}

test('AH: anoniem token, bonusweek, categorieën en productgroepen', async () => {
  const calls = [];
  const res = await fetchAh(mockFetch(calls), { today: '2026-10-21' });
  assert.deepEqual(res.period, { start: '2026-10-19', end: '2026-10-25' });
  assert.equal(calls[0].method, 'POST');
  assert.ok(calls.slice(1).every((c) => c.headers.Authorization === 'Bearer tok'));
  assert.ok(!calls.some((c) => /Voor%20jou|Voor\+jou/.test(c.url)), 'persoonlijke bonus wordt niet opgehaald');
  const melk = res.offers.find((o) => o.title === 'AH Halfvolle melk');
  assert.deepEqual([melk.price, melk.was, melk.size, melk.validTo], [99, 129, '1 l', '2026-10-25']);
  assert.equal(melk.url, 'https://www.ah.nl/producten/product/wi1525');
  const page = res.offers.find((o) => /Page/.test(o.title));
  assert.equal(page.mechanism, '1 + 1 gratis', 'actie van de groep geldt voor het product');
  const opt = res.offers.find((o) => o.title === 'Alle Optimel');
  assert.ok(opt.group);
  assert.deepEqual(parseMechanism(opt.mechanism), { type: 'tweedehalf' });
});

test('Folderz: JSON-LD-pagina', () => {
  const html = `<html><script type="application/ld+json">${JSON.stringify({ '@type': 'ItemList', itemListElement: [
    { '@type': 'Product', name: 'Kruidvat koffiepads', offers: { '@type': 'Offer', price: '10.00', priceValidUntil: '2026-10-25' } },
    { '@type': 'Product', name: 'Robijn Advanced Quickwash', offers: { price: 5.99, highPrice: 18.99 } },
  ] })}</script></html>`;
  const r = parseFolderz(html, 'kruidvat', '2026-10-23');
  assert.equal(r.method, 'json');
  assert.equal(r.offers.length, 2);
  assert.deepEqual([r.offers[0].price, r.offers[0].validTo], [1000, '2026-10-25']);
  assert.equal(r.offers[1].was, 1899);
});

test('Folderz: HTML-blokken met prijs, normale prijs, label en geldigheid', () => {
  const block = (name, offer, normal, badge, date) => `<a href="#"><div class="product"><div class="product__name">${name}</div>
    <div class="product__price-offer">€ ${offer}</div>${normal ? `<div class="product__price-normal">€ ${normal}</div>` : ''}
    ${badge ? `<div class="badge badge--secondary">${badge}</div>` : ''}<div class="product-date">${date}</div></div></a>`;
  const html = `<html><body>${block('Kruidvat Page toiletpapier 24 rollen', '9,99', '15,98', '2E HALVE PRIJS', 'Nog 4 dagen')}
    ${block('NIVEA deodorant &amp; douche', '10,00', '32,76', '4 VOOR 10.00', 'Nog 2 dagen')}
    ${block('Losse col', '4,99', null, null, '1 week')}</body></html>`;
  const r = parseFolderz(html, 'kruidvat', '2026-10-23');
  assert.equal(r.method, 'html');
  assert.equal(r.offers.length, 3);
  const tp = r.offers[0];
  assert.equal(tp.title, 'Page toiletpapier 24 rollen', 'winkelnaam vooraan wordt weggehaald');
  assert.deepEqual([tp.price, tp.was, tp.mechanism, tp.validTo], [999, 1598, '2E HALVE PRIJS', '2026-10-27']);
  assert.equal(r.offers[1].title, 'NIVEA deodorant & douche');
  assert.equal(r.offers[2].validTo, '2026-10-30');
});

test('Folderz: lege of onbekende pagina geeft 0 en bewaart de HTML voor diagnose', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => '<html><body>nieuw ontwerp</body></html>' });
  const r = await fetchFolderz(fetchImpl, 'wibra', { today: '2026-10-23' });
  assert.equal(r.offers.length, 0);
  assert.ok(r.html.includes('nieuw ontwerp'));
});

test('Folderz: probeert alternatieve adressen bij 404', async () => {
  const tried = [];
  const fetchImpl = async (url) => { tried.push(url); return url.includes('/dirk/') ? { ok: false, status: 404 } : { ok: true, status: 200, text: async () => '<html></html>' }; };
  const r = await fetchFolderz(fetchImpl, 'dirk', { today: '2026-10-23' });
  assert.equal(r.slug, 'dirk-van-den-broek');
  assert.equal(tried.length, 2);
});

test('AH-sectie zonder inhoud geeft geen fouten', () => {
  assert.deepEqual(parseAhSection({}, {}), []);
  assert.deepEqual(parseAhSection(null, {}), []);
});
