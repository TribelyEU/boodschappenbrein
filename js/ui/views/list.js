import { state, derived, addToList, updateListItem, removeListItems, setSetting } from '../../data/store.js';
import { html, icon, toast, openSheet, closeSheet, esc } from '../dom.js';
import { CATEGORIES, categoryName, guessCategory } from '../../core/categories.js';
import { catDot, empty } from '../components.js';
import { euro } from '../../core/money.js';
import { storeName } from '../../core/stores.js';
import { addDays, formatDate } from '../../core/dates.js';
import { dueRepeaters, repeaterCandidates } from '../../core/repeat.js';
import { dealForListItem, unitOf } from '../../core/watch.js';
import { matchOffer } from '../../core/offers.js';
import { productTokens } from '../../core/products.js';
import { ahLink, choiceKey, packsForListItem, dealCost } from '../../core/ah.js';
import { backupDue, daysSinceBackup, backupNow, snoozeBackup } from '../../app/backup.js';
import { parseSize } from '../../core/products.js';
import { assortmentIndex, ahSuggest, ahSearch, saveAhChoices, dealFor as ahDealFor } from '../../data/lookup.js';

function categoryOf(item) {
  if (item.category) return item.category;
  if (item.productId && state.products.get(item.productId)) return state.products.get(item.productId).category;
  return guessCategory(item.name).id;
}

/** Herinneringen voor hardlopers (alleen producten die jullie zelf als hardloper hebben aangezet). */
function reminders() {
  const d = derived();
  const onList = new Set(state.list.filter((i) => !i.checked).map((i) => i.productId).filter(Boolean));
  return dueRepeaters({ repeaters: state.settings.repeaters || [], purchasesByProduct: d.purchasesByProduct, today: d.today, snoozed: state.settings.snoozed || {}, onList })
    .filter((r) => state.products.has(r.productId));
}

const weeksText = (days) => (days < 10 ? `${days} dagen` : `${Math.round(days / 7)} weken`);

/** Aanbieding voor een lijstregel (gecachet per versie). */
const dcache = { v: -1, map: new Map() };
function dealFor(it) {
  if (dcache.v !== state.version) { dcache.v = state.version; dcache.map = new Map(); }
  const k = `${it.name}|${it.productId || ''}`;
  if (!dcache.map.has(k)) {
    const d = derived();
    const offers = state.offers?.data?.offers || [];
    const key = productTokens(it.name).join(' ');
    const pseudo = key ? new Map([['x', { id: 'x', key, name: it.name }]]) : null;
    const matchByName = pseudo ? (o) => matchOffer(o, pseudo).length > 0 : null;
    dcache.map.set(k, dealForListItem(it.name, { offers, watchlist: state.settings.watchlist || [], ratings: state.settings.ratings || [], choices: state.settings.offerChoices || {}, today: d.today, stores: (state.settings.myStores || []).map((s) => s.id), matchByName }));
  }
  return dcache.map.get(k);
}

function dealLine(deal) {
  if (!deal) return '';
  const o = deal.offer;
  const unit = deal.watch ? unitOf(deal.watch).label : null;
  const what = o.mechanism || (deal.packPrice != null ? `voor ${euro(deal.packPrice)}` : 'aanbieding');
  const per = deal.perUnit != null && unit ? ` · ${euro(deal.perUnit)} per ${unit}` : '';
  return html`<div class="tiny" style="color:var(--good);font-weight:650;margin-top:2px;white-space:normal">${icon('tag', 12)} ${storeName(o.store)}: ${what}${per}${deal.count > 1 ? ` · nog ${deal.count - 1} andere` : ''}${o.url ? html` · <a href="${o.url}" target="_blank" rel="noopener noreferrer">bekijk ↗</a>` : ''}</div>`;
}

function encodeList(items) {
  const data = items.map((i) => [i.name, i.qty]);
  return btoa(unescape(encodeURIComponent(JSON.stringify(data)))).replace(/=+$/, '');
}
function decodeList(s) {
  try {
    const arr = JSON.parse(decodeURIComponent(escape(atob(s))));
    return Array.isArray(arr) ? arr.filter((x) => Array.isArray(x) && typeof x[0] === 'string').map(([name, qty]) => ({ name: name.slice(0, 80), qty: Math.max(1, Math.min(99, +qty || 1)) })) : [];
  } catch { return []; }
}

