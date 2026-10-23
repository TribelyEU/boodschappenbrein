// Herbruikbare UI-onderdelen.

import { html, icon, raw } from './dom.js';
import { startOfWeek, addDays, formatDate } from '../core/dates.js';
import { euro, pct } from '../core/money.js';
import { categoryName, categoryColor } from '../core/categories.js';

export const tag = {
  feit: html`<span class="tag-fact" title="Berekend uit uw bonnen">Feit</span>`,
  schatting: html`<span class="tag-est" title="Schatting op basis van uw gegevens">Schatting</span>`,
  voorspelling: html`<span class="tag-pred" title="Voorspelling; kan afwijken">Voorspelling</span>`,
};

export function statusChip(pred) {
  if (!pred) return html`<span class="chip muted">Onvoldoende gegevens</span>`;
  const tone = pred.status.tone === 'muted' ? 'muted' : pred.status.tone;
  return html`<span class="chip ${tone}">${pred.status.label}</span>`;
}

export function stockMeter(pred) {
  if (!pred || pred.status.id === 'onvoldoende' || pred.daysLeft == null) return '';
  const horizon = Math.max(pred.meanInterval || 7, 1);
  const frac = Math.max(0, Math.min(1, pred.daysLeft / horizon));
  const cls = pred.status.id === 'op' ? 'bad' : pred.status.id === 'bijna' ? 'warn' : '';
  return html`<div class="meter ${cls}" title="Geschatte resterende voorraad"><i style="width:${Math.round(frac * 100)}%"></i></div>`;
}

export function daysText(pred) {
  if (!pred || pred.daysLeft == null || pred.status.id === 'onvoldoende') return pred?.reason || '';
  const d = Math.round(pred.daysLeft);
  if (pred.status.id === 'op') return d < -1 ? `naar schatting ±${-d} dagen geleden op` : 'naar schatting op';
  if (d <= 1) return 'naar schatting vandaag of morgen op';
  return `nog ±${d} dagen (marge ±${Math.round(pred.margin)})`;
}

export function delta(change, { inverse = true } = {}) {
  if (change == null || !Number.isFinite(change)) return '';
  const up = change > 0;
  const cls = inverse ? (up ? 'delta-up' : 'delta-down') : (up ? 'delta-down' : 'delta-up');
  return html`<span class="${cls}">${pct(change)}</span>`;
}

export function catDot(id) {
  return html`<span class="dot" style="background:${categoryColor(id)}"></span>`;
}

export function empty(title, text, action = '') {
  return html`<div class="empty"><h3>${title}</h3><p>${text}</p>${action}</div>`;
}

export function noDataCard() {
  return html`<div class="card">
    ${empty('Nog geen kassabonnen', 'Importeer uw eerste bonnen. Daarna ziet u hier waar uw boodschappengeld naartoe gaat.',
      html`<a class="btn primary" href="#/importeren">${icon('import')}Bonnen importeren</a>`)}
  </div>`;
}

export function categoryRows(groups, totalNet, { action = 'cat' } = {}) {
  return groups.map((g) => html`
    <div class="row-item clickable" data-action="nav" data-to="analyse?groep=categorie&filter=${encodeURIComponent(g.key)}">
      ${catDot(g.key)}
      <div class="grow"><div class="title">${categoryName(g.key)}</div></div>
      <div class="amount num">${euro(g.net)}</div>
      <div class="muted small num" style="width:42px;text-align:right">${totalNet ? Math.round((g.net / totalNet) * 100) : 0}%</div>
    </div>`);
}

export function productLink(id, name) {
  return html`<a href="#/product/${encodeURIComponent(id)}">${name}</a>`;
}

/**
 * Tijdlijn per week (laatste `weeks` weken + verwachte week): grijs = gekocht, groen = met korting,
 * omlijnd = verwachte volgende aanbieding.
 */
export function rhythmStrip(r, today, weeks = 26) {
  if (!r) return '';
  const thisWeek = startOfWeek(today);
  const byWeek = new Map();
  for (const t of r.timeline || []) byWeek.set(t.week, byWeek.get(t.week) === 'promo' || t.promo ? 'promo' : 'buy');
  const cells = [];
  const ahead = r.status === 'ritme' && r.weeksUntil > 0 ? Math.min(r.weeksUntil, 8) : 0;
  for (let i = -weeks + 1; i <= ahead; i++) {
    const w = addDays(thisWeek, i * 7);
    const kind = byWeek.get(w) || (r.next === w ? 'next' : i > 0 ? 'future' : 'none');
    const label = `${formatDate(w, 'short')}: ${kind === 'promo' ? 'gekocht met korting' : kind === 'buy' ? 'gekocht' : kind === 'next' ? 'aanbieding verwacht' : '—'}`;
    cells.push(`<i class="rs-${kind}${r.next === w ? ' rs-next' : ''}${w === thisWeek ? ' rs-now' : ''}" title="${label}"></i>`);
  }
  return raw(`<div class="rhythm-strip" aria-label="Aankopen per week">${cells.join('')}</div>`);
}

export function rhythmLabel(r) {
  if (!r) return '';
  if (r.status === 'ritme') return r.inPromoNow ? 'nu in de aanbieding' : r.weeksUntil <= 1 ? `aanbieding verwacht ${r.weeksUntil <= 0 ? 'deze' : 'volgende'} week` : `±elke ${Math.round(r.every)} weken in de aanbieding`;
  return '';
}

/** Klein i-knopje dat een uitleg opent (in plaats van lange tekstblokken op het scherm). */
export function info(title, bodyHtml) {
  return html`<button class="info-btn" data-action="info" data-title="${title}" data-body="${String(bodyHtml)}" aria-label="Uitleg: ${title}">i</button>`;
}

/** Sectiekop met optioneel i-knopje en een link rechts. */
export function sectionHead(title, { infoTitle, infoBody, link, linkLabel, id } = {}) {
  return html`<div class="section-head" ${id ? html`id="${id}"` : ''}>
    <h2>${title}${infoBody ? html` ${info(infoTitle || title, infoBody)}` : ''}</h2>
    ${link ? html`<a class="link" href="#/${link}">${linkLabel || 'Alles'}</a>` : ''}
  </div>`;
}
