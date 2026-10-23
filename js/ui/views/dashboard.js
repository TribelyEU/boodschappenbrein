import { state, derived } from '../../data/store.js';
import { html, icon } from '../dom.js';
import { euro, pctChange } from '../../core/money.js';
import { inRange, groupBy, priceIncreases, timeSeries } from '../../core/analytics.js';
import { categoryName, categoryColor } from '../../core/categories.js';
import { addDays, formatDate, MONTH_NAMES } from '../../core/dates.js';
import { donut, barChart } from '../charts.js';
import { tag, statusChip, delta, noDataCard, categoryRows, daysText } from '../components.js';
import { EXAMPLE_QUESTIONS } from '../../core/query.js';
import { storeName } from '../../core/stores.js';

export default {
  render() {
    const d = derived();
    const { facts, predictions, savings, today } = d;
    if (!facts.length) {
      return html`<div class="page-head"><div><h1>Overzicht</h1><p class="muted">Waar gaat ons boodschappengeld naartoe?</p></div></div>${noDataCard()}`;
    }
    const s = (dashStatsCache.v === state.version ? dashStatsCache.s : (dashStatsCache.s = statsFor(facts, today), dashStatsCache.v = state.version, dashStatsCache.s));
    const vsPrev = pctChange(s.prevMonthToDate, s.thisMonth);
    const month = MONTH_NAMES[+today.slice(5, 7) - 1];

    const monthFacts = inRange(facts, s.monthStart, today);
    const cats = groupBy(monthFacts, (f) => f.category).filter((g) => g.net > 0);
    const catTotal = cats.reduce((t, g) => t + g.net, 0);

    const low = [...predictions.entries()]
      .filter(([, p]) => p.status.id === 'bijna' || p.status.id === 'op')
      .sort((a, b) => a[1].daysLeft - b[1].daysLeft)
      .slice(0, 6);
    const incs = priceIncreases(facts, state.products, today).slice(0, 4);
    const weeks = timeSeries(facts, 'week', addDays(today, -7 * 11), today);

    return html`
      <div class="searchbox" style="margin:6px 0 16px">
        ${icon('search', 20)}
        <form data-submit="ask"><input class="input" name="q" placeholder="Vraag iets: hoeveel gaven we uit aan koffie?" autocomplete="off" enterkeyhint="search"></form>
      </div>

      <div class="card hero">
        <div class="label">Boodschappen ${month} · t/m vandaag</div>
        <div class="big num">${euro(s.thisMonth)}</div>
        <div class="row">
          <span>${vsPrev == null ? 'Geen vergelijking met vorige maand' : html`${delta(vsPrev)} t.o.v. zelfde moment vorige maand (${euro(s.prevMonthToDate)})`}</span>
        </div>
        ${s.forecast ? html`<div class="row" style="margin-top:10px">
          <span class="chip">Voorspelling</span>
          <span>Verwacht maandtotaal ±${euro(s.forecast.monthTotal, { short: true })} · nog ±${euro(s.forecast.restOfMonth, { short: true })} in ${s.forecast.daysLeft} dagen</span>
        </div>` : html`<div class="row" style="margin-top:10px;opacity:.8">Voorspelling volgt na 3 weken aan gegevens.</div>`}
      </div>

      <div class="grid kpis" style="margin-top:14px">
        <div class="card kpi clickable" data-action="nav" data-to="analyse?periode=jaar">
          <div class="label">Dit jaar ${tag.feit}</div><div class="value num">${euro(s.ytd, { short: true })}</div>
          <div class="sub">sinds 1 januari</div>
        </div>
        <div class="card kpi clickable" data-action="nav" data-to="analyse?periode=week">
          <div class="label">Gem. per week ${tag.feit}</div><div class="value num">${s.avgWeek != null ? euro(s.avgWeek) : '–'}</div>
          <div class="sub">${s.avgWeek != null ? `over ${s.weeksUsed} weken` : 'min. 2 weken nodig'}</div>
        </div>
        <div class="card kpi clickable" data-action="nav" data-to="analyse?periode=maand">
          <div class="label">Vorige maand ${tag.feit}</div><div class="value num">${euro(s.prevMonthFull, { short: true })}</div>
          <div class="sub">volledige maand</div>
        </div>
        <div class="card kpi clickable" data-action="nav" data-to="analyse?tab=besparen">
          <div class="label">Besparen ${tag.schatting}</div>
          <div class="value num">${savings.enoughData && savings.theoreticalMonthly ? `±${euro(savings.theoreticalMonthly, { short: true })}` : '–'}</div>
          <div class="sub">${savings.enoughData ? (savings.theoreticalMonthly ? 'per maand mogelijk' : 'nog geen onderbouwd advies') : 'meer gegevens nodig'}</div>
        </div>
      </div>

      <div class="grid two" style="margin-top:14px">
        <div class="card">
          <div class="card-head"><h2>Categorieën ${month}</h2><a class="link" href="#/analyse?groep=categorie">Alles</a></div>
          ${cats.length ? html`<div class="donut-wrap">
            ${donut(cats.map((g) => ({ value: g.net, color: categoryColor(g.key), label: `${categoryName(g.key)}: ${euro(g.net)}` })), { center: euro(catTotal, { short: true }) })}
            <div class="legend rows">${categoryRows(cats.slice(0, 5), catTotal)}</div>
          </div>
          ${cats.length > 5 ? html`<div class="rows">${categoryRows(cats.slice(5), catTotal)}</div>` : ''}` : html`<p class="muted">Nog geen aankopen deze maand.</p>`}
        </div>

        <div class="card">
          <div class="card-head"><h2>Bijna op ${tag.voorspelling}</h2><a class="link" href="#/voorraad">Voorraad</a></div>
          ${low.length ? html`<div class="rows">${low.map(([id, p]) => html`
            <div class="row-item">
              <div class="grow clickable" data-action="nav" data-to="product/${id}">
                <div class="title">${state.products.get(id)?.name}</div>
                <div class="sub">${daysText(p)}</div>
              </div>
              <button class="btn small" data-action="addSuggestion" data-id="${id}" aria-label="Op de lijst">${icon('plus', 16)}Lijst</button>
            </div>`)}</div>` : html`<p class="muted">Niets dat met redelijke zekerheid bijna op is. ${predictions.size ? '' : 'Voorspellingen verschijnen na minstens 3 aankopen per product.'}</p>`}
        </div>

        <div class="card">
          <div class="card-head"><h2>Per week</h2><span class="muted small">laatste 11 weken</span></div>
          ${barChart(weeks.map((w) => ({ label: w.label, value: w.net, action: 'nav', args: { to: `analyse?periode=week&van=${w.key}` } })))}
          <p class="muted small" style="margin:8px 0 0">Tik op een week voor de aankopen.</p>
        </div>

        <div class="card">
          <div class="card-head"><h2>Opvallende prijsstijgingen</h2>${tag.feit}</div>
          ${incs.length ? html`<div class="rows">${incs.map((x) => html`
            <div class="row-item clickable" data-action="nav" data-to="product/${x.productId}">
              <div class="grow"><div class="title">${x.name}${x.brand ? ` · ${x.brand}` : ''}</div>
              <div class="sub num">${euro(x.before)} → ${euro(x.after)}${x.perBase ? ' per kg/l/st' : ''}</div></div>
              <span class="chip bad num">+${Math.round(x.change * 100)}%</span>
            </div>`)}</div>` : html`<p class="muted">Nog geen duidelijke stijgingen. Hiervoor zijn per product minimaal 2 aankopen in de laatste 3 maanden én 2 daarvoor nodig.</p>`}
        </div>
      </div>

      ${d.weekly?.items.length ? html`
      <div class="card" style="margin-top:14px">
        <div class="card-head"><h2>Deze week voordelig ${tag.schatting}</h2><a class="link" href="#/prijzen">Alle ${d.weekly.items.length}</a></div>
        <div class="rows">${d.weekly.items.slice(0, 4).map((it) => html`
          <div class="row-item clickable" data-action="nav" data-to="prijzen">
            <div class="grow"><div class="title">${it.name}</div><div class="sub">${storeName(it.offer.store)} · ${it.offer.mechanism || 'aanbieding'}${it.kind === 'inslag' ? ' · inslaan' : ''}</div></div>
            <span class="chip good num">±${euro(it.saving)}</span>
          </div>`)}</div>
        <p class="muted tiny" style="margin:8px 0 0">Samen ±${euro(d.weekly.total)} t.o.v. wat jullie normaal betalen.</p>
      </div>` : ''}

      ${savings.enoughData && savings.advice.length ? html`
      <div class="card" style="margin-top:14px">
        <div class="card-head"><h2>Besparingsideeën</h2><a class="link" href="#/analyse?tab=besparen">Alle ${savings.advice.length}</a></div>
        <div class="rows">${savings.advice.slice(0, 3).map((a) => html`
          <div class="row-item clickable" data-action="nav" data-to="${a.productId ? `product/${a.productId}` : 'analyse?tab=besparen'}">
            <div class="grow"><div class="title">${a.title}</div><div class="sub">${a.explanation}</div></div>
            ${a.monthly ? html`<span class="chip good num">±${euro(a.monthly)}/mnd</span>` : ''}
          </div>`)}</div>
      </div>` : ''}

      ${(() => {
        const soon = d.rhythm.rows.filter((r) => r.status === 'ritme' && r.weeksUntil <= 1).sort((a, b) => a.weeksUntil - b.weeksUntil || b.spend - a.spend).slice(0, 5);
        if (!soon.length) return '';
        return html`<div class="card" style="margin-top:14px">
          <div class="card-head"><h2>Bonus-ritme ${tag.voorspelling}</h2><a class="link" href="#/analyse?tab=bonus">Alles</a></div>
          <div class="rows">${soon.map((r) => html`
            <div class="row-item clickable" data-action="nav" data-to="product/${r.productId}">
              <div class="grow"><div class="title">${r.name}</div><div class="sub">${r.advice}</div></div>
              <span class="chip ${r.inPromoNow ? 'good' : 'warn'}">${r.inPromoNow ? 'nu' : r.weeksUntil <= 0 ? 'deze week' : 'volgende week'}</span>
            </div>`)}</div></div>`;
      })()}

      ${(() => {
        const overdue = state.stockpile.filter((e) => d.freezer.get(e.id)?.overdue && d.freezer.get(e.id).packs > 0);
        if (!overdue.length) return '';
        return html`<div class="notice warn" style="margin-top:14px">Vriezer: ${overdue.map((e) => e.name).join(', ')} ligt er al lang in. <a href="#/menu">Plan het in</a> of <a href="#/voorraad?tab=vriezer">bekijk de vriezer</a>.</div>`;
      })()}

      <div class="section-label">Probeer te vragen</div>
      <div class="qa">${EXAMPLE_QUESTIONS.map((q) => html`<a class="chip" href="#/zoeken?q=${encodeURIComponent(q)}">${q}</a>`)}</div>
      <p class="muted tiny" style="margin-top:18px">Gegevens t/m ${formatDate(today)} · ${state.receipts.length} bonnen · eerste bon ${formatDate(s.firstDate)}.
      Bedragen zijn boodschappen na korting, zonder statiegeld en koopzegels.</p>
    `;
  },
  actions: {
    ask(form, ev, { go }) {
      const q = new FormData(form).get('q');
      if (q) go('zoeken?q=' + encodeURIComponent(q));
    },
    async addSuggestion(el) {
      const { addToList } = await import('../../data/store.js');
      const p = state.products.get(el.dataset.id);
      const pred = derived().predictions.get(el.dataset.id);
      await addToList({ name: p.name, productId: p.id, category: p.category, qty: Math.max(1, Math.round(pred?.typicalQty || 1)), source: 'suggestie' });
      const { toast } = await import('../dom.js');
      toast(`${p.name} staat op de lijst`);
    },
  },
};

const dashStatsCache = { v: -1, s: null };
import { dashboardStats } from '../../core/analytics.js';
function statsFor(facts, today) { return dashboardStats(facts, today); }
