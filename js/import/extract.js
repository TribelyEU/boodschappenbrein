// Tekst en tabellen uit bestanden halen: PDF, foto (OCR), CSV, Excel, JSON.

import { loadPdfjs, loadScript, LIBS } from './loaders.js';
import { parseCSV } from '../core/table-import.js';
import { sha256Hex } from '../core/text.js';
import { itemsToLines } from '../core/pdf-lines.js';

export function fileKind(file) {
  const n = file.name.toLowerCase();
  if (file.type === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (file.type.startsWith('image/') || /\.(jpe?g|png|heic|heif|webp)$/.test(n)) return 'image';
  if (n.endsWith('.csv') || n.endsWith('.tsv') || file.type === 'text/csv') return 'csv';
  if (/\.(xlsx|xls|ods)$/.test(n)) return 'excel';
  if (n.endsWith('.json')) return 'json';
  if (n.endsWith('.txt') || file.type === 'text/plain') return 'text';
  return 'onbekend';
}

export async function hashFile(file) {
  return sha256Hex(await file.arrayBuffer());
}

export async function extractPdf(file, onProgress) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  let textChars = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const t = itemsToLines(content.items);
    textChars += t.replace(/\s/g, '').length;
    pages.push(t);
    onProgress?.(`PDF pagina ${i}/${doc.numPages} gelezen`);
  }
  if (textChars > 30) return { text: pages.join('\n'), method: 'pdf-tekst' };
  // Gescande PDF zonder tekstlaag: pagina's renderen en OCR toepassen.
  onProgress?.('PDF bevat geen tekst; tekstherkenning (OCR) wordt gebruikt…');
  const texts = [];
  for (let i = 1; i <= Math.min(doc.numPages, 5); i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 2.5 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    texts.push(await ocrCanvas(canvas, onProgress));
  }
  return { text: texts.join('\n'), method: 'pdf-ocr' };
}

let workerPromise = null;
async function getOcrWorker(onProgress) {
  if (!workerPromise) {
    workerPromise = (async () => {
      const Tesseract = await loadScript(LIBS.tesseract, 'Tesseract');
      onProgress?.('Tekstherkenning wordt geladen (eenmalig ±15 MB)…');
      const worker = await Tesseract.createWorker('nld', 1, {
        logger: (m) => { if (m.status === 'recognizing text') onProgress?.(`Tekst herkennen… ${Math.round(m.progress * 100)}%`); },
      });
      await worker.setParameters({ tessedit_pageseg_mode: '4', preserve_interword_spaces: '1' });
      return worker;
    })().catch((e) => { workerPromise = null; throw e; });
  }
  return workerPromise;
}

/** Foto voorbewerken: schalen, grijs, contrast. Verbetert OCR op kassabonnen merkbaar. */
async function prepareImage(file) {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error('Deze afbeelding kan niet gelezen worden (HEIC? Zet de iPhone-camera op “Meest compatibel” of maak een schermafbeelding).');
  const scale = Math.min(2.5, Math.max(1, 1800 / bitmap.width));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) { const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; d[i] = g; sum += g; }
  const mean = sum / (d.length / 4);
  for (let i = 0; i < d.length; i += 4) {
    let g = (d[i] - mean) * 1.6 + 150;
    g = g < 0 ? 0 : g > 255 ? 255 : g;
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Aantal bedragen in de tekst (een kassabon heeft er veel; bij te weinig is de opmaak niet goed gelezen). */
const amountCount = (t) => (String(t).match(/\d{1,4}[,.]\d{2}/g) || []).length;

async function ocrCanvas(canvas, onProgress) {
  const worker = await getOcrWorker(onProgress);
  // Eerst "één blok" (psm 4): goed voor de meeste bonnen. Bij een bon met kolommen (Jumbo) vallen de bedragen dan weg;
  // dan opnieuw met "losse regels" (psm 6), en het resultaat met de meeste bedragen gebruiken.
  await worker.setParameters({ tessedit_pageseg_mode: '4' });
  const first = (await worker.recognize(canvas)).data.text;
  if (amountCount(first) >= 6) return first;
  await worker.setParameters({ tessedit_pageseg_mode: '6' });
  const second = (await worker.recognize(canvas)).data.text;
  await worker.setParameters({ tessedit_pageseg_mode: '4' });
  return amountCount(second) > amountCount(first) ? second : first;
}

export async function extractImage(file, onProgress) {
  const canvas = await prepareImage(file);
  return { text: await ocrCanvas(canvas, onProgress), method: 'ocr' };
}

export async function extractTable(file) {
  const kind = fileKind(file);
  if (kind === 'csv') {
    const text = await file.text();
    return { rows: parseCSV(text).rows };
  }
  const XLSX = await loadScript(LIBS.xlsx, 'XLSX');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  return { rows: rows.map((r) => r.map((c) => (c instanceof Date ? c : c))), sheets: wb.SheetNames };
}
