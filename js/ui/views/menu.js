import { state, derived, saveMeal, deleteMeal, setPlan, addToList, loadRecipes, notifyChanged } from '../../data/store.js';
import { matchIngredient, assortmentIndex, assortmentReady, priceFor } from '../../data/lookup.js';
import { dishCost } from '../../core/ah.js';
import { euro } from '../../core/money.js';
import { parseIngredient, amountText, searchRecipes } from '../../core/recipes.js';
import { html, raw, icon, toast, openSheet, closeSheet, confirmSheet, esc } from '../dom.js';
import { addDays, startOfWeek, formatDate } from '../../core/dates.js';
import { productTokens } from '../../core/products.js';
import { empty } from '../components.js';
import { storeName } from '../../core/stores.js';
import { dealForListItem } from '../../core/watch.js';
import { matchOffer } from '../../core/offers.js';

const DAYS = ['Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag', 'Zondag'];
let weekOffset = 0;

let loadStarted = false;
const costCache = new Map();
/** Boodschappenkosten van een gerecht (hele verpakkingen, zonder wat meestal in huis is). */
function costOf(meal) {
  if (!assortmentReady() && !loadStarted) { loadStarted = true; assortmentIndex().then(notifyChanged).catch(() => {}); }
  const key = `${meal.id}|${state.version}|${Boolean(assortmentReady())}`;
  if (!costCache.has(key)) costCache.set(key, dishCost(meal.ingredients, priceFor));
  return costCache.get(key);
}
/** "€ 9,10" met eronder "was € 12,40" als de aanbiedingen schelen. */
function priceHtml(c, { small = false } = {}) {
  if (c.total == null) return '<span class="tiny muted">onvolledig</span>';
  const now = `<strong class="num"${small ? '' : ' style="font-size:16px"'}>${euro(c.dealTotal)}</strong>`;
  return c.saving >= 50 ? `${now}<span class="tiny" style="display:block;color:var(--good);font-weight:650">bonus −${euro(c.saving)}</span>` : now;
}
function costLines(c) {
  const src = (l) => (l.source === 'eigen' ? 'jullie prijs' : 'AH');
  return `<div class="rows">${c.lines.map((l) => `<div class="row-item" style="min-height:0;padding:6px 0;gap:8px">
      <span class="grow" style="white-space:normal;font-size:13px">${esc(l.ing.name)}<span class="muted tiny" style="display:block">${l.packs > 1 ? `${l.packs}× ` : ''}${esc(l.name)} · ${src(l)}</span>
        ${l.deal ? `<span class="tiny" style="display:block;color:var(--good);font-weight:650">Bonus: ${esc(l.deal.mechanism.toLowerCase())}${l.deal.validTo ? ` t/m ${esc(formatDate(l.deal.validTo, 'short'))}` : ''}${l.saving ? '' : ' (scheelt pas bij meer stuks)'}</span>` : ''}</span>
      <span class="num small" style="text-align:right">${l.saving ? `<s class="muted tiny">${euro(l.cost)}</s><br>` : ''}${euro(l.dealCost)}</span></div>`).join('')}</div>
    ${c.missing.length ? `<p class="tiny" style="color:var(--warn);margin-top:6px">Geen prijs voor: ${esc(c.missing.join(', '))}</p>` : ''}
    <p class="tiny muted" style="margin-top:4px">Hele verpakkingen bij AH, met de AH-bonus van deze week. Wat meestal in huis is telt niet mee.</p>`;
}

/** Welke ingrediënten zijn deze week in de aanbieding (via de volglijst of een duidelijke naamovereenkomst)? */
function dealsFor(meal) {
  const offers = state.offers?.data?.offers || [];
  if (!offers.length) return [];
  const today = derived().today;
  const out = [];
  for (const ing of meal.ingredients) {
    const key = productTokens(ing.name).join(' ');
    const pseudo = key ? new Map([['x', { id: 'x', key, name: ing.name }]]) : null;
    const d = dealForListItem(ing.name, { offers, watchlist: state.settings.watchlist || [], ratings: state.settings.ratings || [], today,
      stores: (state.settings.myStores || []).map((s) => s.id), matchByName: pseudo ? (o) => matchOffer(o, pseudo).length > 0 : null });
    if (d) out.push(`${ing.name} (${storeName(d.offer.store)})`);
  }
  return out;
}

