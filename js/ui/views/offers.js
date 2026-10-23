// Prijzen → Aanbiedingen: de folders van deze week, vergeleken met jullie eigen aankopen.

import { state, derived, refreshOffers, addToList } from '../../data/store.js';
import { html, icon, toast } from '../dom.js';
import { euro } from '../../core/money.js';
import { storeName } from '../../core/stores.js';
import { formatDate, localDateOf } from '../../core/dates.js';
import { normalizeText } from '../../core/text.js';
import { tag, empty, sectionHead } from '../components.js';

let busy = false;
let query = '';

function itemRow(it) {
  const o = it.offer;
  const sub = [
    o.mechanism || (o.price != null ? `voor ${euro(o.price)}` : ''),
    it.effBase != null ? `${euro(it.effBase)} per ${it.unitLabel}` : '',
    it.daysLeft != null && it.daysLeft <= 2 ? (it.daysLeft <= 0 ? 'laatste dag' : `nog ${it.daysLeft} dagen`) : '',
  ].filter(Boolean).join(' · ');
  return html`<div class="row-item" style="align-items:flex-start;flex-wrap:wrap">
    <div class="grow" style="min-width:58%">
      <div class="title" style="white-space:normal">${it.name}${it.brandMatch === false ? html` <span class="chip warn">ander merk</span>` : ''}</div>
      <div class="sub" style="white-space:normal">${o.title} · ${sub}</div>
      ${it.kind === 'inslag' || it.needSoon ? html`<div class="tiny" style="margin-top:3px;color:var(--good);font-weight:650">${it.kind === 'inslag' ? 'Inslaan' : 'Heb je deze week nodig'}</div>` : ''}
    </div>
    <div style="text-align:right">
      <div class="amount num" style="color:var(--good)">±${euro(it.saving)}</div>
      <button class="btn small" style="margin-top:6px" data-action="offerToList" data-key="${it.productId}|${o.id}">${icon('plus', 14)}${it.qty || 1}</button>
    </div>
  </div>`;
}

function searchResults() {
  const data = state.offers?.data;
  if (!query || !data?.offers?.length) return '';
  const q = normalizeText(query);
  const mine = new Set((state.settings.myStores || []).map((s) => s.id));
  const res = data.offers.filter((o) => mine.has(o.store) && normalizeText(`${o.title} ${o.brand || ''}`).includes(q)).slice(0, 40);
  return html`<div class="card tight" style="margin-top:10px">${res.length ? html`<div class="rows">${res.map((o) => html`
    <div class="row-item"><div class="grow"><div class="title" style="white-space:normal">${o.title}</div>
      <div class="sub">${storeName(o.store)}${o.mechanism ? ` · ${o.mechanism}` : ''}${o.size ? ` · ${o.size}` : ''}${o.validTo ? ` · t/m ${formatDate(o.validTo, 'short')}` : ''}</div></div>
      <div style="text-align:right"><div class="amount num">${o.price != null ? euro(o.price) : '–'}</div>${o.was ? html`<div class="tiny muted num" style="text-decoration:line-through">${euro(o.was)}</div>` : ''}</div>
    </div>`)}</div>` : html`<p class="muted" style="padding:6px">Niets gevonden voor “${query}”.</p>`}</div>`;
}

/** Korte statusregel: van wanneer de Bonus is, en vernieuwen. Details per winkel achter het i-knopje. */
function statusLine() {
  const d = derived();
  const rec = state.offers;
  const st = d.offerStatus;
  const ah = st.ok ? st.sources?.ah : null;
  const text = !st.ok ? (rec?.error ? `Ophalen lukte niet: ${rec.error}` : st.reason || 'Nog geen aanbiedingen.')
    : ah?.period ? `AH-Bonus ${formatDate(ah.period.start, 'short')} t/m ${formatDate(ah.period.end, 'short')} · ${st.count} acties`
      : `Bijgewerkt ${formatDate(localDateOf(st.generatedAt), 'short')} · ${st.count} acties`;
  return html`<div class="between small" style="color:var(--muted);margin:-2px 2px 10px">
    <span>${st.ok && st.stale ? html`<span style="color:var(--warn)">${text} (${st.age} dagen oud)</span>` : text}</span>
    <button class="btn small ghost" data-action="refreshOffers" ${busy ? 'disabled' : ''}>${busy ? html`<span class="spinner"></span>` : 'Vernieuwen'}</button>
  </div>`;
}

