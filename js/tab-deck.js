import { newItem, enrichAll, aiQuotes, PLATFORM_LABEL, shrinkImage } from './extract.js';
import { pool } from './apify.js';
import * as KB from './kb.js';
import * as X from './excel.js';
import { buildDeck } from './deck.js';
import { $, esc, toast, withBusy, logger, wireDrop, pickFile, fileToDataURL, fmtDT, today } from './ui.js';
import { saveKB, pushIndex } from './app.js';

let S;
const D = { wb: null, rows: [], items: [], golden: null, runId: null };
const SOCIAL_PUB = { instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook', youtube: 'YouTube' };
const log = logger($('#deckLog'));

export function initDeck(state) {
  S = state;
  wireDrop($('#deckDrop'), $('#deckFile'), onDeckFile);
  $('#goldenFile').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) await onGoldenFile(f); });
  ['#deckSheet', '#deckFrom', '#deckTo'].forEach((s) => $(s).addEventListener('change', refreshRows));
  $('#deckLinks').addEventListener('input', updateFetchInfo);
  $('#fetchBtn').addEventListener('click', runFetch);
  $('#refetchMissing').addEventListener('click', () => refetch(D.items.filter((i) => i.status !== 'ok')));
  $('#clearItems').addEventListener('click', () => { if (confirm('לנקות את כל הפריטים?')) { D.items = []; D.runId = null; render(); } });
  $('#dlDeck').addEventListener('click', () => withBusy('בונה מצגת…', async () => { await buildDeck(D.items, opts()); await saveRun(true); }));
  $('#dlGolden').addEventListener('click', () => withBusy('מעדכן Golden Sample…', updateGolden));
  $('#saveDeck').addEventListener('click', () => withBusy('שומר…', () => saveRun(false)));
  loadGoldenMeta();
}

function opts() {
  return { reportTitle: $('#optTitle').value.trim(), product: $('#optProduct').value.trim(), subsidiary: $('#optSubs').value.trim(), slideHeader: $('#optHeader').value,
    fileName: `${$('#optSubs').value.trim()} Media Sample Reviews ${$('#optProduct').value.trim()} ${today()}`.replace(/\s+/g, ' ') };
}
function setOpts(o = {}) {
  if (o.reportTitle) $('#optTitle').value = o.reportTitle;
  $('#optProduct').value = o.product || ''; if (o.subsidiary) $('#optSubs').value = o.subsidiary; if (o.slideHeader) $('#optHeader').value = o.slideHeader;
}

// ---------- Excel source ----------
async function onDeckFile(f) {
  await withBusy('קורא את הקובץ…', async () => {
    D.wb = await X.readWorkbook(f);
    const sheets = D.wb.worksheets.map((ws) => ({ ws, n: X.rowsWithLinks(ws).length })).filter((x) => x.n);
    if (!sheets.length) throw new Error('לא נמצאה עמודת לינקים בקובץ');
    $('#deckSheet').innerHTML = sheets.map((s) => `<option value="${esc(s.ws.name)}">${esc(s.ws.name)} (${s.n})</option>`).join('');
    $('#deckFileInfo').hidden = false;
    $('#deckDrop').querySelector('b').textContent = f.name;
    refreshRows();
    // learn names from the file too
    learnFromWorkbook(D.wb);
  });
}
function refreshRows() {
  if (!D.wb) return;
  const ws = D.wb.getWorksheet($('#deckSheet').value);
  const from = $('#deckFrom').value, to = $('#deckTo').value;
  D.rows = X.rowsWithLinks(ws).filter((r) => (!from || (r.date && r.date >= from)) && (!to || (r.date && r.date <= to)));
  $('#deckFileCount').textContent = `${D.rows.reduce((a, r) => a + r.links.length, 0)} לינקים ב-${D.rows.length} שורות ייכנסו למצגת`;
  updateFetchInfo();
}
function pastedLinks() { return $('#deckLinks').value.split(/[\s,]+/).map((s) => s.trim()).filter((s) => /^(https?:\/\/|www\.|[\w-]+\.\w{2,}\/)/i.test(s)); }
function updateFetchInfo() {
  const n = D.rows.reduce((a, r) => a + r.links.length, 0) + pastedLinks().length;
  $('#fetchInfo').textContent = n ? `${n} לינקים מוכנים לשליפה` : '';
}