const FAMILY = 4;
const ingLine = (i) => `${i.amount ? `${i.amount} ` : i.qty > 1 ? `${i.qty} ` : ''}${i.name}${i.optional ? ' (optioneel)' : ''}`;
/** Ontleed ingrediënt → wat in een gerecht bewaard wordt: aantal (zonder eenheid) of hoeveelheid als tekst. */
function toIngredient(p, factor = 1) {
  const whole = p.amount != null && !p.unit && p.amountTo == null && Number.isInteger(p.amount * factor);
  return { qty: whole ? p.amount * factor : 1, name: p.name || p.raw, amount: whole ? '' : amountText(p, factor), pantry: p.pantry, optional: p.optional };
}

function editMeal(meal = { name: '', ingredients: [], kids: true, favorite: false }) {
  const sheet = openSheet(`
    <h2>${meal.id ? 'Gerecht bewerken' : 'Nieuw gerecht'}</h2>
    <form class="stack" style="margin-top:10px" data-meal>
      <label class="field">Naam<input class="input" name="name" value="${esc(meal.name)}" required></label>
      <label class="field">Ingrediënten (één per regel, optioneel aantal ervoor: "2 paprika")
        <textarea class="input" name="ing" rows="8">${esc(meal.ingredients.map(ingLine).join('\n'))}</textarea></label>
      ${meal.id && meal.ingredients.length ? (() => { const c = costOf(meal); return `<details class="card tight" style="margin:0"><summary class="small" style="font-weight:650">Boodschappen ${c.total != null ? euro(c.dealTotal) : 'prijs onvolledig'}${c.saving >= 50 ? ` <span style="color:var(--good)">(bonus −${euro(c.saving)})</span>` : ''}</summary>${costLines(c)}</details>`; })() : ''}
      ${meal.url ? `<a href="${esc(meal.url)}" target="_blank" rel="noopener noreferrer" class="small" style="font-weight:600">Bereiding op lekkerensimpel.com ↗</a>` : ''}
      <label class="gap8"><input type="checkbox" name="kids" ${meal.kids ? 'checked' : ''}> Kindvriendelijk</label>
      <label class="gap8"><input type="checkbox" name="favorite" ${meal.favorite ? 'checked' : ''}> Favoriet</label>
      <div class="btn-row" style="justify-content:flex-end">${meal.id ? '<button type="button" class="btn danger" data-del>Verwijderen</button>' : ''}<button class="btn primary">Opslaan</button></div>
    </form>`);
  const form = sheet.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const ingredients = String(fd.get('ing')).split('\n').map((s) => s.trim()).filter(Boolean).map((s) => toIngredient(parseIngredient(s.replace(/^(\d+)\s*[x×]\s+/, '$1 '))));
    await saveMeal({ ...meal, name: String(fd.get('name')).trim(), ingredients, kids: fd.get('kids') === 'on', favorite: fd.get('favorite') === 'on' });
    closeSheet();
  });
  sheet.querySelector('[data-del]')?.addEventListener('click', async () => {
    closeSheet();
    if (await confirmSheet('Gerecht verwijderen?', meal.name, { confirm: 'Verwijderen', danger: true })) await deleteMeal(meal.id);
  });
}

