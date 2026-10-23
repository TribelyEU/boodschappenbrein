// Voorraad → Inslag en Vriezer.

import { state, derived, saveStockpile, deleteStockpile, freezerAction, undoFreezerAction, addToList, setSetting } from '../../data/store.js';
import { html, icon, toast, openSheet, closeSheet, confirmSheet, esc } from '../dom.js';
import { euro, parseAmount, parseNumber } from '../../core/money.js';
import { storeName } from '../../core/stores.js';
import { formatDate } from '../../core/dates.js';
import { priceStats, entryPrediction, adviseDeal, suggestEntries, DEAL_TYPES, LOCATIONS, toDisplay } from '../../core/stockpile.js';
import { tag, empty, noDataCard } from '../components.js';
import { pickProduct } from './product.js';

export function stockTabs(active) {
  const tabs = [['voorspelling', 'Voorspelling'], ['inslag', 'Inslag'], ['vriezer', 'Vriezer']];
  return html`<div class="seg" style="margin-bottom:14px">${tabs.map(([k, l]) => html`<button class="${active === k ? 'on' : ''}" data-action="nav" data-to="voorraad?tab=${k}">${l}</button>`)}</div>`;
}

function ctx() {
  const d = derived();
  return { facts: d.facts, lines: state.lines, adjustments: state.adjustments, products: state.products, today: d.today, vacations: state.settings.vacations, manual: state.freezer };
}

const unitWord = (u) => (u === 'st' ? 'stuks' : u === 'g' ? 'kg' : u === 'ml' ? 'liter' : 'pakken');
const fmtNum = (n, d = 1) => (n == null ? '–' : (Math.round(n * 10 ** d) / 10 ** d).toString().replace('.', ','));

function entryCard(e, c) {
  const pred = entryPrediction(e, c);
  const members = e.members.filter((m) => state.products.has(m.productId));
  const std = members.find((m) => m.role !== 'upgrade') || members[0];
  const st = std ? priceStats(c.facts, std.productId) : { observations: 0 };
  const target = e.target ?? st.autoTarget;
  const weeks = pred.ratePerDay ? (pred.estimatedStock || 0) / (pred.ratePerDay * 7) : null;
  const frac = weeks != null ? Math.max(0, Math.min(1, weeks / e.maxWeeks)) : 0;
  const rh = members.map((m) => derived().rhythm.byProduct.get(m.productId)).filter((r) => r?.status === 'ritme').sort((a, b) => a.weeksUntil - b.weeksUntil)[0];
  const fr = derived().freezer.get(e.id);
  return html`
    <div class="card" style="margin-top:12px">
      <div class="between" style="align-items:flex-start">
        <div style="min-width:0"><h3>${e.name}</h3>
          <div class="gap8 wrap" style="margin-top:4px">
            <span class="chip ${e.location === 'vriezer' ? 'info' : ''}">${LOCATIONS[e.location]}</span>
            ${members.map((m) => html`<span class="chip ${m.role === 'upgrade' ? 'warn' : ''}" title="${m.role === 'upgrade' ? 'Alleen bij een goede aanbieding' : 'Standaard'}">${m.role === 'upgrade' ? '⇧ ' : ''}${state.products.get(m.productId).name}</span>`)}
          </div>
        </div>
        <button class="icon-btn" data-action="editEntry" data-id="${e.id}" aria-label="Instellen">${icon('settings', 18)}</button>
      </div>
      <div style="margin-top:12px">
        <div class="between small"><span>${weeks != null ? html`Nog ±<strong>${fmtNum(weeks)}</strong> weken voorraad` : html`<span class="muted">${pred.reason || 'Verbruik nog onbekend'}</span>`}</span><span class="muted">max ${e.maxWeeks} wk</span></div>
        <div class="meter ${weeks != null && weeks < 1.5 ? 'warn' : ''}" style="margin-top:6px"><i style="width:${Math.round(frac * 100)}%"></i></div>
        ${pred.perWeek ? html`<div class="tiny muted" style="margin-top:4px">Verbruik ±${fmtNum(toDisplay(pred.perWeek, pred.unit))} ${unitWord(pred.unit)} per week${fr?.packs > 0 ? ` · in de vriezer ±${fmtNum(fr.packs)} pak` : ''}</div>` : ''}
      </div>
      ${st.observations ? html`<div class="small" style="margin-top:10px">
        Normaal <strong class="num">${euro(st.typical)}</strong> per ${st.unitLabel}
        · doelprijs <strong class="num">${target != null ? euro(target) : '–'}</strong>${e.target == null ? html` <span class="muted">(${st.autoTarget != null ? 'automatisch' : 'na 4 aankopen'})</span>` : ''}
        · laagste <span class="num">${euro(st.best)}</span> <span class="muted">(${storeName(st.bestAt.store)}, ${formatDate(st.bestAt.date, 'short')})</span>
      </div>` : ''}
      ${rh ? html`<div class="tiny" style="margin-top:6px;color:var(--good);font-weight:650">${rh.inPromoNow ? 'Nu in de aanbieding (volgens ritme)' : `Bonus verwacht ${rh.weeksUntil <= 0 ? 'deze week' : rh.weeksUntil === 1 ? 'volgende week' : `over ±${rh.weeksUntil} weken`}`}</div>` : ''}
      <div class="btn-row" style="margin-top:12px"><button class="btn small primary" data-action="judgeDeal" data-id="${e.id}">${icon('tag', 16)}Aanbieding beoordelen</button></div>
    </div>`;
}

