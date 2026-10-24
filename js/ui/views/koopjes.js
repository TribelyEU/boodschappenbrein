// Koopjes: per product op de volglijst alle aanbiedingen van deze week, met de prijs per eenheid.
// Jullie tikken "interessant" of "niet interessant"; daaruit leert de app wat een goede prijs is.

import { state, derived, setSetting, addToList, refreshOffers } from '../../data/store.js';
import { html, icon, toast, openSheet, closeSheet, esc, confirmSheet } from '../dom.js';
import { euro } from '../../core/money.js';
import { storeName } from '../../core/stores.js';
import { formatDate, localDateOf } from '../../core/dates.js';
import { WATCH_UNITS, unitOf, unitKeyOf, watchHistory, weekKey, ownLastPurchase, newWatchItem, watchOffers, normalPriceIn, ownCandidates, refsOf, matchesEntry, MAX_REFS, entryPriceIn, matchesWatch, isExcluded, watchSuggestions } from '../../core/watch.js';
import { parseSize, detectBrand, parseOwnSize, sizeText as productSizeText } from '../../core/products.js';
import { priceStats } from '../../core/stockpile.js';
import { openDeals } from './list.js';


/** Bovenaan: wat er op jullie lijst in de aanbieding staat, en wat dat bij jullie eigen winkel kost. */
function listBlock() {
  const rows = openDeals().slice(0, 8);
  if (!rows.length) return '';
  const fav = state.settings.favoriteStore;
  const priceOf = (x) => x.offer.mechanism || (x.packPrice != null ? euro(x.packPrice) : 'aanbieding');
  return html`<div class="card" style="margin-bottom:16px">
    <h2>Op jullie lijst</h2>
    <p class="muted small">Goedkoopste aanbieding${fav ? `, en wat het bij ${storeName(fav)} kost` : ''}.</p>
    ${rows.map(({ item, deal, own }) => html`<div class="kp-row" style="padding:8px 0;border-top:1px solid var(--line, #eee)">
      <div class="grow"><div class="title" style="font-size:15px">${item.name}</div>
        <div class="tiny" style="color:var(--good);font-weight:650">${deal ? html`${icon('tag', 12)} ${storeName(deal.offer.store)}: ${priceOf(deal)}` : html`<span class="muted">Geen aanbieding</span>`}</div>
        ${fav && deal?.offer.store !== fav ? html`<div class="tiny muted">${own ? `Bij ${storeName(fav)}: ${priceOf(own)}` : `Bij ${storeName(fav)} geen aanbieding`}</div>` : ''}
      </div></div>`)}
  </div>`;
}

const hcache = { v: -1, map: new Map() };
let busy = false;

function sizeText(sz) {
  if (!sz?.amount) return '';
  if (sz.unit === 'st') return `${sz.amount} st.`;
  if (sz.unit === 'g') return sz.amount >= 1000 ? `${String(sz.amount / 1000).replace('.', ',')} kg` : `${sz.amount} g`;
  return sz.amount >= 1000 ? `${String(sz.amount / 1000).replace('.', ',')} l` : `${sz.amount} ml`;
}
const unitLabel = (item) => unitOf(item).label;
const pct = (f) => `${Math.round(f * 100)}%`;

function history(item) {
  if (hcache.v !== state.version) { hcache.v = state.version; hcache.map = new Map(); }
  if (!hcache.map.has(item.id)) {
    const d = derived();
    const priceOf = (e) => (e?.productId ? normalPriceIn(item, priceStats(d.facts, e.productId)) || entryPriceIn(item, e) : entryPriceIn(item, e));
    hcache.map.set(item.id, {
      hist: state.history?.data ? watchHistory(item, state.history.data, { today: d.today, exceptWeek: weekKey(d.today) }) : null,
      own: ownLastPurchase(item, d.facts, state.products),
      refs: refsOf(item).map((r) => ({ ...r, price: priceOf(r) })),
      equiv: (item.equiv || []).map((e) => ({ ...e, price: priceOf(e) })),
    });
  }
  return hcache.map.get(item.id);
}

const unitShort = (item) => ({ kilo: 'kg', liter: 'l', wasbeurt: 'wasbeurt', rol: 'rol', stuk: 'st', verpakking: 'pak' }[unitKeyOf(item)] || unitLabel(item));

/** Prijs rechts: per eenheid als dat kan, anders per verpakking, anders de actie. */
function priceBlock(x, item) {
  if (x.perUnit != null) return html`<div class="kp-price num">${euro(x.perUnit)}</div><div class="kp-unit">per ${unitShort(item)}</div>`;
  if (x.packPrice != null) return html`<div class="kp-price num">${euro(x.packPrice)}</div><div class="kp-unit">per pak</div>`;
  return html`<div class="kp-mech">${x.offer.mechanism || ''}</div>`;
}

function details(x) {
  const o = x.offer;
  const parts = [];
  const sz = x.choice?.sizeText || (x.size ? sizeText(x.size) : o.size && !/^(m\.u\.v|per )/i.test(o.size) ? o.size.split('·')[0].trim() : '');
  if (sz) parts.push(sz);
  if (o.mechanism && x.deal?.type !== 'prijs') parts.push(o.mechanism);
  if (o.validTo) parts.push(`t/m ${formatDate(o.validTo, 'short')}`);
  return parts.join(' · ');
}

/** Afbeelding van de winkel (laadt pas als hij in beeld komt; verdwijnt als hij niet laadt). */
function thumb(o, size = 56) {
  if (!o.image) return html`<span class="kp-thumb" style="width:${size}px;height:${size}px"></span>`;
  return html`<img class="kp-thumb" src="${o.image}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'" style="width:${size}px;height:${size}px">`;
}

/** Referentie: het product van jullie zelf als de aanbieding dat is, anders het goedkoopste wat jullie kopen. */
function refFor(x, item) {
  const refs = history(item).refs.filter((r) => r.price?.perUnit != null);
  if (!refs.length) return null;
  return refs.find((r) => matchesEntry(r, x.offer)) || [...refs].sort((a, b) => a.price.perUnit - b.price.perUnit)[0];
}