export default {
  render() {
    const { today } = derived();
    const monday = addDays(startOfWeek(today), weekOffset * 7);
    const meals = [...state.meals].sort((a, b) => (b.favorite - a.favorite) || a.name.localeCompare(b.name));
    return html`
      <div class="page-head"><div><h1>Weekmenu</h1></div>
        <button class="btn small primary" data-action="recipes">${icon('search', 16)}Recept zoeken</button></div>
      <div class="between" style="margin-bottom:10px">
        <button class="btn small" data-action="week" data-d="-1">${icon('back', 14)}</button>
        <strong>Week van ${formatDate(monday)}</strong>
        <button class="btn small" data-action="week" data-d="1">${icon('chevron', 14)}</button>
      </div>
      <div class="card tight"><div class="rows">${DAYS.map((d, i) => {
        const date = addDays(monday, i);
        const plan = state.plan.get(date);
        return html`<div class="row-item">
          <div style="width:90px" class="${date === today ? '' : 'muted'}"><div style="font-weight:600">${d.slice(0, 2)}</div><div class="tiny">${formatDate(date, 'short')}</div></div>
          <select class="input small" data-change="plan" data-date="${date}">
            <option value="">—</option>${meals.map((m) => html`<option value="${m.id}" ${plan?.mealId === m.id ? 'selected' : ''}>${m.favorite ? '★ ' : ''}${m.name}${m.kids ? ' 🧒' : ''}</option>`)}
          </select>
        </div>`;
      })}</div></div>
      <button class="btn primary block" style="margin-top:12px" data-action="toList" data-monday="${monday}">${icon('list', 18)}Ingrediënten van deze week op de lijst</button>

      <div class="between" style="margin:22px 2px 8px"><div class="section-label" style="margin:0">Gerechten</div>
        <button class="btn small ghost" data-action="newMeal">${icon('plus', 14)}Eigen gerecht</button></div>
      ${meals.length ? html`<div class="card tight"><div class="rows">${meals.map((m) => {
        const deals = dealsFor(m);
        const cost = costOf(m);
        return html`<div class="row-item clickable" data-action="editMeal" data-id="${m.id}">
          ${m.image ? html`<img class="kp-thumb" src="${m.image}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'" style="width:44px;height:44px;object-fit:cover">` : ''}
          <div class="grow"><div class="title">${m.favorite ? '★ ' : ''}${m.name}</div>
          <div class="sub">${[m.time ? `${m.time} min` : '', `${m.ingredients.length} ingrediënten`, m.kids ? 'kindvriendelijk' : ''].filter(Boolean).join(' · ')}</div>
          ${deals.length ? html`<div class="tiny" style="color:var(--good);font-weight:650;margin-top:2px;white-space:normal">${icon('tag', 12)} In de aanbieding: ${deals.join(', ')}</div>` : ''}</div>
          ${cost.total != null ? html`<span style="text-align:right;white-space:nowrap">${raw(priceHtml(cost, { small: true }))}</span>` : ''}
          ${icon('chevron', 16)}
        </div>`;
      })}</div></div>` : html`<div class="card">${empty('Nog geen gerechten', 'Voeg jullie vaste gerechten toe, zoals pasta bolognese of nasi.')}</div>`}`;
  },
  actions: {
    newMeal() { editMeal(); },
    editMeal(el) { editMeal(state.meals.find((m) => m.id === el.dataset.id)); },
    week(el, ev, { rerender }) { weekOffset += +el.dataset.d; rerender(); },
    async plan(el) { await setPlan(el.dataset.date, el.value || null); },
    toList(el) { weekToList(el.dataset.monday); },
    recipes() { recipeSheet(); },
  },
};

