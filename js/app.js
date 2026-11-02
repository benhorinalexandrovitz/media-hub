import { openConfig, importKey, exportKey, sealConfigWithKey } from './crypto.js';
import { GitHubStore } from './github.js';
import { Apify } from './apify.js';
import { DEFAULT_ACTORS } from './extract.js';
import { emptyKB, kbSize } from './kb.js';
import { $, $$, esc, toast, withBusy, fmtDT, fmtNum } from './ui.js';
import { initDeck, loadDeckRun, downloadDeckRun } from './tab-deck.js';
import { initViews, loadViewsSnapshot, downloadViewsSnapshot } from './tab-views.js';

const KEY_STORE = 'mh_key';
export const S = {
  cfg: null, key: null, salt: null, it: null, store: null, apify: null, kb: emptyKB(),
  setBadge: () => {},
};

export const DEFAULT_GOLDEN = { subsidiary: 'SEIL ', archetype: 'Type 1', rationale: 'Top tier media and content creat', seeded: 'y' };

function withDefaults(cfg) {
  cfg.actors = { ...DEFAULT_ACTORS, ...(cfg.actors || {}) };
  cfg.golden = { ...DEFAULT_GOLDEN, ...(cfg.golden || {}) };
  return cfg;
}

async function fetchConfigText() {
  const r = await fetch(`config.enc?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error('קובץ ההגדרות לא נמצא באתר');
  return r.text();
}

async function startSession({ cfg, key, salt, it }) {
  S.cfg = withDefaults(cfg); S.key = key; S.salt = salt; S.it = it;
  S.store = new GitHubStore({ token: cfg.githubToken, owner: cfg.owner, repo: cfg.repo, dataBranch: cfg.dataBranch || 'data' }, key);
  S.apify = new Apify(cfg.apifyToken);
  $('#login').hidden = true; $('#app').hidden = false;
  fillSettings();
  initDeck(S); initViews(S);
  try { S.kb = (await S.store.readJSON('data/kb.enc')) || emptyKB(); } catch (e) { console.warn(e); }
  updateKbInfo();
}

export async function saveKB() {
  S.kb.updatedAt = Date.now();
  await S.store.writeJSON('data/kb.enc', S.kb, 'update knowledge base');
  updateKbInfo();
}
function updateKbInfo() { $('#kbInfo').textContent = `מאגר שמות שנלמד: ${kbSize(S.kb)} אתרים/יוצרים מוכרים.`; }

// ---------- login ----------
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = $('#pw').value;
  const btn = $('#loginBtn');
  $('#loginErr').hidden = true; btn.disabled = true; btn.textContent = 'מאמת…';
  try {
    const text = await fetchConfigText();
    let sess;
    try { sess = await openConfig(text, { password: pw }); } catch { throw new Error('סיסמה שגויה'); }
    const raw = await exportKey(sess.key);
    (($('#remember').checked) ? localStorage : sessionStorage).setItem(KEY_STORE, raw);
    await startSession(sess);
  } catch (err) {
    $('#loginErr').textContent = err.message; $('#loginErr').hidden = false;
  } finally { btn.disabled = false; btn.textContent = 'כניסה'; }
});

$('#logout').addEventListener('click', () => {
  try { localStorage.removeItem(KEY_STORE); sessionStorage.removeItem(KEY_STORE); } catch {}
  location.reload();
});

(async function autoLogin() {
  let raw = null;
  try { raw = sessionStorage.getItem(KEY_STORE) || localStorage.getItem(KEY_STORE); } catch {}
  if (!raw) return;
  try {
    const key = await importKey(raw);
    const sess = await openConfig(await fetchConfigText(), { key });
    await startSession(sess);
  } catch (e) { console.warn('auto login failed', e); try { localStorage.removeItem(KEY_STORE); sessionStorage.removeItem(KEY_STORE); } catch {} }
})();

// ---------- tabs ----------
export function showTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + name));
  if (name === 'history') loadHistory();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
$$('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

// ---------- settings ----------
const SET_MAP = [
  ['#sApify', 'apifyToken'], ['#sClaude', 'anthropicKey'], ['#sModel', 'claudeModel'], ['#sGithub', 'githubToken'], ['#sProxy', 'proxyGroup'],
];
function fillSettings() {
  const c = S.cfg;
  SET_MAP.forEach(([sel, k]) => ($(sel).value = c[k] || ''));
  $('#dSubs').value = c.golden.subsidiary; $('#dArch').value = c.golden.archetype; $('#dRat').value = c.golden.rationale; $('#dSeed').value = c.golden.seeded;
  $('#aInstagram').value = c.actors.instagram; $('#aTiktok').value = c.actors.tiktok; $('#aFacebook').value = c.actors.facebook; $('#aYoutube').value = c.actors.youtube; $('#aWeb').value = c.actors.web;
  $('#aiHint').textContent = c.anthropicKey ? '(באמצעות Claude)' : '(באמצעות Google Translate, חינם. עם Claude API key הציטוטים מדויקים יותר)';
}
$('#saveSettings').addEventListener('click', () => withBusy('שומר הגדרות…', async () => {
  const c = { ...S.cfg };
  SET_MAP.forEach(([sel, k]) => (c[k] = $(sel).value.trim()));
  c.golden = { subsidiary: $('#dSubs').value, archetype: $('#dArch').value, rationale: $('#dRat').value, seeded: $('#dSeed').value };
  c.actors = { instagram: $('#aInstagram').value.trim(), tiktok: $('#aTiktok').value.trim(), facebook: $('#aFacebook').value.trim(), youtube: $('#aYoutube').value.trim(), web: $('#aWeb').value.trim() };
  const text = await sealConfigWithKey(S.key, S.salt, S.it, c);
  await S.store.writeSiteText('config.enc', text, 'update settings');
  S.cfg = withDefaults(c);
  S.store.token = c.githubToken; S.apify = new Apify(c.apifyToken);
  fillSettings();
  $('#saveOut').textContent = 'נשמר ✓ (באתר עצמו ההגדרות יתעדכנו תוך כדקה)';
  toast('ההגדרות נשמרו');
}));
$('#testConn').addEventListener('click', async () => {
  const out = $('#testOut'); out.textContent = 'בודק…';
  const res = [];
  try { const me = await new Apify($('#sApify').value.trim()).me(); res.push(`Apify ✓ (${me.username})`); } catch (e) { res.push('Apify ✗'); }
  try { const r = await S.store.api(''); res.push(r.ok ? 'GitHub ✓' : `GitHub ✗ (${r.status})`); } catch { res.push('GitHub ✗'); }
  const ck = $('#sClaude').value.trim();
  if (ck) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': ck, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify({ model: $('#sModel').value.trim() || 'claude-sonnet-4-5', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] }) });
      res.push(r.ok ? 'Claude ✓' : `Claude ✗ (${r.status})`);
    } catch { res.push('Claude ✗'); }
  }
  out.textContent = res.join(' · ');
});

// ---------- history ----------
let trendChart;
async function loadHistory() {
  if (!S.store) return;
  const dEl = $('#histDecks'), vEl = $('#histViews');
  dEl.innerHTML = vEl.innerHTML = '<div class="empty">טוען…</div>';
  try {
    const [decks, views] = await Promise.all([S.store.readJSON('data/decks/index.enc', []), S.store.readJSON('data/views/index.enc', [])]);
    dEl.innerHTML = decks.length ? decks.map((d) => `
      <div class="h"><div><b>${esc(d.title || 'מצגת')}${d.product ? ' · ' + esc(d.product) : ''}</b><small>${fmtDT(d.createdAt)} · ${d.count} שקפים</small></div>
      <button class="btn sm" data-open-deck="${d.id}">פתיחה ועריכה</button><button class="btn sm primary" data-dl-deck="${d.id}">⬇ מצגת</button></div>`).join('') : '<div class="empty">עדיין אין מצגות שמורות</div>';
    vEl.innerHTML = views.length ? views.map((v) => `
      <div class="h"><div><b>${esc(v.fileName || 'סיכום תכנים')}</b><small>${fmtDT(v.createdAt)} · ${v.count} תכנים · ${fmtNum(v.total)} צפיות${v.updated ? ` · עודכנו ${v.updated}` : ''}</small></div>
      <button class="btn sm" data-open-views="${v.id}">פתיחה</button><button class="btn sm primary" data-dl-views="${v.id}">⬇ אקסל</button></div>`).join('') : '<div class="empty">עדיין אין עדכוני צפיות שמורים</div>';
    const pts = [...views].reverse();
    trendChart?.destroy();
    trendChart = new window.Chart($('#chTrend'), {
      type: 'line',
      data: { labels: pts.map((p) => new Date(p.createdAt).toLocaleDateString('he-IL')), datasets: [{ label: 'סה״כ צפיות', data: pts.map((p) => p.total), borderColor: '#2f4fe0', backgroundColor: 'rgba(47,79,224,.12)', fill: true, tension: .3, pointRadius: 4 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: (v) => Number(v).toLocaleString('he-IL') } } } },
    });
  } catch (e) { dEl.innerHTML = vEl.innerHTML = `<div class="empty">שגיאה בטעינה: ${esc(e.message)}</div>`; }
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-open-deck],[data-dl-deck],[data-open-views],[data-dl-views]');
  if (!b) return;
  if (b.dataset.openDeck) withBusy('טוען מצגת…', async () => { await loadDeckRun(b.dataset.openDeck); showTab('deck'); });
  if (b.dataset.dlDeck) withBusy('בונה מצגת…', () => downloadDeckRun(b.dataset.dlDeck));
  if (b.dataset.openViews) withBusy('טוען…', async () => { await loadViewsSnapshot(b.dataset.openViews); showTab('views'); });
  if (b.dataset.dlViews) withBusy('מוריד…', () => downloadViewsSnapshot(b.dataset.dlViews));
});

// shared helper for indices
export async function pushIndex(path, entry, max = 500) {
  const idx = (await S.store.readJSON(path, [])) || [];
  const i = idx.findIndex((x) => x.id === entry.id);
  if (i >= 0) idx[i] = entry; else idx.unshift(entry);
  await S.store.writeJSON(path, idx.slice(0, max), `index ${path}`);
}
