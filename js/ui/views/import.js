import { state, commitReceipts, undoImport, existingFingerprints, findImportByHash, memory } from '../../data/store.js';
import { html, icon, toast, confirmSheet, esc } from '../dom.js';
import { euro, parseAmount, parseNumber } from '../../core/money.js';
import { STORES, storeName } from '../../core/stores.js';
import { CATEGORIES, categoryName, guessCategory } from '../../core/categories.js';
import { formatDate, todayISO, localDateOf } from '../../core/dates.js';
import { parseReceiptText, validate } from '../../core/receipt-parser.js';
import { detectMapping, rowsToReceipts, FIELDS } from '../../core/table-import.js';
import { classifyDuplicates } from '../../core/dedupe.js';
import { resolveLines } from '../../core/commit.js';
import { parseSize, displayName } from '../../core/products.js';
import { fileKind, hashFile, extractPdf, extractImage, extractTable } from '../../import/extract.js';
import { pickProduct } from './product.js';

// Sessie van de lopende import (niet opgeslagen tot de gebruiker op "Opslaan" tikt).
const session = { files: [], proposals: [], tables: [], busy: false, onlyIssues: false, pasteOpen: false, expanded: new Set() };
let seq = 0;

const KIND_LABELS = { product: 'Artikel', discount: 'Korting', return: 'Retour', deposit: 'Statiegeld', nongrocery: 'Geen boodschap' };

function rerenderSoon(ctx) { if (ctx?.rerender) ctx.rerender(); else window.dispatchEvent(new HashChangeEvent('hashchange')); }

async function handleFiles(files, ctx) {
  session.busy = true;
  for (const file of files) {
    const entry = { id: ++seq, name: file.name, size: file.size, kind: fileKind(file), status: 'bezig', message: 'Bestand lezen…', hash: null };
    session.files.push(entry);
    rerenderSoon(ctx);
    try {
      entry.hash = await hashFile(file);
      const prev = findImportByHash(entry.hash);
      if (prev) {
        entry.status = 'dubbel';
        entry.message = `Dit bestand is al geïmporteerd op ${formatDate(localDateOf(prev.createdAt))}.`;
        entry.file = file;
        rerenderSoon(ctx);
        continue;
      }
      await processFile(file, entry, ctx);
    } catch (e) {
      console.error(e);
      entry.status = 'fout';
      entry.message = e.message || 'Onbekende fout.';
    }
    rerenderSoon(ctx);
  }
  session.busy = false;
  markDuplicates();
  rerenderSoon(ctx);
}

async function processFile(file, entry, ctx) {
  const progress = (m) => { entry.message = m; const el = document.querySelector(`[data-file-msg="${entry.id}"]`); if (el) el.textContent = m; };
  const today = todayISO();
  if (entry.kind === 'pdf' || entry.kind === 'image' || entry.kind === 'text') {
    const { text, method } = entry.kind === 'pdf' ? await extractPdf(file, progress) : entry.kind === 'image' ? await extractImage(file, progress) : { text: await file.text(), method: 'tekst' };
    const p = parseReceiptText(text, { today, fileName: file.name });
    const extra = p.extra || [];
    delete p.extra;
    addProposal(p, { fileName: file.name, sourceType: method, fileId: entry.id });
    for (const x of extra) addProposal(x, { fileName: `${file.name} (retourbon)`, sourceType: method, fileId: entry.id });
    entry.status = 'klaar';
    entry.message = `${extra.length ? `${extra.length + 1} bonnen, ` : ''}${p.lines.length} regels herkend (${method === 'ocr' || method === 'pdf-ocr' ? 'tekstherkenning — controleer extra goed' : 'tekst uit bestand'})`;
  } else if (entry.kind === 'csv' || entry.kind === 'excel') {
    const { rows } = await extractTable(file);
    setupTable(rows, file.name, entry);
  } else if (entry.kind === 'json') {
    const data = JSON.parse(await file.text());
    if (data?.app === 'Boodschappenbrein') throw new Error('Dit is een back-up. Herstel back-ups via Instellingen.');
    const rows = jsonToRows(data);
    if (!rows) throw new Error('Onbekende JSON-structuur: geen lijst met regels gevonden.');
    setupTable(rows, file.name, entry);
  } else {
    throw new Error('Dit bestandstype wordt niet ondersteund. Gebruik PDF, foto, CSV, Excel, JSON of tekst.');
  }
}

