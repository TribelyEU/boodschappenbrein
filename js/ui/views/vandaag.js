// Vandaag: het startscherm. Alleen wat er nu toe doet, elk kort.

import { state, derived, addToList } from '../../data/store.js';
import { html, icon, toast } from '../dom.js';
import { euro, pctChange } from '../../core/money.js';
import { dashboardStats } from '../../core/analytics.js';
import { MONTH_NAMES, formatDate } from '../../core/dates.js';
import { daysText } from '../components.js';
import { offersSection } from './offers.js';

const cache = { v: -1, s: null };

export default {
  render() {
    const d = derived();
    const month = MONTH_NAMES[+d.today.slice(5, 7) - 1];
    const search = html`<form class="searchbox" data-submit="ask" style="margin:4px 0 16px">${icon('search', 20)}
      <input class="input" name="q" placeholder="Zoek een product of stel een vraag" autocomplete="off" enterkeyhint="search"></form>`;
    const head = html`<div class="page-head"><div><h1>Vandaag</h1><p class="muted">${formatDate(d.today)}</p></div>
      <a class="btn small" href="#/importeren">${icon('plus', 16)}Bon</a></div>`;

    if (!d.facts.length) {
      return html`${head}${search}
        <div class="card" style="text-align:center;padding:28px 18px">
          <h2>Welkom</h2>
          <p class="muted">Voeg je eerste kassabonnen toe. Daarna zie je hier wat bijna op is, wat deze week voordelig is en wat je uitgeeft.</p>
          <a class="big-action" href="#/importeren" style="justify-content:center;margin-top:8px"><span class="ic">${icon('plus', 22)}</span><span>Bon toevoegen</span></a>
          <p class="small muted" style="margin-top:14px">Eerst rondkijken met voorbeeldgegevens? Zet de <a href="#/instellingen">demomodus</a> aan.</p>
        </div>`;
    }

    if (cache.v !== state.version) { cache.s = dashboardStats(d.facts, d.today); cache.v = state.version; }
    const s = cache.s;
    const vsPrev = pctChange(s.prevMonthToDate, s.thisMonth);
    const low = [...d.predictions.entries()].filter(([id, p]) => (p.status.id === 'bijna' || p.status.id === 'op') && state.products.has(id))
      .sort((a, b) => a[1].daysLeft - b[1].daysLeft);
    const onList = state.list.filter((i) => !i.checked).length;
    const overdue = state.stockpile.filter((e) => d.freezer.get(e.id)?.overdue && d.freezer.get(e.id).packs > 0);

    return html`${head}${search}
      <div class="stack">
        ${offersSection({ compact: true })}

        <div class="card">
          <div class="quiet-line"><strong>Bijna op</strong><a class="link small" href="#/voorraad">Voorraad</a></div>
          ${low.length ? html`<div class="rows" style="margin-top:6px">${low.slice(0, 3).map(([id, p]) => html`
            <div class="row-item">
              <div class="grow clickable" data-action="nav" data-to="product/${id}"><div class="title">${state.products.get(id).name}</div><div class="sub">${daysText(p)}</div></div>
              <button class="btn small" data-action="toList" data-id="${id}" aria-label="Op de lijst">${icon('plus', 14)}Lijst</button>
            </div>`)}</div>
            ${low.length > 3 ? html`<a class="link small" href="#/voorraad" style="display:block;margin-top:8px">Nog ${low.length - 3} →</a>` : ''}`
            : html`<p class="small muted" style="margin:6px 0 0">Niets dat binnenkort op is.</p>`}
        </div>

        ${overdue.length ? html`<a class="card clickable" href="#/voorraad" style="display:block;color:inherit;background:var(--warn-soft);border-color:transparent">
          <strong>Uit de vriezer opmaken</strong><div class="small">${overdue.map((e) => e.name).join(', ')} ligt er al lang in.</div></a>` : ''}

        <a class="card clickable" href="#/analyse" style="display:block;color:inherit">
          <div class="quiet-line"><span class="muted small">Uitgegeven in ${month}</span>${vsPrev != null ? html`<span class="small ${vsPrev > 0 ? 'delta-up' : 'delta-down'}">${vsPrev > 0 ? '+' : '−'}${Math.abs(Math.round(vsPrev * 100))}% t.o.v. vorige maand</span>` : ''}</div>
          <div class="num-big num" style="font-size:28px;font-weight:700;margin-top:2px">${euro(s.thisMonth)}</div>
          ${s.forecast ? html`<div class="small muted">Verwacht deze maand ±${euro(s.forecast.monthTotal, { short: true })}</div>` : ''}
        </a>

        <a class="card clickable" href="#/lijst" style="display:flex;align-items:center;gap:12px;color:inherit">
          <div class="grow"><strong>Boodschappenlijst</strong><div class="small muted">${onList ? `${onList} product${onList === 1 ? '' : 'en'} te halen` : 'Leeg'}</div></div>${icon('chevron', 18)}
        </a>
      </div>`;
  },
  actions: {
    ask(form, ev, { go }) { const q = new FormData(form).get('q'); if (q) go('zoeken?q=' + encodeURIComponent(q)); },
    async toList(el) {
      const p = state.products.get(el.dataset.id);
      const pred = derived().predictions.get(p.id);
      await addToList({ name: p.name, productId: p.id, category: p.category, qty: Math.max(1, Math.round(pred?.typicalQty || 1)), source: 'suggestie' });
      toast(`${p.name} staat op de lijst`);
    },
  },
};