export default {
  render(params, query) {
    const open = state.list.filter((i) => !i.checked);
    const done = state.list.filter((i) => i.checked);
    const rem = reminders();
    const groups = new Map();
    for (const it of open) {
      const c = categoryOf(it);
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c).push(it);
    }
    const ordered = CATEGORIES.map((c) => c.id).filter((id) => groups.has(id));
    const favorites = [...state.products.values()].filter((p) => p.favorite);
    const incoming = query.get('import') ? decodeList(query.get('import')) : [];
    const deals = open.map((it) => [it, dealFor(it)]).filter(([, dl]) => dl);
    const byStore = new Map();
    for (const [, dl] of deals) byStore.set(dl.offer.store, (byStore.get(dl.offer.store) || 0) + 1);

    return html`
      <div class="page-head">
        <div><h1>Boodschappen</h1><p class="muted">${open.length ? `${open.length} te halen` : 'Lijst is leeg'}${done.length ? ` · ${done.length} afgevinkt` : ''}</p></div>
        <div class="gap8"><button class="btn small" data-action="share" ${state.list.length ? '' : 'disabled'} aria-label="Delen">${icon('share', 16)}</button>
        <button class="btn small primary" data-action="toAh" ${open.length ? '' : 'disabled'}>Naar AH</button></div>
      </div>

      ${backupDue() ? html`<div class="notice" style="margin-bottom:14px;display:flex;gap:10px;align-items:center">
        <div class="grow"><strong>Tijd voor een back-up</strong><div class="small muted">${daysSinceBackup() == null ? 'Er is nog geen back-up gemaakt.' : `Laatste back-up: ${daysSinceBackup()} dagen geleden.`} Je gegevens staan alleen op deze telefoon.</div></div>
        <div style="display:flex;flex-direction:column;gap:6px;flex:none">
          <button class="btn small primary" data-action="backupNow">Back-up maken</button>
          <button class="btn small ghost" data-action="backupLater">Later</button></div>
      </div>` : ''}
      ${incoming.length ? html`<div class="card" style="margin-bottom:14px">
        <h2>Gedeelde lijst ontvangen</h2>
        <p class="muted">${incoming.length} producten: ${incoming.map((i) => `${i.qty}× ${i.name}`).join(', ')}</p>
        <div class="btn-row"><button class="btn primary" data-action="acceptShared">Toevoegen aan mijn lijst</button><a class="btn" href="#/lijst">Negeren</a></div>
      </div>` : ''}

      ${rem.length ? html`<div class="card" style="margin-bottom:14px">
        <div class="quiet-line"><strong>Misschien weer nodig</strong></div>
        <div class="rows" style="margin-top:4px">${rem.map((r) => html`
          <div class="row-item">
            <div class="grow"><div class="title">${state.products.get(r.productId).name}</div>
              <div class="sub">meestal om de ${weeksText(r.every)} · laatst ${formatDate(r.last, 'short')}</div></div>
            <button class="btn small ghost" data-action="snooze" data-id="${r.productId}">Nu niet</button>
            <button class="btn small" data-action="addReminder" data-id="${r.productId}">${icon('plus', 14)}Lijst</button>
          </div>`)}</div>
      </div>` : ''}

      ${deals.length ? html`<p class="small" style="margin:0 2px 10px;color:var(--good);font-weight:600">${deals.length} van ${open.length} producten in de aanbieding: ${[...byStore.entries()].sort((a, b) => b[1] - a[1]).map(([st, n]) => `${storeName(st)} ${n}`).join(', ')}</p>` : ''}

      ${open.length ? ordered.map((cid) => html`
        <div class="section-label gap8">${catDot(cid)} ${categoryName(cid)}</div>
        <div class="card tight"><div class="rows">${groups.get(cid).map((it) => html`
          <div class="row-item">
            <button class="check" data-action="toggle" data-id="${it.id}" aria-label="Afvinken"></button>
            <div class="grow">
              <div class="title">${it.name}</div>
              ${it.note || it.source === 'menu' ? html`<div class="sub" style="white-space:normal">${it.note || 'uit weekmenu'}</div>` : ''}
              ${it.source === 'koopje' ? '' : dealLine(dealFor(it))}
            </div>
            <div class="stepper">
              <button data-action="qty" data-id="${it.id}" data-d="-1" aria-label="Minder">−</button>
              <span class="num">${it.qty}</span>
              <button data-action="qty" data-id="${it.id}" data-d="1" aria-label="Meer">+</button>
            </div>
          </div>`)}</div></div>`) : html`<div class="card">${empty('Niets op de lijst', 'Voeg hieronder iets toe, of zet ingrediënten vanuit het weekmenu op de lijst.')}</div>`}

      ${done.length ? html`
        <div class="section-label between"><span>Afgevinkt</span><button class="btn small ghost" data-action="clearDone">Wis afgevinkte</button></div>
        <div class="card tight"><div class="rows">${done.map((it) => html`
          <div class="row-item" style="opacity:.6">
            <button class="check on" data-action="toggle" data-id="${it.id}" aria-label="Terugzetten">${icon('check', 16)}</button>
            <div class="grow"><div class="title" style="text-decoration:line-through">${it.qty > 1 ? `${it.qty}× ` : ''}${it.name}</div></div>
            <button class="icon-btn" data-action="remove" data-id="${it.id}" aria-label="Verwijderen">${icon('trash', 18)}</button>
          </div>`)}</div></div>` : ''}

      <button class="btn small ghost" data-action="manageRepeaters" style="margin-top:14px">${icon('settings', 14)}Herinneringen voor hardlopers</button>

      ${favorites.length ? html`<div class="section-label">Favorieten</div>
        <div class="qa">${favorites.map((p) => html`<button class="chip" data-action="addFav" data-id="${p.id}">${icon('plus', 14)}${p.name}</button>`)}</div>` : ''}

      <div class="add-bar">
        <form class="card" data-submit="add">
          <input class="input" name="name" list="known-products" placeholder="Product toevoegen…" autocomplete="off" enterkeyhint="done" required>
          <input class="input" name="qty" type="number" inputmode="numeric" min="1" max="99" value="1" style="width:70px" aria-label="Aantal">
          <button class="btn primary" aria-label="Toevoegen">${icon('plus')}</button>
        </form>
        <datalist id="known-products">${[...state.products.values()].sort((a, b) => a.name.localeCompare(b.name)).map((p) => html`<option value="${p.name}">`)}</datalist>
      </div>
    `;
  },
  actions: {
    toAh() { ahSheet(); },
    async backupNow() { await backupNow(); },
    async backupLater() { await snoozeBackup(7); },
    async add(form) {
      const fd = new FormData(form);
      const name = String(fd.get('name') || '').trim();
      if (!name) return;
      const product = [...state.products.values()].find((p) => p.name.toLowerCase() === name.toLowerCase());
      await addToList({ name: product?.name || name, productId: product?.id, category: product?.category, qty: Math.max(1, +fd.get('qty') || 1) });
      setTimeout(() => document.querySelector('.add-bar input[name=name]')?.focus(), 0);
    },
    async toggle(el) {
      const it = state.list.find((i) => i.id === el.dataset.id);
      await updateListItem(it.id, { checked: !it.checked });
    },
    async qty(el) {
      const it = state.list.find((i) => i.id === el.dataset.id);
      const q = it.qty + Number(el.dataset.d);
      if (q <= 0) {
        await removeListItems([it.id]);
        toast(`${it.name} verwijderd`, { action: 'Ongedaan maken', onAction: () => addToList({ ...it, qty: 1 }) });
      } else await updateListItem(it.id, { qty: q });
    },
    async remove(el) { await removeListItems([el.dataset.id]); },
    async clearDone() { await removeListItems(state.list.filter((i) => i.checked).map((i) => i.id)); },
    async addReminder(el) {
      const p = state.products.get(el.dataset.id);
      await addToList({ name: p.name, productId: p.id, category: p.category, qty: 1, source: 'herinnering' });
    },
    async snooze(el) {
      const snoozed = { ...(state.settings.snoozed || {}), [el.dataset.id]: addDays(derived().today, 7) };
      await setSetting('snoozed', snoozed);
      toast('Over een week vraag ik het weer');
    },
    manageRepeaters() { repeaterSheet(); },
    async addFav(el) {
      const p = state.products.get(el.dataset.id);
      await addToList({ name: p.name, productId: p.id, category: p.category, qty: 1 });
    },
    async share() {
      const open = state.list.filter((i) => !i.checked);
      const text = open.map((i) => `${i.qty > 1 ? `${i.qty}× ` : ''}${i.name}`).join('\n');
      const url = `${location.origin}${location.pathname}#/lijst?import=${encodeList(open)}`;
      const sheet = openSheet(`
        <h2>Lijst delen</h2>
        <p class="muted small">Stuur de lijst als tekst, of als link die je in Boodschappenbrein op een andere telefoon kunt openen en overnemen.</p>
        <div class="stack">
          <button class="btn primary block" data-s="text">Als tekst delen</button>
          <button class="btn block" data-s="link">Als Boodschappenbrein-link delen</button>
          <textarea class="input" rows="6" readonly>${esc(text)}</textarea>
        </div>`);
      sheet.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-s]');
        if (!b) return;
        const payload = b.dataset.s === 'text' ? { title: 'Boodschappenlijst', text } : { title: 'Boodschappenlijst', text: 'Onze boodschappenlijst', url };
        try {
          if (navigator.share) await navigator.share(payload);
          else { await navigator.clipboard.writeText(payload.url || payload.text); toast('Gekopieerd naar het klembord'); }
          closeSheet();
        } catch (err) { if (err.name !== 'AbortError') toast('Delen lukte niet: ' + err.message); }
      });
    },
    async acceptShared(el, ev, { go }) {
      const items = decodeList(new URLSearchParams(location.hash.split('?')[1]).get('import'));
      for (const it of items) {
        const product = [...state.products.values()].find((p) => p.name.toLowerCase() === it.name.toLowerCase());
        await addToList({ name: it.name, qty: it.qty, productId: product?.id, category: product?.category, source: 'gedeeld' });
      }
      toast(`${items.length} producten toegevoegd`);
      go('lijst');
    },
  },
};