// ---------- ingrediënten van de week op de lijst (met vinkjes) ----------
function weekToList(monday) {
  const need = new Map();
  for (let i = 0; i < 7; i++) {
    const plan = state.plan.get(addDays(monday, i));
    const meal = plan && state.meals.find((m) => m.id === plan.mealId);
    if (!meal) continue;
    for (const ing of meal.ingredients) {
      const k = ing.name.toLowerCase();
      const cur = need.get(k) || { key: k, name: ing.name, qty: 0, amounts: [], meals: [], pantry: Boolean(ing.pantry), optional: Boolean(ing.optional) };
      if (ing.amount) cur.amounts.push(ing.amount); else cur.qty += ing.qty || 1;
      cur.meals.push(meal.name);
      cur.optional = cur.optional && Boolean(ing.optional);
      need.set(k, cur);
    }
  }
  if (!need.size) { toast('Er zijn nog geen maaltijden gepland deze week.'); return; }
  const items = [...need.values()].sort((a, b) => (a.pantry - b.pantry) || (a.optional - b.optional));
  const amountOf = (it) => [it.qty > 1 ? `${it.qty}×` : '', ...it.amounts].filter(Boolean).join(' + ');
  const sheet = openSheet(`
    <h2>Op de boodschappenlijst</h2>
    <p class="muted small" style="margin:2px 0 8px">Vink uit wat je al in huis hebt.</p>
    <div class="rows">${items.map((it, i) => `<label class="row-item" style="gap:10px;min-height:44px">
      <input type="checkbox" data-i="${i}" ${it.optional ? '' : 'checked'} style="width:20px;height:20px">
      <span class="grow"><span class="title" style="white-space:normal">${esc(it.name)}</span>
        <span class="sub">${esc([amountOf(it), it.pantry ? 'meestal in huis' : it.optional ? 'optioneel' : ''].filter(Boolean).join(' · '))}</span></span>
    </label>`).join('')}</div>
    <button class="btn primary block" style="margin-top:12px" data-go></button>`);
  const btn = sheet.querySelector('[data-go]');
  const count = () => { const n = sheet.querySelectorAll('input[data-i]:checked').length; btn.textContent = `${n} op de lijst zetten`; btn.disabled = !n; };
  sheet.addEventListener('change', count); count();
  btn.addEventListener('click', async () => {
    const chosen = [...sheet.querySelectorAll('input[data-i]:checked')].map((c) => items[+c.dataset.i]);
    closeSheet();
    for (const it of chosen) {
      const p = matchIngredient(it.name);
      await addToList({ name: p?.name || (/^ij/i.test(it.name) ? `IJ${it.name.slice(2)}` : it.name.charAt(0).toUpperCase() + it.name.slice(1)), productId: p?.id, category: p?.category, qty: Math.max(1, it.qty), note: it.amounts.join(' + '), source: 'menu' });
    }
    toast(`${chosen.length} ingrediënten op de lijst`);
  });
}

// ---------- recepten zoeken (Lekker en Simpel) ----------
const rs = { q: '', main: true, quick: false, sort: 'relevant' };
const SORTS = [['relevant', 'Nieuw'], ['cost', 'Voordeligst'], ['bonus', 'Bonus'], ['rating', 'Beoordeeld']];
const recipeCost = new Map(); // url|versie → kosten voor het gezin

/** Boodschappen voor dit recept, omgerekend naar het gezin (hele verpakkingen, zonder voorraadkast). */
function costForFamily(r, price) {
  const key = `${r.url}|${state.version}`;
  if (!recipeCost.has(key)) {
    const f = FAMILY / (r.servings || FAMILY);
    recipeCost.set(key, dishCost(r.ingredients.map((t) => toIngredient(parseIngredient(t), f)), price));
  }
  return recipeCost.get(key);
}
const stars = (r) => (r.rating ? `★ ${String(r.rating).replace('.', ',')} (${r.ratingCount})` : '');