export function inslagView() {
  const d = derived();
  if (!d.facts.length) return html`<div class="page-head"><div><h1>Voorraad</h1></div></div>${stockTabs('inslag')}${noDataCard()}`;
  const c = ctx();
  const inEntries = new Set(state.stockpile.flatMap((e) => e.members.map((m) => m.productId)));
  const sugg = suggestEntries(d.facts, state.products, d.today, { existing: inEntries, freezer: state.settings.hasFreezer !== false, rhythm: d.rhythm.byProduct }).slice(0, 8);
  return html`
    <div class="page-head"><div><h1>Inslaglijst</h1><p class="muted">Producten waar het loont om bij een goede prijs voor weken in te slaan.</p></div>
      <button class="btn small" data-action="addEntry">${icon('plus', 16)}Product</button></div>
    ${stockTabs('inslag')}
    ${state.stockpile.length ? state.stockpile.map((e) => entryCard(e, c)) : html`<div class="card">${empty('Nog niets op de inslaglijst', 'Kies hieronder een voorstel, of voeg zelf een product toe (bv. wc-papier, koffiecups, wasmiddel).')}</div>`}

    ${sugg.length ? html`<div class="section-label">Voorgesteld ${tag.schatting}</div>
      <div class="card tight"><div class="rows">${sugg.map((s) => html`
        <div class="row-item">
          <div class="grow"><div class="title">${s.name}</div><div class="sub">${s.reason}</div></div>
          <span class="chip good num">±${euro(s.monthly)}/mnd</span>
          <button class="btn small" data-action="addSuggested" data-id="${s.productId}">${icon('plus', 14)}</button>
        </div>`)}</div></div>
      <p class="muted tiny">Bedrag: geschatte besparing per maand als jullie dit altijd tegen een goede prijs kopen (theoretisch).</p>` : ''}

    <details class="card" style="margin-top:14px"><summary>Hoe werkt de inslaglijst?</summary>
      <div class="small muted" style="margin-top:8px">
        <p><strong>Doelprijs</strong>: automatisch het beste kwart van wat jullie zelf betaalden (vanaf 4 aankopen), of een eigen bedrag. Prijzen worden per stuk, kilo of liter vergeleken als de inhoud bekend is, zodat een pak van 16 en een pak van 10 eerlijk naast elkaar staan.</p>
        <p><strong>Upgrade</strong> (bv. Starbucks naast Lidl-cups): alleen inslaan als de actieprijs per stuk onder jullie maximum zit; zonder maximum geldt de normale prijs van het standaardproduct.</p>
        <p><strong>Hoeveel</strong>: aanvullen tot de maximale voorraad in weken, in hele actiebundels (1+1 = per 2), en niet meer dan er in de vriezer past of daar goed blijft.</p>
        <p>Vanaf stap 4 beoordeelt de app de aanbiedingen uit de folders automatisch; tot die tijd vult u een aanbieding zelf in.</p>
      </div></details>`;
}

