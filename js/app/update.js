// Bijwerken van de app zelf. Op de iPhone (beginscherm) blijft de app in het geheugen staan en laadt
// hij nooit vanzelf opnieuw; daarom kijken we bij elke terugkeer of er een nieuwe versie online staat.
let loaded = null;   // versie waarmee deze pagina geladen is
let lastCheck = 0;

async function onlineVersion() {
  const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).v;
}

export const currentVersion = () => loaded;

/** Haalt de nieuwste bestanden op (langs de browsercache heen) en laadt de app opnieuw. */
export async function reloadApp() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
    for (const key of await caches.keys()) await caches.delete(key);
  } catch { /* geen service worker: gewoon herladen */ }
  location.reload();
}

const busyUser = () => document.querySelector('.sheet-backdrop') || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);

/** Geeft true als er een nieuwere versie online staat. */
export async function checkForUpdate({ force = false } = {}) {
  if (!force && Date.now() - lastCheck < 60e3) return false;
  lastCheck = Date.now();
  const v = await onlineVersion();
  if (!loaded) { loaded = v; return false; }
  return v !== loaded;
}

export function watchForUpdates({ onUpdate }) {
  checkForUpdate().catch(() => {});
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    try {
      if (!(await checkForUpdate())) return;
      if (busyUser()) onUpdate(); else reloadApp();
    } catch { /* offline: volgende keer */ }
  });
}