/** Kiezen welke producten hardlopers zijn: alles wat minstens 3 keer gekocht is, met de gebruikelijke tussentijd. */
function repeaterSheet() {
  const draw = () => {
    const on = new Set(state.settings.repeaters || []);
    const cands = repeaterCandidates(derived().purchasesByProduct, state.products);
    return `<h2>Hardlopers</h2>
      <p class="small muted">Zet aan wat jullie steeds opnieuw kopen. Is de gebruikelijke tijd bijna om, dan staat het bovenaan de lijst.</p>
      ${cands.length ? `<div class="rows">${cands.map((c) => `<label class="row-item" style="cursor:pointer">
        <input type="checkbox" data-id="${esc(c.productId)}" ${on.has(c.productId) ? 'checked' : ''} style="width:20px;height:20px">
        <div class="grow"><div class="title">${esc(c.name)}</div><div class="sub">${c.times}× gekocht · meestal om de ${weeksText(c.every)}</div></div></label>`).join('')}</div>`
        : '<p class="muted">Nog geen product dat minstens 3 keer gekocht is.</p>'}
      <button class="btn primary block" data-close style="margin-top:12px">Klaar</button>`;
  };
  const sheet = openSheet(draw());
  sheet.addEventListener('change', async (e) => {
    const cb = e.target.closest('input[data-id]');
    if (!cb) return;
    const set = new Set(state.settings.repeaters || []);
    if (cb.checked) set.add(cb.dataset.id); else set.delete(cb.dataset.id);
    await setSetting('repeaters', [...set]);
  });
  sheet.querySelector('[data-close]').onclick = closeSheet;
}

