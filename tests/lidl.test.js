// Lidl-kassabonnen (Lidl Plus-app, "Kopie kassabon") zoals de tekstherkenning ze leest.
// 1. Verzonnen bon met typische OCR-fouten (altijd).
// 2. Echte bonnen (alleen lokaal in tests/fixtures/lidl-ocr-*.txt; anders overgeslagen).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { parseReceiptText } from '../js/core/receipt-parser.js';
import { cleanOcrLine } from '../js/core/lidl-receipt.js';

const OCR = `Kopie kassabon
LeDL
Lidl Voorbeeldstad
Marktplein 1
OMSCHRIJVING EUR
Halfvolle melk @,99 B
Pindakaas 2 x 6,49 0,98 B
In prijs verlaagd -@, 40
Losse fles PET groot 06,25 A
Spareribs 9,95 B
1,005 kg x 9,90 EUR/kg
Afwasmiddel 8,89 C
Ben & the blends 2x 1,99 3,98 B
KORTING 25% -1,00
Aantal 7 art.
Totaal 15 , 64
Bankpas 15,64
Kopie Kaarthouder
Volgnr. 0000 12-10-2026 10:02
Kaartbetaling Totaal EUR 15,64
% Bedr .Excl BTW Bedr.Incl
A @ 0,25 0,00 0,25
B 9 13,30 1,20 14,50
C 21 0,74 0,15 0,89
0185 001234/81 12.10.26
DANK U WEL EN GRAAG TOT ZIENS
KOPIE RETOURBON
LeDL
Retourbon
Datum: 12.10.2026
OMSCHRIJVING EUR
Pindakaas -0,49 B
Reden: Bevalt niet
Aantal 1 art.
Totaal -0 49
Contant -0,49`;

test('OCR-regels opschonen', () => {
  assert.equal(cleanOcrLine('Verse halfvolle melk @,89 B'), 'Verse halfvolle melk 0,89 B');
  assert.equal(cleanOcrLine('In prijs verlaagd -@, 80'), 'In prijs verlaagd -0,80');
  assert.equal(cleanOcrLine('Totaal 17 , 93'), 'Totaal 17,93');
  assert.equal(cleanOcrLine('Naanbrood 2x 1,79 3,58 B'), 'Naanbrood 2 x 1,79 3,58 B');
  assert.equal(cleanOcrLine('Losse fles PET groot 06,25 A'), 'Losse fles PET groot 0,25 A');
  assert.equal(cleanOcrLine('6185 633991/01 03.08.26'), '6185 633991/01 03.08.26', 'datum blijft heel');
});

test('Lidl-bon: artikelen, kortingen, statiegeld, gewicht, retourbon en OCR-herstel', () => {
  const r = parseReceiptText(OCR, { today: '2026-10-23' });
  assert.equal(r.store, 'lidl');
  assert.equal(r.date, '2026-10-12');
  assert.equal(r.total, 1564);
  assert.equal(r.check, 'ok', r.warnings.join(' | '));
  const by = (n) => r.lines.find((l) => l.rawName.startsWith(n));
  assert.equal(by('Halfvolle melk').amount, 99);
  assert.deepEqual([by('Pindakaas').qty, by('Pindakaas').unitPrice, by('Pindakaas').amount], [2, 49, 98], 'stukprijs 6,49 → 0,49 (aantal × prijs)');
  assert.ok(by('Pindakaas').repaired);
  assert.equal(by('Losse fles').kind, 'deposit');
  assert.deepEqual([by('Spareribs').weighed, by('Spareribs').qty, by('Spareribs').unitPrice], [true, 1.005, 990]);
  assert.equal(by('Afwasmiddel').amount, 89, '8,89 → 0,89 via totaal en btw-groep C');
  assert.ok(by('Afwasmiddel').repaired);
  const discounts = r.lines.filter((l) => l.kind === 'discount');
  assert.equal(discounts.length, 2);
  assert.equal(r.lines[discounts[0].linkedTo].rawName, 'Pindakaas');
  assert.equal(r.lines[discounts[1].linkedTo].rawName, 'Ben & the blends');
  assert.ok(by('Pindakaas').promo);
  // retourbon in hetzelfde beeld
  assert.equal(r.extra.length, 1);
  const ret = r.extra[0];
  assert.deepEqual([ret.date, ret.total, ret.check], ['2026-10-12', -49, 'ok']);
  assert.equal(ret.lines[0].kind, 'return');
});

test('Lidl-bon: geen herstel als het niet eenduidig is', () => {
  // Som 4,98 tegen totaal 4,18: meerdere cijferwissels mogelijk en geen btw-tabel → niets aanpassen, wel melden.
  const r = parseReceiptText(`Lidl\nOMSCHRIJVING EUR\nKaas 2,99 B\nBrood 1,99 B\nAantal 2 art.\nTotaal 4,18\nBankpas 4,18\n0185 000001/81 12.10.26`, { today: '2026-10-23' });
  assert.equal(r.check, 'afwijking');
  assert.ok(!r.lines.some((l) => l.repaired));
});

// ---------- echte bonnen (lokaal) ----------
const EXPECT = {
  1: ['2026-10-10', 1097, 2], 2: ['2026-08-07', 1703, 7], 3: ['2026-08-23', 1737, 7], 4: ['2026-10-13', 298, 1], 5: ['2026-09-12', 1656, 3],
  6: ['2026-08-03', 7386, 24], 7: ['2026-08-30', 1573, 5], 8: ['2026-09-24', 6292, 2], 9: ['2026-08-29', 1907, 3],
};
// Twee OCR-varianten per bon: zonder voorbewerking (psm 6) en zoals de app het doet (contrast + psm 4).
for (const variant of ['', 'app-']) for (const [i, [date, total, n]] of Object.entries(EXPECT)) {
  const file = new URL(`./fixtures/lidl-ocr-${variant}${i}.txt`, import.meta.url);
  test(`echte Lidl-bon ${i} (OCR ${variant || 'ruw'})`, { skip: existsSync(file) ? false : 'echte bon niet aanwezig' }, () => {
    const r = parseReceiptText(readFileSync(file, 'utf8'), { today: '2026-10-23' });
    assert.deepEqual([r.store, r.date, r.total, r.check, r.lines.length], ['lidl', date, total, 'ok', n], r.warnings.join(' | '));
    if (+i === 2) assert.deepEqual([r.extra[0].total, r.extra[0].date], [-845, '2026-08-07'], 'retourbon');
  });
}
