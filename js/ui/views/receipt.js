import { state, deleteReceipt } from '../../data/store.js';
import { html, icon, toast, confirmSheet } from '../dom.js';
import { euro } from '../../core/money.js';
import { storeName } from '../../core/stores.js';
import { formatDate } from '../../core/dates.js';
import { empty } from '../components.js';

const KIND = { product: '', discount: 'korting', return: 'retour', deposit: 'statiegeld', nongrocery: 'geen boodschap' };

export default {
  render([id]) {
    const r = state.receipts.find((x) => x.id === id);
    if (!r) return html`<div class="card">${empty('Bon niet gevonden', '', html`<a class="btn" href="#/analyse?tab=bonnen">Alle bonnen</a>`)}</div>`;
    const lines = state.lines.filter((l) => l.receiptId === id).sort((a, b) => a.idx - b.idx);
    return html`
      <div class="page-head"><div>
        <a class="small" href="#/analyse?tab=bonnen">${icon('back', 14)} Alle bonnen</a>
        <h1 style="margin-top:4px">${storeName(r.store)}</h1>
        <p class="muted">${formatDate(r.date)} · ${r.source?.fileName || r.source?.type || ''}</p></div>
        <div style="text-align:right"><div class="num" style="font-size:24px;font-weight:700">${euro(r.total ?? r.computedTotal)}</div>
        ${r.check === 'ok' ? html`<span class="chip good">Totaal klopt</span>` : r.check === 'afwijking' ? html`<span class="chip bad">Som ${euro(r.computedTotal)}</span>` : html`<span class="chip muted">Geen bontotaal</span>`}</div>
      </div>
      ${r.reportedSavings ? html`<div class="notice good" style="margin-bottom:12px">Voordeel volgens ${storeName(r.store)}: <strong>${euro(r.reportedSavings)}</strong> — al verwerkt in de prijzen hieronder.</div>` : ''}
      <div class="card tight"><div class="rows">${lines.map((l) => html`
        <div class="row-item ${l.productId ? 'clickable' : ''}" ${l.productId ? html`data-action="nav" data-to="product/${l.productId}"` : ''}>
          <div class="grow"><div class="title">${l.rawName}</div>
          <div class="sub">${l.weighed ? `${String(l.qty).replace('.', ',')} kg` : `${l.qty}×`}${l.productId ? ` · ${state.products.get(l.productId)?.name || ''}` : ''}${KIND[l.kind] ? ` · ${KIND[l.kind]}` : ''}${l.promo ? ' · bonus' : ''}</div></div>
          <div class="amount num" style="${l.amount < 0 ? 'color:var(--good)' : ''}">${euro(l.amount)}</div>
        </div>`)}</div></div>
      ${r.rawText ? html`<details class="card" style="margin-top:14px"><summary>Originele gegevens</summary><pre class="raw">${r.rawText}</pre></details>` : ''}
      <button class="btn danger" style="margin-top:14px" data-action="del">${icon('trash', 16)}Bon verwijderen</button>`;
  },
  actions: {
    async del(el, ev, { go }) {
      const id = location.hash.split('/')[2];
      if (!(await confirmSheet('Bon verwijderen?', 'Deze bon en alle regels worden verwijderd.', { confirm: 'Verwijderen', danger: true }))) return;
      await deleteReceipt(id);
      toast('Bon verwijderd');
      go('analyse?tab=bonnen');
    },
  },
};
