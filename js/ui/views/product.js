import { state, derived, updateProduct, mergeProducts, adjustStock, undoAdjustment, addToList, relinkLine } from '../../data/store.js';
import { html, icon, toast, openSheet, closeSheet, confirmSheet, esc } from '../dom.js';
import { euro } from '../../core/money.js';
import { priceHistory, groupBy, inRange } from '../../core/analytics.js';
import { CATEGORIES, categoryModel } from '../../core/categories.js';
import { MODELS } from '../../core/stock-model.js';
import { storeName } from '../../core/stores.js';
import { formatDate, addDays } from '../../core/dates.js';
import { lineChart } from '../charts.js';
import { tag, statusChip, stockMeter, daysText, empty, rhythmStrip } from '../components.js';
import { RHYTHM_STATUS } from '../../core/promo-rhythm.js';

export default {
  render([id]) {
    const p = state.products.get(id);
    if (!p) return html`<div class="card">${empty('Product niet gevonden', 'Mogelijk is het samengevoegd of verwijderd.', html`<a class="btn" href="#/analyse">Terug</a>`)}</div>`;
    const { facts, predictions, today } = derived();
    const pf = facts.filter((f) => f.productId === id);
    const hist = priceHistory(pf, id);
    const pred = predictions.get(id);
    const rh = derived().rhythm.byProduct.get(id);
    const year = inRange(pf, addDays(today, -365), today);
    const spend = year.reduce((t, f) => t + f.net, 0);
    const stores = groupBy(pf.filter((f) => f.gross > 0), (f) => f.store).sort((a, b) => b.count - a.count);
    const brands = groupBy(pf.filter((f) => f.gross > 0), (f) => f.brand || 'Zonder merk');
    const useBase = hist.filter((h) => h.perBase != null).length >= Math.max(2, hist.length * 0.6);
    const unitWord = hist.find((h) => h.weighed) ? 'kilo' : hist.find((h) => h.sizeUnit === 'ml') ? 'liter' : hist.find((h) => h.sizeUnit === 'g') ? 'kilo' : 'stuk';
    const points = hist.filter((h) => (useBase ? h.perBase != null : true)).map((h) => ({ x: formatDate(h.date, 'short'), y: useBase ? h.perBase : h.paidPerUnit, highlight: h.discounted }));
    const lines = state.lines.filter((l) => l.productId === id).sort((a, b) => b.date.localeCompare(a.date));
    const names = [...new Set(lines.map((l) => l.rawName))];
    const model = p.model || categoryModel(p.category);

    return html`
      <div class="page-head">
        <div style="min-width:0">
          <a class="small" href="#" data-action="back">${icon('back', 14)} Terug</a>
          <h1 style="margin-top:4px">${p.name}</h1>
          <p class="muted small">${names.slice(0, 4).join(' · ')}${names.length > 4 ? ` · +${names.length - 4}` : ''}</p>
        </div>
        <button class="icon-btn" data-action="fav" aria-label="Favoriet" style="color:${p.favorite ? 'var(--warn)' : 'var(--muted)'}">${icon('star', 24)}</button>
      </div>

      <div class="grid kpis">
        <div class="card kpi"><div class="label">12 maanden ${tag.feit}</div><div class="value num">${euro(spend)}</div><div class="sub">${year.length}× gekocht</div></div>
        <div class="card kpi"><div class="label">Laatste prijs</div><div class="value num">${hist.length ? euro(hist.at(-1).paidPerUnit) : '–'}</div><div class="sub">${hist.length ? `${storeName(hist.at(-1).store)} · ${formatDate(hist.at(-1).date, 'short')}` : ''}</div></div>
        <div class="card kpi"><div class="label">Verbruik ${tag.schatting}</div><div class="value num">${pred?.perWeek ? `${pred.perWeek.toFixed(1).replace('.', ',')}/wk` : '–'}</div><div class="sub">${pred?.perWeek ? 'stuks per week' : 'onvoldoende gegevens'}</div></div>
        <div class="card kpi"><div class="label">Meestal bij</div><div class="value" style="font-size:19px">${stores[0] ? storeName(stores[0].key) : '–'}</div><div class="sub">${stores.length > 1 ? `ook ${stores.slice(1, 3).map((s) => storeName(s.key)).join(', ')}` : ''}</div></div>
      </div>

      <div class="card" style="margin-top:14px">
        <div class="card-head"><h2>Voorraad ${tag.voorspelling}</h2>${statusChip(pred)}</div>
        <p class="muted small" style="margin-top:-4px">${pred ? (pred.status.id === 'onvoldoende' ? pred.reason : daysText(pred)) : 'Nog niet gekocht.'}</p>
        ${stockMeter(pred)}
        <div class="btn-row" style="margin-top:12px">
          <button class="btn small" data-action="adj" data-level="op">Het is op</button>
          <button class="btn small" data-action="adj" data-level="bijna">Bijna op</button>
          <button class="btn small" data-action="adj" data-level="genoeg">Nog genoeg</button>
          <button class="btn small primary" data-action="toList">${icon('plus', 16)}Op de lijst</button>
        </div>
      </div>

      ${rh && rh.purchases ? html`<div class="card" style="margin-top:14px">
        <div class="card-head"><h2>Bonus-ritme</h2><span class="chip ${rh.status === 'ritme' ? 'good' : 'muted'}">${RHYTHM_STATUS[rh.status]}</span></div>
        <p class="small" style="margin-top:-4px">${rh.promoPurchases} van ${rh.purchases} keer met korting gekocht${rh.discountPct != null ? ` · gemiddeld ${Math.round(rh.discountPct * 100)}% korting` : ''}${rh.saved ? ` · ${euro(rh.saved)} bespaard` : ''}.</p>
        ${rh.advice ? html`<p class="small" style="font-weight:600">${rh.advice}</p>` : ''}
        ${rhythmStrip(rh, today)}
        <div class="rhythm-legend" style="margin-top:6px"><span>gekocht</span><span class="l-promo">met korting</span>${rh.status === 'ritme' ? html`<span class="l-next">verwacht</span>` : ''}</div>
      </div>` : ''}

      <div class="card" style="margin-top:14px">
        <div class="card-head"><h2>Prijsverloop</h2><span class="muted small">${useBase ? `per ${unitWord}` : 'per verpakking'} · oranje = met korting</span></div>
        ${points.length >= 2 ? lineChart(points) : html`<p class="muted">Minimaal twee aankopen nodig.</p>`}
      </div>

      ${brands.length > 1 ? html`<div class="card" style="margin-top:14px">
        <div class="card-head"><h2>Merken</h2></div>
        <div class="rows">${brands.map((b) => {
          const hb = priceHistory(b.facts, id).filter((h) => h.perBase != null);
          const avg = hb.length ? Math.round(hb.reduce((t, h) => t + h.perBase, 0) / hb.length) : null;
          return html`<div class="row-item"><div class="grow"><div class="title">${b.key}</div><div class="sub">${b.count}× · ${euro(b.net)}</div></div>
            <div class="amount num">${avg != null ? `${euro(avg)}/${unitWord}` : ''}</div></div>`;
        })}</div>
      </div>` : ''}

      <div class="card" style="margin-top:14px">
        <div class="card-head"><h2>Alle aankopen</h2><span class="muted small">${lines.length}</span></div>
        <div class="scroll-x"><table class="table">
          <thead><tr><th>Datum</th><th>Op bon</th><th class="r">Aantal</th><th class="r">Betaald</th><th></th></tr></thead>
          <tbody>${lines.slice(0, 300).map((l) => {
            const f = pf.find((x) => x.lineId === l.id);
            return html`<tr>
              <td class="num" style="white-space:nowrap">${formatDate(l.date, 'short')} ${l.date.slice(2, 4)}<div class="tiny muted">${storeName(l.store)}</div></td>
              <td>${l.rawName}${l.promo ? html` <span class="chip good">bonus</span>` : ''}</td>
              <td class="r num">${l.weighed ? `${String(l.qty).replace('.', ',')} kg` : l.qty}</td>
              <td class="r num">${euro(f ? f.net : l.amount)}${f && f.discount < 0 ? html`<div class="tiny" style="color:var(--good)">${euro(f.discount)}</div>` : ''}</td>
              <td><button class="icon-btn" style="width:32px;height:32px" data-action="relink" data-line="${l.id}" title="Aan ander product koppelen" aria-label="Wijzig koppeling">${icon('chevron', 16)}</button></td>
            </tr>`;
          })}</tbody></table></div>
      </div>

      <div class="card" style="margin-top:14px">
        <h2>Instellingen product</h2>
        <div class="stack" style="margin-top:12px">
          <label class="field">Naam<input class="input" value="${p.name}" data-change="rename"></label>
          <label class="field">Categorie
            <select class="input" data-change="category">${CATEGORIES.map((c) => html`<option value="${c.id}" ${c.id === p.category ? 'selected' : ''}>${c.name}</option>`)}</select>
          </label>
          <label class="field">Voorraadmodel
            <select class="input" data-change="model">${Object.entries(MODELS).map(([k, m]) => html`<option value="${k}" ${k === model ? 'selected' : ''}>${m.label}${!p.model && k === model ? ' (automatisch)' : ''}</option>`)}</select>
          </label>
          <div><button class="btn" data-action="merge">Samenvoegen met ander product…</button>
          <p class="muted small">Gebruik dit als hetzelfde product onder twee namen staat. Alle aankopen worden samengevoegd en de app onthoudt het.</p></div>
        </div>
      </div>`;
  },
  actions: {
    async fav() { const id = currentId(); await updateProduct(id, { favorite: !state.products.get(id).favorite }); },
    async rename(el) { const v = el.value.trim(); if (v) { await updateProduct(currentId(), { name: v }); toast('Naam opgeslagen'); } },
    async category(el) { await updateProduct(currentId(), { category: el.value }); toast('Categorie aangepast; geldt voor alle aankopen van dit product'); },
    async model(el) { await updateProduct(currentId(), { model: el.value }); },
    async adj(el) {
      const a = await adjustStock(currentId(), el.dataset.level);
      toast('Voorraad gecorrigeerd', { action: 'Ongedaan maken', onAction: () => undoAdjustment(a.id) });
    },
    async toList() {
      const p = state.products.get(currentId());
      const pred = derived().predictions.get(p.id);
      await addToList({ name: p.name, productId: p.id, category: p.category, qty: Math.max(1, Math.round(pred?.typicalQty || 1)) });
      toast(`${p.name} staat op de lijst`);
    },
    merge() { pickProduct('Samenvoegen met…', 'Alle aankopen van dit product gaan naar het gekozen product.', async (target) => {
      const from = state.products.get(currentId());
      if (await confirmSheet('Samenvoegen?', `“${from.name}” wordt onderdeel van “${target.name}”.`, { confirm: 'Samenvoegen' })) {
        await mergeProducts(from.id, target.id);
        location.hash = '#/product/' + target.id;
        toast('Samengevoegd');
      }
    }); },
    relink(el) {
      const line = state.lines.find((l) => l.id === el.dataset.line);
      pickProduct('Bonregel koppelen aan…', `“${line.rawName}” — alle regels met precies deze omschrijving worden verplaatst en de app onthoudt dit.`, async (target) => {
        await relinkLine(line.id, target.id);
        toast(`Gekoppeld aan ${target.name}`);
      });
    },
  },
};