/** Klein verschil-label onder de prijs: hoeveel goedkoper/duurder per eenheid dan wat jullie normaal kopen. */
function vsRef(x, item) {
  if (x.perUnit == null) return '';
  const ref = refFor(x, item);
  if (!ref) return '';
  const diff = ref.price.perUnit - x.perUnit;
  const tip = `${ref.name}: normaal ${euro(ref.price.perUnit)} per ${unitLabel(item)}`;
  if (Math.abs(diff) < 1) return html`<span class="kp-diff" title="${tip}">gelijk</span>`;
  return html`<span class="kp-diff ${diff > 0 ? 'good' : 'warn'}" title="${tip}">${diff > 0 ? '−' : '+'}${euro(Math.abs(diff))}</span>`;
}

function offerRow(x, item) {
  const o = x.offer;
  const r = x.rating;
  const needsChoice = x.perUnit == null && unitOf(item).base && !x.choice;
  const title = o.url ? html`<a class="kp-title" href="${o.url}" target="_blank" rel="noopener noreferrer">${o.title}</a>` : html`<span class="kp-title">${o.title}</span>`;
  const pill = x.label === 'koopje' ? html`<span class="kp-pill good">Koopje</span>` : x.equiv === 'ref' ? html`<span class="kp-pill">Jullie product</span>` : '';
  const was = o.was && x.packPrice != null && o.was > x.packPrice ? html` · <s>${euro(o.was)}</s>` : '';
  return html`<div class="kp-row${r && !r.interesting ? ' dim' : ''}">
    ${thumb(o, 48)}
    <div class="kp-body">
      <div class="kp-store">${storeName(o.store)}${pill}</div>
      ${title}
      <div class="kp-meta">${details(x)}${was}</div>
      ${needsChoice ? html`<button class="kp-link" data-action="choose" data-key="${x.key}" data-w="${item.id}">Kies variant</button>`
        : x.choice ? html`<button class="kp-link muted" data-action="choose" data-key="${x.key}" data-w="${item.id}">${x.choice.name || 'Variant'} · wijzig</button>` : ''}
    </div>
    <div class="kp-right">
      ${priceBlock(x, item)}
      ${vsRef(x, item)}
      <div class="kp-actions">
        ${r ? html`
          <button class="kp-ic on ${r.interesting ? 'yes' : 'no'}" data-action="unrate" data-key="${x.key}" aria-label="Oordeel wissen" title="${r.interesting ? 'Interessant' : 'Niet interessant'} · tik om te wissen">${icon(r.interesting ? 'check' : 'x', 16)}</button>
          ${r.interesting ? html`<button class="kp-ic" data-action="toList" data-key="${x.key}" data-w="${item.id}" aria-label="Op de lijst" title="Op de lijst">${icon('plus', 16)}</button>` : ''}`
        : html`
          <button class="kp-ic" data-action="rate" data-key="${x.key}" data-w="${item.id}" data-v="0" aria-label="Niet interessant" title="Niet interessant">${icon('x', 16)}</button>
          <button class="kp-ic yes" data-action="rate" data-key="${x.key}" data-w="${item.id}" data-v="1" aria-label="Interessant" title="Interessant">${icon('check', 16)}</button>`}
      </div>
    </div>
  </div>`;
}

/** Eén regel onder de kop: wat jullie normaal betalen (goedkoopste van jullie producten). */
function refLine(item) {
  const { refs } = history(item);
  const priced = refs.filter((r) => r.price?.perUnit != null).sort((a, b) => a.price.perUnit - b.price.perUnit);
  if (!refs.length) return html`<button class="kp-link muted" data-action="editItem" data-w="${item.id}" style="margin-top:1px">+ Wat kopen jullie nu?</button>`;
  if (!priced.length) return html`<button class="kp-link warn" data-action="editItem" data-w="${item.id}">Vul de inhoud in van wat jullie kopen</button>`;
  const r = priced[0];
  return html`<span class="kp-sub">Normaal ${euro(r.price.perUnit)}/${unitShort(item)} · ${r.name}</span>`;
}

function footer(item) {
  const { hist } = history(item);
  const parts = [];
  if (hist?.lowest) parts.push(`Laagste sinds wk ${Number(hist.firstWeek.slice(5))}: ${euro(hist.lowest.perUnit)}/${unitShort(item)} bij ${storeName(hist.lowest.store)}`);
  const r = (hist?.rhythm || []).find((x) => x.every && x.weeks.length >= 2);
  if (r) parts.push(`${storeName(r.store)} elke ±${r.every} wk`);
  return parts.length ? html`<div class="kp-foot">${parts.join(' · ')}</div>` : '';
}

function section(group) {
  const { item, offers } = group;
  const shown = offers.filter((x) => !(x.label === 'duur' && !x.rating) && x.rating?.interesting !== false);
  const hidden = offers.filter((x) => !shown.includes(x));
  const best = shown.map((x) => x.perUnit).filter((v) => v != null).sort((a, b) => a - b)[0];
  return html`<section class="kp-card">
    <header class="kp-head">
      <div style="flex:1;min-width:0">
        <div class="kp-name">${item.name}</div>
        ${refLine(item)}
      </div>
      ${best != null ? html`<div class="kp-best"><span class="tiny muted">vanaf</span> <strong class="num">${euro(best)}</strong><span class="tiny muted">/${unitShort(item)}</span></div>` : ''}
      <button class="kp-ic plain" data-action="editItem" data-w="${item.id}" aria-label="Instellingen ${item.name}">${icon('settings', 16)}</button>
    </header>
    ${shown.slice(0, 3).map((x) => offerRow(x, item))}
    ${shown.length > 3 ? html`<details class="kp-more"><summary>Nog ${shown.length - 3}</summary>${shown.slice(3).map((x) => offerRow(x, item))}</details>` : ''}
    ${hidden.length ? html`<details class="kp-more"><summary class="muted">${hidden.length} verborgen</summary>${hidden.map((x) => offerRow(x, item))}</details>` : ''}
    ${footer(item)}
  </section>`;
}

/** Voorstellen: wat jullie veel kopen of waar veel geld naartoe gaat, maar nog niet volgen. */
function suggestionsBlock() {
  const d = derived();
  const list = watchSuggestions(d.facts, state.products, state.settings.watchlist || [], { today: d.today, dismissed: state.settings.watchDismissed || [] });
  if (!list.length) return '';
  const unitTxt = (u) => WATCH_UNITS[u].choice.replace(/ \(.*\)$/, '');
  return html`<section class="kp-card">
    <header class="kp-head"><div style="flex:1;min-width:0"><div class="kp-name">Ook volgen?</div><span class="kp-sub">Veel gekocht, laatste 6 maanden</span></div></header>
    ${list.map((x) => html`<div class="kp-row">
      <div class="kp-body"><div class="kp-title" style="font-weight:600;color:var(--ink)">${x.name}</div>
        <div class="kp-meta">${euro(x.spend)} · ${x.times}× · ${storeName(x.store)}</div></div>
      <div class="kp-actions">
        <button class="kp-ic" data-action="dismissSuggestion" data-id="${x.productId}" aria-label="Niet volgen" title="Niet volgen">${icon('x', 16)}</button>
        <button class="kp-ic yes" data-action="followSuggestion" data-id="${x.productId}" data-unit="${x.unit}" aria-label="Volgen" title="Volgen (${unitTxt(x.unit)})">${icon('plus', 16)}</button>
      </div>
    </div>`)}
  </section>`;
}

