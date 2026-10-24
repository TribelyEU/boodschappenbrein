// Back-up maken met één tik en er af en toe aan herinneren. Alle gegevens staan alleen op dit toestel;
// raakt de telefoon kwijt of ruimt iOS de opslag op, dan is de back-up het enige vangnet.
import { state, exportBackup, setSetting } from '../data/store.js';
import { download, toast } from '../ui/dom.js';
import { todayISO } from '../core/dates.js';

export const BACKUP_EVERY_DAYS = 30;

/** Dagen sinds de laatste back-up (null = nog nooit). */
export function daysSinceBackup(now = Date.now()) {
  const at = state.settings.lastBackupAt;
  return at ? Math.floor((now - Date.parse(at)) / 864e5) : null;
}

/** Moet de herinnering getoond worden? Alleen met echte gegevens (bonnen), niet in de demo, niet als hij net is uitgesteld. */
export function backupDue(now = Date.now()) {
  if (state.mode === 'demo' || !state.receipts?.length) return false;
  const snooze = state.settings.backupSnoozedUntil;
  if (snooze && Date.parse(snooze) > now) return false;
  const d = daysSinceBackup(now);
  return d == null || d >= BACKUP_EVERY_DAYS;
}

/** Maakt de back-up. Op de iPhone via het deelmenu ("Bewaar in Bestanden", AirDrop, mail); anders als download. */
export async function backupNow() {
  const b = await exportBackup();
  const name = `boodschappenbrein-backup-${todayISO()}.json`;
  const text = JSON.stringify(b);
  let done = false;
  try {
    const file = new File([text], name, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Boodschappenbrein back-up' });
      done = true;
    }
  } catch (e) {
    if (e?.name === 'AbortError') return false; // zelf geannuleerd: niet als gemaakt tellen
  }
  if (!done) download(name, text);
  await setSetting('lastBackupAt', new Date().toISOString());
  toast(`Back-up gemaakt (${b.counts.receipts} bonnen)`);
  return true;
}

export async function snoozeBackup(days = 7) {
  await setSetting('backupSnoozedUntil', new Date(Date.now() + days * 864e5).toISOString());
}