async function recipeSheet() {
  const sheet = openSheet(`
    <div class="between"><h2>Recepten</h2><span class="tiny muted">van Lekker en Simpel</span></div>
    <input class="input" type="search" placeholder="Zoek op gerecht of ingrediënt" value="${esc(rs.q)}" data-q style="margin-top:8px">
    <div class="seg" style="margin:10px 0 0;display:flex">${SORTS.map(([k, l]) => `<button data-sort="${k}" class="${rs.sort === k ? 'on' : ''}" style="flex:1;padding:7px 6px">${l}</button>`).join('')}</div>
    <div class="gap8" style="margin:8px 0 4px">
      <button class="chip ${rs.main ? 'good' : ''}" data-f="main">Hoofdgerecht</button>
      <button class="chip ${rs.quick ? 'good' : ''}" data-f="quick">Max. 30 min</button>
    </div>
    <div data-results><div class="muted small" style="padding:14px 0"><span class="spinner"></span> Recepten laden…</div></div>`);
  const box = sheet.querySelector('[data-results]');
  let list;
  try { list = (await loadRecipes()).recipes; } catch (e) { box.innerHTML = `<p class="muted small">${esc(e.message)}</p>`; return; }
  if (!list.length) { box.innerHTML = '<p class="muted small">Er zijn nog geen recepten opgehaald. Probeer het morgen opnieuw.</p>'; return; }
  let run = 0;
  const row = (r, cost) => `<button class="row-item clickable" data-url="${esc(r.url)}" style="width:100%;text-align:left;background:none;border-left:0;border-right:0;border-top:0;font:inherit;color:inherit">
      ${r.image ? `<img class="kp-thumb" src="${esc(r.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'" style="width:64px;height:48px;object-fit:cover">` : '<span class="kp-thumb" style="width:64px;height:48px"></span>'}
      <span class="grow" style="min-width:0"><span class="title" style="white-space:normal;display:block">${esc(r.name)}</span>
        <span class="sub">${esc([r.time ? `${r.time} min` : '', stars(r), `${r.ingredients.length} ingrediënten`].filter(Boolean).join(' · '))}</span></span>
      ${cost ? `<span style="text-align:right;flex:none">${priceHtml(cost)}</span>` : ''}
    </button>`;
  const draw = async () => {
    const id = ++run;
    const opts = { maxTime: rs.quick ? 30 : null, category: rs.main ? 'hoofdgerecht' : null };
    if (rs.sort !== 'cost' && rs.sort !== 'bonus') {
      const found = searchRecipes(list, rs.q, { ...opts, sort: rs.sort, limit: 40 });
      const note = rs.sort === 'rating' && !found.some((r) => r.rating) ? '<p class="tiny muted" style="margin:6px 0">De beoordelingen worden nog opgehaald.</p>' : '';
      box.innerHTML = found.length ? `${note}<div class="rows">${found.map((r) => row(r, null)).join('')}</div>` : '<p class="muted small" style="padding:12px 0">Niets gevonden.</p>';
      return;
    }
    // Voordeligst: van alle treffers de boodschappen uitrekenen (in stukjes, zodat het scherm blijft reageren)
    const found = searchRecipes(list, rs.q, { ...opts, limit: 1000 });
    if (!found.length) { box.innerHTML = '<p class="muted small" style="padding:12px 0">Niets gevonden.</p>'; return; }
    if (!assortmentReady()) {
      box.innerHTML = '<div class="muted small" style="padding:14px 0"><span class="spinner"></span> AH-prijzen laden…</div>';
      try { await assortmentIndex(); } catch (e) { box.innerHTML = `<p class="muted small">${esc(e.message)}</p>`; return; }
      if (id !== run) return;
    }
    const memo = new Map();
    const price = (n, ing) => { const k = `${n}|${ing?.amount}|${ing?.qty}`; if (!memo.has(k)) memo.set(k, priceFor(n, ing)); return memo.get(k); };
    for (let i = 0; i < found.length; i += 12) {
      found.slice(i, i + 12).forEach((r) => costForFamily(r, price));
      if (i + 12 < found.length) {
        box.innerHTML = `<div class="muted small" style="padding:14px 0"><span class="spinner"></span> Prijzen berekenen… ${i + 12} van ${found.length}</div>`;
        await new Promise((res) => setTimeout(res, 0));
        if (id !== run) return;
      }
    }
    let withCost = found.map((r) => ({ r, c: costForFamily(r, price) }));
    if (rs.sort === 'bonus') {
      // Deze week in de bonus: waar de aanbiedingen het meest schelen (minstens een euro)
      withCost = withCost.filter((x) => x.c.total != null && x.c.saving >= 100).sort((a, b) => b.c.saving - a.c.saving || a.c.dealTotal - b.c.dealTotal);
    } else withCost.sort((a, b) => (a.c.dealTotal ?? Infinity) - (b.c.dealTotal ?? Infinity));
    const intro = rs.sort === 'bonus'
      ? `Hier scheelt de AH-bonus van deze week het meest. Prijzen voor ${FAMILY} personen.`
      : `Boodschappen voor ${FAMILY} personen bij AH, met de bonus van deze week. Hele verpakkingen, zonder wat meestal in huis is.`;
    box.innerHTML = withCost.length ? `<p class="tiny muted" style="margin:6px 0">${intro}</p>
      <div class="rows">${withCost.slice(0, 40).map(({ r, c }) => row(r, c)).join('')}</div>`
      : '<p class="muted small" style="padding:12px 0">Deze week geen recepten waarbij de bonus minstens een euro scheelt.</p>';
  };
  draw();
  let t;
  sheet.querySelector('[data-q]').addEventListener('input', (e) => { rs.q = e.target.value; clearTimeout(t); t = setTimeout(draw, 250); });
  sheet.addEventListener('click', (e) => {
    const so = e.target.closest('[data-sort]');
    if (so) { rs.sort = so.dataset.sort; sheet.querySelectorAll('[data-sort]').forEach((b) => b.classList.toggle('on', b === so)); draw(); return; }
    const f = e.target.closest('[data-f]');
    if (f) { rs[f.dataset.f] = !rs[f.dataset.f]; f.classList.toggle('good', rs[f.dataset.f]); draw(); return; }
    const hit = e.target.closest('[data-url]');
    if (hit) recipePreview(list.find((r) => r.url === hit.dataset.url));
  });
}

