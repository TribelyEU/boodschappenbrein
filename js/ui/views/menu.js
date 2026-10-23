import { state, derived, saveMeal, deleteMeal, setPlan, addToList } from '../../data/store.js';
import { html, icon, toast, openSheet, closeSheet, confirmSheet, esc } from '../dom.js';
import { euro } from '../../core/money.js';
import { addDays, startOfWeek, formatDate } from '../../core/dates.js';
import { findProducts } from '../../core/query.js';
import { productTokens } from '../../core/products.js';
import { priceHistory } from '../../core/analytics.js';
import { tag, empty } from '../components.js';

const DAYS = ['Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag', 'Zondag'];
let weekOffset = 0;

function matchIngredient(name) {
  const hits = findProducts(productTokens(name), state.products);
  if (!hits.length) return null;
  // Meest gekochte variant
  const counts = new Map(hits.map((p) => [p.id, 0]));
  for (const l of state.lines) if (counts.has(l.productId)) counts.set(l.productId, counts.get(l.productId) + 1);
  return hits.sort((a, b) => counts.get(b.id) - counts.get(a.id))[0];
}

/** Geschatte kosten: laatste betaalde prijs per verpakking van elk herkend ingrediënt. */
function mealCost(meal) {
  const { facts } = derived();
  let sum = 0;
  let known = 0;
  for (const ing of meal.ingredients) {
    const p = matchIngredient(ing.name);
    if (!p) continue;
    const h = priceHistory(facts, p.id);
    if (!h.length) continue;
    sum += h.at(-1).paidPerUnit * (ing.qty || 1);
    known++;
  }
  return { sum, known, total: meal.ingredients.length };
}

function editMeal(meal = { name: '', ingredients: [], kids: true, favorite: false }) {
  const sheet = openSheet(`
    <h2>${meal.id ? 'Gerecht bewerken' : 'Nieuw gerecht'}</h2>
    <form class="stack" style="margin-top:10px" data-meal>
      <label class="field">Naam<input class="input" name="name" value="${esc(meal.name)}" required></label>
      <label class="field">Ingrediënten (één per regel, optioneel aantal ervoor: "2 paprika")
        <textarea class="input" name="ing" rows="6">${esc(meal.ingredients.map((i) => `${i.qty > 1 ? i.qty + ' ' : ''}${i.name}`).join('\n'))}</textarea></label>
      <label class="gap8"><input type="checkbox" name="kids" ${meal.kids ? 'checked' : ''}> Kindvriendelijk</label>
      <label class="gap8"><input type="checkbox" name="favorite" ${meal.favorite ? 'checked' : ''}> Favoriet</label>
      <div class="btn-row" style="justify-content:flex-end">${meal.id ? '<button type="button" class="btn danger" data-del>Verwijderen</button>' : ''}<button class="btn primary">Opslaan</button></div>
    </form>`);
  const form = sheet.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const ingredients = String(fd.get('ing')).split('\n').map((s) => s.trim()).filter(Boolean).map((s) => {
      const m = s.match(/^(\d+)\s*[x×]?\s+(.+)$/);
      return m ? { qty: +m[1], name: m[2] } : { qty: 1, name: s };
    });
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
    const { today, predictions } = derived();
    const monday = addDays(startOfWeek(today), weekOffset * 7);
    const meals = [...state.meals].sort((a, b) => (b.favorite - a.favorite) || a.name.localeCompare(b.name));
    const byId = new Map(meals.map((m) => [m.id, m]));
    return html`
      <div class="page-head"><div><h1>Weekmenu</h1><p class="muted">Plan maaltijden en zet ingrediënten met één tik op de lijst.</p></div>
        <button class="btn small primary" data-action="newMeal">${icon('plus', 16)}Gerecht</button></div>
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
      <p class="muted tiny">Ingrediënten die volgens de voorraadschatting nog ruim voldoende zijn, worden overgeslagen; u ziet welke.</p>

      <div class="section-label">Gerechten</div>
      ${meals.length ? html`<div class="card tight"><div class="rows">${meals.map((m) => {
        const c = mealCost(m);
        const inStock = m.ingredients.filter((ing) => { const p = matchIngredient(ing.name); return p && predictions.get(p.id)?.status.id === 'voldoende'; }).length;
        return html`<div class="row-item clickable" data-action="editMeal" data-id="${m.id}">
          <div class="grow"><div class="title">${m.favorite ? '★ ' : ''}${m.name}</div>
          <div class="sub">${m.ingredients.length} ingrediënten${m.kids ? ' · kindvriendelijk' : ''}${inStock ? ` · ${inStock} waarschijnlijk in huis` : ''}</div></div>
          <div style="text-align:right"><div class="amount num">${c.known ? `±${euro(c.sum)}` : '–'}</div><div class="tiny muted">${c.known ? `${c.known}/${c.total} ingr. bekend` : 'prijs onbekend'}</div></div>
        </div>`;
      })}</div></div>
      <p class="muted tiny">${tag.schatting} Kosten per maaltijd = laatst betaalde prijs per verpakking van de ingrediënten die in uw aankopen voorkomen.</p>` : html`<div class="card">${empty('Nog geen gerechten', 'Voeg uw vaste gerechten toe, zoals pasta bolognese of nasi.')}</div>`}`;
  },
  actions: {
    newMeal() { editMeal(); },
    editMeal(el) { editMeal(state.meals.find((m) => m.id === el.dataset.id)); },
    week(el, ev, { rerender }) { weekOffset += +el.dataset.d; rerender(); },
    async plan(el) { await setPlan(el.dataset.date, el.value || null); },
    async toList(el) {
      const monday = el.dataset.monday;
      const { predictions } = derived();
      const need = new Map();
      const skipped = [];
      for (let i = 0; i < 7; i++) {
        const plan = state.plan.get(addDays(monday, i));
        const meal = plan && state.meals.find((m) => m.id === plan.mealId);
        if (!meal) continue;
        for (const ing of meal.ingredients) {
          const p = matchIngredient(ing.name);
          if (p && predictions.get(p.id)?.status.id === 'voldoende' && !need.has(ing.name.toLowerCase())) { skipped.push(p.name); continue; }
          const k = ing.name.toLowerCase();
          const cur = need.get(k) || { name: p?.name || ing.name, productId: p?.id, category: p?.category, qty: 0 };
          cur.qty += ing.qty || 1;
          need.set(k, cur);
        }
      }
      if (!need.size && !skipped.length) { toast('Er zijn nog geen maaltijden gepland deze week.'); return; }
      for (const it of need.values()) await addToList({ ...it, source: 'menu' });
      toast(`${need.size} ingrediënten op de lijst${skipped.length ? ` · overgeslagen (waarschijnlijk in huis): ${[...new Set(skipped)].join(', ')}` : ''}`, { duration: 7000 });
    },
  },
};
