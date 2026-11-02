// Excel helpers (ExcelJS loaded globally from /vendor)
import { cleanUrl, toISODate } from './extract.js';

export async function readWorkbook(fileOrBytes) {
  const buf = fileOrBytes instanceof Uint8Array ? fileOrBytes : new Uint8Array(await fileOrBytes.arrayBuffer());
  const wb = new window.ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
}
export async function workbookBytes(wb) { return new Uint8Array(await wb.xlsx.writeBuffer()); }

export function cellValue(v) {
  if (v == null) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (v.hyperlink) return v.hyperlink;
    if (v.richText) return v.richText.map((r) => r.text).join('');
    if ('result' in v) return cellValue(v.result);
    if (v.text) return typeof v.text === 'string' ? v.text : cellValue(v.text);
    if (v.error) return '';
    return '';
  }
  return v;
}
export const cellText = (v) => { const x = cellValue(v); return x instanceof Date ? toISODate(x) : String(x ?? '').trim(); };

export function parseDate(v) {
  const x = cellValue(v);
  if (!x) return '';
  if (x instanceof Date) {
    return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`;
  }
  if (typeof x === 'number' && x > 20000 && x < 80000) { const d = new Date(Math.round((x - 25569) * 864e5)); return parseDate(d); }
  const s = String(x).trim();
  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return '';
}

const SYN = {
  link: [/link/i, /url/i, /קישור/, /לינק/],
  publication: [/publication name/i, /channel name/i, /^publication/i, /^media$/i, /פרסום|אתר|ערוץ/],
  journalist: [/journalist/i, /author/i, /^name$/i, /עיתונאי|כתב|שם/],
  date: [/date/i, /תאריך/],
  channelType: [/channel type/i, /^platform/i, /פלטפורמה/],
  views: [/\bviews?\b/i, /צפיות/],
  channel: [/^channel$/i],
  topic: [/topic/i, /נושא/],
  headline: [/headline/i, /כותרת/],
};
export function findTable(ws) {
  let best = null;
  for (let r = 1; r <= Math.min(8, ws.rowCount); r++) {
    const row = ws.getRow(r);
    const cols = {}; const links = [];
    row.eachCell({ includeEmpty: false }, (cell, c) => {
      const h = cellText(cell.value);
      if (!h) return;
      for (const [k, res] of Object.entries(SYN)) {
        if (res.some((re) => re.test(h))) {
          if (k === 'link') links.push(c);
          else if (!cols[k]) cols[k] = c;
          break;
        }
      }
    });
    if (links.length && (!best || Object.keys(cols).length > Object.keys(best.cols).length)) best = { headerRow: r, cols, links };
  }
  return best;
}

// Generic: rows that contain at least one link
export function rowsWithLinks(ws) {
  const t = findTable(ws);
  if (!t) return [];
  const out = [];
  for (let r = t.headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const links = t.links.map((c) => cleanUrl(cellValue(row.getCell(c).value))).filter((u) => /^https?:\/\//i.test(u));
    if (!links.length) continue;
    const g = (k) => (t.cols[k] ? cellText(row.getCell(t.cols[k]).value) : '');
    out.push({
      row: r, links, publication: g('publication'), journalist: g('journalist'), channelType: g('channelType'), headline: g('headline'),
      date: t.cols.date ? parseDate(row.getCell(t.cols.date).value) : '',
    });
  }
  return out;
}

// ---------- Golden Sample ----------
export function findGoldenSheet(wb) {
  return wb.worksheets.find((w) => /accumulation/i.test(w.name)) ||
    wb.worksheets.find((w) => { const t = findTable(w); return t && t.cols.publication && t.cols.journalist && t.cols.date; });
}
export function goldenLinks(wb) {
  const set = new Set();
  for (const ws of wb.worksheets) for (const r of rowsWithLinks(ws)) r.links.forEach((l) => set.add(normLink(l)));
  return set;
}
export function normLink(u) {
  return cleanUrl(u).replace(/^https?:\/\/(www\.|m\.)?/i, '').replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
}

export function appendToGolden(wb, items, d) {
  const ws = findGoldenSheet(wb);
  if (!ws) throw new Error('לא נמצא גיליון Accumulation Template בקובץ');
  const existing = new Set(rowsWithLinks(ws).flatMap((r) => r.links.map(normLink)));
  let last = 2;
  for (let r = ws.rowCount; r >= 3; r--) {
    const vals = ws.getRow(r).values.slice(1, 11);
    if (vals.some((v) => cellText(v))) { last = r; break; }
  }
  const styleRow = ws.getRow(last);
  let added = 0, skipped = 0;
  for (const it of items) {
    if (it.skip) continue;
    if (existing.has(normLink(it.url))) { skipped++; continue; }
    const r = ws.getRow(++last);
    const [y, m, dd] = (it.date || '').split('-').map(Number);
    const vals = [
      d.subsidiary, d.archetype, it.channelType, it.publication, it.journalist,
      it.platform === 'web' ? it.publication : `${it.publication} ${it.journalist}`.trim(),
      d.rationale, d.seeded, y ? new Date(Date.UTC(y, m - 1, dd)) : '', { text: it.url, hyperlink: it.url },
    ];
    vals.forEach((v, k) => {
      const c = r.getCell(k + 1);
      c.value = v;
      const st = styleRow.getCell(k + 1).style;
      if (st) c.style = JSON.parse(JSON.stringify(st));
      if (k === 8) c.numFmt = 'dd/mm/yyyy';
    });
    r.commit?.();
    existing.add(normLink(it.url));
    added++;
  }
  return { added, skipped, sheet: ws.name };
}

// ---------- Techie content summary (views) ----------
export function parseViewsWorkbook(wb) {
  const rows = [];
  for (const ws of wb.worksheets) {
    const t = findTable(ws);
    if (!t || !t.cols.views) continue;
    const linkCol = t.links[0];
    for (let r = t.headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const link = cleanUrl(cellValue(row.getCell(linkCol).value));
      if (!link) continue;
      const g = (k) => (t.cols[k] ? cellText(row.getCell(t.cols[k]).value) : '');
      const vRaw = cellValue(row.getCell(t.cols.views).value);
      rows.push({
        sheet: ws.name, row: r, viewsCol: t.cols.views, link,
        channel: g('channel') || g('publication'), name: g('journalist'), topic: g('topic'),
        date: t.cols.date ? parseDate(row.getCell(t.cols.date).value) : '',
        views: typeof vRaw === 'number' ? vRaw : (parseFloat(String(vRaw).replace(/,/g, '')) || null),
      });
    }
  }
  return rows;
}
export function writeViews(wb, updates /* Map normLink -> views */) {
  let n = 0;
  for (const ws of wb.worksheets) {
    const t = findTable(ws);
    if (!t || !t.cols.views) continue;
    for (let r = t.headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const key = normLink(cellValue(row.getCell(t.links[0]).value));
      if (key && updates.has(key)) { row.getCell(t.cols.views).value = updates.get(key); n++; }
    }
  }
  return n;
}

export function downloadBytes(bytes, name, type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