// ---------- Golden sample ----------
async function loadGoldenMeta() {
  try {
    D.goldenMeta = await S.store.readJSON('data/golden/meta.enc');
    $('#goldenStatus').textContent = D.goldenMeta ? `שמורה: ${D.goldenMeta.name} · ${fmtDT(D.goldenMeta.savedAt)}` : 'עדיין לא הועלה קובץ. העלו אותו פעם אחת, ומשם הוא יתעדכן אוטומטית.';
  } catch (e) { $('#goldenStatus').textContent = 'שגיאה בטעינה: ' + e.message; }
}
function learnFromWorkbook(wb) {
  let n = 0;
  for (const ws of wb.worksheets) for (const r of X.rowsWithLinks(ws)) for (const l of r.links) { KB.learnRow(S.kb, { url: l, ...r }); n++; }
  return n;
}
async function onGoldenFile(f) {
  await withBusy('שומר את ה-Golden Sample (מוצפן)…', async () => {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const wb = await X.readWorkbook(bytes);
    if (!X.findGoldenSheet(wb)) throw new Error('הקובץ לא נראה כמו Golden Sample (חסר Accumulation Template)');
    learnFromWorkbook(wb);
    await saveGolden(bytes, f.name);
    await saveKB();
    toast('ה-Golden Sample נשמר, ושמות העיתונאים נלמדו');
  });
}
async function saveGolden(bytes, name) {
  await S.store.writeBytes('data/golden/latest.enc', bytes, 'golden sample');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await S.store.writeBytes(`data/golden/archive/${stamp}.enc`, bytes, 'golden sample archive');
  D.goldenMeta = { name, savedAt: Date.now() };
  await S.store.writeJSON('data/golden/meta.enc', D.goldenMeta, 'golden meta');
  $('#goldenStatus').textContent = `שמורה: ${name} · ${fmtDT(D.goldenMeta.savedAt)}`;
}
async function updateGolden() {
  const bytes = await S.store.readBytes('data/golden/latest.enc');
  if (!bytes) throw new Error('צריך קודם להעלות קובץ Golden Sample (בכרטיס "פרטי המצגת")');
  const wb = await X.readWorkbook(bytes);
  const res = X.appendToGolden(wb, D.items, S.cfg.golden);
  const out = await X.workbookBytes(wb);
  const name = (D.goldenMeta?.name || 'Golden_Sample.xlsx').replace(/(_updated_\d{4}-\d{2}-\d{2})?\.xlsx$/i, '') + `_updated_${today()}.xlsx`;
  X.downloadBytes(out, name);
  if (res.added) await saveGolden(out, name);
  D.items.forEach((i) => KB.remember(S.kb, i));
  await saveKB();
  toast(`נוספו ${res.added} שורות לגיליון ${res.sheet}${res.skipped ? `, ${res.skipped} כבר היו קיימות` : ''}`);
}

// ---------- fetching ----------
function buildItems() {
  const items = [];
  const seen = new Set();
  const add = (url, hint) => {
    const it = newItem(url, { hint });
    const k = X.normLink(it.url);
    if (!it.url || seen.has(k)) return;
    seen.add(k); items.push(it);
  };
  D.rows.forEach((r) => r.links.forEach((l) => add(l, { publication: r.publication, journalist: r.journalist, date: r.date, headline: r.headline, channelType: r.channelType })));
  pastedLinks().forEach((l) => add(l, {}));
  return items;
}

