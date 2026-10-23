import { state, derived, savePriceData, loadPriceData, setSetting } from '../../data/store.js';
import { html, icon, toast } from '../dom.js';
import { euro } from '../../core/money.js';
import { PRICE_SOURCES, parseCheckjebon, buildIndex, findCandidates, compareBasket } from '../../core/prices.js';
import { storeName } from '../../core/stores.js';
import { daysBetween, formatDate, todayISO, localDateOf } from '../../core/dates.js';
import { unitLabel } from '../../core/products.js';
import { priceHistory } from '../../core/analytics.js';
import { empty } from '../components.js';
import { offerActions } from './offers.js';

const SRC = PRICE_SOURCES.checkjebon;
const ui = { loading: false, error: null, meta: null, idx: null, stores: [], searchQ: '', basketFrom: 'lijst' };

async function ensureLoaded(rerender) {
  if (ui.idx || ui.loading || ui.tried) return;
  ui.tried = true;
  const rec = await loadPriceData(SRC.id);
  if (!rec) { ui.meta = null; return; }
  ui.loading = true;
  rerender();
  setTimeout(() => {
    try {
      const { items, stores } = parseCheckjebon(JSON.parse(rec.json));
      ui.idx = buildIndex(items);
      ui.stores = stores;
      ui.meta = { fetchedAt: rec.fetchedAt, sourceDate: rec.sourceDate, items: items.length, origin: rec.origin };
    } catch (e) { ui.error = 'Opgeslagen prijsdata is onleesbaar: ' + e.message; }
    ui.loading = false;
    rerender();
  }, 30);
}

async function storeRaw(text, origin, rerender) {
  const json = JSON.parse(text);
  const { items, stores } = parseCheckjebon(json); // valideert
  if (!items.length) throw new Error('Geen prijzen gevonden in dit bestand.');
  let sourceDate = null;
  if (origin === 'download') {
    try {
      const r = await fetch(SRC.commitsUrl, { headers: { Accept: 'application/vnd.github+json' } });
      if (r.ok) sourceDate = (await r.json())[0]?.commit?.committer?.date || null;
    } catch { /* datum onbekend */ }
  }
  const fetchedAt = new Date().toISOString();
  await savePriceData({ id: SRC.id, fetchedAt, sourceDate, origin, json: text });
  ui.idx = buildIndex(items);
  ui.stores = stores;
  ui.meta = { fetchedAt, sourceDate, items: items.length, origin };
  rerender();
}

/** Wat moet er vergeleken worden: de open lijst, of anders de meest gekochte producten. */
function basketItems() {
  const typicalSize = (pid) => {
    const counts = new Map();
    for (const l of state.lines) if (l.productId === pid && l.sizeAmount) counts.set(`${l.sizeAmount}|${l.sizeUnit}`, (counts.get(`${l.sizeAmount}|${l.sizeUnit}`) || 0) + 1);
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!best) return {};
    const [amount, unit] = best[0].split('|');
    return { amount: +amount, unit };
  };
  const pinned = state.settings.priceMatches || {};
  if (ui.basketFrom === 'lijst') {
    return state.list.filter((i) => !i.checked).map((i) => ({ key: i.name.toLowerCase(), name: i.name, qty: i.qty, productId: i.productId, ...(i.productId ? typicalSize(i.productId) : {}), pinned: pinned[i.name.toLowerCase()] }));
  }
  const { facts, today } = derived();
  const counts = new Map();
  for (const f of facts) if (f.productId && f.date >= today.slice(0, 4) + '-01-01' && f.gross > 0) counts.set(f.productId, (counts.get(f.productId) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([pid]) => {
    const p = state.products.get(pid);
    return { key: p.name.toLowerCase(), name: p.name, qty: 1, productId: pid, ...typicalSize(pid), pinned: pinned[p.name.toLowerCase()] };
  });
}

function freshness() {
  if (!ui.meta) return null;
  const ref = ui.meta.sourceDate || ui.meta.fetchedAt;
  const age = daysBetween(ref.slice(0, 10), todayISO());
  return { age, ref };
}

