// Eenvoudige, lichte SVG-grafieken.

import { raw, esc } from './dom.js';
import { euro } from '../core/money.js';

/** Staafdiagram. items: [{label, value, action?, args?, highlight?}] */
export function barChart(items, { height = 170, format = (v) => euro(v, { short: true }) } = {}) {
  if (!items.length) return raw('');
  const W = 640;
  const H = height;
  const padL = 44;
  const padB = 22;
  const max = Math.max(1, ...items.map((i) => i.value));
  const nice = niceMax(max);
  const bw = Math.min((W - padL) / items.length, 90); // weinig staven: niet over de hele breedte uitsmeren
  const gap = Math.min(10, bw * 0.28);
  const y = (v) => H - padB - (Math.max(0, v) / nice) * (H - padB - 8);
  const ticks = [0, nice / 2, nice];
  const labelEvery = Math.ceil(items.length / 12);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">`;
  for (const t of ticks) s += `<line class="grid-line" x1="${padL}" x2="${W}" y1="${y(t)}" y2="${y(t)}"/><text x="${padL - 6}" y="${y(t) + 4}" text-anchor="end">${esc(format(t))}</text>`;
  items.forEach((it, i) => {
    const x = padL + i * bw + gap / 2;
    const h = Math.max(it.value > 0 ? 2 : 0, H - padB - y(it.value));
    const attrs = it.action ? ` data-action="${esc(it.action)}" ${Object.entries(it.args || {}).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}` : '';
    s += `<rect class="bar${it.dim ? ' dim' : ''}" x="${x.toFixed(1)}" y="${(H - padB - h).toFixed(1)}" width="${(bw - gap).toFixed(1)}" height="${h.toFixed(1)}" rx="4"${attrs}><title>${esc(it.label)}: ${esc(format(it.value))}</title></rect>`;
    if (i % labelEvery === 0) s += `<text x="${(x + (bw - gap) / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(it.label)}</text>`;
  });
  return raw(s + '</svg>');
}

/** Donutdiagram. segments: [{value, color, label}] */
export function donut(segments, { size = 132, thickness = 18, center = '' } = {}) {
  const totalV = segments.reduce((t, s) => t + Math.max(0, s.value), 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  let s = `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="${thickness}"/>`;
  if (totalV > 0) {
    for (const seg of segments) {
      if (seg.value <= 0) continue;
      const len = (seg.value / totalV) * c;
      s += `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${esc(seg.color)}" stroke-width="${thickness}" stroke-dasharray="${Math.max(0, len - 1.5).toFixed(2)} ${(c - len + 1.5).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"><title>${esc(seg.label)}</title></circle>`;
      offset += len;
    }
  }
  if (center) s += `<text x="50%" y="52%" text-anchor="middle" dominant-baseline="middle" style="font-size:15px;font-weight:650;fill:var(--ink)">${esc(center)}</text>`;
  return raw(s + '</svg>');
}

/** Lijngrafiek voor prijshistorie. points: [{x: label, y, highlight?}] */
export function lineChart(points, { height = 160, format = (v) => euro(v) } = {}) {
  if (points.length < 2) return raw('');
  const W = 640;
  const H = height;
  const padL = 54;
  const padB = 22;
  const ys = points.map((p) => p.y);
  let min = Math.min(...ys);
  let max = Math.max(...ys);
  if (min === max) { min *= 0.9; max *= 1.1; }
  const span = max - min;
  min = Math.max(0, min - span * 0.15);
  max += span * 0.15;
  const x = (i) => padL + (i / (points.length - 1)) * (W - padL - 8);
  const y = (v) => H - padB - ((v - min) / (max - min)) * (H - padB - 10);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">`;
  for (const t of [min, (min + max) / 2, max]) s += `<line class="grid-line" x1="${padL}" x2="${W}" y1="${y(t)}" y2="${y(t)}"/><text x="${padL - 6}" y="${y(t) + 4}" text-anchor="end">${esc(format(Math.round(t)))}</text>`;
  s += `<path class="line" d="${points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ')}"/>`;
  points.forEach((p, i) => { s += `<circle class="pt${p.highlight ? ' disc' : ''}" cx="${x(i).toFixed(1)}" cy="${y(p.y).toFixed(1)}" r="3.5"><title>${esc(p.x)}: ${esc(format(p.y))}${p.highlight ? ' (met korting)' : ''}</title></circle>`; });
  const every = Math.ceil(points.length / 6);
  points.forEach((p, i) => { if (i % every === 0 || i === points.length - 1) s += `<text x="${x(i).toFixed(1)}" y="${H - 5}" text-anchor="middle">${esc(p.x)}</text>`; });
  return raw(s + '</svg>');
}

function niceMax(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
