// Herbruikbare UI-onderdelen.

import { html, icon, raw } from './dom.js';
import { startOfWeek, addDays, formatDate } from '../core/dates.js';
import { pct } from '../core/money.js';
import { categoryColor } from '../core/categories.js';

export const tag = {
  feit: html`<span class="tag-fact" title="Berekend uit uw bonnen">Feit</span>`,
  schatting: html`<span class="tag-est" title="Schatting op basis van uw gegevens">Schatting</span>`,
  voorspelling: html`<span class="tag-pred" title="Voorspelling; kan afwijken">Voorspelling</span>`,
};




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


/** Klein i-knopje dat een uitleg opent (in plaats van lange tekstblokken op het scherm). */
export function info(title, bodyHtml) {
  return html`<button class="info-btn" data-action="info" data-title="${title}" data-body="${String(bodyHtml)}" aria-label="Uitleg: ${title}">i</button>`;
}