function sourceCard() {
  const f = freshness();
  return html`<div class="card">
    <div class="card-head"><h2>Prijsbron</h2>${ui.meta ? (f.age <= 2 ? html`<span class="chip good">Actueel</span>` : html`<span class="chip warn">${f.age} dagen oud</span>`) : html`<span class="chip muted">Geen data</span>`}</div>
    <p class="small" style="margin-top:-4px"><a href="${SRC.infoUrl}" target="_blank" rel="noopener">${SRC.name}</a> — ${SRC.notes}</p>
    ${ui.meta ? html`<p class="small muted">Bron bijgewerkt: <strong>${ui.meta.sourceDate ? formatDate(ui.meta.sourceDate.slice(0, 10)) : 'onbekend'}</strong> · opgehaald: ${formatDate(localDateOf(ui.meta.fetchedAt))} · ${ui.meta.items.toLocaleString('nl-NL')} prijzen</p>` : html`<p class="small muted">Nog geen prijzen geladen. Er worden nooit prijzen verzonnen: zonder data toont de app geen vergelijking.</p>`}
    ${ui.error ? html`<div class="notice bad small">${ui.error}</div>` : ''}
    <div class="btn-row" style="margin-top:8px">
      <button class="btn primary small" data-action="download" ${ui.loading ? 'disabled' : ''}>${ui.loading ? html`<span class="spinner"></span>Bezig…` : html`${icon('import', 16)}${ui.meta ? 'Vernieuwen' : 'Prijzen ophalen'} (±10 MB)`}</button>
      <label class="btn small">Bestand kiezen…<input type="file" accept=".json" class="sr-only" data-change="fileData"></label>
    </div>
    <p class="tiny muted" style="margin:8px 0 0">Ophalen gebeurt rechtstreeks vanuit uw browser bij GitHub. Er wordt niets over uw aankopen verstuurd.</p>
  </div>`;
}

function basketSection() {
  const items = basketItems();
  const chosen = state.settings.compareStores || [];
  const available = ui.stores.filter((s) => ['ah', 'jumbo', 'lidl', 'aldi', 'dirk', 'plus', 'hoogvliet', 'vomar', 'dekamarkt', 'spar', 'poiesz'].includes(s.id));
  const usable = chosen.filter((s) => ui.stores.find((x) => x.id === s)?.count > 0);
  const result = items.length && usable.length ? compareBasket(items, ui.idx, { stores: usable, extraStoreCost: state.settings.extraStoreCost || 0 }) : null;
  return html`
    <div class="card" style="margin-top:14px">
      <div class="card-head"><h2>Wat kost de hele lijst?</h2></div>
      <div class="seg" style="margin-bottom:10px">
        <button class="${ui.basketFrom === 'lijst' ? 'on' : ''}" data-action="basketFrom" data-v="lijst">Boodschappenlijst</button>
        <button class="${ui.basketFrom === 'top' ? 'on' : ''}" data-action="basketFrom" data-v="top">Top 20 dit jaar</button>
      </div>
      <div class="qa" style="flex-wrap:wrap;margin-bottom:8px">${available.map((s) => html`
        <button class="chip ${chosen.includes(s.id) ? 'good' : ''}" data-action="toggleStore" data-id="${s.id}" ${s.count ? '' : 'disabled title="Geen prijzen in deze bron"'}>${chosen.includes(s.id) ? icon('check', 13) : ''}${storeName(s.id)}${s.count ? '' : ' · geen data'}</button>`)}</div>
      <label class="field small" style="max-width:280px">Extra kosten voor een tweede winkel (reistijd/benzine)
        <input class="input small num" inputmode="decimal" value="${((state.settings.extraStoreCost || 0) / 100).toFixed(2).replace('.', ',')}" data-change="extraCost"></label>
      ${!items.length ? html`<p class="muted" style="margin-top:12px">${ui.basketFrom === 'lijst' ? 'De boodschappenlijst is leeg.' : 'Nog geen aankopen dit jaar.'}</p>` : ''}
      ${result ? html`
        ${result.commonCount && result.commonCount < items.length ? html`<div class="section-label">Eerlijke vergelijking · ${result.commonCount} producten die overal zeker gevonden zijn</div>
        <div class="rows">${[...result.single].filter((r) => r.commonTotal != null).sort((a, b) => a.commonTotal - b.commonTotal).map((r, i) => html`
          <div class="row-item"><div class="grow"><div class="title">${i === 0 ? '🏆 ' : ''}${storeName(r.stores[0])}</div></div><div class="amount num">${euro(r.commonTotal)}</div></div>`)}</div>` : ''}
        <div class="section-label">Eén winkel · hele lijst</div>
        <div class="rows">${result.single.map((r, i) => html`
          <div class="row-item">
            <div class="grow"><div class="title">${i === 0 && r.complete && result.commonCount === items.length ? '🏆 ' : ''}${storeName(r.stores[0])}</div>
            <div class="sub">${r.found}/${items.length} zeker gevonden${r.missing.length ? ` · ontbreekt/onzeker: ${r.missing.slice(0, 3).join(', ')}${r.missing.length > 3 ? '…' : ''}` : ''}</div></div>
            <div class="amount num">${r.found ? euro(r.total) : '–'}</div>
          </div>`)}</div>
        ${result.pairs.length ? html`<div class="section-label">Combinatie van twee winkels</div>
        <div class="rows">${result.pairs.slice(0, 3).map((r) => html`
          <div class="row-item">
            <div class="grow"><div class="title">${storeName(r.stores[0])} + ${storeName(r.stores[1])}</div>
            <div class="sub">${r.found}/${items.length} gevonden${r.extra ? ` · incl. ${euro(r.extra)} extra kosten` : ''}</div></div>
            <div class="amount num">${euro(r.total)}</div>
          </div>`)}</div>` : ''}
        <p class="tiny muted">Alleen vergelijkbaar als alle winkels alle producten hebben; winkels met ontbrekende producten lijken anders goedkoper dan ze zijn. Zonder aanbiedingen.</p>
        <details style="margin-top:10px"><summary class="small">Per product bekijken en keuze aanpassen</summary>
          <div class="scroll-x"><table class="table" style="margin-top:8px">
            <thead><tr><th>Product</th>${usable.map((s) => html`<th class="r">${storeName(s)}</th>`)}</tr></thead>
            <tbody>${result.perItem.map((x, i) => {
              const min = Math.min(...usable.map((s) => x.byStore[s]?.cost ?? Infinity));
              return html`<tr><td><strong>${x.need.qty > 1 ? `${x.need.qty}× ` : ''}${x.need.name}</strong>${x.need.amount ? html`<div class="tiny muted">${x.need.amount} ${x.need.unit}</div>` : ''}</td>
                ${usable.map((s) => {
                  const c = x.byStore[s];
                  if (!c) {
                    const unsure = x.unsureByStore?.[s];
                    if (!unsure) return html`<td class="r muted">niet gevonden</td>`;
                    return html`<td class="r"><span class="chip warn">onzeker</span>
                      <select class="input" style="min-height:28px;font-size:12px;padding:2px 4px;margin-top:4px" data-change="pin" data-key="${x.need.key}" data-store="${s}">
                        <option value="">Kies het juiste product…</option>${unsure.map((a) => html`<option value="${a.item.url || ''}">${a.item.name} ${a.item.sizeText} – ${euro(a.item.price)}</option>`)}</select></td>`;
                  }
                  return html`<td class="r" style="${c.cost === min ? 'color:var(--good);font-weight:650' : ''}">
                    <div class="num">${euro(c.cost)}</div>
                    <div class="tiny muted" style="max-width:150px;margin-left:auto">${c.packs}× ${c.item.name}${c.item.sizeText ? ` (${c.item.sizeText})` : ''}${c.pinned ? ' 📌' : ''}</div>
                    ${c.alternatives?.length ? html`<select class="input" style="min-height:28px;font-size:12px;padding:2px 4px;margin-top:4px" data-change="pin" data-key="${x.need.key}" data-store="${s}">
                      <option value="">Andere keuze…</option>${[c, ...c.alternatives].map((a) => html`<option value="${a.item.url || ''}">${a.item.name} ${a.item.sizeText} – ${euro(a.item.price)}</option>`)}<option value="__clear">Automatisch kiezen</option></select>` : ''}
                    ${c.item.url ? html`<a class="tiny" href="${c.item.url}" target="_blank" rel="noopener">bekijk</a>` : ''}
                  </td>`;
                })}</tr>`;
            })}</tbody></table></div>
        </details>` : ''}
    </div>`;
}

