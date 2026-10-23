import { state, derived } from '../../data/store.js';
import { html, icon } from '../dom.js';
import { runQuery, EXAMPLE_QUESTIONS } from '../../core/query.js';
import { tag } from '../components.js';

export default {
  render(params, query) {
    const q = query.get('q') || '';
    const d = derived();
    const res = q ? runQuery(q, { facts: d.facts, products: state.products, predictions: d.predictions, savings: d.savings, rhythm: d.rhythm, today: d.today }) : null;
    return html`
      <div class="page-head"><div><h1>Vraag het</h1><p class="muted">Elk antwoord wordt berekend uit uw eigen bonnen.</p></div></div>
      <form class="searchbox" data-submit="ask">
        ${icon('search', 20)}
        <input class="input" name="q" value="${q}" placeholder="Hoeveel gaven we dit jaar uit aan koffie?" autocomplete="off" enterkeyhint="search" autofocus>
      </form>
      ${res ? html`
        <div class="card" style="margin-top:14px">
          <div class="between"><div class="muted small">${res.title}</div>${tag[res.kind] || ''}</div>
          <div style="font-family:var(--font-display);font-size:30px;font-weight:700;margin:4px 0" class="num">${res.answer}</div>
          ${res.basis ? html`<p class="muted small" style="margin:0">${res.basis}</p>` : ''}
          ${res.rows?.length ? html`<div class="rows" style="margin-top:10px">${res.rows.map((r) => html`
            <div class="row-item ${r.productId ? 'clickable' : ''}" ${r.productId ? html`data-action="nav" data-to="product/${r.productId}"` : ''} style="align-items:flex-start">
              <div class="grow"><div class="title" style="white-space:normal">${r.label}</div>${r.sub ? html`<div class="sub" style="white-space:normal">${r.sub}</div>` : ''}</div>
              <div class="amount num">${r.value}</div>
            </div>`)}</div>` : ''}
        </div>` : ''}
      <div class="section-label">Voorbeelden</div>
      <div class="rows card tight">${EXAMPLE_QUESTIONS.map((x) => html`<a class="row-item" href="#/zoeken?q=${encodeURIComponent(x)}"><div class="grow">${x}</div>${icon('chevron', 16)}</a>`)}</div>
      <p class="muted tiny" style="margin-top:14px">De zoekfunctie werkt zonder AI of internet: vragen worden herkend op trefwoorden (periode, winkel, categorie, product) en exact uitgerekend.</p>`;
  },
  actions: {
    ask(form, ev, { go }) { const q = new FormData(form).get('q'); if (q) go('zoeken?q=' + encodeURIComponent(q)); },
  },
};
