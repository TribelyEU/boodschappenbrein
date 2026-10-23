import { state, derived, addToList, updateListItem, removeListItems } from '../../data/store.js';
import { html, icon, toast, openSheet, closeSheet, esc } from '../dom.js';
import { CATEGORIES, categoryName, guessCategory } from '../../core/categories.js';
import { neededWithin } from '../../core/stock-model.js';
import { tag, catDot, daysText, empty, rhythmLabel } from '../components.js';

function categoryOf(item) {
  if (item.category) return item.category;
  if (item.productId && state.products.get(item.productId)) return state.products.get(item.productId).category;
  return guessCategory(item.name).id;
}

function suggestions() {
  const { predictions } = derived();
  const onList = new Set(state.list.filter((i) => !i.checked).map((i) => i.productId).filter(Boolean));
  const dismissed = new Set((state.settings.dismissed || []).filter((d) => d.until >= derived().today).map((d) => d.productId));
  return [...predictions.entries()]
    .filter(([id, p]) => neededWithin(p, 4) && !onList.has(id) && !dismissed.has(id) && state.products.has(id))
    .sort((a, b) => a[1].daysLeft - b[1].daysLeft)
    .map(([id, p]) => ({ product: state.products.get(id), pred: p, qty: Math.max(1, Math.round(p.typicalQty || 1)) }));
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
    const sugg = suggestions();
    const groups = new Map();
    for (const it of open) {
      const c = categoryOf(it);
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c).push(it);
    }
    const ordered = CATEGORIES.map((c) => c.id).filter((id) => groups.has(id));
    const favorites = [...state.products.values()].filter((p) => p.favorite);
    const incoming = query.get('import') ? decodeList(query.get('import')) : [];

    return html`
      <div class="page-head">
        <div><h1>Boodschappenlijst</h1><p class="muted">${open.length ? `${open.length} te halen` : 'Lijst is leeg'}${done.length ? ` · ${done.length} afgevinkt` : ''}</p></div>
        <button class="btn small" data-action="share" ${state.list.length ? '' : 'disabled'}>${icon('share', 16)}Delen</button>
      </div>

      ${incoming.length ? html`<div class="card" style="margin-bottom:14px">
        <h2>Gedeelde lijst ontvangen</h2>
        <p class="muted">${incoming.length} producten: ${incoming.map((i) => `${i.qty}× ${i.name}`).join(', ')}</p>
        <div class="btn-row"><button class="btn primary" data-action="acceptShared">Toevoegen aan mijn lijst</button><a class="btn" href="#/lijst">Negeren</a></div>
      </div>` : ''}

      ${sugg.length ? html`<div class="card" style="margin-bottom:14px">
        <div class="card-head"><h2>Suggesties ${tag.voorspelling}</h2><button class="btn small ghost" data-action="addAllSuggestions">Alle ${sugg.length} toevoegen</button></div>
        <p class="muted small" style="margin-top:-6px">Op basis van uw aankoopritme. Er wordt niets toegevoegd zonder dat u tikt.</p>
        <div class="rows">${sugg.slice(0, 8).map((s) => html`
          <div class="row-item">
            <div class="grow"><div class="title">${s.product.name}</div><div class="sub">${s.pred.status.label} · ${daysText(s.pred)}</div>${(() => {
              const r = derived().rhythm.byProduct.get(s.product.id);
              if (r?.status !== 'ritme') return '';
              if (r.inPromoNow) return html`<div class="tiny" style="color:var(--good);font-weight:650;margin-top:2px">Nu in de aanbieding${r.stockUp ? ` — overweeg ${r.stockUp} stuks` : ''}</div>`;
              if (r.weeksUntil <= 1) return html`<div class="tiny" style="color:var(--warn);font-weight:650;margin-top:2px">Aanbieding verwacht ${r.weeksUntil <= 0 ? 'deze' : 'volgende'} week — ${s.pred.daysLeft > 7 ? 'wachten kan' : 'koop nu alleen het nodige'}</div>`;
              return '';
            })()}</div>
            <button class="icon-btn" data-action="dismiss" data-id="${s.product.id}" aria-label="Niet nu">${icon('x', 18)}</button>
            <button class="btn small" data-action="addSuggestion" data-id="${s.product.id}" data-qty="${s.qty}">${icon('plus', 16)}${s.qty}</button>
          </div>`)}</div>
      </div>` : ''}

      ${open.length ? ordered.map((cid) => html`
        <div class="section-label gap8">${catDot(cid)} ${categoryName(cid)}</div>
        <div class="card tight"><div class="rows">${groups.get(cid).map((it) => html`
          <div class="row-item">
            <button class="check" data-action="toggle" data-id="${it.id}" aria-label="Afvinken"></button>
            <div class="grow">
              <div class="title">${it.name}</div>
              ${it.source !== 'handmatig' || it.note ? html`<div class="sub">${it.source === 'suggestie' ? 'voorgesteld' : it.source === 'menu' ? 'uit weekmenu' : it.source === 'gedeeld' ? 'gedeeld' : it.source === 'inslag' ? 'inslaan' : ''}${it.note ? ` · ${it.note}` : ''}</div>` : ''}
            </div>
            <div class="stepper">
              <button data-action="qty" data-id="${it.id}" data-d="-1" aria-label="Minder">−</button>
              <span class="num">${it.qty}</span>
              <button data-action="qty" data-id="${it.id}" data-d="1" aria-label="Meer">+</button>
            </div>
          </div>`)}</div></div>`) : (sugg.length ? '' : html`<div class="card">${empty('Niets op de lijst', 'Voeg hieronder iets toe, of importeer bonnen zodat de app suggesties kan doen.')}</div>`)}

      ${done.length ? html`
        <div class="section-label between"><span>Afgevinkt</span><button class="btn small ghost" data-action="clearDone">Wis afgevinkte</button></div>
        <div class="card tight"><div class="rows">${done.map((it) => html`
          <div class="row-item" style="opacity:.6">
            <button class="check on" data-action="toggle" data-id="${it.id}" aria-label="Terugzetten">${icon('check', 16)}</button>
            <div class="grow"><div class="title" style="text-decoration:line-through">${it.qty > 1 ? `${it.qty}× ` : ''}${it.name}</div></div>
            <button class="icon-btn" data-action="remove" data-id="${it.id}" aria-label="Verwijderen">${icon('trash', 18)}</button>
          </div>`)}</div></div>` : ''}

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
    async addSuggestion(el) {
      const p = state.products.get(el.dataset.id);
      await addToList({ name: p.name, productId: p.id, category: p.category, qty: +el.dataset.qty || 1, source: 'suggestie' });
    },
    async addAllSuggestions() {
      for (const s of suggestions()) await addToList({ name: s.product.name, productId: s.product.id, category: s.product.category, qty: s.qty, source: 'suggestie' });
      toast('Suggesties toegevoegd');
    },
    async dismiss(el) {
      const { setSetting } = await import('../../data/store.js');
      const { addDays } = await import('../../core/dates.js');
      const list = (state.settings.dismissed || []).filter((d) => d.until >= derived().today && d.productId !== el.dataset.id);
      list.push({ productId: el.dataset.id, until: addDays(derived().today, 3) });
      await setSetting('dismissed', list);
      toast('Drie dagen niet voorgesteld. Is het product nog niet op? Corrigeer dan bij Voorraad.');
    },
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
        <p class="muted small">Er is (nog) geen automatische synchronisatie: alle gegevens staan alleen op dit apparaat. U kunt de lijst als tekst sturen, of als link die het andere gezinslid in Boodschappenbrein kan openen en overnemen.</p>
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
