import { state, derived } from '../../data/store.js';
import { html, icon } from '../dom.js';
import { euro } from '../../core/money.js';
import { inRange, groupBy, timeSeries, total, bucketLabel } from '../../core/analytics.js';
import { categoryName, categoryColor } from '../../core/categories.js';
import { storeName } from '../../core/stores.js';
import { addDays, addMonths, startOfMonth, startOfWeek, formatDate, isoWeek } from '../../core/dates.js';
import { frequentProducts } from '../../core/savings.js';
import { barChart } from '../charts.js';
import { tag, catDot, noDataCard, empty, rhythmStrip } from '../components.js';
import { RHYTHM_STATUS } from '../../core/promo-rhythm.js';

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
      <div class="card-head"><h2>Uitgaven per ${g}</h2>${tag.feit}</div>
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
            <div class="sub">${gr.count}× ${gr.discount < 0 ? `· ${euro(-gr.discount)} korting` : ''}</div>
          </div>
          <div style="text-align:right">
            <div class="amount num">${euro(gr.net)}</div>
            <div class="tiny muted num">${sum ? Math.round((gr.net / sum) * 100) : 0}%</div>
          </div>
        </div>`;
      })}</div>` : html`<p class="muted">Geen aankopen in deze periode.</p>`}
    </div>`;
}

function savingsTab() {
  const { savings, facts, today } = derived();
  if (!savings.enoughData) return html`<div class="card">${empty('Nog te weinig gegevens', savings.reason || '')}</div>`;
  const theo = savings.advice.filter((a) => a.kind === 'theoretisch');
  const insights = savings.advice.filter((a) => a.kind !== 'theoretisch');
  const freq = frequentProducts(facts, state.products, today, 8);
  return html`
    <div class="grid kpis">
      <div class="card kpi"><div class="label">Gerealiseerd ${tag.feit}</div><div class="value num">${euro(savings.realized.discounts)}</div><div class="sub">korting op bonnen${savings.realized.reported ? ` (incl. ${euro(savings.realized.reported)} online voordeel)` : ''}, laatste ${Math.round(savings.realized.months)} mnd</div></div>
      <div class="card kpi"><div class="label">Mogelijk ${tag.schatting}</div><div class="value num">±${euro(savings.theoreticalMonthly)}</div><div class="sub">per maand, als u de adviezen volgt</div></div>
    </div>
    <div class="section-label">Besparingsvoorstellen</div>
    <div class="card tight">${theo.length ? html`<div class="rows">${theo.map((a) => html`
      <div class="row-item clickable" data-action="nav" data-to="product/${a.productId}" style="align-items:flex-start">
        <div class="grow"><div class="title" style="white-space:normal">${a.title}</div><div class="small muted" style="margin-top:2px">${a.explanation}</div>
        <div class="tiny muted" style="margin-top:4px">Zekerheid: ${a.confidence}</div></div>
        <span class="chip good num">±${euro(a.monthly)}/mnd</span>
      </div>`)}</div>` : html`<p class="muted" style="padding:6px">Nog geen voorstel met genoeg onderbouwing. Hiervoor moet u bijvoorbeeld hetzelfde product van verschillende merken hebben gekocht.</p>`}</div>
    ${insights.length ? html`<div class="section-label">Inzichten</div>
    <div class="card tight"><div class="rows">${insights.map((a) => html`
      <div class="row-item ${a.productId ? 'clickable' : ''}" ${a.productId ? html`data-action="nav" data-to="product/${a.productId}"` : ''} style="align-items:flex-start">
        <div class="grow"><div class="title" style="white-space:normal">${a.title}</div><div class="small muted">${a.explanation}</div></div>
      </div>`)}</div></div>` : ''}
    <div class="section-label">Meest gekocht (6 maanden)</div>
    <div class="card tight"><div class="rows">${freq.map((f) => html`
      <div class="row-item clickable" data-action="nav" data-to="product/${f.productId}">
        <div class="grow"><div class="title">${f.name}</div><div class="sub">${f.count}× gekocht</div></div><div class="amount num">${euro(f.net)}</div>
      </div>`)}</div></div>
    <p class="muted tiny">Theoretische besparingen zijn schattingen op basis van uw eigen aankopen; werkelijke prijzen en aanbiedingen kunnen verschillen.</p>`;
}

function bonusTab() {
  const { rhythm, today } = derived();
  const { rows, totals } = rhythm;
  const weeksOfData = Math.max(0, Math.round((new Date(today) - new Date(derived().facts.reduce((m, f) => (!m || f.date < m ? f.date : m), today))) / 6048e5));
  const ritme = rows.filter((r) => r.status === 'ritme').sort((a, b) => (b.inPromoNow - a.inPromoNow) || a.weeksUntil - b.weeksUntil || b.spend - a.spend);
  const waitable = rows.filter((r) => r.status !== 'ritme' && r.advice).sort((a, b) => b.spend - a.spend).slice(0, 12);
  const never = rows.filter((r) => r.status === 'nooit').sort((a, b) => b.spend - a.spend).slice(0, 8);
  const row = (r, showStrip) => html`
    <div class="row-item clickable" data-action="nav" data-to="product/${r.productId}" style="flex-wrap:wrap;align-items:flex-start">
      <div class="grow" style="min-width:60%">
        <div class="title">${r.name}</div>
        <div class="sub" style="-webkit-line-clamp:3">${r.advice || `${r.promoPurchases} van ${r.purchases} keer met korting`}</div>
      </div>
      <div style="text-align:right">
        ${r.status === 'ritme' ? (r.inPromoNow ? html`<span class="chip good">nu</span>` : html`<span class="chip ${r.weeksUntil <= 1 ? 'warn' : 'info'}">${r.weeksUntil <= 0 ? 'deze week' : `over ${r.weeksUntil} wk`}</span>`) : ''}
        <div class="tiny muted num" style="margin-top:4px">${euro(r.spend)}</div>
      </div>
      ${showStrip ? html`<div style="width:100%">${rhythmStrip(r, today)}</div>` : ''}
    </div>`;
  return html`
    <div class="grid kpis">
      <div class="card kpi"><div class="label">Met korting gekocht ${tag.feit}</div><div class="value num">${Math.round(totals.share * 100)}%</div><div class="sub">van de boodschappen (in euro's)</div></div>
      <div class="card kpi"><div class="label">Bespaard met acties ${tag.feit}</div><div class="value num">${euro(totals.saved)}</div><div class="sub">${totals.reported ? `incl. ${euro(totals.reported)} online voordeel` : 'korting op de bonnen'}</div></div>
    </div>

    ${weeksOfData < 12 ? html`<div class="notice" style="margin-top:14px">Er zijn ${weeksOfData} weken aan bonnen. Een vast ritme is pas te zien als een product minstens 3 keer met korting is gekocht; reken op 3 à 6 maanden. Oudere bonnen uit de AH-app importeren versnelt dit.</div>` : ''}

    <div class="section-label">Ritme gevonden ${tag.voorspelling}</div>
    ${ritme.length ? html`<div class="card tight">
      <div class="rhythm-legend" style="margin:4px 2px 6px"><span>gekocht</span><span class="l-promo">met korting</span><span class="l-next">verwacht</span></div>
      <div class="rows">${ritme.map((r) => row(r, true))}</div></div>`
      : html`<div class="card"><p class="muted" style="margin:0">Nog geen product met een herkenbaar Bonus-ritme.</p></div>`}

    ${waitable.length ? html`<div class="section-label">Vaak zonder korting gekocht</div>
      <div class="card tight"><div class="rows">${waitable.map((r) => row(r, false))}</div></div>` : ''}

    ${never.length ? html`<div class="section-label">Nooit met korting gekocht (grootste posten)</div>
      <div class="card tight"><div class="rows">${never.map((r) => html`
        <div class="row-item clickable" data-action="nav" data-to="product/${r.productId}">
          <div class="grow"><div class="title">${r.name}</div><div class="sub">${r.purchases}× gekocht · ${RHYTHM_STATUS.nooit.toLowerCase()}</div></div>
          <div class="amount num">${euro(r.spend)}</div></div>`)}</div></div>` : ''}

    <details class="card" style="margin-top:14px"><summary>Hoe werkt het Bonus-ritme?</summary>
      <div class="small muted" style="margin-top:8px">
        <p>De app kijkt per product in welke weken jullie het met korting kochten: een <strong>B</strong> achter het bedrag op de AH-bon, een gekoppelde BONUS-regel, of BONUS op een online factuur. Zitten er tussen die weken steeds ongeveer even veel weken, dan is er een ritme en voorspelt de app de volgende aanbieding.</p>
        <p><strong>Beperking:</strong> de app ziet alleen aanbiedingen in weken dat jullie het product kochten. Het echte ritme kan dus vaker zijn. Zodra de wekelijkse folder wordt ingelezen (stap 4), vervalt die beperking.</p>
        <p>De inslaghoeveelheid ("sla 10 stuks in") is het verbruik per week uit de voorraadvoorspelling × het aantal weken tot de volgende aanbieding.</p>
      </div></details>`;
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
        ${[['uitgaven', 'Overzicht'], ['besparen', 'Besparen'], ['bonnen', 'Alle bonnen']].map(([k, l]) => html`<button class="${tab === k ? 'on' : ''}" data-action="nav" data-to="analyse?tab=${k}">${l}</button>`)}
      </div>
      ${tab === 'besparen' ? savingsTab() : tab === 'bonnen' ? receiptsTab() : spendingTab(q)}`;
  },
};

export { bucketLabel, categoryColor };