function unrated() {
  const out = [];
  for (const g of derived().koopjes) for (const x of g.offers) if (!x.rating && x.label !== 'duur') out.push({ x, item: g.item });
  return out;
}

export default {
  render() {
    const d = derived();
    const st = d.offerStatus;
    const groups = d.koopjes || [];
    const withOffers = groups.filter((g) => g.offers.length);
    const without = groups.filter((g) => !g.offers.length);
    const todo = unrated();
    const status = !st.ok ? (state.offers?.error ? `Ophalen lukte niet: ${state.offers.error}` : st.reason)
      : `Aanbiedingen van ${formatDate(localDateOf(st.generatedAt), 'short')}${st.stale ? ` (${st.age} dagen oud)` : ''}`;
    return html`
      <div class="page-head"><div><h1>Koopjes</h1><p class="muted">${status}</p></div>
        <button class="btn small ghost" data-action="refresh" ${busy ? 'disabled' : ''}>${busy ? html`<span class="spinner"></span>` : 'Vernieuwen'}</button></div>

      ${listBlock()}

      ${todo.length ? html`<button class="big-action" data-action="swipe" style="margin-bottom:16px;width:100%;text-align:left">
        <span class="ic">${icon('tag', 22)}</span><span>${todo.length} nieuwe aanbieding${todo.length === 1 ? '' : 'en'}<small>Snel beoordelen</small></span></button>` : ''}

      ${withOffers.map(section)}
      ${without.length ? html`<p class="tiny muted" style="margin:2px 4px 16px">Geen aanbieding: ${without.map((g) => g.item.name).join(', ')}</p>` : ''}

      ${suggestionsBlock()}
      <button class="btn block" data-action="editList">${icon('settings', 16)}Volglijst aanpassen</button>`;
  },
  actions: {
    async refresh(el, ev, { rerender }) {
      busy = true; rerender();
      const r = await refreshOffers();
      const { refreshHistory } = await import('../../data/store.js');
      await refreshHistory();
      busy = false; rerender();
      toast(r.error ? `Niet gelukt: ${r.error}` : 'Bijgewerkt');
    },
    async rate(el) { await rate(el.dataset.key, el.dataset.w, el.dataset.v === '1'); },
    async unrate(el) { await setSetting('ratings', (state.settings.ratings || []).filter((r) => r.key !== el.dataset.key)); },
    async toList(el) {
      const g = derived().koopjes.find((k) => k.item.id === el.dataset.w);
      const x = g?.offers.find((o) => o.key === el.dataset.key);
      if (!x) return;
      await addToList({ name: g.item.name, qty: x.eff?.bundle || 1, source: 'koopje', store: x.offer.store,
        note: `${storeName(x.offer.store)}: ${x.offer.title}${x.offer.mechanism ? `, ${x.offer.mechanism}` : ''}${x.offer.validTo ? ` (t/m ${formatDate(x.offer.validTo, 'short')})` : ''}` });
      toast(`${g.item.name} op de lijst`);
    },
    swipe() { swipeSheet(); },
    editList() { editSheet(); },
    editItem(el) { editSheet(el.dataset.w); },
    async followSuggestion(el) {
      const p = state.products.get(el.dataset.id);
      if (!p) return;
      const item = newWatchItem(p.name, el.dataset.unit);
      // Zoekwoord: de eerste twee betekenisvolle woorden ("Ncc forte lungo rfa" → "forte lungo", "Cola zero sugar 6 pack" → "cola zero")
      const generic = new Set(['ah', 'jumbo', 'lidl', 'dirk', 'plus', 'pack', 'pak', 'stuk', 'stuks', 'zak', 'bak', 'sugar', 'per', 'los', 'ncc']);
      const words = item.terms[0].split(' ').filter((w) => w.length >= 3 && !/\d/.test(w) && !generic.has(w));
      if (words.length) item.terms = [words.slice(0, 2).join(' ')];
      const line = state.lines.find((l) => l.productId === p.id);
      item.refs = [{ productId: p.id, name: p.name, store: line?.store || null }];
      const list = state.settings.watchlist || [];
      if (list.some((w) => w.id === item.id)) item.id = `${item.id}-${Date.now().toString(36)}`;
      await setSetting('watchlist', [...list, item]);
      toast(`${p.name} wordt gevolgd. Pas de zoekwoorden aan als het te smal of te breed is.`, { duration: 6000 });
      editSheet(item.id);
    },
    async dismissSuggestion(el) {
      await setSetting('watchDismissed', [...(state.settings.watchDismissed || []), el.dataset.id]);
    },
    choose(el) { chooseSheet(el.dataset.key, el.dataset.w); },
  },
};

async function rate(key, watchId, interesting) {
  const g = derived().koopjes.find((k) => k.item.id === watchId);
  const x = g?.offers.find((o) => o.key === key);
  if (!x) return;
  const list = (state.settings.ratings || []).filter((r) => r.key !== key);
  list.push({ key, watchId, store: x.offer.store, title: x.offer.title, perUnit: x.perUnit ?? null, discount: x.discount ?? null, interesting, week: weekKey(derived().today), at: new Date().toISOString() });
  await setSetting('ratings', list.slice(-3000));
}

