// Koopjes: per product op de volglijst alle aanbiedingen van deze week, met de prijs per eenheid.
// Jullie tikken "interessant" of "niet interessant"; daaruit leert de app wat een goede prijs is.

import { state, derived, setSetting, addToList, refreshOffers } from '../../data/store.js';
import { html, icon, toast, openSheet, closeSheet, esc, confirmSheet } from '../dom.js';
import { euro } from '../../core/money.js';
import { storeName } from '../../core/stores.js';
import { formatDate, localDateOf } from '../../core/dates.js';
import { WATCH_UNITS, watchHistory, weekKey, ownLastPurchase, newWatchItem, watchOffers } from '../../core/watch.js';

const hcache = { v: -1, map: new Map() };
let busy = false;

function sizeText(sz) {
  if (!sz?.amount) return '';
  if (sz.unit === 'st') return `${sz.amount} st.`;
  if (sz.unit === 'g') return sz.amount >= 1000 ? `${String(sz.amount / 1000).replace('.', ',')} kg` : `${sz.amount} g`;
  return sz.amount >= 1000 ? `${String(sz.amount / 1000).replace('.', ',')} l` : `${sz.amount} ml`;
}
const unitLabel = (item) => (WATCH_UNITS[item.unit] || WATCH_UNITS.stuk).label;
const pct = (f) => `${Math.round(f * 100)}%`;

function history(item) {
  if (hcache.v !== state.version) { hcache.v = state.version; hcache.map = new Map(); }
  if (!hcache.map.has(item.id)) {
    const d = derived();
    hcache.map.set(item.id, {
      hist: state.history?.data ? watchHistory(item, state.history.data, { today: d.today, exceptWeek: weekKey(d.today) }) : null,
      own: ownLastPurchase(item, d.facts, state.products),
    });
  }
  return hcache.map.get(item.id);
}

/** De prijs groot rechts: per eenheid als dat kan, anders per verpakking, anders alleen de actie. */
function priceBlock(x, item) {
  if (x.perUnit != null) return html`<div class="num" style="font-weight:750;font-size:18px">${euro(x.perUnit)}</div><div class="tiny muted">per ${unitLabel(item)}</div>`;
  if (x.packPrice != null) return html`<div class="num" style="font-weight:750;font-size:18px">${euro(x.packPrice)}</div><div class="tiny muted">per stuk/pak</div>`;
  return html`<div style="font-weight:700">${x.offer.mechanism || ''}</div>`;
}

function details(x) {
  const o = x.offer;
  const parts = [];
  const sz = x.size ? sizeText(x.size) : o.size && !/^(m\.u\.v|per )/i.test(o.size) ? o.size.split('·')[0].trim() : '';
  if (sz) parts.push(sz);
  if (o.mechanism && x.deal?.type !== 'prijs') parts.push(o.mechanism); // "voor 8,49" staat al groot rechts
  if (x.eff?.bundle > 1) parts.push(`bij ${x.eff.bundle} stuks`);
  if (o.validTo) parts.push(`t/m ${formatDate(o.validTo, 'short')}`);
  return parts.join(' · ');
}

function offerRow(x, item) {
  const o = x.offer;
  const r = x.rating;
  const facts = [];
  if (o.was && x.packPrice != null && o.was > x.packPrice) facts.push(`van ${euro(o.was)}`);
  if (x.perUnit == null && x.discount != null) facts.push(`${pct(x.discount)} korting`);
  if (x.perUnit == null && !x.size && x.packPrice != null) facts.push('inhoud niet vermeld');
  return html`<div class="row-item" style="align-items:flex-start;flex-wrap:wrap;gap:8px">
    <div class="grow" style="min-width:60%">
      <div class="title" style="white-space:normal">${storeName(o.store)}${x.label === 'koopje' ? html` <span class="chip good">Koopje</span>` : ''}</div>
      <div class="small" style="white-space:normal;color:var(--ink-2)">${o.title}</div>
      <div class="tiny muted" style="white-space:normal;margin-top:2px">${details(x)}${facts.length ? ` · ${facts.join(' · ')}` : ''}</div>
    </div>
    <div style="text-align:right;min-width:72px">${priceBlock(x, item)}</div>
    <div style="width:100%;display:flex;gap:8px;justify-content:flex-end">
      ${r ? html`
        <span class="chip ${r.interesting ? 'good' : ''}" style="align-self:center">${r.interesting ? 'Interessant' : 'Niet interessant'}</span>
        <button class="btn small ghost" data-action="unrate" data-key="${x.key}">Wijzig</button>
        ${r.interesting ? html`<button class="btn small" data-action="toList" data-key="${x.key}" data-w="${item.id}">${icon('plus', 14)}Op lijst</button>` : ''}`
      : html`
        <button class="btn small" data-action="rate" data-key="${x.key}" data-w="${item.id}" data-v="0">Niet interessant</button>
        <button class="btn small primary" data-action="rate" data-key="${x.key}" data-w="${item.id}" data-v="1">Interessant</button>`}
    </div>
  </div>`;
}