const OFFERS_INFO = `<p>Elke ochtend haalt een klein script op GitHub de Bonus-aanbiedingen van Albert Heijn op. Jullie aankopen gaan daar nooit naartoe: de vergelijking gebeurt op deze telefoon.</p>
<p>Je ziet alleen acties die voor jullie echt goedkoper zijn dan wat jullie normaal betalen. Het bedrag is de besparing voor de voorgestelde hoeveelheid.</p>
<p>Voor Lidl, Kruidvat en andere winkels is er geen bron die automatisch ophalen toestaat. Zie je daar iets goeds, tik dan bij een inslagproduct op <strong>Aanbieding beoordelen</strong>.</p>`;

/** Sectie "Deze week in de Bonus" voor het Aanbiedingen-scherm (of een korte versie voor Vandaag). */
export function offersSection({ compact = false } = {}) {
  const d = derived();
  const w = d.weekly;
  const items = w?.items || [];
  if (compact) {
    if (!items.length) return '';
    return html`<div class="card">
      <div class="quiet-line"><strong>Deze week voordelig</strong><span class="num" style="color:var(--good);font-weight:700">±${euro(w.total)}</span></div>
      <div class="rows" style="margin-top:6px">${items.slice(0, 3).map((it) => html`
        <div class="row-item clickable" data-action="nav" data-to="aanbiedingen">
          <div class="grow"><div class="title">${it.name}</div><div class="sub">${storeName(it.offer.store)} · ${it.offer.mechanism || 'aanbieding'}</div></div>
          <span class="num" style="color:var(--good);font-weight:650">±${euro(it.saving)}</span>
        </div>`)}</div>
      ${items.length > 3 ? html`<a class="link small" href="#/aanbiedingen" style="display:block;margin-top:8px">Nog ${items.length - 3} aanbiedingen →</a>` : ''}
    </div>`;
  }
  return html`
    ${sectionHead('Deze week voor jullie', { infoTitle: 'Over de aanbiedingen', infoBody: OFFERS_INFO })}
    ${statusLine()}
    ${items.length ? html`
      ${[...w.byStore.entries()].map(([store, list]) => html`
        <div class="card tight" style="margin-bottom:12px">
          <div class="between" style="padding:6px 2px 2px"><strong>${storeName(store)} · <span style="color:var(--good)">±${euro(list.reduce((t, x) => t + x.saving, 0))}</span></strong>
            <button class="btn small ghost" data-action="storeToList" data-store="${store}">Alles op lijst</button></div>
          <div class="rows">${list.map(itemRow)}</div>
        </div>`)}`
      : html`<div class="card"><p class="muted" style="margin:0">${d.offerStatus.ok ? 'Geen acties die duidelijk goedkoper zijn dan wat jullie normaal betalen. Hoe meer bonnen, hoe beter de app dit ziet.' : 'Zodra de aanbiedingen binnen zijn, zie je hier wat voor jullie interessant is.'}</p></div>`}
    ${state.offers?.data?.offers?.length ? html`
      <form class="searchbox" data-submit="offerSearch" style="margin-top:12px">${icon('search', 20)}<input class="input" name="q" value="${query}" placeholder="Zoek in alle ${state.offers.data.offers.length} acties…" autocomplete="off" enterkeyhint="search"></form>
      ${searchResults()}` : ''}`;
}

function findItem(key) {
  const [pid, oid] = key.split('|');
  return derived().weekly?.items.find((x) => x.productId === pid && String(x.offer.id) === oid);
}

async function itemToList(it) {
  const p = state.products.get(it.productId);
  await addToList({ name: p.name, productId: p.id, category: p.category, qty: it.qty || 1, source: 'inslag', store: it.offer.store,
    note: `${storeName(it.offer.store)}: ${it.offer.mechanism || 'aanbieding'}${it.offer.validTo ? ` t/m ${formatDate(it.offer.validTo, 'short')}` : ''}` });
}

export const offerActions = {
  async refreshOffers(el, ev, { rerender }) {
    busy = true; rerender();
    const r = await refreshOffers();
    busy = false; rerender();
    toast(r.error ? `Niet gelukt: ${r.error}` : 'Aanbiedingen bijgewerkt');
  },
  async offerToList(el) {
    const it = findItem(el.dataset.key);
    if (!it) return;
    await itemToList(it);
    toast(`${it.qty || 1}× ${it.name} op de lijst`);
  },
  async storeToList(el) {
    const list = derived().weekly?.byStore.get(el.dataset.store) || [];
    for (const it of list) await itemToList(it);
    toast(`${list.length} producten van ${storeName(el.dataset.store)} op de lijst`);
  },
  offerSearch(form, ev, { rerender }) { query = String(new FormData(form).get('q') || '').trim(); rerender(); },
};