function searchSection() {
  const q = ui.searchQ;
  const results = q ? (state.settings.compareStores || []).map((s) => ({ s, c: findCandidates(ui.idx, q, { store: s, limit: 4 }) })).filter((x) => x.c.length) : [];
  const own = q ? [...state.products.values()].find((p) => p.name.toLowerCase().includes(q.toLowerCase())) : null;
  const ownHist = own ? priceHistory(derived().facts, own.id) : [];
  return html`<div class="card" style="margin-top:14px">
    <div class="card-head"><h2>Product vergelijken</h2></div>
    <form data-submit="search" class="gap8"><input class="input" name="q" value="${q}" placeholder="bv. halfvolle melk, pindakaas, koffiebonen"><button class="btn">Zoek</button></form>
    ${own && ownHist.length ? html`<p class="small" style="margin-top:10px">U betaalde laatst <strong>${euro(ownHist.at(-1).paidPerUnit)}</strong> voor ${own.name} bij ${storeName(ownHist.at(-1).store)} (${formatDate(ownHist.at(-1).date)}).</p>` : ''}
    ${q && !results.length ? html`<p class="muted">Geen resultaten. Probeer een algemenere omschrijving.</p>` : ''}
    ${results.map(({ s, c }) => html`<div class="section-label">${storeName(s)}</div><div class="rows">${c.map((x) => html`
      <div class="row-item"><div class="grow"><div class="title">${x.item.name}</div><div class="sub">${x.item.sizeText || 'inhoud onbekend'}${x.unitPrice != null ? ` · ${euro(x.unitPrice)} per ${unitLabel(x.item.sizeUnit)}` : ''}</div></div>
      <div class="amount num">${euro(x.item.price)}</div></div>`)}</div>`)}
  </div>`;
}

