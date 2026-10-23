// Externe bibliotheken worden pas geladen als ze nodig zijn (eenmalig, daarna in de browsercache).
// Uw bestanden blijven op uw apparaat: alleen de programmacode van deze bibliotheken wordt gedownload.

export const LIBS = {
  pdfjs: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs',
  pdfjsWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs',
  tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
  xlsx: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
};

const loaded = new Map();

export function loadScript(src, globalName) {
  if (globalThis[globalName]) return Promise.resolve(globalThis[globalName]);
  if (loaded.has(src)) return loaded.get(src);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => (globalThis[globalName] ? resolve(globalThis[globalName]) : reject(new Error(`${globalName} niet beschikbaar na laden.`)));
    s.onerror = () => reject(new Error('Kon een benodigde bibliotheek niet laden. Is er internetverbinding?'));
    document.head.appendChild(s);
  });
  loaded.set(src, p);
  p.catch(() => loaded.delete(src));
  return p;
}

let pdfjsPromise = null;
export function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(/* @vite-ignore */ LIBS.pdfjs).then((m) => {
      m.GlobalWorkerOptions.workerSrc = LIBS.pdfjsWorker;
      return m;
    }).catch((e) => {
      pdfjsPromise = null;
      throw new Error('Kon de PDF-lezer niet laden. Is er internetverbinding? (' + e.message + ')');
    });
  }
  return pdfjsPromise;
}