function recipePreview(r) {
  if (!r) return;
  const base = r.servings || FAMILY;
  let persons = r.servings && r.servings < FAMILY ? FAMILY : base;
  const parsed = r.ingredients.map(parseIngredient);
  const monday = addDays(startOfWeek(derived().today), weekOffset * 7);
  const sheet = openSheet(`
    ${r.image ? `<img src="${esc(r.image)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()" style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:12px;margin-bottom:10px">` : ''}
    <h2 style="margin:0">${esc(r.name)}</h2>
    <p class="muted small" style="margin:2px 0 10px">${esc([r.time ? `${r.time} min` : '', stars(r), r.cuisine?.[0] || ''].filter(Boolean).join(' · '))}</p>
    ${r.servings ? `<div class="seg" style="margin-bottom:8px">${[...new Set([r.servings, FAMILY, r.servings * 2])].sort((a, b) => a - b).slice(0, 3).map((n) => `<button data-p="${n}">${n} pers.</button>`).join('')}</div>` : ''}
    <div data-ings></div>
    <div data-cost style="margin-top:10px"></div>
    <a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" class="btn block" style="margin-top:12px">Bereiding op lekkerensimpel.com ↗</a>
    <label class="field" style="margin-top:12px">Inplannen
      <select class="input" data-day><option value="">Nog niet</option>${DAYS.map((d, i) => { const date = addDays(monday, i); return `<option value="${date}" ${state.plan.get(date) ? '' : ''}>${d} ${formatDate(date, 'short')}${state.plan.get(date) ? ' (bezet)' : ''}</option>`; }).join('')}</select></label>
    <button class="btn primary block" style="margin-top:10px" data-save>Toevoegen aan gerechten</button>`);
  const box = sheet.querySelector('[data-ings]');
  const draw = () => {
    const f = persons / base;
    sheet.querySelectorAll('[data-p]').forEach((b) => b.classList.toggle('on', +b.dataset.p === persons));
    box.innerHTML = `<div class="rows">${parsed.map((p) => `<div class="row-item" style="min-height:0;padding:7px 2px">
      <span class="num" style="width:76px;flex:none;font-weight:650">${esc(amountText(p, f))}</span>
      <span class="grow" style="white-space:normal">${esc(p.name)}${p.optional ? ' <span class="muted tiny">optioneel</span>' : ''}</span></div>`).join('')}</div>`;
    const c = dishCost(parsed.map((p) => toIngredient(p, f)), priceFor);
    sheet.querySelector('[data-cost]').innerHTML = `<details><summary class="quiet-line" style="cursor:pointer"><span class="small" style="font-weight:650">Boodschappen</span><span style="text-align:right">${priceHtml(c)}</span></summary>${costLines(c)}</details>`;
  };
  if (!assortmentReady()) assortmentIndex().then(() => sheet.isConnected && draw()).catch(() => {});
  draw();
  sheet.addEventListener('click', (e) => { const b = e.target.closest('[data-p]'); if (b) { persons = +b.dataset.p; draw(); } });
  sheet.querySelector('[data-save]').addEventListener('click', async () => {
    const f = persons / base;
    const existing = state.meals.find((m) => m.url === r.url);
    const meal = await saveMeal({ ...(existing || {}), name: r.name, url: r.url, image: r.image, time: r.time, servings: persons, source: 'lekkerensimpel',
      kids: existing?.kids ?? true, favorite: existing?.favorite ?? false, ingredients: parsed.map((p) => toIngredient(p, f)) });
    const day = sheet.querySelector('[data-day]').value;
    if (day) await setPlan(day, meal.id);
    closeSheet();
    toast(day ? `${r.name} staat op ${formatDate(day, 'short')}` : `${r.name} toegevoegd aan jullie gerechten`);
  });
}