// ---------- naar het AH-mandje (via ah.nl) ----------
async function ahSheet() {
  const sheet = openSheet(`<h2>Naar AH</h2><div data-body><p class="muted small" style="padding:12px 0"><span class="spinner"></span> AH-producten zoeken…</p></div>`);
  const body = sheet.querySelector('[data-body]');
  let idx;
  try { idx = await assortmentIndex(); } catch (e) { body.innerHTML = `<p class="muted small">${esc(e.message)}</p>`; return; }
  const rows = state.list.filter((i) => !i.checked).map((it) => {
    const s = ahSuggest(idx, it.name, it.productId);
    return { it, pick: s, on: Boolean(s), open: false };
  });
  const packs = (r) => packsForListItem(r.it, parseSize(r.pick?.sizeText) || parseSize(r.pick?.name));
  const draw = () => {
    const chosen = rows.filter((r) => r.on && r.pick);
    const normal = chosen.reduce((t, r) => t + r.pick.price * packs(r), 0);
    const total = chosen.reduce((t, r) => t + dealCost(packs(r), r.pick.price, ahDealFor(r.pick.id)), 0);
    body.innerHTML = `
      <p class="muted small" style="margin:2px 0 8px">Controleer de producten. Daarna opent ah.nl en staat alles in je mandje.</p>
      <div class="rows">${rows.map((r, i) => `
        <div class="row-item" style="align-items:flex-start;gap:10px">
          <input type="checkbox" data-on="${i}" ${r.on ? 'checked' : ''} ${r.pick ? '' : 'disabled'} style="width:20px;height:20px;margin-top:2px;flex:none">
          <div class="grow" style="min-width:0">
            <div class="title" style="white-space:normal">${esc(r.it.name)}${r.it.note ? ` <span class="muted small">${esc(r.it.note)}</span>` : ''}</div>
            <div class="sub" style="white-space:normal">${r.pick ? `${packs(r) > 1 ? `<strong>${packs(r)}×</strong> ` : ''}${esc(r.pick.name)}${r.pick.sizeText ? ` · ${esc(r.pick.sizeText)}` : ''} · ${euro(r.pick.price)}${ahDealFor(r.pick.id) ? ` · <span style="color:var(--good);font-weight:650">bonus: ${esc(ahDealFor(r.pick.id).mechanism.toLowerCase())}</span>` : ''}` : 'Geen AH-product gevonden'}</div>
            ${r.open ? `<div style="margin-top:6px"><input class="input small" data-q="${i}" value="${esc(r.q ?? r.it.name)}" placeholder="Zoek bij AH">
              <div data-res="${i}"></div></div>` : ''}
          </div>
          <button class="kp-link" data-edit="${i}" style="margin-top:0">${r.open ? 'Klaar' : r.pick ? 'Wijzig' : 'Zoek'}</button>
        </div>`).join('')}</div>
      <div class="quiet-line" style="margin-top:12px"><span class="muted small">Totaal bij AH${normal - total >= 50 ? ` <span style="color:var(--good);font-weight:650">(bonus −${euro(normal - total)})</span>` : ''}</span><strong class="num">${euro(total)}</strong></div>
      <a class="btn primary block" style="margin-top:10px${chosen.length ? '' : ';pointer-events:none;opacity:.5'}" data-go target="_blank" rel="noopener" href="${esc(ahLink(chosen.map((r) => ({ id: r.pick.id, qty: packs(r) }))) || '#')}">Open AH met ${chosen.length} product${chosen.length === 1 ? '' : 'en'}</a>
      <p class="tiny muted" style="margin-top:6px">Je moet op ah.nl ingelogd zijn. Gewone AH-prijzen kunnen een paar dagen oud zijn; de bonus is die van deze week.</p>`;
    rows.forEach((r, i) => { if (r.open) results(i); });
  };
  const results = (i) => {
    const r = rows[i];
    const box = body.querySelector(`[data-res="${i}"]`);
    const found = ahSearch(idx, r.q ?? r.it.name, { limit: 8 });
    box.innerHTML = found.length ? found.map((f, k) => `<button class="row-item clickable" data-pick="${i}:${k}" style="width:100%;text-align:left;background:none;border-left:0;border-right:0;border-top:0;font:inherit;color:inherit;min-height:0;padding:8px 0">
      <span class="grow" style="white-space:normal">${esc(f.name)}<span class="muted small">${f.sizeText ? ` · ${esc(f.sizeText)}` : ''}</span></span><strong class="num small">${euro(f.price)}</strong></button>`).join('') : '<p class="muted small">Niets gevonden.</p>';
    r.found = found;
  };
  draw();
  body.addEventListener('change', (e) => { const c = e.target.closest('[data-on]'); if (c) { rows[+c.dataset.on].on = c.checked; draw(); } });
  let t;
  body.addEventListener('input', (e) => { const q = e.target.closest('[data-q]'); if (!q) return; rows[+q.dataset.q].q = q.value; clearTimeout(t); t = setTimeout(() => results(+q.dataset.q), 200); });
  body.addEventListener('click', (e) => {
    const ed = e.target.closest('[data-edit]');
    if (ed) { const r = rows[+ed.dataset.edit]; r.open = !r.open; draw(); body.querySelector(`[data-q="${ed.dataset.edit}"]`)?.focus(); return; }
    const pk = e.target.closest('[data-pick]');
    if (pk) {
      const [i, k] = pk.dataset.pick.split(':').map(Number);
      const f = rows[i].found[k];
      Object.assign(rows[i], { pick: { id: f.id, name: f.name, price: f.price, sizeText: f.sizeText }, on: true, open: false, changed: true });
      draw(); return;
    }
    const go = e.target.closest('[data-go]');
    if (go) {
      // Onthoud de keuzes, zodat het de volgende keer meteen goed staat
      const map = {};
      for (const r of rows) if (r.on && r.pick) map[choiceKey(r.it.name)] = { id: r.pick.id, name: r.pick.name, price: r.pick.price, sizeText: r.pick.sizeText };
      saveAhChoices(map);
    }
  });
}