export function vriezerView() {
  const d = derived();
  const entries = state.stockpile.filter((e) => e.location === 'vriezer');
  const cap = state.settings.freezerCapacity || 40;
  const used = d.freezerUsed;
  const items = entries.map((e) => ({ e, f: d.freezer.get(e.id) })).filter((x) => x.f).sort((a, b) => (b.f.overdue - a.f.overdue) || (a.f.oldest || '9').localeCompare(b.f.oldest || '9'));
  return html`
    <div class="page-head"><div><h1>Vriezer ${tag.schatting}</h1><p class="muted">Bijgehouden zonder administratie: wat jullie extra kopen van een vriezerproduct, telt als ingevroren.</p></div></div>
    ${stockTabs('vriezer')}
    <div class="card">
      <div class="between"><strong>±${fmtNum(used)} van ${cap} verpakkingen</strong><span class="muted small">${Math.round((used / cap) * 100)}%</span></div>
      <div class="meter ${used / cap > 0.9 ? 'bad' : used / cap > 0.7 ? 'warn' : ''}" style="margin-top:8px"><i style="width:${Math.min(100, Math.round((used / cap) * 100))}%"></i></div>
      <label class="field small" style="margin-top:10px;max-width:260px">Capaciteit (verpakkingen, grof)
        <input class="input small num" type="number" min="5" max="400" value="${cap}" data-change="freezerCap"></label>
    </div>
    ${items.length ? html`<div class="card tight" style="margin-top:12px"><div class="rows">${items.map(({ e, f }) => html`
      <div class="row-item" style="flex-wrap:wrap">
        <div class="grow" style="min-width:55%">
          <div class="title">${e.name} ${f.overdue ? html`<span class="chip bad">plan in</span>` : ''}</div>
          <div class="sub">${f.packs > 0 ? `±${fmtNum(f.packs)} verpakking${f.packs === 1 ? '' : 'en'} · oudste ${formatDate(f.oldest, 'short')} (${Math.round(f.oldestWeeks)} wk${e.shelfWeeks ? `, max ±${e.shelfWeeks}` : ''})` : 'Waarschijnlijk niets meer in de vriezer'}</div>
        </div>
        <div class="stock-actions">
          <button data-action="frzAdd" data-id="${e.id}" title="Zelf iets ingevroren">+1</button>
          <button data-action="frzEmpty" data-id="${e.id}" title="Niets meer in de vriezer">Leeg</button>
        </div>
      </div>`)}</div></div>`
      : html`<div class="card" style="margin-top:12px">${empty('Nog geen vriezerproducten', 'Zet bij de inslaglijst een product op “Vriezer” (vlees, vis, brood, kaas). De app herkent daarna vanzelf wanneer jullie extra kochten om in te vriezen.', html`<a class="btn" href="#/voorraad?tab=inslag">Naar inslaglijst</a>`)}</div>`}
    ${items.some((x) => x.f.overdue) ? html`<p class="small" style="margin-top:10px">Iets met <span class="chip bad">plan in</span> ligt al lang in de vriezer. <a href="#/menu">Plan het in het weekmenu</a>.</p>` : ''}
    <details class="card" style="margin-top:14px"><summary>Hoe wordt dit geschat?</summary>
      <div class="small muted" style="margin-top:8px">
        <p>Koopt u van een vriezerproduct meer dan normaal (bv. 3 pakken kipfilet in plaats van 1), dan gaat de app ervan uit dat het extra deel is ingevroren. Met de verbruiksvoorspelling schat de app hoeveel er nog ligt; het oudste gaat het eerst op.</p>
        <p>Klopt het niet? Tik <strong>Leeg</strong> als er niets meer ligt, of <strong>+1</strong> als u zelf iets heeft ingevroren. Richtlijnen: gehakt ±3 maanden, kip/vis/vlees ±4 maanden, brood ±2,5 maand, kaas ±3 maanden (per product aan te passen).</p>
      </div></details>`;
}