export default {
  render(params, query) {
    return html`
      <a class="small" href="#/aanbiedingen">${icon('back', 14)} Aanbiedingen</a>
      <div class="page-head"><div><h1>Prijzen vergelijken</h1><p class="muted">Gewone winkelprijzen (zonder acties): waar is onze lijst het voordeligst?</p></div></div>
      ${sourceCard()}
      ${ui.loading ? html`<div class="card" style="margin-top:14px"><div class="progress"><span class="spinner"></span>Prijsdata verwerken…</div></div>` : ''}
      ${ui.idx ? html`${basketSection()}${searchSection()}` : (!ui.loading ? html`<div class="card" style="margin-top:14px">${empty('Geen actuele prijzen', 'Haal eerst prijsdata op. Uw eigen betaalde prijzen vindt u altijd bij elk product onder Analyse.')}</div>` : '')}
      <details class="card" style="margin-top:14px"><summary>Over de prijsgegevens</summary>
        <div class="small" style="margin-top:8px">
          <p>Er bestaan geen officiële, openbare prijs-API's van Albert Heijn, Jumbo, Lidl, Aldi, Dirk of PLUS. De gebruikte bron is het open-sourceproject Checkjebon.nl, dat dagelijks de online prijzen van supermarkten verzamelt en vrij beschikbaar stelt.</p>
          <ul><li>Geen aanbiedingen/bonusprijzen: vergelijking is op basis van de vermelde prijs.</li>
          <li>Aldi publiceert geen online prijzen; Lidl-prijzen komen via boodschaapje.nl.</li>
          <li>Productmatching gebeurt op naam en kan misgaan; controleer per product en pin zo nodig de juiste keuze.</li>
          <li>De module is uitbreidbaar met andere bronnen (zie <code>js/core/prices.js</code>).</li></ul>
        </div></details>`;
  },
  after(root, params, query) { if ((query?.get('tab') || 'aanbiedingen') !== 'vergelijken') return; if (!ui.idx && !ui.loading) ensureLoaded(() => window.dispatchEvent(new HashChangeEvent('hashchange'))); },
  actions: {
    ...offerActions,
    async download(el, ev, { rerender }) {
      ui.loading = true; ui.error = null; rerender();
      try {
        const r = await fetch(SRC.dataUrl, { cache: 'no-store' });
        if (!r.ok) throw new Error(`Server antwoordde ${r.status}`);
        await storeRaw(await r.text(), 'download', rerender);
        toast('Prijsdata bijgewerkt');
      } catch (e) {
        ui.error = `Ophalen mislukt (${e.message}). Controleer de internetverbinding, of download supermarkets.json zelf via de bronlink en kies “Bestand kiezen”.`;
      }
      ui.loading = false; rerender();
    },
    async fileData(el, ev, { rerender }) {
      const file = el.files[0];
      if (!file) return;
      ui.loading = true; ui.error = null; rerender();
      try { await storeRaw(await file.text(), 'bestand', rerender); toast('Prijsdata geladen uit bestand'); } catch (e) { ui.error = 'Bestand kon niet gelezen worden: ' + e.message; }
      ui.loading = false; rerender();
    },
    basketFrom(el, ev, { rerender }) { ui.basketFrom = el.dataset.v; rerender(); },
    async toggleStore(el) {
      const cur = new Set(state.settings.compareStores || []);
      cur.has(el.dataset.id) ? cur.delete(el.dataset.id) : cur.add(el.dataset.id);
      await setSetting('compareStores', [...cur]);
    },
    async extraCost(el) { const v = Math.round(parseFloat(el.value.replace(',', '.')) * 100); await setSetting('extraStoreCost', Number.isFinite(v) && v >= 0 ? v : 0); },
    async pin(el) {
      const all = { ...(state.settings.priceMatches || {}) };
      const k = el.dataset.key;
      all[k] = { ...(all[k] || {}) };
      if (el.value === '__clear' || !el.value) delete all[k][el.dataset.store];
      else all[k][el.dataset.store] = el.value;
      await setSetting('priceMatches', all);
    },
    search(form, ev, { rerender }) { ui.searchQ = String(new FormData(form).get('q') || '').trim(); rerender(); },
  },
};
