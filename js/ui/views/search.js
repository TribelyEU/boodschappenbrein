import { state, derived } from '../../data/store.js';
import { html, icon } from '../dom.js';
import { runQuery, EXAMPLE_QUESTIONS } from '../../core/query.js';
import { tag } from '../components.js';
import { normalizeText } from '../../core/text.js';

// Schermen terugvinden via de zoekbalk ("waar vind ik de vriezer?")
const SHORTCUTS = [
  [['inslag', 'inslaan', 'inslagproduct', 'inslaglijst', 'hamster', 'voorraad aanleggen', 'inhaler'], 'Inslagproducten', 'aanbiedingen?s=inslag', 'Aanbiedingen → Inslagproducten'],
  [['vriezer', 'diepvries', 'ingevroren', 'invriezen'], 'Vriezer', 'voorraad?s=vriezer', 'Voorraad → Vriezer'],
  [['bonus', 'aanbieding', 'aanbiedingen', 'folder', 'actie', 'acties', 'korting'], 'Aanbiedingen deze week', 'aanbiedingen', 'Aanbiedingen'],
  [['ritme', 'bonusritme', 'wanneer in de aanbieding'], 'Bonus-ritme', 'aanbiedingen?s=ritme', 'Aanbiedingen → Bonus-ritme'],
  [['bon toevoegen', 'importeren', 'import', 'kassabon', 'pdf', 'foto', 'uploaden', 'toevoegen'], 'Bon toevoegen', 'importeren', 'Uitgaven → Bon toevoegen'],
  [['bonnen', 'alle bonnen', 'kassabonnen'], 'Alle bonnen', 'analyse?tab=bonnen', 'Uitgaven → Alle bonnen'],
  [['weekmenu', 'menu', 'recept', 'recepten', 'gerecht', 'gerechten', 'maaltijd', 'koken'], 'Weekmenu', 'menu', 'Lijst → Weekmenu'],
  [['lijst', 'boodschappenlijst', 'lijstje'], 'Boodschappenlijst', 'lijst', 'Lijst'],
  [['voorraad', 'bijna op', 'op'], 'Voorraad', 'voorraad', 'Voorraad'],
  [['besparen', 'besparing', 'goedkoper'], 'Besparen', 'analyse?tab=besparen', 'Uitgaven → Besparen'],
  [['uitgaven', 'uitgegeven', 'kosten', 'categorie', 'categorieen'], 'Uitgaven', 'analyse', 'Uitgaven'],
  [['vergelijken', 'prijzen vergelijken', 'goedkoopste winkel', 'lidl', 'jumbo'], 'Prijzen vergelijken', 'vergelijken', 'Aanbiedingen → Gewone prijzen vergelijken'],
  [['instellingen', 'back-up', 'backup', 'vakantie', 'demo', 'demomodus', 'winkels', 'herstellen'], 'Instellingen', 'instellingen', 'tandwiel rechtsboven'],
];

function shortcutsFor(q) {
  const n = normalizeText(q);
  const words = n.split(' ');
  return SHORTCUTS.filter(([keys]) => keys.some((k) => {
    const kk = normalizeText(k);
    return n === kk || (kk.includes(' ') ? n.includes(kk) : words.includes(kk)) || (n.length >= 4 && kk.startsWith(n));
  })).slice(0, 3);
}

export default {
  render(params, query) {
    const q = query.get('q') || '';
    const d = derived();
    const res = q ? runQuery(q, { facts: d.facts, products: state.products, predictions: d.predictions, savings: d.savings, rhythm: d.rhythm, today: d.today }) : null;
    const shortcuts = q ? shortcutsFor(q) : [];
    const hideResult = res && res.kind === 'onbekend' && shortcuts.length;
    return html`
      <div class="page-head"><div><h1>Zoeken</h1><p class="muted">Een product, een scherm of een vraag.</p></div></div>
      <form class="searchbox" data-submit="ask">
        ${icon('search', 20)}
        <input class="input" name="q" value="${q}" placeholder="Hoeveel gaven we dit jaar uit aan koffie?" autocomplete="off" enterkeyhint="search" autofocus>
      </form>
      ${shortcuts.length ? html`<div class="card tight" style="margin-top:14px"><div class="rows">${shortcuts.map(([, label, path, where]) => html`
        <a class="row-item" href="#/${path}" style="color:inherit"><div class="grow"><div class="title">Ga naar ${label}</div><div class="sub">${where}</div></div>${icon('chevron', 16)}</a>`)}</div></div>` : ''}
      ${res && !hideResult ? html`
        <div class="card" style="margin-top:14px">
          <div class="between"><div class="muted small">${res.title}</div>${tag[res.kind] || ''}</div>
          <div style="font-family:var(--font-display);font-size:30px;font-weight:700;margin:4px 0" class="num">${res.answer}</div>
          ${res.basis ? html`<p class="muted small" style="margin:0">${res.basis}</p>` : ''}
          ${res.rows?.length ? html`<div class="rows" style="margin-top:10px">${res.rows.map((r) => html`
            <div class="row-item ${r.productId ? 'clickable' : ''}" ${r.productId ? html`data-action="nav" data-to="product/${r.productId}"` : ''} style="align-items:flex-start">
              <div class="grow"><div class="title" style="white-space:normal">${r.label}</div>${r.sub ? html`<div class="sub" style="white-space:normal">${r.sub}</div>` : ''}</div>
              <div class="amount num">${r.value}</div>
            </div>`)}</div>` : ''}
        </div>` : ''}
      <div class="section-label">Voorbeelden</div>
      <div class="rows card tight">${EXAMPLE_QUESTIONS.map((x) => html`<a class="row-item" href="#/zoeken?q=${encodeURIComponent(x)}"><div class="grow">${x}</div>${icon('chevron', 16)}</a>`)}</div>
      <p class="muted tiny" style="margin-top:14px">De zoekfunctie werkt zonder AI of internet: vragen worden herkend op trefwoorden (periode, winkel, categorie, product) en exact uitgerekend.</p>`;
  },
  actions: {
    ask(form, ev, { go }) { const q = new FormData(form).get('q'); if (q) go('zoeken?q=' + encodeURIComponent(q)); },
  },
};