/** AVG-/exportbestanden in JSON: zoek de grootste lijst met objecten en maak er een tabel van. */
function jsonToRows(data) {
  let best = null;
  const visit = (v, depth) => {
    if (depth > 6 || v == null) return;
    if (Array.isArray(v)) {
      if (v.length && typeof v[0] === 'object' && !Array.isArray(v[0]) && (!best || v.length > best.length)) best = v;
      v.slice(0, 50).forEach((x) => visit(x, depth + 1));
    } else if (typeof v === 'object') Object.values(v).forEach((x) => visit(x, depth + 1));
  };
  visit(data, 0);
  if (!best) return null;
  const flat = best.map((o) => flatten(o));
  const keys = [...new Set(flat.flatMap((o) => Object.keys(o)))];
  return [keys, ...flat.map((o) => keys.map((k) => o[k] ?? ''))];
}
function flatten(o, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(o || {})) {
    const key = prefix ? `${prefix} ${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else if (!Array.isArray(v)) out[key] = v;
  }
  return out;
}

function setupTable(rows, fileName, entry) {
  const det = detectMapping(rows);
  const table = { id: entry.id, fileName, rows, headerRow: det.headerRow, mapping: { ...det.mapping }, defaultStore: state.settings.defaultStore || null, applied: false };
  session.tables.push(table);
  if (det.confident) {
    applyTable(table);
    entry.status = 'klaar';
    entry.message = `${rows.length - det.headerRow - 1} rijen; kolommen automatisch herkend — controleer de toewijzing hieronder.`;
  } else {
    entry.status = 'kolommen';
    entry.message = 'Kies welke kolom wat bevat.';
  }
}

function applyTable(table) {
  session.proposals = session.proposals.filter((p) => p.fileId !== table.id);
  const { receipts, skipped } = rowsToReceipts(table.rows, table);
  for (const r of receipts) addProposal(r, { fileName: table.fileName, sourceType: 'tabel', fileId: table.id });
  table.applied = true;
  table.skipped = skipped;
  markDuplicates();
}

function addProposal(p, meta) {
  Object.assign(p, meta, { _id: ++seq, include: true });
  if (!p.store && state.settings.defaultStore) { p.store = state.settings.defaultStore; p.warnings.push('Supermarkt niet herkend; standaardwinkel ingevuld.'); }
  session.proposals.push(p);
  if (needsAttention(p)) session.expanded.add(p._id);
}

function markDuplicates() {
  const status = classifyDuplicates(session.proposals, existingFingerprints());
  session.proposals.forEach((p, i) => {
    p.dup = status[i];
    if (p.dup === 'dubbel') p.include = false;
  });
}

function needsAttention(p) {
  return p.check !== 'ok' && p.sourceType !== 'tabel' || !p.date || !p.store || p.lines.some((l) => (l.confidence ?? 1) < 0.75);
}

// ---------- weergave ----------
function fileList() {
  if (!session.files.length) return '';
  return html`<div class="card tight" style="margin-top:14px"><div class="rows">${session.files.map((f) => html`
    <div class="row-item">
      ${f.status === 'bezig' ? html`<span class="spinner"></span>` : f.status === 'fout' ? html`<span class="chip bad">Fout</span>` : f.status === 'dubbel' ? html`<span class="chip warn">Al gedaan</span>` : f.status === 'kolommen' ? html`<span class="chip warn">Actie</span>` : html`<span class="chip good">${icon('check', 14)}</span>`}
      <div class="grow"><div class="title">${f.name}</div><div class="sub" data-file-msg="${f.id}">${f.message}</div></div>
      ${f.status === 'dubbel' ? html`<button class="btn small" data-action="forceFile" data-id="${f.id}">Toch inlezen</button>` : ''}
    </div>`)}</div></div>`;
}

function mappingCard(t) {
  const header = t.rows[t.headerRow] || [];
  const opts = (fid) => html`<option value="">—</option>${header.map((h, i) => html`<option value="${i}" ${t.mapping[fid] === i ? 'selected' : ''}>${String(h || `kolom ${i + 1}`).slice(0, 40)}</option>`)}`;
  return html`<div class="card" style="margin-top:14px">
    <div class="card-head"><h2>Kolommen · ${t.fileName}</h2>${t.applied ? html`<span class="chip good">Toegepast</span>` : ''}</div>
    <div class="grid two" style="gap:10px">
      ${FIELDS.map((f) => html`<label class="field">${f.label}${f.required ? ' *' : ''}
        <select class="input small" data-change="mapField" data-table="${t.id}" data-field="${f.id}">${opts(f.id)}</select></label>`)}
      <label class="field">Kopregel (rijnummer)<input class="input small" type="number" min="1" value="${t.headerRow + 1}" data-change="headerRow" data-table="${t.id}"></label>
      <label class="field">Winkel als kolom ontbreekt
        <select class="input small" data-change="tableStore" data-table="${t.id}"><option value="">Onbekend</option>${STORES.map((s) => html`<option value="${s.id}" ${t.defaultStore === s.id ? 'selected' : ''}>${s.name}</option>`)}</select></label>
    </div>
    <div class="scroll-x" style="margin-top:12px"><table class="table"><tbody>${t.rows.slice(t.headerRow, t.headerRow + 5).map((r, i) => html`<tr style="${i === 0 ? 'font-weight:600' : ''}">${r.slice(0, 10).map((c) => html`<td>${String(c instanceof Date ? c.toISOString().slice(0, 10) : c).slice(0, 30)}</td>`)}</tr>`)}</tbody></table></div>
    ${t.skipped?.length ? html`<p class="small" style="color:var(--warn)">${t.skipped.length} rijen overgeslagen (bv. rij ${t.skipped[0].row}: ${t.skipped[0].reason}).</p>` : ''}
    <button class="btn primary" style="margin-top:10px" data-action="applyTable" data-table="${t.id}">Toepassen</button>
  </div>`;
}

function lineRow(p, l, i, mem) {
  const low = (l.confidence ?? 1) < 0.75;
  const isProduct = l.kind === 'product' || l.kind === 'return';
  const match = l.match;
  const matched = match?.productId ? mem.products.get(match.productId) : null;
  return html`<div class="review-line ${low ? 'low' : ''}">
    <input class="input small" value="${l.rawName}" data-change="lineName" data-p="${p._id}" data-i="${i}" aria-label="Omschrijving">
    <input class="input small num" value="${String(l.qty).replace('.', ',')}" inputmode="decimal" data-change="lineQty" data-p="${p._id}" data-i="${i}" aria-label="Aantal">
    <input class="input small num" value="${(l.amount / 100).toFixed(2).replace('.', ',')}" inputmode="decimal" data-change="lineAmount" data-p="${p._id}" data-i="${i}" aria-label="Bedrag">
    <button class="icon-btn" data-action="delLine" data-p="${p._id}" data-i="${i}" aria-label="Regel verwijderen">${icon('trash', 16)}</button>
    <div class="meta">
      <select class="input" data-change="lineKind" data-p="${p._id}" data-i="${i}">${Object.entries(KIND_LABELS).map(([k, v]) => html`<option value="${k}" ${k === l.kind ? 'selected' : ''}>${v}</option>`)}</select>
      ${isProduct ? (matched
        ? html`<button class="chip info" data-action="pickLine" data-p="${p._id}" data-i="${i}" title="Gekoppeld product wijzigen">→ ${matched.name}${match.method === 'geleerd' ? ' (geleerd)' : match.method === 'handmatig' ? ' (gekozen)' : match.method === 'gelijkenis' ? ' (lijkt op — klopt dit?)' : ''}</button>`
        : html`<button class="chip" data-action="pickLine" data-p="${p._id}" data-i="${i}">Nieuw product · koppelen?</button>
          <select class="input" data-change="lineCat" data-p="${p._id}" data-i="${i}">${CATEGORIES.map((c) => html`<option value="${c.id}" ${c.id === (l.category || guessCategory(l.rawName + ' ' + displayName(l.rawName)).id) ? 'selected' : ''}>${c.name}</option>`)}</select>`) : ''}
      ${l.kind === 'discount' ? html`<select class="input" data-change="lineLink" data-p="${p._id}" data-i="${i}"><option value="">Niet gekoppeld</option>${p.lines.map((x, j) => x.kind === 'product' ? html`<option value="${j}" ${l.linkedTo === j ? 'selected' : ''}>bij: ${x.rawName}</option>` : '')}</select>` : ''}
      ${l.weighed ? html`<span class="chip">gewogen (kg)</span>` : ''}
      ${l.repaired ? html`<span class="chip warn" title="Tekstherkenning las ${euro(l.repairedFrom?.what === 'stukprijs' ? l.repairedFrom.unitPrice : l.repairedFrom?.amount)}; aangepast zodat de bon klopt">hersteld · las ${euro(l.repairedFrom?.what === 'stukprijs' ? l.repairedFrom.unitPrice : l.repairedFrom?.amount)}</span>` : low ? html`<span class="chip warn">controleer</span>` : ''}
    </div>
  </div>`;
}

function proposalCard(p, mem) {
  const open = session.expanded.has(p._id);
  const resolved = open ? resolveLines(p, mem) : null;
  const diff = p.total != null ? p.computedTotal - p.total : null;
  return html`<div class="card" style="margin-top:12px;${p.include ? '' : 'opacity:.6'}">
    <div class="between" style="align-items:flex-start">
      <label class="gap8" style="cursor:pointer"><input type="checkbox" ${p.include ? 'checked' : ''} data-change="include" data-p="${p._id}" style="width:20px;height:20px">
        <div><div style="font-weight:650">${storeName(p.store)} · ${p.date ? formatDate(p.date) : 'datum?'}</div>
        <div class="muted small">${p.lines.length} regels · ${p.fileName || ''}</div></div></label>
      <div style="text-align:right">
        <div class="num" style="font-weight:700">${euro(p.total ?? p.computedTotal)}</div>
        ${p.check === 'ok' ? html`<span class="chip good">Totaal klopt</span>` : p.check === 'afwijking' ? html`<span class="chip bad">Verschil ${euro(diff)}</span>` : html`<span class="chip muted">Geen bontotaal</span>`}
      </div>
    </div>
    ${p.dup === 'dubbel' ? html`<div class="notice warn" style="margin-top:10px">Deze bon staat al in de database en wordt overgeslagen.</div>` : p.dup === 'mogelijk-dubbel' ? html`<div class="notice warn" style="margin-top:10px">Mogelijk dubbel: er is al een bon van dezelfde winkel, datum en bedrag.</div>` : ''}
    ${p.warnings?.length ? html`<ul class="small" style="color:var(--warn);margin:8px 0 0;padding-left:18px">${p.warnings.map((w) => html`<li>${w}</li>`)}</ul>` : ''}
    <div class="btn-row" style="margin-top:10px"><button class="btn small" data-action="expand" data-p="${p._id}">${open ? 'Inklappen' : 'Regels bekijken'}</button></div>
    ${open ? html`
      <div class="grid two" style="gap:10px;margin-top:12px">
        <label class="field">Supermarkt<select class="input small" data-change="pStore" data-p="${p._id}"><option value="">Onbekend</option>${STORES.map((s) => html`<option value="${s.id}" ${p.store === s.id ? 'selected' : ''}>${s.name}</option>`)}</select></label>
        <label class="field">Datum<input class="input small" type="date" value="${p.date || ''}" data-change="pDate" data-p="${p._id}"></label>
        <label class="field">Bontotaal (van de bon)<input class="input small num" inputmode="decimal" value="${p.total != null ? (p.total / 100).toFixed(2).replace('.', ',') : ''}" data-change="pTotal" data-p="${p._id}"></label>
        <div class="field"><span>Som van de regels</span><div class="num" style="padding:8px 0;font-weight:650">${euro(p.computedTotal)}</div></div>
      </div>
      <div class="review-line muted tiny" style="border:0"><span>Omschrijving</span><span>Aantal</span><span>Bedrag €</span><span></span></div>
      ${resolved.map((l, i) => ({ l, i })).filter(({ l }) => !session.onlyIssues || (l.confidence ?? 1) < 0.75).map(({ l, i }) => lineRow(p, l, i, mem))}
      <button class="btn small ghost" data-action="addLine" data-p="${p._id}">${icon('plus', 14)} Regel toevoegen</button>
      ${p.rawText ? html`<details style="margin-top:10px"><summary class="small">Originele tekst</summary><pre class="raw">${p.rawText}</pre></details>` : ''}
    ` : ''}
  </div>`;
}

const AH_INFO = html`
  <details class="card" style="margin-top:14px">
    <summary>Albert Heijn-gegevens: wat kan wel en niet?</summary>
    <div class="small" style="margin-top:10px">
      <p><strong>Digitale kassabonnen in de AH-app.</strong> Met een persoonlijke Bonuskaart staan uw bonnen in de app (Profiel → Kassabonnen) en ze blijven daar 27 maanden bewaard. Er is geen exportknop. Werkwijze: open een bon, maak een schermafbeelding (of deel/print als PDF als uw app dat aanbiedt) en importeer die hier. Schermafbeeldingen zijn veel scherper dan foto's van papier en worden daardoor beter herkend.</p>
      <p><strong>ah.nl “Mijn bestellingen”</strong> (online bestellingen): open een bestelling en kies Afdrukken → Opslaan als PDF. Importeer de PDF hier. Het formaat van deze overzichten is niet gedocumenteerd; controleer de herkende regels.</p>
      <p><strong>AVG-inzageverzoek.</strong> U kunt AH vragen om al uw aankoopgegevens (via de privacypagina van ah.nl). Het formaat van die export is niet openbaar; als het een CSV, Excel of JSON is, kan deze app het lezen via kolomtoewijzing.</p>
      <p><strong>Wat bewust niet is gebouwd:</strong> automatisch inloggen of scrapen van de AH-app of ah.nl. Er is geen officiële API voor klantgegevens; onofficiële koppelingen kunnen zonder aankondiging stoppen en vragen om uw inloggegevens. Daarom niet.</p>
      <p class="muted">Andere supermarkten: Jumbo, Lidl Plus en PLUS tonen ook digitale bonnen in hun apps; dezelfde werkwijze (schermafbeelding of PDF) werkt daar.</p>
    </div>
  </details>`;

export default {
  manualRefresh: true,
  render() {
    const mem = memory();
    const included = session.proposals.filter((p) => p.include);
    const sum = included.reduce((t, p) => t + (p.total ?? p.computedTotal ?? 0), 0);
    const issues = included.filter((p) => !p.date || p.check === 'afwijking').length;
    return html`
      <div class="page-head"><div><h1>Importeren</h1><p class="muted">PDF, foto of schermafbeelding van een bon, CSV/Excel, of geplakte tekst. Meerdere tegelijk kan.</p></div></div>

      <label class="drop" data-drop>
        <div class="big-icon">${icon('import', 26)}</div>
        <div style="font-weight:650">Kies bestanden of sleep ze hierheen</div>
        <div class="muted small">PDF · JPG/PNG · CSV · XLSX · JSON · TXT</div>
        <input type="file" multiple accept=".pdf,image/*,.csv,.tsv,.xlsx,.xls,.json,.txt" class="sr-only" data-change="files">
      </label>
      <div class="btn-row" style="margin-top:10px">
        <label class="btn">${icon('camera', 18)}Foto maken<input type="file" accept="image/*" capture="environment" class="sr-only" data-change="files"></label>
        <button class="btn" data-action="togglePaste">Tekst plakken</button>
      </div>
      ${session.pasteOpen ? html`<form class="card" style="margin-top:10px" data-submit="paste">
        <textarea class="input" name="text" rows="8" placeholder="Plak hier de tekst van een kassabon…"></textarea>
        <button class="btn primary" style="margin-top:8px">Herkennen</button></form>` : ''}

      ${fileList()}
      ${session.tables.map(mappingCard)}

      ${session.proposals.length ? html`
        <div class="card" style="margin-top:14px;position:sticky;top:64px;z-index:5">
          <div class="between wrap">
            <div><div style="font-weight:650">${included.length} van ${session.proposals.length} bonnen klaar om op te slaan</div>
            <div class="muted small num">Totaal ${euro(sum)}${issues ? ` · ${issues} met aandachtspunten` : ''}</div></div>
            <div class="btn-row">
              <button class="btn small" data-action="toggleIssues">${session.onlyIssues ? 'Alle regels' : 'Alleen twijfelregels'}</button>
              <button class="btn small" data-action="discard">Annuleren</button>
              <button class="btn primary" data-action="save" ${included.length && !session.busy ? '' : 'disabled'}>Opslaan</button>
            </div>
          </div>
        </div>
        ${session.proposals.slice(0, 150).map((p) => proposalCard(p, mem))}
        ${session.proposals.length > 150 ? html`<p class="muted small">Nog ${session.proposals.length - 150} bonnen (niet getoond, worden wel opgeslagen).</p>` : ''}
      ` : ''}

      ${AH_INFO}

      <div class="section-label">Eerdere imports</div>
      ${state.imports.length ? html`<div class="card tight"><div class="rows">${state.imports.slice(0, 30).map((imp) => html`
        <div class="row-item">
          <div class="grow"><div class="title">${imp.label}</div>
          <div class="sub">${formatDate(localDateOf(imp.createdAt))} · ${imp.receiptCount} bonnen · ${euro(imp.total)}</div></div>
          <button class="btn small danger" data-action="undo" data-id="${imp.id}">${icon('undo', 14)}Terugdraaien</button>
        </div>`)}</div></div>` : html`<p class="muted small">Nog niets geïmporteerd.</p>`}
    `;
  },
  after(root) {
    const drop = root.querySelector('[data-drop]');
    if (!drop) return;
    ['dragenter', 'dragover'].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (ev) => { if (ev.dataTransfer?.files?.length) handleFiles([...ev.dataTransfer.files]); });
  },
  actions: {
    files(el, ev, ctx) { const files = [...el.files]; el.value = ''; if (files.length) handleFiles(files, ctx); },
    togglePaste(el, ev, { rerender }) { session.pasteOpen = !session.pasteOpen; rerender(); },
    paste(form, ev, { rerender }) {
      const text = new FormData(form).get('text');
      if (!String(text).trim()) return;
      const p = parseReceiptText(String(text), { today: todayISO() });
      addProposal(p, { fileName: 'geplakte tekst', sourceType: 'tekst' });
      session.pasteOpen = false;
      markDuplicates();
      rerender();
    },
    async forceFile(el, ev, ctx) {
      const f = session.files.find((x) => x.id === +el.dataset.id);
      f.status = 'bezig';
      f.message = 'Opnieuw lezen…';
      ctx.rerender();
      try { await processFile(f.file, f, ctx); } catch (e) { f.status = 'fout'; f.message = e.message; }
      markDuplicates();
      ctx.rerender();
    },
    mapField(el, ev, { rerender }) { const t = tbl(el); const v = el.value; if (v === '') delete t.mapping[el.dataset.field]; else t.mapping[el.dataset.field] = +v; t.applied = false; rerender(); },
    headerRow(el, ev, { rerender }) { const t = tbl(el); t.headerRow = Math.max(0, (+el.value || 1) - 1); t.mapping = detectMappingAt(t); t.applied = false; rerender(); },
    tableStore(el, ev, { rerender }) { const t = tbl(el); t.defaultStore = el.value || null; t.applied = false; rerender(); },
    applyTable(el, ev, { rerender }) {
      const t = tbl(el);
      if (t.mapping.date == null || t.mapping.product == null || (t.mapping.amount == null && t.mapping.unitPrice == null)) { toast('Kies minimaal Datum, Product en een Bedrag of Stukprijs.'); return; }
      applyTable(t);
      const f = session.files.find((x) => x.id === t.id);
      if (f) { f.status = 'klaar'; f.message = `${session.proposals.filter((p) => p.fileId === t.id).length} bonnen gevormd uit de tabel.`; }
      rerender();
    },
    include(el, ev, { rerender }) { prop(el).include = el.checked; rerender(); },
    expand(el, ev, { rerender }) { const id = +el.dataset.p; session.expanded.has(id) ? session.expanded.delete(id) : session.expanded.add(id); rerender(); },
    toggleIssues(el, ev, { rerender }) { session.onlyIssues = !session.onlyIssues; rerender(); },
    pStore(el, ev, { rerender }) { const p = prop(el); p.store = el.value || null; revalidate(p); rerender(); },
    pDate(el, ev, { rerender }) { const p = prop(el); p.date = el.value || null; revalidate(p); rerender(); },
    pTotal(el, ev, { rerender }) { const p = prop(el); const v = parseAmount(el.value) ?? (parseNumber(el.value) != null ? Math.round(parseNumber(el.value) * 100) : null); p.total = v; revalidate(p); rerender(); },
    lineName(el, ev, { rerender }) { const l = line(el); l.rawName = el.value.trim(); l.size = parseSize(l.rawName); l.confidence = 1; delete l.productId; rerender(); },
    lineQty(el, ev, { rerender }) { const l = line(el); const q = parseNumber(el.value); if (q) { l.qty = q; l.confidence = 1; } rerender(); },
    lineAmount(el, ev, { rerender }) { const l = line(el); const v = parseAmount(el.value) ?? (parseNumber(el.value) != null ? Math.round(parseNumber(el.value) * 100) : null); if (v != null) { l.amount = v; l.unitPrice = l.qty ? Math.round(v / l.qty) : v; l.confidence = 1; } revalidate(prop(el)); rerender(); },
    lineKind(el, ev, { rerender }) { const l = line(el); l.kind = el.value; if (l.kind === 'discount' && l.amount > 0) l.amount = -l.amount; if (l.kind !== 'discount') l.linkedTo = null; l.confidence = 1; revalidate(prop(el)); rerender(); },
    lineCat(el) { line(el).category = el.value; },
    lineLink(el, ev, { rerender }) { const l = line(el); l.linkedTo = el.value === '' ? null : +el.value; delete l.linkedAlso; l.confidence = 1; rerender(); },
    delLine(el, ev, { rerender }) {
      const p = prop(el);
      const i = +el.dataset.i;
      p.lines.splice(i, 1);
      for (const l of p.lines) {
        if (l.linkedAlso) l.linkedAlso = l.linkedAlso.filter((j) => j !== i).map((j) => (j > i ? j - 1 : j));
        if (l.linkedTo === i) { l.linkedTo = l.linkedAlso?.shift() ?? null; } else if (l.linkedTo > i) l.linkedTo--;
      }
      revalidate(p);
      rerender();
    },
    addLine(el, ev, { rerender }) { const p = prop(el); p.lines.push({ rawName: 'Nieuw artikel', qty: 1, unitPrice: 0, amount: 0, kind: 'product', confidence: 0.5, linkedTo: null }); revalidate(p); rerender(); },
    pickLine(el, ev, { rerender }) {
      const l = line(el);
      pickProduct('Koppelen aan bestaand product', `“${l.rawName}” — de app onthoudt deze koppeling.`, (target) => { l.productId = target.id; l.learn = true; rerender(); });
    },
    async save(el, ev, { rerender }) {
      const chosen = session.proposals.filter((p) => p.include);
      const noDate = chosen.filter((p) => !p.date);
      if (noDate.length) { toast(`${noDate.length} bon(nen) zonder datum. Vul de datum in of vink ze uit.`); return; }
      const off = chosen.filter((p) => p.check === 'afwijking');
      if (off.length && !(await confirmSheet('Totaal klopt niet', `${off.length} bon(nen) hebben een verschil tussen de regels en het bontotaal. Toch opslaan? U kunt ze later bekijken en verwijderen.`, { confirm: 'Toch opslaan' }))) return;
      session.busy = true;
      const files = session.files.filter((f) => f.hash && session.proposals.some((p) => p.fileId === f.id && p.include)).map((f) => ({ name: f.name, hash: f.hash }));
      const imp = await commitReceipts(chosen, { files });
      Object.assign(session, { files: [], proposals: [], tables: [], busy: false, expanded: new Set() });
      rerender();
      toast(`${imp.receiptCount} bonnen opgeslagen`, { action: 'Terugdraaien', onAction: async () => { await undoImport(imp.id); rerender(); toast('Import teruggedraaid'); }, duration: 8000 });
    },
    discard(el, ev, { rerender }) { Object.assign(session, { files: [], proposals: [], tables: [], expanded: new Set() }); rerender(); },
    async undo(el, ev, { rerender }) {
      const imp = state.imports.find((i) => i.id === el.dataset.id);
      if (!(await confirmSheet('Import terugdraaien?', `${imp.receiptCount} bonnen (${euro(imp.total)}) worden verwijderd, plus producten die alleen door deze import bestonden.`, { confirm: 'Terugdraaien', danger: true }))) return;
      await undoImport(imp.id);
      rerender();
      toast('Import teruggedraaid');
    },
  },
};

function tbl(el) { return session.tables.find((t) => t.id === +el.dataset.table); }
function prop(el) { return session.proposals.find((p) => p._id === +el.dataset.p); }
function line(el) { return prop(el).lines[+el.dataset.i]; }
function revalidate(p) { validate(p); markDuplicates(); }
function detectMappingAt(t) {
  const det = detectMapping(t.rows.slice(t.headerRow));
  return det.mapping;
}

export { esc, categoryName };
