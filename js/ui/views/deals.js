// Aanbiedingen: alles over goedkoper kopen op één plek.
//  1. Deze week voor jullie (AH-Bonus, vergeleken met wat jullie normaal betalen)
//  2. Inslagproducten (wc-papier, koffie, vriezer…)
//  3. Bonus-ritme (wanneer iets meestal weer in de aanbieding is)

import { state, derived } from '../../data/store.js';
import { html, icon } from '../dom.js';
import { offersSection, offerActions } from './offers.js';
import { inslagSection, inslagActions } from './stockpile.js';
import { rhythmStrip } from '../components.js';

const RITME_INFO = `<p>De app kijkt in welke weken jullie een product met korting kochten (de <strong>B</strong> op de AH-bon, of BONUS op een online factuur). Zit daar een vast patroon in, dan voorspelt de app wanneer het weer in de aanbieding komt.</p>
<p>Zo weet je: nu niet inslaan, volgende week is het waarschijnlijk goedkoper. Een ritme is pas te zien na een paar maanden bonnen.</p>`;

function rhythmSection() {
  const { rhythm, today } = derived();
  const rows = rhythm.rows.filter((r) => r.status === 'ritme').sort((a, b) => (b.inPromoNow - a.inPromoNow) || a.weeksUntil - b.weeksUntil).slice(0, 6);
  return html`
    <div class="section-head" id="ritme"><h2>Bonus-ritme ${html`<button class="info-btn" data-action="info" data-title="Bonus-ritme" data-body="${RITME_INFO}" aria-label="Uitleg">i</button>`}</h2></div>
    ${rows.length ? html`<div class="card tight"><div class="rows">${rows.map((r) => html`
      <div class="row-item clickable" data-action="nav" data-to="product/${r.productId}" style="flex-wrap:wrap">
        <div class="grow"><div class="title">${r.name}</div>
          <div class="sub">${r.inPromoNow ? 'nu in de aanbieding' : r.weeksUntil <= 0 ? 'verwacht deze week' : r.weeksUntil === 1 ? 'verwacht volgende week' : `verwacht over ±${r.weeksUntil} weken`} · elke ±${Math.round(r.every)} weken${r.discountPct ? ` · ${Math.round(r.discountPct * 100)}% korting` : ''}</div></div>
        <div style="width:100%">${rhythmStrip(r, today, 16)}</div>
      </div>`)}</div></div>`
      : html`<div class="card"><p class="muted" style="margin:0">Nog geen vast ritme gevonden. Dat wordt zichtbaar na een paar maanden bonnen.</p></div>`}`;
}

export default {
  render() {
    return html`
      <div class="page-head"><div><h1>Aanbiedingen</h1></div></div>
      ${offersSection()}
      ${inslagSection()}
      ${rhythmSection()}
      <a class="card clickable" href="#/vergelijken" style="display:flex;align-items:center;gap:12px;margin-top:26px;color:inherit">
        <div class="grow"><strong>Gewone prijzen vergelijken</strong><div class="small muted">Waar is jullie lijst het goedkoopst, zonder acties?</div></div>
        ${icon('chevron', 18)}
      </a>`;
  },
  actions: { ...offerActions, ...inslagActions },
};

export { state };