// ---------- onderbladen ----------

function centsInput(v) {
  if (v == null || String(v).trim() === '') return null;
  const a = parseAmount(String(v).trim());
  if (a != null) return a;
  const n = parseNumber(v);
  return n == null ? null : Math.round(n * 100);
}

function entrySheet(entry) {
  const e = JSON.parse(JSON.stringify(entry));
  const draw = () => {
    const sheet = openSheet(`
      <h2>${esc(e.name)}</h2>
      <form class="stack" style="margin-top:10px" data-f>
        <label class="field">Naam<input class="input" name="name" value="${esc(e.name)}"></label>
        <div class="grid two" style="gap:10px">
          <label class="field">Waar<select class="input" name="location">${Object.entries(LOCATIONS).map(([k, l]) => `<option value="${k}" ${e.location === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field">Maximale voorraad (weken)<input class="input num" type="number" min="1" max="52" name="maxWeeks" value="${e.maxWeeks}"></label>
          <label class="field">Houdbaar in vriezer (weken)<input class="input num" type="number" min="1" max="104" name="shelfWeeks" value="${e.shelfWeeks ?? ''}" placeholder="—"></label>
          <label class="field">Doelprijs per eenheid (€, leeg = automatisch)<input class="input num" inputmode="decimal" name="target" value="${e.target != null ? (e.target / 100).toFixed(2).replace('.', ',') : ''}"></label>
        </div>
        <div><div class="section-label" style="margin-top:6px">Producten</div>
          ${e.members.map((m, i) => {
            const p = state.products.get(m.productId);
            return `<div class="row-item" style="flex-wrap:wrap;gap:8px">
              <div class="grow">${esc(p?.name || '(verwijderd product)')}</div>
              <select class="input small" style="width:auto" data-role="${i}"><option value="standaard" ${m.role !== 'upgrade' ? 'selected' : ''}>Standaard</option><option value="upgrade" ${m.role === 'upgrade' ? 'selected' : ''}>Upgrade bij actie</option></select>
              ${m.role === 'upgrade' ? `<input class="input small num" style="width:110px" inputmode="decimal" placeholder="max €/eenh." data-max="${i}" value="${m.maxPrice != null ? (m.maxPrice / 100).toFixed(2).replace('.', ',') : ''}">` : ''}
              ${e.members.length > 1 ? `<button type="button" class="icon-btn" data-del="${i}" aria-label="Verwijderen">✕</button>` : ''}
            </div>`;
          }).join('')}
          <button type="button" class="btn small ghost" data-addm>+ Product toevoegen (bv. ander merk)</button>
        </div>
        <div class="btn-row" style="justify-content:space-between">
          <button type="button" class="btn danger" data-remove>Van lijst halen</button>
          <button class="btn primary">Opslaan</button>
        </div>
      </form>`);
    const form = sheet.querySelector('[data-f]');
    const collect = () => {
      const fd = new FormData(form);
      e.name = String(fd.get('name') || e.name).trim();
      e.location = fd.get('location');
      e.maxWeeks = Math.max(1, +fd.get('maxWeeks') || e.maxWeeks);
      e.shelfWeeks = fd.get('shelfWeeks') ? +fd.get('shelfWeeks') : null;
      e.target = centsInput(fd.get('target'));
      sheet.querySelectorAll('[data-role]').forEach((el) => { e.members[+el.dataset.role].role = el.value; });
      sheet.querySelectorAll('[data-max]').forEach((el) => { e.members[+el.dataset.max].maxPrice = centsInput(el.value); });
    };
    sheet.querySelectorAll('[data-role]').forEach((el) => el.addEventListener('change', () => { collect(); draw(); }));
    sheet.querySelectorAll('[data-del]').forEach((el) => el.addEventListener('click', () => { collect(); e.members.splice(+el.dataset.del, 1); draw(); }));
    sheet.querySelector('[data-addm]').addEventListener('click', () => {
      collect();
      pickProduct('Product toevoegen', 'Kies een product dat dit kan vervangen (ander merk of andere verpakking).', (p) => {
        if (!e.members.some((m) => m.productId === p.id)) e.members.push({ productId: p.id, role: 'upgrade' });
        draw();
      });
    });
    sheet.querySelector('[data-remove]').addEventListener('click', async () => {
      closeSheet();
      if (e.id && await confirmSheet('Van de inslaglijst halen?', e.name, { confirm: 'Verwijderen', danger: true })) { await deleteStockpile(e.id); toast('Verwijderd'); }
    });
    form.addEventListener('submit', async (ev) => { ev.preventDefault(); collect(); await saveStockpile(e); closeSheet(); toast('Opgeslagen'); });
  };
  draw();
}

function dealSheet(entry) {
  const c = ctx();
  const members = entry.members.filter((m) => state.products.has(m.productId));
  const stores = (state.settings.myStores || []).map((s) => s.id);
  const st = { productId: members[0].productId, type: 'gratis', buy: 1, free: 1, store: stores[0] || 'ah' };
  const sheet = openSheet(`
    <h2>Aanbieding beoordelen</h2><p class="muted small">${esc(entry.name)}</p>
    <form class="stack" data-f style="margin-top:8px">
      <div class="grid two" style="gap:10px">
        <label class="field">Product<select class="input" name="productId">${members.map((m) => `<option value="${m.productId}">${esc(state.products.get(m.productId).name)}${m.role === 'upgrade' ? ' (upgrade)' : ''}</option>`).join('')}</select></label>
        <label class="field">Winkel<select class="input" name="store">${[...new Set([...stores, 'ah', 'lidl', 'jumbo', 'kruidvat'])].map((id) => `<option value="${id}">${esc(storeName(id))}</option>`).join('')}</select></label>
        <label class="field">Soort actie<select class="input" name="type">${Object.entries(DEAL_TYPES).map(([k, l]) => `<option value="${k}" ${k === 'gratis' ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field">Normale prijs per verpakking (€)<input class="input num" inputmode="decimal" name="normal" placeholder="uit jullie bonnen"></label>
      </div>
      <div class="grid two" style="gap:10px" data-extra></div>
      <div data-result></div>
      <button class="btn primary" type="submit" data-add disabled>Op de lijst</button>
    </form>`);
  const form = sheet.querySelector('[data-f]');
  const extra = sheet.querySelector('[data-extra]');
  const result = sheet.querySelector('[data-result]');
  const drawExtra = () => {
    const t = form.type.value;
    extra.innerHTML = t === 'prijs' ? `<label class="field">Actieprijs per verpakking (€)<input class="input num" inputmode="decimal" name="price"></label>`
      : t === 'pct' ? `<label class="field">Korting (%)<input class="input num" type="number" min="1" max="90" name="pct" value="25"></label>`
        : t === 'gratis' ? `<label class="field">Koop<input class="input num" type="number" min="1" max="9" name="buy" value="1"></label><label class="field">Gratis<input class="input num" type="number" min="1" max="9" name="free" value="1"></label>`
          : t === 'xvoor' ? `<label class="field">Aantal<input class="input num" type="number" min="2" max="20" name="n" value="3"></label><label class="field">Voor (€)<input class="input num" inputmode="decimal" name="total"></label>` : '';
  };
  let last = null;
  const calc = () => {
    const fd = new FormData(form);
    const deal = { type: fd.get('type') };
    if (deal.type === 'prijs') deal.price = centsInput(fd.get('price'));
    if (deal.type === 'pct') deal.pct = +fd.get('pct');
    if (deal.type === 'gratis') { deal.buy = +fd.get('buy') || 1; deal.free = +fd.get('free') || 1; }
    if (deal.type === 'xvoor') { deal.n = +fd.get('n') || 2; deal.total = centsInput(fd.get('total')); }
    const normal = centsInput(fd.get('normal'));
    if (normal != null) deal.normal = normal;
    const pid = fd.get('productId');
    const stats = priceStats(c.facts, pid);
    if (!form.normal.value && stats.packPrice) form.normal.placeholder = `${(stats.packPrice / 100).toFixed(2).replace('.', ',')} (uit bonnen)`;
    if ((deal.type === 'prijs' && deal.price == null) || (deal.type === 'xvoor' && deal.total == null)) { result.innerHTML = ''; sheet.querySelector('[data-add]').disabled = true; return; }
    try {
      const freezerFree = entry.location === 'vriezer' ? (state.settings.freezerCapacity || 40) - derived().freezerUsed : null;
      const a = adviseDeal(entry, pid, deal, { ...c, freezerFree });
      last = { a, pid, store: fd.get('store') };
      const chip = a.verdict === 'inslaan' ? '<span class="chip good">Inslaan</span>' : a.verdict === 'redelijk' ? '<span class="chip warn">Redelijk, geen topdeal</span>' : a.verdict === 'niet' ? '<span class="chip bad">Niet inslaan</span>' : '<span class="chip muted">Onbekend</span>';
      result.innerHTML = `<div class="card flat" style="background:var(--surface-2)">
        <div class="between">${chip}${a.effBase != null ? `<strong class="num">${esc(euro(a.effBase))} / ${esc(a.unitLabel)}</strong>` : ''}</div>
        ${a.buyPacks ? `<div style="margin-top:8px;font-size:18px;font-weight:700">Koop ${a.buyPacks} verpakking${a.buyPacks === 1 ? '' : 'en'}${a.saving > 0 ? ` · ±${esc(euro(a.saving))} besparing` : ''}</div>
          ${a.coversWeeks ? `<div class="small muted">Genoeg voor ±${Math.round(a.coversWeeks)} weken. Minder of meer? Pas het maximum aan bij Instellen.</div>` : ''}` : ''}
        <ul class="small" style="margin:8px 0 0;padding-left:18px">${a.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
        ${a.warnings.length ? `<ul class="small" style="margin:6px 0 0;padding-left:18px;color:var(--warn)">${a.warnings.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
      </div>`;
      const btn = sheet.querySelector('[data-add]');
      btn.disabled = !a.buyPacks;
      btn.textContent = a.buyPacks ? `${a.buyPacks}× op de lijst` : 'Op de lijst';
    } catch (err) { result.innerHTML = `<div class="notice bad small">${esc(err.message)}</div>`; }
  };
  drawExtra();
  calc();
  form.addEventListener('input', calc);
  form.addEventListener('change', (ev) => { if (ev.target.name === 'type') drawExtra(); calc(); });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!last?.a.buyPacks) return;
    const p = state.products.get(last.pid);
    await addToList({ name: p.name, productId: p.id, category: p.category, qty: last.a.buyPacks, source: 'inslag', note: `${storeName(last.store)}: ${last.a.dealLabel}`, store: last.store });
    closeSheet();
    toast(`${last.a.buyPacks}× ${p.name} op de lijst`);
  });
}

export const inslagActions = {
  addEntry() {
    pickProduct('Op de inslaglijst', 'Kies het product dat jullie normaal kopen. Andere merken kunt u daarna toevoegen.', async (p) => {
      const e = await saveStockpile({ members: [{ productId: p.id, role: 'standaard' }], name: p.name });
      toast(`${p.name} staat op de inslaglijst`);
      entrySheet(e);
    });
  },
  async addSuggested(el) {
    const p = state.products.get(el.dataset.id);
    await saveStockpile({ members: [{ productId: p.id, role: 'standaard' }], name: p.name, location: state.settings.hasFreezer === false ? 'kast' : undefined });
    toast(`${p.name} staat op de inslaglijst`);
  },
  editEntry(el) { entrySheet(state.stockpile.find((e) => e.id === el.dataset.id)); },
  judgeDeal(el) { dealSheet(state.stockpile.find((e) => e.id === el.dataset.id)); },
  async frzAdd(el) { const r = await freezerAction(el.dataset.id, 'erbij', 1); toast('1 verpakking erbij', { action: 'Ongedaan maken', onAction: () => undoFreezerAction(r.id) }); },
  async frzEmpty(el) { const r = await freezerAction(el.dataset.id, 'leeg'); toast('Gemarkeerd als leeg', { action: 'Ongedaan maken', onAction: () => undoFreezerAction(r.id) }); },
  async freezerCap(el) { const v = Math.max(5, Math.min(400, +el.value || 40)); await setSetting('freezerCapacity', v); },
};

// ---------- compacte secties (nieuwe indeling) ----------

const INSLAG_INFO = `<p>Producten waarbij het loont om bij een goede prijs voor een paar weken in te slaan, zoals wc-papier, koffie, wasmiddel of vlees voor de vriezer.</p>
<p><strong>Doelprijs:</strong> automatisch de goedkoopste kwart van wat jullie zelf betaalden (vanaf 4 aankopen), of zelf in te stellen via het tandwiel.</p>
<p><strong>Ander merk bij actie</strong> (bv. Starbucks naast Lidl-cups): voeg het toe via het tandwiel als "upgrade". Het wordt alleen aangeraden als het per stuk niet te duur is.</p>
<p>Zie je ergens een aanbieding (ook bij Lidl of Kruidvat)? Tik op het <strong>labeltje</strong> naast het product: de app zegt of het loont en hoeveel je moet kopen. Met het <strong>tandwiel</strong> stel je het product in.</p>`;

const VRIEZER_INFO = `<p>Je hoeft niets bij te houden. Koop je van een vriezerproduct meer dan normaal (bv. 3 pakken kipfilet in plaats van 1), dan telt het extra deel als ingevroren. Wat er nog ligt, schat de app uit jullie verbruik; het oudste gaat eerst op.</p>
<p>Klopt het niet? Tik <strong>Leeg</strong> of <strong>+1</strong>. Een product wordt een vriezerproduct via het tandwiel bij Inslagproducten.</p>
<p>Richtlijnen: gehakt ±3 maanden, kip/vis/vlees ±4 maanden, brood ±2,5 maand, kaas ±3 maanden.</p>`;

function entryRow(e, c) {
  const pred = entryPrediction(e, c);
  const members = e.members.filter((m) => state.products.has(m.productId));
  const std = members.find((m) => m.role !== 'upgrade') || members[0];
  const st = std ? priceStats(c.facts, std.productId) : { observations: 0 };
  const target = e.target ?? st.autoTarget;
  const weeks = pred.ratePerDay ? (pred.estimatedStock || 0) / (pred.ratePerDay * 7) : null;
  const frac = weeks != null ? Math.max(0, Math.min(1, weeks / e.maxWeeks)) : 0;
  const rh = members.map((m) => derived().rhythm.byProduct.get(m.productId)).filter((r) => r?.status === 'ritme').sort((a, b) => a.weeksUntil - b.weeksUntil)[0];
  const upgrades = members.filter((m) => m.role === 'upgrade').map((m) => state.products.get(m.productId).name);
  const line2 = [
    weeks != null ? `nog ±${fmtNum(weeks)} wk` : 'voorraad onbekend',
    st.observations ? `normaal ${euro(st.typical)}/${st.unitLabel}` : '',
    target != null ? `doel ${euro(target)}` : '',
  ].filter(Boolean).join(' · ');
  return html`<div class="row-item">
    <div class="grow">
      <div class="title">${e.name}${e.location === 'vriezer' ? html` <span class="chip info">vriezer</span>` : ''}</div>
      <div class="sub">${line2}</div>
      ${upgrades.length ? html`<div class="tiny muted">bij actie ook: ${upgrades.join(', ')}</div>` : ''}
      ${rh ? html`<div class="tiny" style="color:var(--good);font-weight:650">${rh.inPromoNow ? 'Nu in de Bonus' : `Bonus verwacht ${rh.weeksUntil <= 0 ? 'deze week' : rh.weeksUntil === 1 ? 'volgende week' : `over ±${rh.weeksUntil} weken`}`}</div>` : ''}
      <div class="meter ${weeks != null && weeks < 1.5 ? 'warn' : ''}" style="margin-top:6px;max-width:240px"><i style="width:${Math.round(frac * 100)}%"></i></div>
    </div>
    <div style="display:flex;gap:2px;align-self:center">
      <button class="icon-btn" data-action="judgeDeal" data-id="${e.id}" aria-label="Aanbieding beoordelen" title="Aanbieding beoordelen">${icon('tag', 19)}</button>
      <button class="icon-btn" data-action="editEntry" data-id="${e.id}" aria-label="Instellen" title="Instellen">${icon('settings', 19)}</button>
    </div>
  </div>`;
}

export function inslagSection() {
  const d = derived();
  const c = ctx();
  const inEntries = new Set(state.stockpile.flatMap((e) => e.members.map((m) => m.productId)));
  const sugg = d.facts.length ? suggestEntries(d.facts, state.products, d.today, { existing: inEntries, freezer: state.settings.hasFreezer !== false, rhythm: d.rhythm.byProduct }).slice(0, 3) : [];
  return html`
    <div class="section-head" id="inslag"><h2>Inslagproducten ${html`<button class="info-btn" data-action="info" data-title="Inslagproducten" data-body="${INSLAG_INFO}" aria-label="Uitleg">i</button>`}</h2>
      <button class="btn small" data-action="addEntry">${icon('plus', 16)}Toevoegen</button></div>
    ${state.stockpile.length
      ? html`<div class="card tight"><div class="rows">${state.stockpile.map((e) => entryRow(e, c))}</div></div>`
      : html`<div class="card"><p class="muted" style="margin:0">Nog geen inslagproducten. Tik op <strong>Toevoegen</strong>, of kies een voorstel hieronder.</p></div>`}
    ${sugg.length ? html`<div class="card tight" style="margin-top:10px">
      <div class="tiny muted" style="padding:6px 2px 0;font-weight:650;text-transform:uppercase;letter-spacing:.04em">Voorgesteld</div>
      <div class="rows">${sugg.map((s) => html`
        <div class="row-item">
          <div class="grow"><div class="title">${s.name}</div><div class="sub">tot ±${euro(s.monthly)} per maand · ${s.purchases}× gekocht</div></div>
          <button class="btn small" data-action="addSuggested" data-id="${s.productId}">${icon('plus', 14)}</button>
        </div>`)}</div></div>` : ''}`;
}

export function vriezerSection() {
  const d = derived();
  const entries = state.stockpile.filter((e) => e.location === 'vriezer');
  const cap = state.settings.freezerCapacity || 40;
  const used = d.freezerUsed;
  const items = entries.map((e) => ({ e, f: d.freezer.get(e.id) })).filter((x) => x.f).sort((a, b) => (b.f.overdue - a.f.overdue) || (a.f.oldest || '9').localeCompare(b.f.oldest || '9'));
  return html`
    <div class="section-head" id="vriezer"><h2>Vriezer ${html`<button class="info-btn" data-action="info" data-title="Vriezer" data-body="${VRIEZER_INFO}" aria-label="Uitleg">i</button>`}</h2>
      ${entries.length ? html`<span class="small muted">±${fmtNum(used)} van ${cap} pakken</span>` : ''}</div>
    ${items.length ? html`<div class="card tight"><div class="rows">${items.map(({ e, f }) => html`
      <div class="row-item">
        <div class="grow">
          <div class="title">${e.name} ${f.overdue ? html`<span class="chip bad">opmaken</span>` : ''}</div>
          <div class="sub">${f.packs > 0 ? `±${fmtNum(f.packs)} pak · sinds ${formatDate(f.oldest, 'short')}` : 'waarschijnlijk op'}</div>
        </div>
        <div class="stock-actions">
          <button data-action="frzAdd" data-id="${e.id}" title="Zelf iets ingevroren">+1</button>
          <button data-action="frzEmpty" data-id="${e.id}" title="Niets meer in de vriezer">Leeg</button>
        </div>
      </div>`)}</div></div>`
      : html`<div class="card"><p class="muted" style="margin:0">Nog geen vriezerproducten. Zet bij <a href="#/aanbiedingen">Inslagproducten</a> een product op "Vriezer" (vlees, vis, brood, kaas).</p></div>`}`;
}
