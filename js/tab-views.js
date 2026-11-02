import { newItem, enrichAll, detect, cleanUrl, fmtDate, PLATFORM_LABEL } from './extract.js';
import * as X from './excel.js';
import * as KB from './kb.js';
import { $, $$, esc, toast, withBusy, logger, wireDrop, fmtNum, today } from './ui.js';
import { pushIndex, saveKB } from './app.js';

let S;
const V = { bytes: null, name: '', rows: [], uniq: [], updates: new Map(), filters: { from: '', to: '', creator: '', topic: '', platforms: new Set() }, sort: { k: 'date', dir: -1 }, charts: {} };
const log = logger($('#viewsLog'));
const PLATS = ['instagram', 'tiktok', 'facebook', 'youtube', 'web'];
const COLORS = { instagram: '#d6307f', tiktok: '#111827', facebook: '#1b5bd6', youtube: '#e11d1d', web: '#8a94ad' };

export function initViews(state) {
  S = state;
  wireDrop($('#viewsDrop'), $('#viewsFile'), async (f) => withBusy('קורא את הקובץ…', async () => load(new Uint8Array(await f.arrayBuffer()), f.name)));
  $('#viewsLoadLast').addEventListener('click', () => withBusy('טוען את הגרסה האחרונה…', async () => {
    const idx = await S.store.readJSON('data/views/index.enc', []);
    if (!idx.length) throw new Error('עדיין אין גרסה שמורה. העלו קובץ');
    await loadViewsSnapshot(idx[0].id);
  }));
  ['#vFrom', '#vTo', '#vCreator', '#vTopic'].forEach((s) => $(s).addEventListener('change', () => { readFilters(); renderAll(); }));
  $('#vUpdate').addEventListener('click', runUpdate);
  $('#vDownload').addEventListener('click', () => withBusy('מכין קובץ…', download));
  $('#vTable').addEventListener('click', (e) => {
    const th = e.target.closest('th[data-k]'); if (!th) return;
    V.sort = { k: th.dataset.k, dir: V.sort.k === th.dataset.k ? -V.sort.dir : -1 }; renderTable();
  });
  $('#vTable').addEventListener('change', (e) => {
    const inp = e.target.closest('input.vin'); if (!inp) return;
    const v = inp.value === '' ? null : Number(inp.value.replace(/[^\d]/g, ''));
    if (v == null) V.updates.delete(inp.dataset.key); else V.updates.set(inp.dataset.key, v);
    renderKpis(); renderCharts();
  });
}

async function load(bytes, name, updates) {
  const wb = await X.readWorkbook(bytes);
  const rows = X.parseViewsWorkbook(wb);
  if (!rows.length) throw new Error('לא נמצאו עמודות link + views בקובץ');
  V.bytes = bytes; V.name = name; V.rows = rows; V.updates = new Map(updates || []);
  // unique contents (the "All" sheet repeats the per-creator sheets)
  const m = new Map();
  for (const r of rows) {
    const key = X.normLink(r.link);
    if (!m.has(key)) {
      const det = detect(cleanUrl(r.link));
      m.set(key, { ...r, key, platform: det.platform, kind: det.kind, sheets: [r.sheet] });
    } else {
      const u = m.get(key); u.sheets.push(r.sheet);
      ['name', 'channel', 'topic', 'date'].forEach((k) => { if (!u[k] && r[k]) u[k] = r[k]; });
      if (u.views == null && r.views != null) u.views = r.views;
    }
  }
  V.uniq = [...m.values()];
  V.uniq.forEach((u) => { if (u.name && /tiktok|instagram/.test(u.platform)) { const h = detect(u.link).handle; if (h) KB.learnHandle(S.kb, h, u.name); } });
  $('#viewsFileInfo').textContent = `${name} · ${V.uniq.length} תכנים ייחודיים ב-${new Set(rows.map((r) => r.sheet)).size} גיליונות`;
  $('#viewsDrop').querySelector('b').textContent = name;
  $('#viewsBody').hidden = false;
  buildFilters();
  renderAll();
}

