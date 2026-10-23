// Opstart, navigatie en gebeurtenisafhandeling.

import * as store from './data/store.js';
import { html, icon, toast } from './ui/dom.js';
import vandaag from './ui/views/vandaag.js';
import deals from './ui/views/deals.js';
import list from './ui/views/list.js';
import stock from './ui/views/stock.js';
import analysis from './ui/views/analysis.js';
import prices from './ui/views/prices.js';
import importView from './ui/views/import.js';
import product from './ui/views/product.js';
import search from './ui/views/search.js';
import menu from './ui/views/menu.js';
import settings from './ui/views/settings.js';
import receipt from './ui/views/receipt.js';

// Prijsvergelijking (gewone winkelprijzen) als eigen scherm, bereikbaar vanuit Aanbiedingen.
const compareTab = () => new URLSearchParams('tab=vergelijken');
const vergelijken = {
  render: (p) => prices.render(p, compareTab()),
  after: (r, p) => prices.after?.(r, p, compareTab()),
  actions: prices.actions,
};

const ROUTES = {
  vandaag, lijst: list, aanbiedingen: deals, voorraad: stock, analyse: analysis,
  importeren: importView, product, zoeken: search, menu, instellingen: settings, bon: receipt, vergelijken,
  // oude adressen blijven werken
  dashboard: vandaag, prijzen: deals,
};

// Welk tabblad oplicht bij schermen die zelf geen tabblad zijn
const ACTIVE = { dashboard: 'vandaag', zoeken: 'vandaag', product: 'analyse', bon: 'analyse', importeren: 'analyse', prijzen: 'aanbiedingen', vergelijken: 'aanbiedingen', menu: 'lijst' };

const TABS = [
  ['vandaag', 'Vandaag', 'home'],
  ['lijst', 'Lijst', 'list'],
  ['aanbiedingen', 'Aanbiedingen', 'tag'],
  ['voorraad', 'Voorraad', 'stock'],
  ['analyse', 'Uitgaven', 'chart'],
];

let current = { name: null, params: [], query: new URLSearchParams() };

export function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  const [name, ...params] = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { name: ROUTES[name] ? name : 'vandaag', params, query: new URLSearchParams(qs || '') };
}

export function go(path) {
  location.hash = '#/' + path;
}

function renderShell() {
  const app = document.getElementById('app');
  app.innerHTML = String(html`
    <nav class="tabbar" aria-label="Hoofdnavigatie">
      <div class="side-brand brand"><span class="brand-mark">${icon('spark', 18)}</span>Boodschappenbrein</div>
      ${TABS.map(([id, label, ic]) => html`<a class="tab" href="#/${id}" data-tab="${id}">${icon(ic, 22)}<span>${label}</span></a>`)}
      <a class="tab secondary-only secondary" href="#/instellingen" data-tab="instellingen">${icon('settings', 22)}<span>Instellingen</span></a>
    </nav>
    <div class="content">
      <div id="demo-banner"></div>
      <header class="topbar">
        <div class="brand"><span class="brand-mark">${icon('spark', 18)}</span>Boodschappenbrein</div>
        <div class="spacer"></div>
        <a class="icon-btn" href="#/zoeken" aria-label="Zoeken">${icon('search', 22)}</a>
        <a class="icon-btn" href="#/instellingen" aria-label="Instellingen">${icon('settings', 22)}</a>
      </header>
      <main class="main" id="view" tabindex="-1"></main>
    </div>`);
}

function renderView({ keepScroll = false } = {}) {
  const view = ROUTES[current.name];
  const root = document.getElementById('view');
  const y = window.scrollY;
  try {
    root.innerHTML = String(view.render(current.params, current.query));
    view.after?.(root, current.params, current.query);
    const sec = current.query.get('s');
    if (sec) setTimeout(() => document.getElementById(sec)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50);
  } catch (e) {
    console.error(e);
    root.innerHTML = `<div class="notice bad">Er ging iets mis bij het tonen van dit scherm: ${String(e.message).replace(/</g, '&lt;')}</div>`;
  }
  const activeTab = ACTIVE[current.name] || current.name;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === activeTab));
  document.getElementById('demo-banner').innerHTML = store.state.mode === 'demo'
    ? '<div class="demo-banner">Demomodus — alle gegevens zijn fictief. Uw echte gegevens staan apart. <a href="#/instellingen">Wisselen</a></div>' : '';
  if (keepScroll) window.scrollTo(0, y);
}