function footer(item) {
  const { hist, own } = history(item);
  const lines = [];
  if (own) lines.push(`Laatst zelf betaald: ${own.perUnit != null ? `${euro(own.perUnit)} per ${unitLabel(item)}` : `${euro(own.perPack)} per stuk/pak`} (${storeName(own.store)}, ${formatDate(own.date, 'short')}${own.promo ? ', met korting' : ''})`);
  if (hist?.lowest) lines.push(`Laagste sinds week ${Number(hist.firstWeek.slice(5))}: ${euro(hist.lowest.perUnit)} per ${unitLabel(item)} (${storeName(hist.lowest.store)}, week ${Number(hist.lowest.week.slice(5))})`);
  for (const r of (hist?.rhythm || []).filter((x) => x.weeks.length >= 2).slice(0, 3)) {
    lines.push(`${storeName(r.store)}: in de aanbieding in week ${r.weeks.map((w) => Number(w.slice(5))).join(', ')}${r.every ? ` (elke ±${r.every} weken)` : ''}`);
  }
  return lines.length ? html`<div class="tiny muted" style="padding:8px 2px 2px;border-top:1px solid var(--line);margin-top:4px">${lines.map((l) => html`<div>${l}</div>`)}</div>` : '';
}

function section(group) {
  const { item, offers } = group;
  const shown = offers.filter((x) => !(x.label === 'duur' && !x.rating) && x.rating?.interesting !== false);
  const hidden = offers.filter((x) => !shown.includes(x));
  return html`<div class="card tight" style="margin-bottom:12px">
    <div class="between" style="padding:6px 2px 2px"><strong>${item.name}</strong><span class="small muted">${offers.length} aanbieding${offers.length === 1 ? '' : 'en'}</span></div>
    ${shown.length ? html`<div class="rows">${shown.slice(0, 3).map((x) => offerRow(x, item))}</div>` : ''}
    ${shown.length > 3 ? html`<details style="margin:4px 2px"><summary class="small" style="color:var(--accent);font-weight:600">Nog ${shown.length - 3} aanbieding${shown.length - 3 === 1 ? '' : 'en'}</summary>
      <div class="rows">${shown.slice(3).map((x) => offerRow(x, item))}</div></details>` : ''}
    ${hidden.length ? html`<details style="margin:4px 2px"><summary class="small muted">${hidden.length} niet interessant${hidden.some((x) => !x.rating) ? ' (duurder dan wat jullie eerder afwezen)' : ''}</summary>
      <div class="rows">${hidden.map((x) => offerRow(x, item))}</div></details>` : ''}
    ${footer(item)}
  </div>`;
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

      ${todo.length ? html`<button class="big-action" data-action="swipe" style="margin-bottom:16px;width:100%;text-align:left">
        <span class="ic">${icon('tag', 22)}</span><span>${todo.length} nieuwe aanbieding${todo.length === 1 ? '' : 'en'} beoordelen<small>Interessant of niet? Daar leert de app van.</small></span></button>` : ''}

      ${withOffers.map(section)}
      ${without.length ? html`<p class="small muted" style="margin:4px 2px 14px">Deze week niet in de aanbieding: ${without.map((g) => g.item.name).join(', ')}.</p>` : ''}

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
        <div class="between"><strong style="font-size:18px">${esc(storeName(o.store))}</strong>${x.label === 'koopje' ? '<span class="chip good">Koopje</span>' : ''}</div>
        <div style="margin-top:6px">${esc(o.title)}</div>
        <div class="small muted" style="margin-top:4px">${esc(details(x))}</div>
        <div style="margin-top:14px;font-size:30px;font-weight:800" class="num">${x.perUnit != null ? `${esc(euro(x.perUnit))} <span class="small muted" style="font-weight:500">per ${esc(unitLabel(item))}</span>` : x.packPrice != null ? `${esc(euro(x.packPrice))} <span class="small muted" style="font-weight:500">per stuk/pak</span>` : esc(o.mechanism || '')}</div>
        ${o.was && x.packPrice != null && o.was > x.packPrice ? `<div class="small muted">van ${esc(euro(o.was))}</div>` : ''}
        ${x.perUnit == null && x.discount != null ? `<div class="small muted">${pct(x.discount)} korting</div>` : ''}
        ${own ? `<div class="tiny muted" style="margin-top:10px">Laatst zelf betaald: ${own.perUnit != null ? `${esc(euro(own.perUnit))} per ${esc(unitLabel(item))}` : `${esc(euro(own.perPack))} per stuk/pak`} (${esc(storeName(own.store))})</div>` : ''}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <button class="btn" data-v="0" style="padding:14px">${icon('x', 18)} Niet interessant</button>
        <button class="btn primary" data-v="1" style="padding:14px">${icon('check', 18)} Interessant</button>
      </div>
      <p class="tiny muted" style="text-align:center;margin:10px 0 0">Veeg naar rechts voor interessant, naar links voor niet.</p>`;
    const card = box.querySelector('[data-card]');
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
function editSheet() {
  const sheet = openSheet('<div data-edit></div>');
  const box = sheet.querySelector('[data-edit]');
  const list = () => state.settings.watchlist || [];
  const unitOptions = (sel) => Object.entries(WATCH_UNITS).map(([k, u]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>per ${u.label}</option>`).join('');
  const drawList = () => {
    box.innerHTML = `<h2>Volglijst</h2>
      <p class="small muted">Van deze producten zie je elke week alle aanbiedingen, in alle winkels.</p>
      <div class="rows">${list().map((w) => `<div class="row-item clickable" data-id="${esc(w.id)}"><div class="grow"><div class="title">${esc(w.name)}</div><div class="sub">zoekt op: ${esc(w.terms.join(', '))}</div></div>${icon('chevron', 16)}</div>`).join('')}</div>
      <form data-new class="gap8" style="margin-top:12px">
        <input class="input" name="name" placeholder="Product toevoegen, bv. koffiecups" required autocomplete="off">
        <select class="input" name="unit" style="width:auto">${unitOptions('stuk')}</select>
        <button class="btn primary" aria-label="Toevoegen">${icon('plus')}</button>
      </form>
      <button class="btn block" data-close style="margin-top:12px">Klaar</button>`;
    box.querySelectorAll('[data-id]').forEach((r) => { r.onclick = () => drawItem(r.dataset.id); });
    box.querySelector('[data-close]').onclick = closeSheet;
    box.querySelector('[data-new]').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const item = newWatchItem(fd.get('name'), fd.get('unit'));
      if (!item.name) return;
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
        <label class="field">Vergelijken<select class="input" name="unit">${unitOptions(w.unit)}</select></label>
        <p class="small muted" style="margin:0">Deze week: ${count} aanbieding${count === 1 ? '' : 'en'} gevonden. Een zoekwoord telt ook als begin van een langer woord ("vaatwastablet" vindt ook "vaatwastabletten").</p>
        <div class="btn-row" style="justify-content:space-between"><button type="button" class="btn danger" data-del>Verwijderen</button><div class="gap8"><button type="button" class="btn" data-back>Terug</button><button class="btn primary">Opslaan</button></div></div>
      </form>`;
    const form = box.querySelector('[data-item]');
    const split = (s) => String(s || '').split(',').map((t) => t.trim()).filter(Boolean);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const next = { ...w, name: String(fd.get('name')).trim(), terms: split(fd.get('terms')), exclude: split(fd.get('exclude')), unit: fd.get('unit') };
      if (!next.terms.length) { toast('Vul minstens één zoekwoord in'); return; }
      await setSetting('watchlist', list().map((x) => (x.id === w.id ? next : x)));
      toast('Opgeslagen');
      drawItem(w.id);
    };
    box.querySelector('[data-back]').onclick = drawList;
    box.querySelector('[data-del]').onclick = async () => {
      if (!(await confirmSheet(`${w.name} van de volglijst halen?`, 'Eerdere oordelen blijven bewaard.', { confirm: 'Verwijderen', danger: true }))) return;
      await setSetting('watchlist', list().filter((x) => x.id !== w.id));
      editSheet();
    };
  };
  drawList();
}