function finalize(it) {
  const k = KB.lookup(S.kb, it) || {};
  const h = it.hint || {}; const f = it.fetched;
  it.src = {};
  const pick = (field, ...cands) => { for (const [src, v] of cands) if (v) { it[field] = v; it.src[field] = src; return; } it[field] = it[field] || ''; };
  const host = (() => { try { return new URL(it.url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  const kbPub = it.platform !== 'web' && k.publication && [it.det?.handle, f.handle].some((x) => x && x.toLowerCase() === k.publication.toLowerCase()) ? '' : k.publication;
  pick('publication', ['hint', h.publication], ['kb', kbPub], ['fetched', it.platform === 'web' ? f.site : SOCIAL_PUB[it.platform]], ['host', host]);
  pick('journalist', ['hint', h.journalist], ['kb', k.journalist], ['fetched', f.author], ['fetched', f.handle]);
  if (h.channelType) it.channelType = h.channelType;
  else if (it.platform === 'web' && k.channelType) it.channelType = k.channelType;
  pick('date', ['hint', h.date], ['fetched', f.date]);
  pick('headline', ['hint', h.headline], ['fetched', f.title], ['fetched', (f.text || '').split('\n').find((l) => l.trim())?.slice(0, 220)]);
  if (f.views != null) it.views = f.views;
  if (f.image) it.image = f.image;
  const got = f.image || f.title || f.text || f.views != null;
  it.status = it.kind === 'story' ? 'warn' : got ? (it.note || !f.image ? 'warn' : 'ok') : 'bad';
  if (it.kind === 'story' && !it.note) it.note = 'סטורי: אין גישה לנתונים, יש להוסיף צילום מסך ידנית';
}

async function addAI(items) {
  if (!$('#optAI').checked || !S.cfg.anthropicKey) return;
  const list = items.filter((i) => i.fetched.text || i.fetched.title);
  if (!list.length) return;
  log(`Claude: מתרגם כותרות ומחלץ ציטוטים ל-${list.length} פריטים…`);
  await pool(list, 3, async (it) => {
    try {
      const r = await aiQuotes(S.cfg, it);
      if (!r) return;
      if (r.headline && it.src.headline !== 'hint') it.headline = r.headline;
      if (r.journalist && it.platform === 'web' && !['hint', 'kb'].includes(it.src.journalist)) it.journalist = r.journalist;
      if (r.publication && it.platform === 'web' && !['hint', 'kb'].includes(it.src.publication)) it.publication = r.publication;
      if (Array.isArray(r.quotes) && r.quotes.length) it.quotes = r.quotes;
    } catch (e) { log('⚠️ Claude: ' + e.message); }
  });
}

async function runFetch() {
  const items = buildItems();
  if (!items.length) return toast('לא נמצאו לינקים. העלו אקסל או הדביקו לינקים', true);
  if (D.items.length && !confirm('להחליף את הפריטים הקיימים ברשימה החדשה?')) return;
  D.items = items; D.runId = null;
  $('#deckLog').innerHTML = '';
  render();
  await doFetch(items);
}
async function refetch(list) {
  if (!list.length) return toast('אין פריטים חסרים');
  list.forEach((i) => { i.fetched = {}; i.note = ''; i.status = 'new'; });
  render();
  await doFetch(list);
}
async function doFetch(items) {
  const btn = $('#fetchBtn'); btn.disabled = true;
  items.forEach((i) => (i.status = 'loading'));
  render();
  try {
    log(`מתחיל שליפה של ${items.length} לינקים. זה יכול לקחת כמה דקות…`);
    await enrichAll(S.apify, S.cfg, items, log);
    items.forEach(finalize);
    await addAI(items);
    log('✓ הסתיים');
    toast('השליפה הסתיימה. בדקו את הפרטים לפני ההורדה');
  } catch (e) { log('⚠️ ' + e.message); toast(e.message, true); items.forEach((i) => i.status === 'loading' && (i.status = 'bad')); }
  finally { btn.disabled = false; render(); }
}

// ---------- rendering ----------
const STATUS = { ok: ['ok', 'מוכן'], warn: ['warn', 'לבדוק'], bad: ['bad', 'לא נשלף'], loading: ['', 'שולף…'], new: ['', 'ממתין'] };
function render() {
  $('#itemsWrap').hidden = $('#deckActions').hidden = !D.items.length;
  const active = D.items.filter((i) => !i.skip).length;
  $('#itemsCount').textContent = `(${active} שקפים)`;
  $('#items').innerHTML = D.items.map((it, i) => {
    const [cls, lbl] = STATUS[it.status] || STATUS.new;
    const social = it.platform !== 'web';
    return `<article class="item ${it.skip ? 'skip' : ''}" data-i="${i}">
      <div class="thumb" data-act="img" title="לחצו להחלפת התמונה">
        ${it.image ? `<img src="${it.image}" alt="">` : `<div class="ph">${it.status === 'loading' ? '<div class="spinner"></div>' : 'אין תמונה<br>לחצו להעלאת צילום מסך'}</div>`}
        <div class="ov">החלפת תמונה</div>
      </div>
      <div>
        <div class="item-top">
          <span class="num">#${i + 1}</span>
          <span class="badge ${it.platform}">${PLATFORM_LABEL[it.platform]}${it.kind === 'story' ? ' · סטורי' : ''}</span>
          <span class="badge ${cls}">${lbl}</span>
          <a class="url" href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.url)}</a>
          <div class="item-tools">
            <button class="btn icon sm" data-act="up" title="למעלה">↑</button>
            <button class="btn icon sm" data-act="down" title="למטה">↓</button>
            <button class="btn icon sm" data-act="re" title="שליפה חוזרת">⟳</button>
            <button class="btn icon sm" data-act="skip" title="${it.skip ? 'החזרה למצגת' : 'הוצאה מהמצגת'}">${it.skip ? '＋' : '⊘'}</button>
            <button class="btn icon sm" data-act="del" title="מחיקה">✕</button>
          </div>
        </div>
        ${it.note ? `<p class="small muted" style="margin:0 0 8px">⚠ ${esc(it.note)}</p>` : ''}
        <div class="item-grid">
          <label class="field"><span>Channel Type</span><input data-k="channelType" value="${esc(it.channelType)}"></label>
          <label class="field"><span>Publication</span><input data-k="publication" value="${esc(it.publication)}"></label>
          <label class="field"><span>Journalist</span><input data-k="journalist" value="${esc(it.journalist)}"></label>
          <label class="field"><span>Date</span><input type="date" data-k="date" value="${esc(it.date)}"></label>
          ${social ? `<label class="field"><span>Views</span><input data-k="views" inputmode="numeric" value="${it.views ?? ''}"></label>
          <label class="field"><span>Total Potential Reach (UVM)</span><input data-k="reach" value="${esc(it.reach)}"></label>` : ''}
          <label class="field ${social ? 'wide2' : 'full'}"><span>Headline</span><input data-k="headline" dir="auto" value="${esc(it.headline)}"></label>
          <label class="field full"><span>Positive Quotes (ציטוט בכל שורה)</span><textarea data-k="quotes" dir="auto" rows="4">${esc((it.quotes || []).join('\n'))}</textarea></label>
        </div>
      </div>
    </article>`;
  }).join('');
}
$('#items').addEventListener('input', (e) => {
  const el = e.target.closest('[data-k]'); if (!el) return;
  const it = D.items[+el.closest('.item').dataset.i]; const k = el.dataset.k;
  if (k === 'quotes') it.quotes = el.value.split('\n').filter((s) => s.trim());
  else if (k === 'views') it.views = el.value === '' ? null : Number(String(el.value).replace(/[^\d.]/g, ''));
  else it[k] = el.value;
});
$('#items').addEventListener('change', (e) => {
  const el = e.target.closest('[data-k]'); if (!el) return;
  if (['publication', 'journalist', 'channelType'].includes(el.dataset.k)) KB.remember(S.kb, D.items[+el.closest('.item').dataset.i]);
});
$('#items').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const i = +b.closest('.item').dataset.i; const it = D.items[i];
  const act = b.dataset.act;
  if (act === 'up' && i > 0) [D.items[i - 1], D.items[i]] = [D.items[i], D.items[i - 1]];
  else if (act === 'down' && i < D.items.length - 1) [D.items[i + 1], D.items[i]] = [D.items[i], D.items[i + 1]];
  else if (act === 'del') D.items.splice(i, 1);
  else if (act === 'skip') it.skip = !it.skip;
  else if (act === 're') return refetch([it]);
  else if (act === 'img') {
    const f = await pickFile('image/*'); if (!f) return;
    it.image = await shrinkImage(await fileToDataURL(f), 1400, 0.85);
    if (it.status !== 'ok') it.status = 'warn';
  }
  render();
});
// paste a screenshot straight onto the page -> goes to the first item without image
document.addEventListener('paste', async (e) => {
  if (!$('#tab-deck').classList.contains('active')) return;
  const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
  if (!file) return;
  const it = D.items.find((x) => !x.image && !x.skip);
  if (!it) return;
  it.image = await shrinkImage(await fileToDataURL(file), 1400, 0.85);
  render(); toast('התמונה הודבקה לשקף ' + (D.items.indexOf(it) + 1));
});

// ---------- history ----------
function serialize() {
  return D.items.map(({ fetched, det, ...rest }) => ({ ...rest, det, fetched: { views: fetched?.views, handle: fetched?.handle } }));
}
async function saveRun(silent) {
  if (!D.items.length) return;
  D.runId ||= `${Date.now()}`;
  const o = opts();
  await S.store.writeJSON(`data/decks/${D.runId}.enc`, { opts: o, items: serialize(), savedAt: Date.now() }, 'save deck');
  await pushIndex('data/decks/index.enc', { id: D.runId, createdAt: +D.runId, title: o.reportTitle, product: o.product, count: D.items.filter((i) => !i.skip).length });
  await saveKB();
  if (!silent) toast('נשמר בהיסטוריה');
}
export async function loadDeckRun(id) {
  const run = await S.store.readJSON(`data/decks/${id}.enc`);
  if (!run) throw new Error('לא נמצא');
  D.items = run.items; D.runId = id; setOpts(run.opts); render();
}
export async function downloadDeckRun(id) {
  const run = await S.store.readJSON(`data/decks/${id}.enc`);
  await buildDeck(run.items, run.opts);
}