// ---------- beoordelen, één kaart per keer (vegen of tikken) ----------
function swipeSheet() {
  const queue = unrated();
  let i = 0;
  const sheet = openSheet('<div data-stack></div>');
  const box = sheet.querySelector('[data-stack]');
  const draw = () => {
    if (i >= queue.length) {
      box.innerHTML = `<h2>Klaar</h2><p class="muted">Alles beoordeeld. Bij de volgende aanbiedingen herkent de app jullie goede prijzen.</p><button class="btn primary block" data-done>Sluiten</button>`;
      box.querySelector('[data-done]').onclick = closeSheet;
      return;
    }
    const { x, item } = queue[i];
    const o = x.offer;
    const { own } = history(item);
    box.innerHTML = `
      <div class="small muted" style="text-align:center">${i + 1} van ${queue.length} · ${esc(item.name)}</div>
      <div class="card" data-card style="margin:12px 0;touch-action:pan-y;transition:transform .2s;user-select:none">
        ${o.image ? `<img src="${esc(o.image)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()" draggable="false" style="display:block;width:100%;max-height:180px;object-fit:contain;margin-bottom:10px;pointer-events:none">` : ''}
        <div class="between"><strong style="font-size:18px">${esc(storeName(o.store))}</strong>${x.label === 'koopje' ? '<span class="chip good">Koopje</span>' : ''}</div>
        <div style="margin-top:6px">${esc(o.title)}</div>
        <div class="small muted" style="margin-top:4px">${esc(details(x))}</div>
        <div style="margin-top:14px;font-size:30px;font-weight:800" class="num">${x.perUnit != null ? `${esc(euro(x.perUnit))} <span class="small muted" style="font-weight:500">per ${esc(unitLabel(item))}</span>` : x.packPrice != null ? `${esc(euro(x.packPrice))} <span class="small muted" style="font-weight:500">per stuk/pak</span>` : esc(o.mechanism || '')}</div>
        ${o.was && x.packPrice != null && o.was > x.packPrice ? `<div class="small muted">van ${esc(euro(o.was))}</div>` : ''}
        ${x.perUnit == null && x.discount != null ? `<div class="small muted">${pct(x.discount)} korting</div>` : ''}
        ${x.choice ? `<div class="small" style="margin-top:8px">Gekozen: <strong>${esc(x.choice.name || x.choice.sizeText)}</strong>${x.choice.normal ? ` (normaal ${esc(euro(x.choice.normal))})` : ''} · <a href="#" data-choose>wijzig</a></div>`
          : x.perUnit == null && unitOf(item).base ? `<button type="button" class="btn small" data-choose style="margin-top:10px">Kies welke je zou nemen</button>
            <div class="tiny muted" style="margin-top:4px">Dan rekent de app de prijs per ${esc(unitLabel(item))} uit.</div>` : ''}
        ${o.url ? `<div style="margin-top:8px"><a href="${esc(o.url)}" target="_blank" rel="noopener noreferrer" class="small" style="font-weight:600">Bekijk bij ${esc(storeName(o.store))} ↗</a></div>` : ''}
        ${own ? `<div class="tiny muted" style="margin-top:10px">Laatst zelf betaald: ${own.perUnit != null ? `${esc(euro(own.perUnit))} per ${esc(unitLabel(item))}` : `${esc(euro(own.perPack))} per stuk/pak`} (${esc(storeName(own.store))})</div>` : ''}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <button class="btn" data-v="0" style="padding:14px">${icon('x', 18)} Niet interessant</button>
        <button class="btn primary" data-v="1" style="padding:14px">${icon('check', 18)} Interessant</button>
      </div>
      <p class="tiny muted" style="text-align:center;margin:10px 0 0">Veeg naar rechts voor interessant, naar links voor niet.</p>`;
    const card = box.querySelector('[data-card]');
    box.querySelector('[data-choose]')?.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); chooseSheet(x.key, item.id, { onDone: swipeSheet }); });
    box.querySelector('[data-choose]')?.addEventListener('pointerdown', (e) => e.stopPropagation());
    const answer = async (v) => {
      card.style.transform = `translateX(${v ? 120 : -120}%) rotate(${v ? 8 : -8}deg)`;
      await rate(x.key, item.id, v);
      setTimeout(() => { i++; draw(); }, 180);
    };
    box.querySelectorAll('[data-v]').forEach((b) => { b.onclick = () => answer(b.dataset.v === '1'); });
    let startX = null;
    card.addEventListener('pointerdown', (e) => { startX = e.clientX; card.style.transition = 'none'; });
    card.addEventListener('pointermove', (e) => { if (startX != null) { const dx = e.clientX - startX; card.style.transform = `translateX(${dx}px) rotate(${dx / 25}deg)`; } });
    const end = (e) => {
      if (startX == null) return;
      const dx = e.clientX - startX;
      startX = null;
      card.style.transition = 'transform .2s';
      if (Math.abs(dx) > 90) answer(dx > 0); else card.style.transform = '';
    };
    card.addEventListener('pointerup', end);
    card.addEventListener('pointercancel', end);
  };
  draw();
}