function buildFilters() {
  const creators = [...new Set(V.uniq.map((u) => u.name).filter(Boolean))].sort();
  const topics = [...new Set(V.uniq.map((u) => u.topic).filter(Boolean))].sort();
  $('#vCreator').innerHTML = '<option value="">כולם</option>' + creators.map((c) => `<option>${esc(c)}</option>`).join('');
  $('#vTopic').innerHTML = '<option value="">הכל</option>' + topics.map((c) => `<option>${esc(c)}</option>`).join('');
  const present = PLATS.filter((p) => V.uniq.some((u) => u.platform === p));
  V.filters.platforms = new Set(present);
  $('#vPlatforms').innerHTML = present.map((p) => `<button class="chip on" data-p="${p}">${PLATFORM_LABEL[p]}</button>`).join('');
  $$('#vPlatforms .chip').forEach((c) => c.addEventListener('click', () => {
    c.classList.toggle('on'); const p = c.dataset.p;
    V.filters.platforms.has(p) ? V.filters.platforms.delete(p) : V.filters.platforms.add(p);
    renderAll();
  }));
  // quick month chips
  const months = [...new Set(V.uniq.map((u) => u.date?.slice(0, 7)).filter(Boolean))].sort();
  const chip = (label, from, to) => `<button class="chip" data-from="${from}" data-to="${to}">${label}</button>`;
  const end = (ym) => { const [y, m] = ym.split('-').map(Number); return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`; };
  let html = chip('כל התקופה', '', '');
  if (months.length) {
    const last3 = months.slice(-3);
    html += chip('3 החודשים האחרונים', `${last3[0]}-01`, end(last3.at(-1)));
  }
  html += months.map((ym) => chip(`${ym.slice(5)}/${ym.slice(0, 4)}`, `${ym}-01`, end(ym))).join('');
  $('#vQuick').innerHTML = html;
  $$('#vQuick .chip').forEach((c) => c.addEventListener('click', () => {
    $('#vFrom').value = c.dataset.from; $('#vTo').value = c.dataset.to;
    $$('#vQuick .chip').forEach((x) => x.classList.toggle('on', x === c));
    readFilters(); renderAll();
  }));
  $('#vFrom').value = $('#vTo').value = ''; readFilters();
}
function readFilters() {
  Object.assign(V.filters, { from: $('#vFrom').value, to: $('#vTo').value, creator: $('#vCreator').value, topic: $('#vTopic').value });
}
function filtered() {
  const f = V.filters;
  return V.uniq.filter((u) => f.platforms.has(u.platform) && (!f.creator || u.name === f.creator) && (!f.topic || u.topic === f.topic) &&
    (!f.from || (u.date && u.date >= f.from)) && (!f.to || (u.date && u.date <= f.to)));
}
const cur = (u) => (V.updates.has(u.key) ? V.updates.get(u.key) : u.views);

function renderAll() { renderKpis(); renderCharts(); renderTable(); }
function renderKpis() {
  const list = filtered();
  const total = list.reduce((a, u) => a + (cur(u) || 0), 0);
  const before = list.reduce((a, u) => a + (u.views || 0), 0);
  const per = PLATS.map((p) => [p, list.filter((u) => u.platform === p).reduce((a, u) => a + (cur(u) || 0), 0)]).filter(([, v]) => v);
  const upd = list.filter((u) => V.updates.has(u.key)).length;
  $('#vKpis').innerHTML = `
    <div class="kpi"><small>סה״כ צפיות</small><b>${fmtNum(total)}</b>${total !== before ? `<span class="delta">+${fmtNum(total - before)} מאז הקובץ</span>` : ''}</div>
    <div class="kpi"><small>תכנים</small><b>${fmtNum(list.length)}</b><span class="muted small">${upd ? `${upd} עודכנו` : ''}</span></div>
    ${per.map(([p, v]) => `<div class="kpi"><small>${PLATFORM_LABEL[p]}</small><b>${fmtNum(v)}</b></div>`).join('')}`;
  $('#vUpdate').textContent = `עדכון צפיות (${list.filter((u) => u.kind !== 'story' && u.platform !== 'web').length})`;
}
function renderCharts() {
  const list = filtered();
  const byC = {};
  list.forEach((u) => { const k = u.name || u.channel || '—'; byC[k] = (byC[k] || 0) + (cur(u) || 0); });
  const cs = Object.entries(byC).sort((a, b) => b[1] - a[1]);
  V.charts.c?.destroy(); V.charts.p?.destroy();
  const numTick = { callback: (v) => Number(v).toLocaleString('he-IL') };
  V.charts.c = new window.Chart($('#chCreators'), {
    type: 'bar', data: { labels: cs.map((x) => x[0]), datasets: [{ data: cs.map((x) => x[1]), backgroundColor: '#2f4fe0', borderRadius: 6 }] },
    options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => fmtNum(c.raw) } } }, scales: { x: { ticks: numTick } } },
  });
  const ps = PLATS.map((p) => [p, list.filter((u) => u.platform === p).reduce((a, u) => a + (cur(u) || 0), 0)]).filter(([, v]) => v);
  V.charts.p = new window.Chart($('#chPlatforms'), {
    type: 'doughnut', data: { labels: ps.map(([p]) => PLATFORM_LABEL[p]), datasets: [{ data: ps.map(([, v]) => v), backgroundColor: ps.map(([p]) => COLORS[p]), borderWidth: 2 }] },
    options: { maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom', rtl: true }, tooltip: { callbacks: { label: (c) => `${c.label}: ${fmtNum(c.raw)}` } } } },
  });
}
function renderTable() {
  const list = filtered();
  const { k, dir } = V.sort;
  const val = (u) => (k === 'views' ? cur(u) ?? -1 : k === 'old' ? u.views ?? -1 : String(u[k] || ''));
  list.sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * dir);
  $('#vCount').textContent = `(${list.length})`;
  const arrow = (key) => (k === key ? (dir > 0 ? ' ▲' : ' ▼') : '');
  $('#vTable').innerHTML = `<thead><tr>
    <th data-k="date">תאריך${arrow('date')}</th><th data-k="name">יוצר${arrow('name')}</th><th data-k="topic">נושא${arrow('topic')}</th><th data-k="platform">פלטפורמה${arrow('platform')}</th>
    <th data-k="old">צפיות בקובץ${arrow('old')}</th><th data-k="views">צפיות עדכניות${arrow('views')}</th><th>לינק</th></tr></thead><tbody>` +
    list.map((u) => {
      const nv = V.updates.get(u.key);
      const d = nv != null && u.views != null ? nv - u.views : null;
      return `<tr><td>${fmtDate(u.date)}</td><td>${esc(u.name || u.channel)}</td><td>${esc(u.topic)}</td>
      <td><span class="badge ${u.platform}">${PLATFORM_LABEL[u.platform]}${u.kind === 'story' ? ' · סטורי' : ''}</span></td>
      <td class="num">${fmtNum(u.views)}</td>
      <td class="num"><input class="vin" data-key="${esc(u.key)}" inputmode="numeric" value="${nv ?? ''}" placeholder="${u.kind === 'story' ? 'ידני' : ''}">${d ? `<span class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : ''}${fmtNum(d)}</span>` : ''}</td>
      <td><a class="lnk" href="${esc(u.link)}" target="_blank" rel="noopener">${esc(u.link)}</a></td></tr>`;
    }).join('') + '</tbody>';
}

async function runUpdate() {
  const list = filtered().filter((u) => u.kind !== 'story' && u.platform !== 'web');
  if (!list.length) return toast('אין תכנים לעדכון בסינון הנוכחי', true);
  const btn = $('#vUpdate'); btn.disabled = true;
  $('#viewsLog').innerHTML = '';
  try {
    log(`מעדכן צפיות ל-${list.length} תכנים…`);
    const items = list.map((u) => Object.assign(newItem(u.link), { _u: u }));
    await enrichAll(S.apify, S.cfg, items, log, { images: false });
    let ok = 0; const failed = [];
    for (const it of items) {
      if (it.fetched.views != null) { V.updates.set(it._u.key, it.fetched.views); ok++; } else failed.push(it);
    }
    log(`✓ עודכנו ${ok} מתוך ${items.length}`);
    failed.forEach((f) => log(`✗ ${f.url.slice(0, 70)}: ${f.note || 'לא התקבל מספר צפיות'}`));
    renderAll();
    await saveSnapshot();
    toast(`עודכנו ${ok} תכנים${failed.length ? `, ${failed.length} דורשים הזנה ידנית` : ''}. נשמר בהיסטוריה`);
  } catch (e) { log('⚠️ ' + e.message); toast(e.message, true); } finally { btn.disabled = false; renderKpis(); }
}

async function updatedBytes() {
  const wb = await X.readWorkbook(V.bytes);
  X.writeViews(wb, V.updates);
  return X.workbookBytes(wb);
}
function outName() { return V.name.replace(/(_\d{4}-\d{2}-\d{2})?\.xlsx$/i, '') + `_${today()}.xlsx`; }
async function download() {
  if (!V.bytes) return;
  const bytes = await updatedBytes();
  X.downloadBytes(bytes, outName());
  const sig = JSON.stringify([...V.updates]);
  if (V.updates.size && sig !== V.savedSig) await saveSnapshot(bytes);
}
async function saveSnapshot(bytes) {
  bytes ||= await updatedBytes();
  const id = `${Date.now()}`;
  const rows = V.uniq.map((u) => ({ link: u.link, name: u.name, channel: u.channel, topic: u.topic, date: u.date, platform: u.platform, kind: u.kind, before: u.views, views: cur(u) }));
  const total = rows.reduce((a, r) => a + (r.views || 0), 0);
  await S.store.writeBytes(`data/views/${id}.xlsx.enc`, bytes, 'views xlsx');
  await S.store.writeJSON(`data/views/${id}.enc`, { id, name: outName(), rows }, 'views snapshot');
  await pushIndex('data/views/index.enc', { id, createdAt: +id, fileName: outName(), total, count: rows.length, updated: V.updates.size });
  saveKB().catch(() => {});
  V.savedSig = JSON.stringify([...V.updates]);
  // the saved file becomes the new baseline
  V.bytes = bytes; V.name = outName();
}

export async function loadViewsSnapshot(id) {
  const bytes = await S.store.readBytes(`data/views/${id}.xlsx.enc`);
  const meta = await S.store.readJSON(`data/views/${id}.enc`);
  if (!bytes) throw new Error('לא נמצא');
  await load(bytes, meta?.name || 'summary.xlsx');
}
export async function downloadViewsSnapshot(id) {
  const bytes = await S.store.readBytes(`data/views/${id}.xlsx.enc`);
  const meta = await S.store.readJSON(`data/views/${id}.enc`);
  X.downloadBytes(bytes, meta?.name || `summary_${id}.xlsx`);
}
