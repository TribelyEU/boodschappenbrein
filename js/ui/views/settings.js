import { state, setMode, setSetting, exportBackup, restoreBackup, wipeAll, db } from '../../data/store.js';
import { html, icon, toast, confirmSheet, download } from '../dom.js';
import { STORES, storeName } from '../../core/stores.js';
import { formatDate, todayISO, localDateOf } from '../../core/dates.js';
import { validateBackup } from '../../core/backup.js';
import { currentVersion, checkForUpdate, reloadApp } from '../../app/update.js';

let usage = null;

export default {
  render() {
    if (!usage) db.estimateUsage().then((u) => { usage = u || { usage: 0 }; window.dispatchEvent(new HashChangeEvent('hashchange')); });
    const vac = state.settings.vacations || [];
    return html`
      <div class="page-head"><div><h1>Instellingen</h1></div></div>
      <div class="stack">
        <div class="card">
          <h2>Gegevens</h2>
          <p class="muted small">${state.receipts.length} bonnen · ${state.lines.length} regels · ${state.products.size} producten. Alles staat alleen op deze telefoon${usage?.usage ? ` (${(usage.usage / 1048576).toFixed(1).replace('.', ',')} MB)` : ''}.
          ${usage && usage.persisted === false ? html`<br><span style="color:var(--warn)">De browser heeft permanente opslag niet bevestigd. Maak regelmatig een back-up.</span>` : ''}</p>
          <div class="btn-row">
            <button class="btn primary" data-action="backup">${icon('import', 16)}Back-up downloaden</button>
            <label class="btn">Back-up terugzetten…<input type="file" accept=".json,application/json" class="sr-only" data-change="restore"></label>
          </div>
          <p class="muted tiny" style="margin-bottom:0">De back-up bevat bonnen, producten, lijst, weekmenu, volglijst, jullie oordelen over aanbiedingen en instellingen. Zet hem op een andere telefoon terug om daar verder te gaan.</p>
        </div>

        <div class="card">
          <h2>Mijn winkels</h2>
          <p class="muted small">Van deze winkels zie je de aanbiedingen bij Koopjes en op de lijst.</p>
          <div class="qa" style="flex-wrap:wrap;margin-top:6px">${['ah', 'lidl', 'hoogvliet', 'jumbo', 'dirk', 'plus', 'aldi', 'kruidvat', 'etos', 'action', 'wibra'].map((id) => {
            const on = (state.settings.myStores || []).some((m) => m.id === id);
            return html`<button class="chip ${on ? 'good' : ''}" data-action="toggleMyStore" data-id="${id}">${on ? icon('check', 13) : ''}${storeName(id)}</button>`;
          })}</div>
        </div>

        <div class="card">
          <h2>Standaardwinkel</h2>
          <p class="muted small">Wordt ingevuld als een bon of tabel geen herkenbare supermarkt bevat.</p>
          <select class="input" data-change="defaultStore"><option value="">Geen</option>${STORES.map((s) => html`<option value="${s.id}" ${state.settings.defaultStore === s.id ? 'selected' : ''}>${s.name}</option>`)}</select>
        </div>

        <div class="card">
          <h2>Demomodus</h2>
          <p class="muted small">Verken de app met <strong>fictieve</strong> bonnen. Demogegevens staan in een aparte database en raken uw echte gegevens nooit.</p>
          <div class="seg">
            <button class="${state.mode === 'real' ? 'on' : ''}" data-action="mode" data-m="real">Mijn gegevens</button>
            <button class="${state.mode === 'demo' ? 'on' : ''}" data-action="mode" data-m="demo">Demo</button>
          </div>
        </div>

        <details class="card">
          <summary>Geavanceerd: adres van de aanbiedingen</summary>
          <p class="muted small">Standaard leest de app <code>data/aanbiedingen.json</code> van dezelfde website. Alleen nodig als de app ergens anders draait dan op GitHub Pages.</p>
          <input class="input small" placeholder="https://gebruikersnaam.github.io/boodschappenbrein/data/aanbiedingen.json" value="${state.settings.offersUrl || ''}" data-change="offersUrl">
        </details>

        <div class="card">
          <h2 style="color:var(--bad)">Alles wissen</h2>
          <p class="muted small">Verwijdert alle gegevens in de ${state.mode === 'demo' ? 'demo-' : ''}database op dit apparaat. Maak eerst een back-up.</p>
          <button class="btn danger" data-action="wipe">${icon('trash', 16)}Alles wissen</button>
        </div>
        <div class="card">
          <div class="quiet-line"><h2 style="margin:0">App bijwerken</h2><span class="tiny muted">versie ${currentVersion() || '–'}</span></div>
          <p class="muted small">De app werkt zichzelf bij als je hem opent. Lukt dat niet, tik dan hier.</p>
          <button class="btn" data-action="update">Nu bijwerken</button>
        </div>
        <p class="muted tiny">Boodschappenbrein 1.0 · lokale app zonder account · gegevens verlaten dit apparaat niet.</p>
      </div>`;
  },
  actions: {
    async update() {
      toast('Bijwerken…');
      try { await checkForUpdate({ force: true }); } catch { toast('Geen verbinding'); return; }
      reloadApp();
    },
    async backup() {
      const b = await exportBackup();
      download(`boodschappenbrein-backup-${todayISO()}.json`, JSON.stringify(b));
      toast(`Back-up gemaakt (${b.counts.receipts} bonnen)`);
    },
    async restore(el) {
      const file = el.files[0];
      el.value = '';
      if (!file) return;
      let obj;
      try { obj = JSON.parse(await file.text()); } catch { toast('Dit is geen geldig JSON-bestand.'); return; }
      const errors = validateBackup(obj);
      if (errors.length) { toast(errors[0]); return; }
      if (!(await confirmSheet('Back-up terugzetten?', `Back-up van ${formatDate(localDateOf(obj.exportedAt))} met ${obj.counts?.receipts ?? '?'} bonnen. Alle huidige gegevens worden vervangen.`, { confirm: 'Terugzetten', danger: true }))) return;
      await restoreBackup(obj);
      toast('Back-up teruggezet');
    },
    async addVac(form) {
      const fd = new FormData(form);
      const from = fd.get('from');
      const to = fd.get('to');
      if (!from || !to || to < from) { toast('Kies een geldige periode.'); return; }
      await setSetting('vacations', [...(state.settings.vacations || []), { from, to }].sort((a, b) => a.from.localeCompare(b.from)));
    },
    async delVac(el) { const v = [...state.settings.vacations]; v.splice(+el.dataset.i, 1); await setSetting('vacations', v); },
    async toggleMyStore(el) {
      const list = [...(state.settings.myStores || [])];
      const i = list.findIndex((m) => m.id === el.dataset.id);
      if (i >= 0) list.splice(i, 1); else list.push({ id: el.dataset.id });
      await setSetting('myStores', list);
    },
    async offersUrl(el) { await setSetting('offersUrl', el.value.trim()); const { refreshOffers } = await import('../../data/store.js'); refreshOffers(); },
    async hasFreezer(el) { await setSetting('hasFreezer', el.checked); },
    async freezerCap2(el) { await setSetting('freezerCapacity', Math.max(5, Math.min(400, +el.value || 40))); },
    async defaultStore(el) { await setSetting('defaultStore', el.value || null); },
    async mode(el) { usage = null; await setMode(el.dataset.m); toast(el.dataset.m === 'demo' ? 'Demomodus: fictieve gegevens' : 'Uw eigen gegevens'); },
    async wipe() {
      if (!(await confirmSheet('Alles wissen?', 'Dit kan niet ongedaan worden gemaakt.', { confirm: 'Definitief wissen', danger: true }))) return;
      await wipeAll();
      toast('Alle gegevens gewist');
    },
  },
};
