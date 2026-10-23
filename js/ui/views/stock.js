import { state, derived, adjustStock, undoAdjustment, addToList } from '../../data/store.js';
import { html, icon, toast } from '../dom.js';
import { MODELS } from '../../core/stock-model.js';
import { categoryModel } from '../../core/categories.js';
import { formatDate } from '../../core/dates.js';
import { statusChip, stockMeter, daysText, tag, empty, noDataCard } from '../components.js';
import { inslagView, vriezerView, stockTabs, inslagActions } from './stockpile.js';

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

    return html`
      <div class="page-head">
        <div><h1>Voorraad ${tag.voorspelling}</h1><p class="muted">Geschat uit uw aankoopritme. Klopt iets niet? Eén tik corrigeert en de app leert ervan.</p></div>
      </div>
      ${stockTabs('voorspelling')}
      <div class="seg" style="margin-bottom:12px">
        ${[['alle', 'Alles'], ...Object.entries(MODELS).map(([k, m]) => [k, m.label.split(' ')[0]])].map(([k, l]) => html`<button class="${filterModel === k ? 'on' : ''}" data-action="filter" data-m="${k}">${l}</button>`)}
      </div>
      ${vac.some((v) => v.to >= derived().today) ? html`<div class="notice" style="margin-bottom:12px">Vakantie ingesteld: ${vac.map((v) => `${formatDate(v.from)} – ${formatDate(v.to)}`).join(', ')}. Die dagen tellen niet als verbruik.</div>` : ''}

      ${ORDER.filter((k) => k !== 'onvoldoende').map((k) => buckets[k].length ? html`
        <div class="section-label">${HEADINGS[k]} · ${buckets[k].length}</div>
        <div class="card tight"><div class="rows">${buckets[k].map(([id, pred]) => row(id, pred))}</div></div>` : '')}

      ${!buckets.op.length && !buckets.bijna.length && !buckets.voldoende.length ? html`<div class="card">${empty('Nog geen voorspellingen', 'Per product zijn minstens 3 aankopen over ruim een week nodig. Importeer meer bonnen.')}</div>` : ''}

      <div class="section-label between"><span>Onvoldoende gegevens · ${buckets.onvoldoende.length}</span>
        <button class="btn small ghost" data-action="toggleUnknown">${showUnknown ? 'Verbergen' : 'Tonen'}</button></div>
      ${showUnknown ? html`<div class="card tight"><div class="rows">${buckets.onvoldoende.slice(0, 150).map(([id, pred]) => html`
        <div class="row-item clickable" data-action="nav" data-to="product/${id}">
          <div class="grow"><div class="title">${state.products.get(id).name}</div><div class="sub">${pred.reason}</div></div>
          ${statusChip(pred)}
        </div>`)}</div></div>` : ''}

      <details class="card" style="margin-top:14px">
        <summary>Hoe werkt de voorspelling?</summary>
        <div class="small muted" style="margin-top:10px">
          <p>Wat u bij een aankoop kocht, is meestal op rond de volgende aankoop. Uit die intervallen schat de app uw verbruik per dag, waarbij recente weken zwaarder tellen. Aankopen bij alle supermarkten tellen mee.</p>
          <p>Vier modellen: <strong>snel</strong> (melk, brood, fruit — reageert snel op verandering), <strong>houdbaar</strong> en <strong>huishoudelijk</strong> (rustiger), en <strong>onregelmatig</strong> (snacks — alleen een voorspelling als het ritme echt regelmatig is).</p>
          <p>Bij onregelmatige aankopen, te weinig aankopen of producten die u lang niet kocht, toont de app <em>Onvoldoende gegevens</em> in plaats van te gokken. Vakanties stelt u in bij Instellingen.</p>
        </div>
      </details>`;
  }
}

export default {
  render(params, q) {
    const tab = q.get('tab') || 'voorspelling';
    if (tab === 'inslag') return inslagView();
    if (tab === 'vriezer') return vriezerView();
    return predictionView();
  },
  actions: {
    ...inslagActions,
    filter(el, ev, { rerender }) { filterModel = el.dataset.m; rerender(); },
    toggleUnknown(el, ev, { rerender }) { showUnknown = !showUnknown; rerender(); },
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
