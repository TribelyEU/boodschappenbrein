import { state, derived, adjustStock, undoAdjustment, addToList } from '../../data/store.js';
import { html, icon, toast } from '../dom.js';
import { MODELS } from '../../core/stock-model.js';
import { categoryModel } from '../../core/categories.js';
import { formatDate } from '../../core/dates.js';
import { statusChip, stockMeter, daysText, tag, empty, noDataCard, info } from '../components.js';
import { vriezerSection, inslagActions } from './stockpile.js';

let filterModel = 'alle';
let showUnknown = false;

const ORDER = ['op', 'bijna', 'voldoende', 'onvoldoende'];
const HEADINGS = { op: 'Waarschijnlijk op', bijna: 'Mogelijk bijna op', voldoende: 'Waarschijnlijk voldoende', onvoldoende: 'Onvoldoende gegevens' };

function modelOf(p) { return p.model || categoryModel(p.category); }

function row(id, pred) {
  const p = state.products.get(id);
  const lastAdj = state.adjustments.filter((a) => a.productId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return html`
    <div class="row-item" style="flex-wrap:wrap">
      <div class="grow clickable" data-action="nav" data-to="product/${id}" style="min-width:55%">
        <div class="title">${p.name}</div>
        <div class="sub">${pred.status.id === 'onvoldoende' ? pred.reason : daysText(pred)}${pred.perWeek ? ` · ±${pred.perWeek.toFixed(1).replace('.', ',')} per week` : ''}</div>
        ${stockMeter(pred)}
      </div>
      <div class="stock-actions" role="group" aria-label="Voorraad corrigeren">
        <button data-action="adj" data-id="${id}" data-level="op" title="Het is op">Op</button>
        <button data-action="adj" data-id="${id}" data-level="bijna" title="Bijna op">Bijna</button>
        <button data-action="adj" data-id="${id}" data-level="genoeg" title="Nog genoeg">Genoeg</button>
        ${pred.status.id === 'op' || pred.status.id === 'bijna' ? html`<button data-action="toList" data-id="${id}" title="Op de lijst">${icon('plus', 14)}</button>` : ''}
      </div>
      ${lastAdj && lastAdj.date === derived().today ? html`<div class="tiny muted" style="width:100%">Vandaag gecorrigeerd: “${lastAdj.level}”</div>` : ''}
    </div>`;
}

function predictionView() {
  {
    const { predictions, facts } = derived();
    if (!facts.length) return html`<div class="page-head"><div><h1>Voorraad</h1></div></div>${noDataCard()}`;
    const buckets = Object.fromEntries(ORDER.map((k) => [k, []]));
    for (const [id, pred] of predictions) {
      const p = state.products.get(id);
      if (!p) continue;
      if (filterModel !== 'alle' && modelOf(p) !== filterModel) continue;
      buckets[pred.status.id].push([id, pred]);
    }
    buckets.op.sort((a, b) => a[1].daysLeft - b[1].daysLeft);
    buckets.bijna.sort((a, b) => a[1].daysLeft - b[1].daysLeft);
    buckets.voldoende.sort((a, b) => a[1].daysLeft - b[1].daysLeft);
    buckets.onvoldoende.sort((a, b) => b[1].purchases - a[1].purchases);
    const vac = state.settings.vacations || [];

    const low = [...buckets.op, ...buckets.bijna].sort((a, b) => a[1].daysLeft - b[1].daysLeft);
    const okList = buckets.voldoende;
    const shownOk = showAllOk ? okList : okList.slice(0, 6);
    return html`
      <div class="page-head"><div><h1>Voorraad ${info('Hoe werkt de voorraad?', STOCK_INFO)}</h1></div></div>
      ${vac.some((v) => v.to >= derived().today) ? html`<div class="notice" style="margin-bottom:12px">Vakantie: ${vac.map((v) => `${formatDate(v.from, 'short')} – ${formatDate(v.to, 'short')}`).join(', ')}. Die dagen tellen niet als verbruik.</div>` : ''}

      <div class="section-head" style="margin-top:6px"><h2>Bijna op</h2><span class="small muted">${low.length}</span></div>
      ${low.length ? html`<div class="card tight"><div class="rows">${low.map(([id, pred]) => row(id, pred))}</div></div>`
        : html`<div class="card"><p class="muted" style="margin:0">${predictions.size ? 'Niets dat met redelijke zekerheid bijna op is.' : 'Voorspellingen verschijnen zodra producten minstens 3 keer gekocht zijn.'}</p></div>`}

      ${vriezerSection()}

      ${okList.length ? html`
        <div class="section-head"><h2>Genoeg in huis</h2><span class="small muted">${okList.length}</span></div>
        <div class="card tight"><div class="rows">${shownOk.map(([id, pred]) => okRow(id, pred))}</div>
          ${okList.length > 6 ? html`<button class="btn small ghost block" data-action="toggleOk">${showAllOk ? 'Minder tonen' : `Alle ${okList.length} tonen`}</button>` : ''}</div>` : ''}

      ${buckets.onvoldoende.length ? html`
        <button class="btn small ghost" style="margin-top:18px" data-action="toggleUnknown">${showUnknown ? 'Verberg' : 'Toon'} ${buckets.onvoldoende.length} producten met te weinig gegevens</button>
        ${showUnknown ? html`<div class="card tight" style="margin-top:8px"><div class="rows">${buckets.onvoldoende.slice(0, 150).map(([id, pred]) => html`
          <div class="row-item clickable" data-action="nav" data-to="product/${id}">
            <div class="grow"><div class="title">${state.products.get(id).name}</div><div class="sub">${pred.reason}</div></div>
          </div>`)}</div></div>` : ''}` : ''}`;
  }
}

const STOCK_INFO = `<p>De app schat uit jullie aankopen hoe snel iets opgaat. Wat je bij een aankoop kocht, is meestal op rond de volgende keer dat je het koopt.</p>
<p>Klopt iets niet? Tik <strong>Op</strong>, <strong>Bijna</strong> of <strong>Genoeg</strong>; de app leert daarvan.</p>
<p>Bij te weinig of onregelmatige aankopen gokt de app niet en zet het product onder "te weinig gegevens". Vakanties stel je in bij Instellingen.</p>`;

let showAllOk = false;

function okRow(id, pred) {
  const p = state.products.get(id);
  return html`<div class="row-item">
    <div class="grow clickable" data-action="nav" data-to="product/${id}"><div class="title">${p.name}</div><div class="sub">${daysText(pred)}</div></div>
    <div class="stock-actions"><button data-action="adj" data-id="${id}" data-level="op" title="Het is op">Op</button></div>
  </div>`;
}

export default {
  render() { return predictionView(); },
  actions: {
    ...inslagActions,
    filter(el, ev, { rerender }) { filterModel = el.dataset.m; rerender(); },
    toggleUnknown(el, ev, { rerender }) { showUnknown = !showUnknown; rerender(); },
    toggleOk(el, ev, { rerender }) { showAllOk = !showAllOk; rerender(); },
    async adj(el) {
      const a = await adjustStock(el.dataset.id, el.dataset.level);
      const name = state.products.get(el.dataset.id)?.name;
      toast(`${name}: “${el.dataset.level}” onthouden`, { action: 'Ongedaan maken', onAction: () => undoAdjustment(a.id) });
    },
    async toList(el) {
      const p = state.products.get(el.dataset.id);
      const pred = derived().predictions.get(p.id);
      await addToList({ name: p.name, productId: p.id, category: p.category, qty: Math.max(1, Math.round(pred?.typicalQty || 1)), source: 'suggestie' });
      toast(`${p.name} staat op de lijst`);
    },
  },
};
