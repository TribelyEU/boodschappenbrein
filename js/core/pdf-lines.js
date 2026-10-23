// Regelreconstructie uit PDF-tekstfragmenten (pdf.js getTextContent), los van de browser zodat het testbaar is.

/** Reconstrueert regels uit PDF-tekstfragmenten op basis van hun positie. */
export function itemsToLines(items) {
  const rows = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const x = it.transform[4];
    const y = it.transform[5];
    let row = rows.find((r) => Math.abs(r.y - y) <= Math.max(2, (it.height || 8) * 0.4));
    if (!row) { row = { y, parts: [] }; rows.push(row); }
    row.parts.push({ x, str: it.str, w: it.width || it.str.length * 4 });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map((r) => {
    r.parts.sort((a, b) => a.x - b.x);
    let line = '';
    let end = null;
    for (const p of r.parts) {
      if (end != null) line += p.x - end > 6 ? '   ' : (p.x - end > 1 ? ' ' : '');
      line += p.str;
      end = p.x + p.w;
    }
    return line;
  }).join('\n');
}