function currentId() { return decodeURIComponent(location.hash.split('/')[2]?.split('?')[0] || ''); }

export function pickProduct(title, text, onPick) {
  const products = [...state.products.values()].sort((a, b) => a.name.localeCompare(b.name));
  const sheet = openSheet(`
    <h2>${esc(title)}</h2><p class="muted small">${esc(text)}</p>
    <input class="input" placeholder="Zoek product…" data-f>
    <div class="rows" data-list style="margin-top:8px;max-height:50dvh;overflow:auto"></div>`);
  const listEl = sheet.querySelector('[data-list]');
  const draw = (q) => {
    const n = q.toLowerCase();
    listEl.innerHTML = products.filter((p) => !n || p.name.toLowerCase().includes(n) || p.key.includes(n)).slice(0, 60)
      .map((p) => `<div class="row-item clickable" data-pick="${esc(p.id)}"><div class="grow"><div class="title">${esc(p.name)}</div><div class="sub">${esc(p.key)}</div></div></div>`).join('');
  };
  draw('');
  sheet.querySelector('[data-f]').addEventListener('input', (e) => draw(e.target.value));
  listEl.addEventListener('click', (e) => {
    const row = e.target.closest('[data-pick]');
    if (!row) return;
    closeSheet();
    onPick(state.products.get(row.dataset.pick));
  });
}