// ---------- volglijst aanpassen ----------
function editSheet(openId = null) {
  const sheet = openSheet('<div data-edit></div>');
  const box = sheet.querySelector('[data-edit]');
  const list = () => state.settings.watchlist || [];
  const unitOptions = (sel) => Object.entries(WATCH_UNITS).map(([k, u]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${u.choice}</option>`).join('');
  const drawList = () => {
    box.innerHTML = `<h2>Volglijst</h2>
      <p class="small muted">Van deze producten zie je elke week alle aanbiedingen, in alle winkels.</p>
      <div class="rows">${list().map((w) => `<div class="row-item clickable" data-id="${esc(w.id)}"><div class="grow"><div class="title">${esc(w.name)}</div><div class="sub">${esc(unitOf(w).choice)} · zoekt op: ${esc(w.terms.join(', '))}</div></div>${icon('chevron', 16)}</div>`).join('')}</div>
      <form data-new class="stack" style="margin-top:14px;background:var(--surface-2);border-radius:12px;padding:12px">
        <strong>Product toevoegen</strong>
        <label class="field">Naam<input class="input" name="name" placeholder="bv. koffiecups" required autocomplete="off"></label>
        <label class="field">Vergelijk prijs<select class="input" name="unit" required><option value="">Kies…</option>${unitOptions('')}</select></label>
        <button class="btn primary">${icon('plus', 16)}Toevoegen</button>
      </form>
      <button class="btn block" data-close style="margin-top:12px">Klaar</button>`;
    box.querySelectorAll('[data-id]').forEach((r) => { r.onclick = () => drawItem(r.dataset.id); });
    box.querySelector('[data-close]').onclick = closeSheet;
    box.querySelector('[data-new]').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const item = newWatchItem(fd.get('name'), fd.get('unit'));
      if (!item.name) return;
      if (!fd.get('unit')) { toast('Kies waarmee je de prijs vergelijkt'); return; }
      if (list().some((w) => w.id === item.id)) { toast('Staat al op de volglijst'); return; }
      await setSetting('watchlist', [...list(), item]);
      drawItem(item.id);
    };
  };
  const drawItem = (id) => {
    const w = list().find((x) => x.id === id);
    if (!w) { drawList(); return; }
    const count = watchOffers(w, state.offers?.data?.offers || [], { today: derived().today, stores: (state.settings.myStores || []).map((s) => s.id) }).offers.length;
    box.innerHTML = `<h2>${esc(w.name)}</h2>
      <form data-item class="stack" style="margin-top:8px">
        <label class="field">Naam<input class="input" name="name" value="${esc(w.name)}" required></label>
        <label class="field">Zoekwoorden (komma's ertussen)<input class="input" name="terms" value="${esc(w.terms.join(', '))}" required></label>
        <label class="field">Niet als de naam dit bevat<input class="input" name="exclude" value="${esc((w.exclude || []).join(', '))}" placeholder="bv. vochtig, jong belegen"></label>
        <label class="field">Vergelijk prijs<select class="input" name="unit">${unitOptions(unitKeyOf(w))}</select></label>
        ${equivEditor(w)}
        <p class="small muted" style="margin:0">Deze week: ${count} aanbieding${count === 1 ? '' : 'en'} gevonden. Een zoekwoord telt ook als begin van een langer woord ("vaatwastablet" vindt ook "vaatwastabletten").</p>
        <div class="btn-row" style="justify-content:space-between"><button type="button" class="btn danger" data-del>Verwijderen</button><div class="gap8"><button type="button" class="btn" data-back>Terug</button><button class="btn primary">Opslaan</button></div></div>
      </form>`;
    const form = box.querySelector('[data-item]');
    const split = (s) => String(s || '').split(',').map((t) => t.trim()).filter(Boolean);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const next = { ...w, name: String(fd.get('name')).trim(), terms: split(fd.get('terms')), exclude: split(fd.get('exclude')), unit: fd.get('unit'), onlyEquiv: fd.get('onlyEquiv') === 'on' };
      if (!next.terms.length) { toast('Vul minstens één zoekwoord in'); return; }
      await setSetting('watchlist', list().map((x) => (x.id === w.id ? next : x)));
      toast('Opgeslagen');
      drawItem(w.id);
    };
    box.querySelector('[data-back]').onclick = drawList;
    wireEquiv(box, w, () => drawItem(w.id));
    box.querySelector('[data-del]').onclick = async () => {
      if (!(await confirmSheet(`${w.name} van de volglijst halen?`, 'Eerdere oordelen blijven bewaard.', { confirm: 'Verwijderen', danger: true }))) return;
      await setSetting('watchlist', list().filter((x) => x.id !== w.id));
      editSheet();
    };
  };
  if (openId && list().some((x) => x.id === openId)) drawItem(openId); else drawList();
}

// ---------- equivalenten bewerken ----------

/** Inhoud van een eigen product (uit de bonnen of zelf ingevuld), met een veld om die in te vullen of te verbeteren. */
function sizeRow(e) {
  if (!e.productId) return e.size?.amount ? `<div class="tiny muted">inhoud: ${esc(productSizeText(e.size))}</div>` : '';
  const p = state.products.get(e.productId);
  const line = state.lines.find((l) => l.productId === e.productId && l.sizeAmount);
  const known = p?.size || (line ? { amount: line.sizeAmount, unit: line.sizeUnit } : null); // zelf ingevuld gaat voor
  return `<div class="gap8" style="margin-top:4px;align-items:center">
    <span class="tiny ${known ? 'muted' : ''}" style="${known ? '' : 'color:var(--warn);font-weight:600'};white-space:nowrap">${known ? `inhoud: ${esc(productSizeText(known))}${p?.size ? '' : ' (bon)'}` : 'inhoud onbekend'}</span>
    <input class="input small" data-psize="${esc(e.productId)}" placeholder="${known ? 'wijzig, bv. 6 x 1,5 l' : 'bv. 6 x 1,5 l'}" value="${esc(p?.size?.text || '')}" autocomplete="off" style="max-width:160px">
    <button type="button" class="btn small" data-psave="${esc(e.productId)}">Opslaan</button></div>`;
}
const STORE_IDS = ['ah', 'lidl', 'jumbo', 'dirk', 'hoogvliet', 'aldi', 'plus', 'action', 'kruidvat', 'wibra'];

function equivEditor(w) {
  const cands = ownCandidates(w, derived().facts, state.products);
  const opt = (c) => `<option value="${esc(c.productId)}">${esc(c.name)} · ${esc(storeName(c.store))} (${c.count}×)</option>`;
  return `<div style="border-top:1px solid var(--line);padding-top:10px">
    <strong>Wat jullie nu kopen</strong> <span class="tiny muted">(maximaal ${MAX_REFS})</span>
    <p class="tiny muted" style="margin:2px 0 6px">Daar vergelijkt de app elke aanbieding mee, met de normale prijs uit jullie bonnen.</p>
    ${refsOf(w).map((r, i) => `<div class="small" style="padding:4px 0"><div class="between"><span>${esc(r.name)}${r.store ? ` · ${esc(storeName(r.store))}` : ''}</span><button type="button" class="icon-btn" data-refdel="${i}" aria-label="Verwijderen">${icon('trash', 16)}</button></div>${sizeRow(r)}</div>`).join('')}
    ${refsOf(w).length < MAX_REFS && cands.length ? `<select class="input" data-ref style="margin-top:4px"><option value="">${refsOf(w).length ? 'Nog een toevoegen…' : 'Kies uit jullie aankopen…'}</option>${cands.filter((c) => !refsOf(w).some((r) => r.productId === c.productId)).map(opt).join('')}</select>` : ''}
    ${!cands.length ? '<p class="tiny muted" style="margin:4px 0 0">Nog niets gevonden in jullie bonnen dat bij de zoekwoorden past.</p>' : ''}
    <div style="margin-top:12px"><strong>Gelijkwaardig</strong></div>
    <p class="tiny muted" style="margin:2px 0 6px">Huismerken of andere merken die voor jullie hetzelfde zijn, bijvoorbeeld Lidl Freeway cola zero naast AH cola zero.</p>
    ${(w.equiv || []).map((e, i) => `<div class="small" style="padding:4px 0"><div class="between"><span>${esc(e.name)}${e.store ? ` · ${esc(storeName(e.store))}` : ''}</span><button type="button" class="icon-btn" data-eqdel="${i}" aria-label="Verwijderen">${icon('trash', 16)}</button></div>${sizeRow(e)}</div>`).join('')}
    ${cands.length ? `<select class="input" data-eqpick style="margin-top:4px"><option value="">Toevoegen uit jullie aankopen…</option>${cands.map(opt).join('')}</select>` : ''}
    <div class="gap8" style="margin-top:6px">
      <input class="input" data-eqname placeholder="Of typ een naam, bv. Freeway cola zero" autocomplete="off">
      <select class="input" data-eqstore style="width:auto">${STORE_IDS.map((id) => `<option value="${id}">${esc(storeName(id))}</option>`).join('')}</select>
      <button type="button" class="btn" data-eqadd aria-label="Toevoegen">${icon('plus', 16)}</button>
    </div>
    <button type="button" class="btn block" data-suggest style="margin-top:10px">${icon('search', 16)}Voorstellen uit het supermarktassortiment</button>
    <div data-suggestions></div>
    <label class="gap8 small" style="margin-top:10px"><input type="checkbox" name="onlyEquiv" ${w.onlyEquiv ? 'checked' : ''}> Alleen aanbiedingen van wat jullie kopen en gelijkwaardige producten tonen</label>
  </div>`;
}

function wireEquiv(box, w, redraw) {
  const save = async (patch) => {
    const list = state.settings.watchlist || [];
    await setSetting('watchlist', list.map((x) => (x.id === w.id ? { ...x, ...patch } : x)));
    Object.assign(w, patch);
    redraw();
  };
  const entryFor = (pid) => {
    const c = ownCandidates(w, derived().facts, state.products).find((x) => x.productId === pid);
    return c ? { productId: c.productId, name: c.name, store: c.store } : null;
  };
  box.querySelector('[data-ref]')?.addEventListener('change', (e) => {
    const en = e.target.value && entryFor(e.target.value);
    if (en) save({ refs: [...refsOf(w), en].slice(0, MAX_REFS), ref: null });
  });
  box.querySelectorAll('[data-refdel]').forEach((b) => b.addEventListener('click', () => {
    const refs = [...refsOf(w)];
    refs.splice(+b.dataset.refdel, 1);
    save({ refs, ref: null });
  }));
  box.querySelector('[data-eqpick]')?.addEventListener('change', (e) => {
    const en = e.target.value && entryFor(e.target.value);
    if (en && !(w.equiv || []).some((x) => x.productId === en.productId)) save({ equiv: [...(w.equiv || []), en] });
  });
  box.querySelector('[data-eqadd]')?.addEventListener('click', () => {
    const name = box.querySelector('[data-eqname]').value.trim();
    if (!name) { toast('Typ eerst een naam'); return; }
    save({ equiv: [...(w.equiv || []), { name, store: box.querySelector('[data-eqstore]').value }] });
  });
  box.querySelector('[data-suggest]')?.addEventListener('click', () => showSuggestions(box, w, save));
  box.querySelectorAll('[data-psave]').forEach((b) => b.addEventListener('click', async () => {
    const pid = b.dataset.psave;
    const v = box.querySelector(`[data-psize="${CSS.escape(pid)}"]`).value.trim();
    const size = parseOwnSize(v);
    if (v && !size) { toast('Inhoud niet herkend; schrijf bijvoorbeeld 6 x 1,5 l of 300 g'); return; }
    const { updateProduct } = await import('../../data/store.js');
    await updateProduct(pid, { size: size || null });
    toast(size ? `Inhoud opgeslagen: ${productSizeText(size)}` : 'Inhoud gewist');
    redraw();
  }));
  box.querySelectorAll('[data-eqdel]').forEach((b) => b.addEventListener('click', () => {
    const eq = [...(w.equiv || [])];
    eq.splice(+b.dataset.eqdel, 1);
    save({ equiv: eq });
  }));
}

// ---------- voorstellen uit het assortiment ----------
let assortmentIdx = null;
let sugState = null; // { id, groups, title } zodat de lijst open blijft na een keuze

async function getAssortment() {
  if (assortmentIdx) return assortmentIdx;
  const { loadAssortment } = await import('../../data/store.js');
  const { indexAssortment } = await import('../../core/assortment.js');
  const rec = await loadAssortment();
  assortmentIdx = { idx: indexAssortment(rec.stores), fetchedAt: rec.fetchedAt, stale: rec.stale };
  return assortmentIdx;
}

function refSize(w) {
  const d = derived();
  for (const r of refsOf(w)) {
    if (r.size?.amount) return r.size;
    if (r.productId) { const st = priceStats(d.facts, r.productId); if (st.packSize) return st.packSize; }
    const p = parseSize(r.name);
    if (p) return { amount: p.amount, unit: p.unit };
  }
  return null;
}

async function showSuggestions(box, w, save) {
  const area = box.querySelector('[data-suggestions]');
  area.innerHTML = '<p class="small muted" style="margin:8px 0"><span class="spinner"></span> Assortiment laden (eenmalig per week, ±2 MB)…</p>';
  let A;
  try { A = await getAssortment(); } catch (e) { area.innerHTML = `<div class="notice bad small" style="margin-top:8px">${esc(e.message)}</div>`; return; }
  const { suggestEquivalents, searchAssortment, ASSORTMENT_STORES } = await import('../../core/assortment.js');
  const refs = refsOf(w);
  const query = !/[\/]/.test(w.name) ? w.name : (refs[0]?.name || w.terms[0]);
  const size = refSize(w);
  const preferHouse = !refs.length || refs.some((r) => detectBrand(r.name).house || /^(ah|jumbo|lidl|dirk|hoogvliet|plus)$/.test(r.store || '') && /^(ah|jumbo|1 de beste|g.?woon|plus|hoogvliet)\b/i.test(r.name));
  const stores = ASSORTMENT_STORES.filter((s) => (state.settings.myStores || []).some((m) => m.id === s));
  const has = (r, store) => [...(w.equiv || []), ...refs].some((e) => e.store === store && e.name === r.name && (e.price == null || e.price === r.price));
  const sizeTxt = (r) => r.sizeText || '';
  const unitTxt = (r) => { const p = entryPriceIn(w, { price: r.price, size: r.sizeAmount ? { amount: r.sizeAmount, unit: r.sizeUnit, count: parseSize(r.sizeText || r.name)?.count } : null }); return p?.perUnit != null ? ` · ${euro(p.perUnit)} per ${unitLabel(w)}` : ''; };
  const render = (groups, title) => `
    <div class="small muted" style="margin:10px 0 4px">${title}</div>
    ${groups.length ? groups.map((g) => `<div style="margin-top:6px"><strong class="small">${esc(storeName(g.store))}</strong>
      ${g.results.map((r, i) => `<div class="small" style="padding:6px 0;border-bottom:1px solid var(--line)">
        <div>${esc(r.name)}</div><div class="tiny muted">${esc(sizeTxt(r))}${sizeTxt(r) ? ' · ' : ''}${esc(euro(r.price))}${unitTxt(r)}${r.sameSize ? ' · zelfde inhoud' : ''}</div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px">${has(r, g.store) ? '<span class="chip good">Toegevoegd</span>'
          : `${refs.length < MAX_REFS ? `<button type="button" class="btn small ghost" data-pick="ref" data-s="${esc(g.store)}" data-i="${i}">Kopen wij</button>` : ''}<button type="button" class="btn small" data-pick="equiv" data-s="${esc(g.store)}" data-i="${i}">${icon('plus', 14)}Gelijkwaardig</button>`}</div>
      </div>`).join('')}</div>`).join('') : '<p class="small muted">Niets gevonden.</p>'}`;
  const resume = sugState?.id === w.id;
  let groups = resume ? sugState.groups : suggestEquivalents(A.idx, query, { size, preferHouse, stores });
  const draw = (title) => {
    sugState = { id: w.id, groups, title };
    area.innerHTML = `
      <div data-asearch class="gap8" style="margin-top:10px"><input class="input" data-q placeholder="Zelf zoeken, bv. cola zero 1,5 liter" autocomplete="off" enterkeyhint="search"><button type="button" class="btn" data-go aria-label="Zoeken">${icon('search', 16)}</button></div>
      ${render(groups, title)}
      <p class="tiny muted" style="margin-top:8px">Gewone winkelprijzen uit de open data van Checkjebon.nl (bijgewerkt ${esc(formatDate(localDateOf(A.fetchedAt), 'short'))}${A.stale ? ', kon nu niet vernieuwen' : ''}). Geen aanbiedingen. Controleer of het echt hetzelfde product is.</p>`;
    // (geen <form>: dit staat al binnen het formulier van het volgproduct)
    const run = () => {
      const q = area.querySelector('[data-q]').value.trim();
      if (!q) return;
      groups = searchAssortment(A.idx, q, { stores });
      draw(`Zoekresultaten voor “${esc(q)}”`);
    };
    area.querySelector('[data-go]').onclick = run;
    area.querySelector('[data-q]').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } };
    area.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', async () => {
      const g = groups.find((x) => x.store === b.dataset.s);
      const r = g?.results[+b.dataset.i];
      if (!r) return;
      const entry = { name: r.name, store: g.store, price: r.price, size: r.sizeAmount ? { amount: r.sizeAmount, unit: r.sizeUnit, count: parseSize(r.sizeText || r.name)?.count || 1 } : null, source: 'assortiment', priceDate: A.fetchedAt.slice(0, 10) };
      if (b.dataset.pick === 'ref') await save({ refs: [...refsOf(w), entry].slice(0, MAX_REFS), ref: null });
      else await save({ equiv: [...(w.equiv || []), entry] });
      toast(b.dataset.pick === 'ref' ? 'Toegevoegd bij "Wat jullie nu kopen"' : 'Toegevoegd als gelijkwaardig');
      // Het scherm is opnieuw opgebouwd: voorstellen weer tonen op dezelfde plek
      const again = document.querySelector('.sheet [data-suggest]');
      if (again) { again.click(); setTimeout(() => document.querySelector('.sheet [data-suggestions]')?.scrollIntoView({ block: 'start' }), 60); }
    }));
  };
  if (resume) { draw(sugState.title); return; }
  draw(`Voorstellen voor “${esc(query)}”${size ? ` (${size.unit === 'g' ? `${size.amount} g` : size.unit === 'ml' ? `${size.amount / 1000} l`.replace('.', ',') : `${size.amount} st.`})` : ''}`);
}

// ---------- variant kiezen bij een aanbieding ----------
async function saveChoice(key, choice) {
  const all = { ...(state.settings.offerChoices || {}) };
  if (choice) all[key] = choice; else delete all[key];
  // Oude keuzes (verlopen acties) opruimen: de sleutel bevat de einddatum
  const today = derived().today;
  for (const k of Object.keys(all)) { const end = k.split('|').pop(); if (end && end < today) delete all[k]; }
  await setSetting('offerChoices', all);
}

async function chooseSheet(key, watchId, { onDone = null } = {}) {
  const done = () => { closeSheet(); if (onDone) setTimeout(onDone, 50); };
  const g = derived().koopjes.find((k) => k.item.id === watchId);
  const x = g?.offers.find((o) => o.key === key);
  if (!x) return;
  const item = g.item;
  const o = x.offer;
  const { sizeOptionsOf } = await import('../../core/watch.js');
  const unit = unitOf(item);
  const sizeLbl = (sz) => (sz.unit === 'g' ? (sz.amount >= 1000 ? `${String(sz.amount / 1000).replace('.', ',')} kg` : `${sz.amount} gram`) : sz.unit === 'ml' ? (sz.amount >= 1000 ? `${String(sz.amount / 1000).replace('.', ',')} liter` : `${sz.amount} ml`) : `${sz.amount} stuks`);
  const opts = sizeOptionsOf(o).filter((sz) => sz.unit === unit.base);
  const needsPrice = x.deal && x.deal.type !== 'prijs' && x.deal.type !== 'xvoor' && o.was == null;
  const sheet = openSheet(`<h2>Welke zou je nemen?</h2>
    <p class="small muted">${esc(storeName(o.store))} · ${esc(o.title)}${o.mechanism ? ` · ${esc(o.mechanism)}` : ''}</p>
    ${opts.length && !needsPrice ? `<div class="small" style="margin-top:8px"><strong>Uit de actie</strong></div>
      <div class="btn-row" style="margin-top:6px">${opts.map((sz, i) => `<button class="btn small" data-size="${i}">${esc(sizeLbl(sz))}</button>`).join('')}</div>` : ''}
    <div class="small" style="margin-top:12px"><strong>Uit het assortiment van ${esc(storeName(o.store))}</strong>${needsPrice ? ' <span class="muted">(nodig: deze actie noemt geen prijs)</span>' : ''}</div>
    <div data-list><p class="small muted"><span class="spinner"></span> Laden…</p></div>
    <div class="small" style="margin-top:12px"><strong>Of vul zelf in</strong> <span class="muted">(bv. wat je in de app van de winkel ziet)</span></div>
    <div class="gap8" style="margin-top:6px">
      <input class="input" data-own-size placeholder="Inhoud, bv. 300 g" autocomplete="off" value="${esc(x.choice?.sizeText || '')}">
      <input class="input num" data-own-price inputmode="decimal" placeholder="Normale prijs" style="width:120px" value="${x.choice?.normal ? (x.choice.normal / 100).toFixed(2).replace('.', ',') : ''}">
      <button class="btn" data-own aria-label="Opslaan">${icon('check', 16)}</button>
    </div>
    <div class="btn-row" style="margin-top:12px;justify-content:space-between">${x.choice ? '<button class="btn danger small" data-clear>Keuze wissen</button>' : '<span></span>'}<button class="btn" data-close>Sluiten</button></div>`);
  sheet.querySelector('[data-close]').onclick = done;
  sheet.querySelector('[data-clear]')?.addEventListener('click', async () => { await saveChoice(key, null); done(); });
  sheet.querySelectorAll('[data-size]').forEach((b) => b.addEventListener('click', async () => {
    const sz = opts[+b.dataset.size];
    await saveChoice(key, { name: sizeLbl(sz), sizeText: sizeLbl(sz) });
    done();
    toast('Gekozen');
  }));
  sheet.querySelector('[data-own]').addEventListener('click', async () => {
    const sizeText = sheet.querySelector('[data-own-size]').value.trim();
    const p = sheet.querySelector('[data-own-price]').value.trim().replace(',', '.');
    const normal = p ? Math.round(parseFloat(p) * 100) : null;
    if (!sizeText && !normal) { toast('Vul de inhoud en/of de normale prijs in'); return; }
    if (sizeText && !parseSize(sizeText)) { toast('Inhoud niet herkend; schrijf bijvoorbeeld 300 g of 1,5 liter'); return; }
    const picked = sheet.querySelector('[data-own-size]').dataset.name;
    await saveChoice(key, { name: picked ? `${picked} (${sizeText})` : sizeText || 'eigen invoer', sizeText, normal: Number.isFinite(normal) ? normal : null });
    done();
    toast('Gekozen');
  });
  const list = sheet.querySelector('[data-list]');
  let A;
  try { A = await getAssortment(); } catch (e) { list.innerHTML = `<p class="small muted">${esc(e.message)}</p>`; return; }
  const { suggestEquivalents } = await import('../../core/assortment.js');
  // Zoek op de actietitel zonder "Alle"/winkelnaam, en op het volgproduct zelf
  const cleanTitle = o.title.replace(/^alle\s+/i, '').replace(/\*+$/, '');
  const seen = new Set();
  const rows = [];
  // 1. Producten die onder de actie zelf vallen (woorden van de titel, met merk)
  const { productsForOffer } = await import('../../core/assortment.js');
  for (const r of productsForOffer(A.idx, o)) {
    if (isExcluded(item, r.name)) continue;
    seen.add(r.name + r.price);
    rows.push(r);
  }
  // 2. Niets gevonden? Dan breder zoeken op het volgproduct
  // "AH Gehakt 300 gram en AH Terra plantaardig rulgehakt 200 gram" → beide delen apart, plus de zoekwoorden van het volgproduct
  const parts = cleanTitle.split(/\s+(?:en|of)\s+|,\s*/i).map((t) => t.trim()).filter((t) => t.length > 2);
  if (!rows.length) for (const q of [...new Set([cleanTitle, ...parts, item.name, ...(item.terms || [])])]) {
    for (const grp of suggestEquivalents(A.idx, q, { stores: [o.store], perStore: 8 })) {
      for (const r of grp.results) {
        if (seen.has(r.name + r.price)) continue;
        if (!matchesWatch(item, { title: r.name })) continue; // geen gehaktballen bij "gehakt
        seen.add(r.name + r.price);
        rows.push(r);
      }
    }
  }
  if (!rows.length) { list.innerHTML = '<p class="small muted">Niets gevonden in het assortiment van deze winkel.</p>'; return; }
  // Producten met een inhoud die in de actie staat ("300 gram") eerst
  const inOffer = (r) => sizeOptionsOf(o).some((sz) => sz.unit === r.sizeUnit && Math.abs(sz.amount - r.sizeAmount) <= 1);
  rows.sort((a, b) => inOffer(b) - inOffer(a));
  // Past de inhoud niet bij de vergelijkingseenheid (bananen "5 stuks" terwijl je per kilo vergelijkt)? Dan wel tonen,
  // maar na kiezen het gewicht laten invullen.
  const fits = (r) => !unit.base || unit.base === 'st' || (r.sizeUnit === unit.base && r.sizeAmount);
  const unitWord = unit.base === 'g' ? 'het gewicht, bv. 1 kg' : unit.base === 'ml' ? 'de inhoud, bv. 1,5 l' : 'de inhoud';
  list.innerHTML = rows.slice(0, 15).map((r, i) => `<div class="between small" style="padding:6px 0;border-bottom:1px solid var(--line);gap:8px">
    <div style="min-width:0"><div>${esc(r.name)}</div><div class="tiny muted">${esc(r.sizeText || 'inhoud onbekend')} · normaal ${esc(euro(r.price))} (Checkjebon)${fits(r) ? '' : ` · <span style="color:var(--warn)">vul daarna ${esc(unitWord)} in</span>`}</div></div>
    <button class="btn small" data-pick="${i}">Deze</button></div>`).join('');
  list.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', async () => {
    const r = rows[+b.dataset.pick];
    if (!fits(r)) {
      // Naam en prijs overnemen in "Of vul zelf in"; alleen de inhoud nog invullen
      const sizeIn = sheet.querySelector('[data-own-size]');
      sheet.querySelector('[data-own-price]').value = (r.price / 100).toFixed(2).replace('.', ',');
      sizeIn.dataset.name = r.name;
      sizeIn.placeholder = unit.base === 'g' ? 'Gewicht, bv. 1 kg' : 'Inhoud, bv. 1,5 l';
      sizeIn.focus();
      sizeIn.scrollIntoView({ block: 'center' });
      toast(`Vul ${unitWord} in en tik op ✓`);
      return;
    }
    await saveChoice(key, { name: r.name, sizeText: r.sizeText || (r.sizeAmount ? sizeLbl({ amount: r.sizeAmount, unit: r.sizeUnit }) : ''), normal: r.price });
    done();
    toast('Gekozen');
  }));
}