function onRoute() {
  const next = parseHash();
  // Oude tabbladen die verhuisd zijn
  if (next.name === 'voorraad' && next.query.get('tab') === 'inslag') { location.replace('#/aanbiedingen'); return; }
  if (next.name === 'analyse' && next.query.get('tab') === 'bonus') { location.replace('#/aanbiedingen'); return; }
  if (next.name === 'prijzen' && next.query.get('tab') === 'vergelijken') { location.replace('#/vergelijken'); return; }
  const same = next.name === current.name && next.params.join('/') === current.params.join('/');
  current = next;
  renderView({ keepScroll: same });
  if (!same) window.scrollTo(0, 0);
}

// Gebeurtenisdelegatie: elementen met data-action roepen de actie van het huidige scherm aan.
function findAction(name) {
  const view = ROUTES[current.name];
  return view.actions?.[name] || GLOBAL_ACTIONS[name];
}

const GLOBAL_ACTIONS = {
  nav: (el) => go(el.dataset.to),
  // Uitleg achter een i-knopje (tekst komt uit de eigen code, niet van de gebruiker)
  info: (el) => import('./ui/dom.js').then((m) => m.openSheet(`<h2>${m.esc(el.dataset.title || 'Uitleg')}</h2><div class="small" style="color:var(--ink-2)">${el.dataset.body || ''}</div><button class="btn block" style="margin-top:14px" onclick="this.closest('.sheet-backdrop').remove();document.body.style.overflow=''">Sluiten</button>`)),
  back: () => (history.length > 1 ? history.back() : go('dashboard')),
};

async function dispatch(el, ev) {
  const name = el.dataset.action;
  const fn = findAction(name);
  if (!fn) return;
  try {
    await fn(el, ev, { rerender: () => renderView({ keepScroll: true }), go });
  } catch (e) {
    console.error(e);
    toast(e.message || 'Er ging iets mis.');
  }
}

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && el.type !== 'button' && el.type !== 'checkbox')) return;
  if (el.tagName === 'A' && !el.getAttribute('href')?.startsWith('#')) return;
  ev.preventDefault();
  dispatch(el, ev);
});
document.addEventListener('change', (ev) => {
  const el = ev.target.closest('[data-change]');
  if (!el) return;
  const fn = findAction(el.dataset.change);
  if (fn) Promise.resolve(fn(el, ev, { rerender: () => renderView({ keepScroll: true }), go })).catch((e) => toast(e.message));
});
document.addEventListener('submit', (ev) => {
  const form = ev.target.closest('form[data-submit]');
  if (!form) return;
  ev.preventDefault();
  const fn = findAction(form.dataset.submit);
  if (fn) Promise.resolve(fn(form, ev, { rerender: () => renderView({ keepScroll: true }), go })).catch((e) => toast(e.message));
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') import('./ui/dom.js').then((m) => m.closeSheet());
});

async function start() {
  renderShell();
  try {
    await store.init();
  } catch (e) {
    document.getElementById('view').innerHTML = `<div class="notice bad"><strong>De lokale database kan niet worden geopend.</strong><br>${String(e.message).replace(/</g, '&lt;')}<br><br>Mogelijke oorzaken: privé-browsen, geblokkeerde websitegegevens of een ander open tabblad.</div>`;
    return;
  }
  store.subscribe(() => {
    // Schermen met lopende invoer (controlescherm) beheren zelf wanneer ze verversen.
    if (ROUTES[current.name].manualRefresh) return;
    renderView({ keepScroll: true });
  });
  window.addEventListener('hashchange', onRoute);
  onRoute();
  if ('serviceWorker' in navigator && location.protocol !== 'file:' && !/^(localhost|127\.)/.test(location.hostname)) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

start();
