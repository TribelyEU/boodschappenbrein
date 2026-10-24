import { state, derived } from '../../data/store.js';
import { html, icon } from '../dom.js';
import { euro } from '../../core/money.js';
import { inRange, groupBy, timeSeries, total, bucketLabel } from '../../core/analytics.js';
import { categoryName, categoryColor } from '../../core/categories.js';
import { storeName } from '../../core/stores.js';
import { addDays, addMonths, startOfMonth, startOfWeek, formatDate, isoWeek } from '../../core/dates.js';
import { barChart } from '../charts.js';
import { catDot, noDataCard, empty } from '../components.js';

const GROUPS = [['categorie', 'Categorie'], ['supermarkt', 'Supermarkt'], ['product', 'Product'], ['merk', 'Merk']];
const PERIODS = [['week', 'Week'], ['maand', 'Maand'], ['jaar', 'Jaar']];

function link(q, patch) {
  const p = new URLSearchParams(q);
  for (const [k, v] of Object.entries(patch)) { if (v == null) p.delete(k); else p.set(k, v); }
  return 'analyse?' + p.toString();
}

function bucketRange(key, g) {
  if (g === 'week') return [key, addDays(key, 6)];
  if (g === 'maand') return [key, addDays(addMonths(key, 1), -1)];
  return [key, `${key.slice(0, 4)}-12-31`];
}

function spendingTab(q) {
  const { facts, today } = derived();
  const g = q.get('periode') || 'maand';
  const groupKey = q.get('groep') || 'categorie';
  const filter = q.get('filter');
  const van = q.get('van');
  const first = facts.reduce((m, f) => (!m || f.date < m ? f.date : m), today);
  const from = g === 'week' ? addDays(startOfWeek(today), -7 * 15) : g === 'maand' ? addMonths(startOfMonth(today), -11) : `${first.slice(0, 4)}-01-01`;
  const series = timeSeries(facts, g, from < first && g !== 'jaar' ? (g === 'week' ? startOfWeek(first) : startOfMonth(first)) : from, today);
  const [rFrom, rTo] = van ? bucketRange(van, g) : [series[0]?.key || from, today];
  let scoped = inRange(facts, rFrom, rTo);
  let filterLabel = null;
  if (filter) {
    if (groupKey === 'categorie') { scoped = scoped.filter((f) => f.category === filter); filterLabel = categoryName(filter); }
    if (groupKey === 'supermarkt') { scoped = scoped.filter((f) => f.store === filter); filterLabel = storeName(filter); }
    if (groupKey === 'merk') { scoped = scoped.filter((f) => (f.brand || 'Zonder merk') === filter); filterLabel = filter; }
  }
  const showProducts = groupKey === 'product' || Boolean(filter);
  const keyFn = showProducts ? (f) => f.productId || (f.category === 'korting' ? '__korting' : null)
    : groupKey === 'categorie' ? (f) => f.category
      : groupKey === 'supermarkt' ? (f) => f.store || 'onbekend'
        : (f) => f.brand || 'Zonder merk';
  const groups = groupBy(scoped, keyFn);
  const sum = total(scoped);
  const label = (k) => showProducts ? (k === '__korting' ? 'Niet-toegewezen korting' : state.products.get(k)?.name || '?')
    : groupKey === 'categorie' ? categoryName(k) : groupKey === 'supermarkt' ? storeName(k) : k;
  const rowLink = (k) => showProducts ? (k === '__korting' ? null : `product/${k}`) : link(q, { filter: k });
  const periodText = van ? (g === 'week' ? `week ${isoWeek(van).week} (${formatDate(rFrom, 'short')} – ${formatDate(rTo, 'short')})` : g === 'maand' ? formatDate(van, 'month') : van.slice(0, 4)) : `${formatDate(rFrom)} – ${formatDate(rTo)}`;

  return html`
    <div class="between wrap" style="margin-bottom:12px;gap:8px">
      <div class="seg">${PERIODS.map(([k, l]) => html`<button class="${g === k ? 'on' : ''}" data-action="nav" data-to="${link(q, { periode: k, van: null })}">${l}</button>`)}</div>
      <div class="seg">${GROUPS.map(([k, l]) => html`<button class="${groupKey === k ? 'on' : ''}" data-action="nav" data-to="${link(q, { groep: k, filter: null })}">${l}</button>`)}</div>
    </div>
    <div class="card">
      <div class="card-head"><h2>Uitgaven per ${g}</h2></div>
      ${barChart(series.map((s) => ({ label: s.label, value: s.net, dim: van && s.key !== van, action: 'nav', args: { to: link(q, { van: s.key === van ? null : s.key }) } })))}
      <p class="muted small" style="margin:8px 0 0">Tik op een staaf om die periode te bekijken.${van ? html` <a href="#/${link(q, { van: null })}">Toon alles</a>` : ''}</p>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="card-head">
        <div>
          <h2>${filterLabel ? html`${filterLabel}` : `Per ${groupKey}`}</h2>
          <div class="muted small">${periodText} · ${scoped.length} regels</div>
        </div>
        <div style="text-align:right"><div class="num" style="font-weight:700;font-size:20px">${euro(sum)}</div>
        ${filter ? html`<a class="small" href="#/${link(q, { filter: null })}">${icon('back', 14)} terug</a>` : ''}</div>
      </div>
      ${groups.length ? html`<div class="rows">${groups.slice(0, 200).map((gr) => {
        const to = rowLink(gr.key);
        return html`
        <div class="row-item ${to ? 'clickable' : ''}" ${to ? html`data-action="nav" data-to="${to}"` : ''}>
          ${!showProducts && groupKey === 'categorie' ? catDot(gr.key) : ''}
          <div class="grow">
            <div class="title">${label(gr.key)}</div>
            <div class="sub">${gr.net < 0 ? `${gr.count}× korting op de bon` : `${gr.count}×${gr.discount < 0 ? ` · ${euro(-gr.discount)} korting` : ''}`}</div>
          </div>
          <div style="text-align:right">
            <div class="amount num">${euro(gr.net)}</div>
            ${gr.net >= 0 ? html`<div class="tiny muted num">${sum ? Math.round((gr.net / sum) * 100) : 0}%</div>` : ''}
          </div>
        </div>`;
      })}</div>` : html`<p class="muted">Geen aankopen in deze periode.</p>`}
    </div>`;
}

