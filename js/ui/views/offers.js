// Prijzen → Aanbiedingen: de folders van deze week, vergeleken met jullie eigen aankopen.

import { state, derived, refreshOffers, addToList } from '../../data/store.js';
import { html, icon, toast } from '../dom.js';
import { euro } from '../../core/money.js';
import { storeName } from '../../core/stores.js';
import { formatDate, localDateOf } from '../../core/dates.js';
import { normalizeText } from '../../core/text.js';
import { tag, empty } from '../components.js';

let busy = false;
let query = '';

export function priceTabs(active) {
  return html`<div class="seg" style="margin-bottom:14px">${[['aanbiedingen', 'Aanbiedingen'], ['vergelijken', 'Vergelijken']].map(([k, l]) => html`<button class="${active === k ? 'on' : ''}" data-action="nav" data-to="prijzen?tab=${k}">${l}</button>`)}</div>`;
}

function statusCard() {
  const d = derived();
  const rec = state.offers;
  const st = d.offerStatus;
  const mine = (state.settings.myStores || []).map((s) => s.id);
  const sources = st.ok ? st.sources : {};
  return html`<div class="card">
    <div class="card-head"><h2>Folders van deze week</h2>
      ${!st.ok ? html`<span class="chip muted">Geen gegevens</span>` : st.stale ? html`<span class="chip warn">${st.age} dagen oud</span>` : html`<span class="chip good">Actueel</span>`}</div>
    ${st.ok ? html`<p class="small" style="margin-top:-4px">Bijgewerkt ${formatDate(localDateOf(st.generatedAt))} · ${st.count} aanbiedingen</p>
      <div class="qa" style="flex-wrap:wrap">${mine.map((id) => {
        const s = sources[id];
        const good = s?.ok && s.count > 0;
        const label = good ? ` · ${s.count}` : s?.ok || (s && !s.error) ? ' · 0 gevonden' : s ? ' · mislukt' : ' · geen automatische bron';
        return html`<span class="chip ${good ? 'good' : s?.error ? 'bad' : s ? 'warn' : 'muted'}" title="${s?.error || s?.note || (s ? '' : 'Beoordeel aanbiedingen van deze winkel zelf via Voorraad → Inslag → Aanbieding beoordelen')}">${storeName(id)}${label}</span>`;
      })}</div>`
      : html`<p class="small muted" style="margin-top:-4px">${rec?.error ? `Ophalen lukte niet: ${rec.error}.` : st.reason || 'Nog geen aanbiedingen geladen.'} De aanbiedingen worden elke ochtend opgehaald door een klein script op GitHub; zie de installatiegids (LEESMIJ.md).</p>`}
    ${rec?.error && st.ok ? html`<p class="small" style="color:var(--warn)">Laatste poging mislukt: ${rec.error}. De vorige gegevens worden getoond.</p>` : ''}
    <div class="btn-row" style="margin-top:8px"><button class="btn small" data-action="refreshOffers" ${busy ? 'disabled' : ''}>${busy ? html`<span class="spinner"></span>Bezig…` : html`${icon('undo', 14)}Vernieuwen`}</button></div>
  </div>`;
}

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
      <div class="sub" style="white-space:normal">${o.title}</div>
      <div class="tiny muted" style="margin-top:2px">${sub}</div>
      <div class="gap8 wrap" style="margin-top:4px">
        ${it.kind === 'inslag' ? html`<span class="chip good">inslaan</span>` : ''}
        ${it.needSoon ? html`<span class="chip info">nodig deze week</span>` : ''}
        ${it.discountVsYou ? html`<span class="chip">${Math.round(it.discountVsYou * 100)}% onder jullie prijs</span>` : ''}
      </div>
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

export function offersView() {
  const d = derived();
  const w = d.weekly;
  return html`
    <div class="page-head"><div><h1>Aanbiedingen</h1><p class="muted">Alleen wat voor jullie interessant is, vergeleken met wat jullie zelf normaal betalen.</p></div></div>
    ${priceTabs('aanbiedingen')}
    ${statusCard()}
    ${w ? (w.items.length ? html`
      <div class="card" style="margin-top:14px;background:var(--accent);color:var(--accent-ink);border:0">
        <div style="opacity:.8;font-size:14px">Deze week voordelig voor jullie ${html`<span class="chip" style="background:rgba(255,255,255,.15);color:inherit;border:0">schatting</span>`}</div>
        <div style="font-size:30px;font-weight:700;margin-top:2px" class="num">±${euro(w.total)}</div>
        <div class="small" style="opacity:.9">${w.items.length} aanbiedingen in ${w.byStore.size} winkel${w.byStore.size === 1 ? '' : 's'} · uit ${w.considered} bekeken</div>
      </div>
      ${[...w.byStore.entries()].map(([store, list]) => html`
        <div class="section-label between"><span>${storeName(store)} · ±${euro(list.reduce((t, x) => t + x.saving, 0))}</span>
          <button class="btn small ghost" data-action="storeToList" data-store="${store}">Alles op de lijst</button></div>
        <div class="card tight"><div class="rows">${list.map(itemRow)}</div></div>`)}
      <p class="muted tiny">Besparing = wat jullie normaal betalen min de actieprijs, voor de voorgestelde hoeveelheid. Bij inslagproducten tot jullie maximale voorraad; bij vaste producten jullie gebruikelijke hoeveelheid.</p>`
      : html`<div class="card" style="margin-top:14px">${empty('Niets bijzonders deze week', 'Geen aanbiedingen die duidelijk goedkoper zijn dan wat jullie normaal betalen voor jullie vaste producten. Hoe meer bonnen, hoe beter de app dit kan beoordelen.')}</div>`)
      : ''}
    ${state.offers?.data?.offers?.length ? html`
      <div class="section-label">Alle aanbiedingen doorzoeken</div>
      <form class="searchbox" data-submit="offerSearch">${icon('search', 20)}<input class="input" name="q" value="${query}" placeholder="bv. koffiecups, pampers, wasmiddel" autocomplete="off" enterkeyhint="search"></form>
      ${searchResults()}` : ''}
    <details class="card" style="margin-top:14px"><summary>Waar komen deze aanbiedingen vandaan?</summary>
      <div class="small muted" style="margin-top:8px">
        <p>Elke ochtend haalt een klein script op GitHub de openbare Bonus-aanbiedingen van Albert Heijn op via de (onofficiële) app-API. Jullie aankopen gaan daar nooit naartoe; de vergelijking gebeurt op dit apparaat.</p>
        <p>Voor de andere winkels is er (nog) geen bron die automatische toegang toestaat: Folderz.nl blokkeert dit bewust, en die blokkade omzeilt de app niet. Zie je in een folder iets interessants, gebruik dan <strong>Voorraad → Inslag → Aanbieding beoordelen</strong>.</p>
        <p>Beide bronnen zijn onofficieel en kunnen veranderen. Lukt het ophalen niet, dan ziet u dat hierboven per winkel; de vorige gegevens blijven dan staan en de rest van de app werkt gewoon.</p>
        <p>Persoonlijke Bonus Box-aanbiedingen uit de AH-app zitten er niet in: die vragen om inloggen.</p>
      </div></details>`;
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