function receiptsTab() {
  if (!state.receipts.length) return html`<div class="card">${empty('Nog geen bonnen', '')}</div>`;
  return html`<div class="card tight"><div class="rows">${state.receipts.slice(0, 400).map((r) => html`
    <div class="row-item clickable" data-action="nav" data-to="bon/${r.id}">
      <div class="grow"><div class="title">${storeName(r.store)} · ${formatDate(r.date)}</div>
      <div class="sub">${r.lineCount} regels · ${r.source?.type || ''}${r.source?.fileName ? ` · ${r.source.fileName}` : ''}</div></div>
      ${r.check === 'afwijking' ? html`<span class="chip warn">Afwijking</span>` : r.check === 'ok' ? html`<span class="chip good">Klopt</span>` : ''}
      <div class="amount num">${euro(r.total ?? r.computedTotal)}</div>
    </div>`)}</div></div>
    ${state.receipts.length > 400 ? html`<p class="muted small">De 400 meest recente bonnen worden getoond.</p>` : ''}`;
}

export default {
  render(params, q) {
    const addBtn = html`<a class="big-action" href="#/importeren" style="margin-bottom:16px"><span class="ic">${icon('plus', 22)}</span><span>Bon toevoegen<small>PDF of foto van een kassabon</small></span></a>`;
    if (!derived().facts.length) return html`<div class="page-head"><div><h1>Uitgaven</h1></div></div>${addBtn}${noDataCard()}`;
    const tab = q.get('tab') || 'uitgaven';
    return html`
      <div class="page-head"><div><h1>Uitgaven</h1></div></div>
      ${addBtn}
      <div class="seg" style="margin-bottom:14px">
        ${[['uitgaven', 'Overzicht'], ['bonnen', 'Alle bonnen']].map(([k, l]) => html`<button class="${tab === k ? 'on' : ''}" data-action="nav" data-to="analyse?tab=${k}">${l}</button>`)}
      </div>
      ${tab === 'bonnen' ? receiptsTab() : spendingTab(q)}`;
  },
};

export { bucketLabel, categoryColor };
