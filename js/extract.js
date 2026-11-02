// Link detection + data enrichment through Apify actors
import { pool } from './apify.js';

export const DEFAULT_ACTORS = {
  instagram: 'apify/instagram-scraper',
  tiktok: 'clockworks/tiktok-scraper',
  facebook: 'apify/facebook-posts-scraper',
  youtube: 'streamers/youtube-scraper',
  web: 'apify/puppeteer-scraper',
};

export const PLATFORM_LABEL = { instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook', youtube: 'YouTube', web: 'כתבה / אתר' };

export function cleanUrl(u) {
  if (!u) return '';
  let s = String(typeof u === 'object' ? (u.hyperlink || u.text || '') : u).trim();
  s = s.replace(/^[\s"'<(]+|[\s"'>)]+$/g, '');
  if (!/^https?:\/\//i.test(s) && /^[\w.-]+\.[a-z]{2,}\//i.test(s)) s = 'https://' + s;
  return s;
}

export function detect(url) {
  let u;
  try { u = new URL(url); } catch { return { platform: 'web', kind: 'article', valid: false }; }
  const h = u.hostname.replace(/^www\.|^m\.|^mobile\./, '').toLowerCase();
  const p = u.pathname;
  if (h.endsWith('instagram.com')) {
    if (/^\/stories\//.test(p)) return { platform: 'instagram', kind: 'story', handle: p.split('/')[2] };
    const m = p.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
    const hm = p.match(/^\/([A-Za-z0-9_.]+)\/(?:p|reel)\//);
    return { platform: 'instagram', kind: 'post', id: m?.[1], handle: hm?.[1] };
  }
  if (h.endsWith('tiktok.com')) {
    const m = p.match(/\/video\/(\d+)/);
    const hm = p.match(/\/@([^/]+)/);
    return { platform: 'tiktok', kind: /\/story\//.test(p) ? 'story' : 'post', id: m?.[1], handle: hm?.[1], short: !m };
  }
  if (h.endsWith('facebook.com') || h === 'fb.watch' || h === 'fb.com') {
    const story = /^\/stories\//.test(p);
    return { platform: 'facebook', kind: story ? 'story' : 'post' };
  }
  if (h.endsWith('youtube.com') || h === 'youtu.be') {
    const id = h === 'youtu.be' ? p.slice(1).split('/')[0] : (p.match(/\/(?:shorts|live|embed)\/([\w-]{6,})/)?.[1] || u.searchParams.get('v'));
    return { platform: 'youtube', kind: 'post', id };
  }
  return { platform: 'web', kind: 'article', host: h, newspaper: /ifat\.com$/.test(h) };
}

export function channelTypeFor(platform, kind, det = {}) {
  if (platform === 'web') return det.newspaper ? 'Newspaper' : 'Online';
  const base = { instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook', youtube: 'Youtube' }[platform];
  return kind === 'story' ? `${base} - Story` : base;
}

// ---------- generic helpers ----------
const VIEW_KEYS = ['videoPlayCount', 'playCount', 'videoViewCount', 'viewCount', 'viewsCount', 'views', 'video_view_count', 'play_count', 'playsCount', 'plays', 'igPlayCount', 'fbPlayCount'];
export function findNumber(obj, keys, depth = 4) {
  if (!obj || typeof obj !== 'object' || depth < 0) return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number' && isFinite(v)) return v;
    if (typeof v === 'string' && /^[\d,.]+[KkMm]?$/.test(v.trim())) return parseCompact(v);
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') { const r = findNumber(v, keys, depth - 1); if (r != null) return r; }
  }
  return null;
}
export function parseCompact(v) {
  if (typeof v === 'number') return v;
  const s = String(v).trim().replace(/,/g, '');
  const m = s.match(/^([\d.]+)\s*([KkMm])?$/);
  if (!m) return null;
  return Math.round(parseFloat(m[1]) * (m[2] ? (/k/i.test(m[2]) ? 1e3 : 1e6) : 1));
}
export function toISODate(v) {
  if (!v) return '';
  if (typeof v === 'number') v = new Date(v < 1e12 ? v * 1000 : v);
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d)) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

async function blobToDataURL(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
}
// Downscale to keep decks/history light
export async function shrinkImage(dataUrl, maxW = 1100, quality = 0.78) {
  if (!dataUrl) return null;
  const img = await loadImage(dataUrl);
  const scale = Math.min(1, maxW / img.naturalWidth, 1600 / img.naturalHeight);
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}
export function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image load failed')); i.src = src; });
}
async function tryFetchImage(url) {
  try {
    const r = await fetch(url, { mode: 'cors', referrerPolicy: 'no-referrer' });
    if (!r.ok) return null;
    const b = await r.blob();
    if (!b.type.startsWith('image/')) return null;
    return await blobToDataURL(b);
  } catch { return null; }
}

// ---------- puppeteer page function (runs on Apify) ----------
const PAGE_FUNCTION = `async function pageFunction(context) {
  const { page, request, response } = context;
  if (request.userData && request.userData.kind === 'image') {
    const buf = await response.buffer();
    const ct = (response.headers()['content-type'] || 'image/jpeg').split(';')[0];
    return { kind: 'image', url: request.userData.orig || request.url, image: 'data:' + ct + ';base64,' + Buffer.from(buf).toString('base64') };
  }
  await new Promise(r => setTimeout(r, 3000));
  try {
    await page.evaluate(() => {
      const words = ['accept','agree','אישור','מאשר','מסכים','הבנתי','קבל','close','סגור','got it','ok'];
      document.querySelectorAll('button, a[role=button], [class*=cookie] button').forEach(b => {
        const t = (b.innerText || '').trim().toLowerCase();
        if (t && t.length < 25 && words.some(w => t.includes(w))) { try { b.click(); } catch (e) {} }
      });
    });
    await new Promise(r => setTimeout(r, 800));
    await page.evaluate(() => {
      const vw = innerWidth, vh = innerHeight;
      document.querySelectorAll('body *').forEach(el => {
        const s = getComputedStyle(el);
        if ((s.position === 'fixed' || s.position === 'sticky') && el.tagName !== 'HEADER') {
          const r = el.getBoundingClientRect();
          if (r.width * r.height > vw * vh * 0.25 || r.top > vh * 0.6) el.style.display = 'none';
        }
      });
    });
  } catch (e) {}
  const meta = await page.evaluate(() => {
    const m = n => { const e = document.querySelector('meta[property="' + n + '"],meta[name="' + n + '"],meta[itemprop="' + n + '"]'); return e ? (e.content || '') : ''; };
    const ld = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach(s => { try { ld.push(JSON.parse(s.textContent)); } catch (e) {} });
    const art = document.querySelector('article') || document.querySelector('main') || document.body;
    const timeEl = document.querySelector('time[datetime]');
    return {
      title: m('og:title') || document.title, h1: (document.querySelector('h1') || {}).innerText || '',
      siteName: m('og:site_name') || m('application-name'), image: m('og:image'),
      published: m('article:published_time') || m('datePublished') || m('pubdate') || m('publish-date') || m('date') || (timeEl ? timeEl.getAttribute('datetime') : ''),
      author: m('author') || m('article:author') || m('dcterms.creator') || m('byl'),
      description: m('og:description') || m('description'), ld,
      text: (art.innerText || '').replace(/\\n{3,}/g, '\\n\\n').slice(0, 14000), lang: document.documentElement.lang || ''
    };
  });
  const shot = await page.screenshot({ type: 'jpeg', quality: 72 });
  return { kind: 'page', url: request.userData.orig || request.url, loadedUrl: request.loadedUrl, ...meta, screenshot: 'data:image/jpeg;base64,' + Buffer.from(shot).toString('base64') };
}`;

function puppeteerInput(requests, cfg) {
  return {
    startUrls: requests,
    pageFunction: PAGE_FUNCTION,
    preNavigationHooks: `[async ({ page }) => { await page.setViewport({ width: 1280, height: 1050 }); }]`,
    proxyConfiguration: cfg.proxyGroup ? { useApifyProxy: true, apifyProxyGroups: [cfg.proxyGroup] } : { useApifyProxy: true },
    maxRequestRetries: 2, maxConcurrency: 6, pageLoadTimeoutSecs: 60, pageFunctionTimeoutSecs: 90,
    useChrome: false, headless: true, ignoreSslErrors: true, downloadMedia: true, downloadCss: true,
    waitUntil: ['domcontentloaded'],
  };
}

function pickLd(ld) {
  const flat = [];
  const walk = (x) => { if (!x) return; if (Array.isArray(x)) x.forEach(walk); else if (typeof x === 'object') { flat.push(x); if (x['@graph']) walk(x['@graph']); } };
  walk(ld);
  const art = flat.find((o) => /Article|Posting|Report/i.test([].concat(o['@type'] || []).join(','))) || flat.find((o) => o.headline) || {};
  let author = art.author;
  if (Array.isArray(author)) author = author.map((a) => a?.name || a).filter(Boolean).join(', ');
  else if (author && typeof author === 'object') author = author.name;
  const pub = art.publisher?.name;
  return { headline: art.headline, author, date: art.datePublished || art.dateCreated, publisher: pub };
}

// ---------- platform enrichers ----------
async function enrichInstagram(apify, cfg, items, log) {
  const posts = items.filter((i) => i.kind !== 'story');
  if (!posts.length) return;
  log(`אינסטגרם: ${posts.length} קישורים…`);
  const res = await apify.run(cfg.actors.instagram, { directUrls: posts.map((i) => i.url), resultsType: 'posts', resultsLimit: 1, addParentData: false },
    { onStatus: (s, t) => log(`אינסטגרם: ${s} (${t}s)`) });
  for (const it of posts) {
    const r = res.find((x) => it.det.id && (x.shortCode === it.det.id || (x.url || '').includes(it.det.id))) ||
      res.find((x) => x.inputUrl === it.url) || (posts.length === 1 ? res[0] : null);
    if (!r || r.error) { it.note = r?.error || 'לא נמצא באינסטגרם'; continue; }
    Object.assign(it.fetched, {
      views: r.videoPlayCount ?? r.videoViewCount ?? r.igPlayCount ?? null, likes: r.likesCount, text: r.caption || '',
      date: toISODate(r.timestamp), handle: r.ownerUsername, author: r.ownerFullName || r.ownerUsername, imageUrl: r.displayUrl, isVideo: r.type === 'Video',
    });
  }
}
async function enrichTikTok(apify, cfg, items, log) {
  const posts = items.filter((i) => i.kind !== 'story');
  if (!posts.length) return;
  log(`טיקטוק: ${posts.length} קישורים…`);
  const res = await apify.run(cfg.actors.tiktok, { postURLs: posts.map((i) => i.url), resultsPerPage: 1, shouldDownloadVideos: false, shouldDownloadCovers: false, shouldDownloadSubtitles: false, shouldDownloadSlideshowImages: false },
    { onStatus: (s, t) => log(`טיקטוק: ${s} (${t}s)`) });
  const used = new Set();
  const take = (r) => { used.add(r); return r; };
  for (const it of posts) {
    const r = res.find((x) => !used.has(x) && it.det.id && String(x.id) === it.det.id) ||
      res.find((x) => !used.has(x) && (x.submittedVideoUrl === it.url || x.inputUrl === it.url || x.input === it.url));
    if (r) { take(r); it._r = r; }
  }
  const left = posts.filter((i) => !i._r), leftRes = res.filter((x) => !used.has(x) && !x.error);
  if (left.length && left.length === leftRes.length) left.forEach((it, k) => (it._r = leftRes[k]));
  for (const it of posts) {
    const r = it._r; delete it._r;
    if (!r) { it.note = 'לא נמצא בטיקטוק'; continue; }
    Object.assign(it.fetched, {
      views: r.playCount ?? findNumber(r, VIEW_KEYS), likes: r.diggCount, text: r.text || '', date: toISODate(r.createTimeISO || r.createTime),
      handle: r.authorMeta?.name, author: r.authorMeta?.nickName || r.authorMeta?.name, imageUrl: r.videoMeta?.coverUrl || r.videoMeta?.originalCoverUrl, resolvedUrl: r.webVideoUrl,
    });
  }
}
async function enrichYouTube(apify, cfg, items, log) {
  if (!items.length) return;
  log(`יוטיוב: ${items.length} קישורים…`);
  const res = await apify.run(cfg.actors.youtube, { startUrls: items.map((i) => ({ url: i.url })), maxResults: 1, maxResultsShorts: 1, maxResultStreams: 0, downloadSubtitles: false },
    { onStatus: (s, t) => log(`יוטיוב: ${s} (${t}s)`) });
  for (const it of items) {
    const r = res.find((x) => it.det.id && (x.id === it.det.id || (x.url || '').includes(it.det.id))) || (items.length === 1 ? res[0] : null);
    if (!r) { it.note = 'לא נמצא ביוטיוב'; continue; }
    Object.assign(it.fetched, {
      views: r.viewCount ?? findNumber(r, VIEW_KEYS), likes: r.likes, text: [r.title, r.text].filter(Boolean).join('\n'), title: r.title,
      date: toISODate(r.date), author: r.channelName, handle: (r.channelUrl || '').split('/').pop()?.replace('@', ''),
      imageUrl: r.thumbnailUrl || (it.det.id ? `https://i.ytimg.com/vi/${it.det.id}/hqdefault.jpg` : null),
    });
  }
}
async function enrichFacebook(apify, cfg, items, log) {
  const posts = items.filter((i) => i.kind !== 'story');
  if (!posts.length) return;
  log(`פייסבוק: ${posts.length} קישורים…`);
  await pool(posts, 3, async (it) => {
    try {
      const res = await apify.run(cfg.actors.facebook, { startUrls: [{ url: it.url }], resultsLimit: 1, captionText: false });
      const r = res.find((x) => !x.error) || res[0];
      if (!r || r.error) { it.note = r?.error || 'לא נמצא בפייסבוק'; return; }
      Object.assign(it.fetched, {
        views: findNumber(r, VIEW_KEYS), likes: r.likes ?? r.reactionsCount, text: r.text || r.message || '',
        date: toISODate(r.time || r.timestamp || r.date), author: r.user?.name || r.pageName || r.ownerName,
        imageUrl: r.media?.[0]?.thumbnail || r.media?.[0]?.photo_image?.uri || r.thumbnail || r.image,
      });
    } catch (e) { it.note = e.message; }
  });
}
async function enrichWeb(apify, cfg, items, log) {
  if (!items.length) return;
  log(`כתבות: ${items.length} קישורים (צילום מסך + כותרת)…`);
  const res = await apify.run(cfg.actors.web, puppeteerInput(items.map((i) => ({ url: i.url, userData: { kind: 'page', orig: i.url } })), cfg),
    { memory: 4096, onStatus: (s, t) => log(`כתבות: ${s} (${t}s)`) });
  for (const it of items) {
    const r = res.find((x) => x.url === it.url);
    if (!r || r['#error']) { it.note = 'לא הצלחתי לפתוח את הכתבה'; continue; }
    const ld = pickLd(r.ld);
    Object.assign(it.fetched, {
      title: (ld.headline || r.h1 || r.title || '').trim(), text: r.text || r.description || '', author: ld.author || r.author || '',
      date: toISODate(ld.date || r.published), site: r.siteName || ld.publisher || '', image: r.screenshot,
    });
  }
}
async function fetchImagesViaApify(apify, cfg, list, log) {
  if (!list.length) return [];
  log(`מוריד ${list.length} תמונות…`);
  return apify.run(cfg.actors.web, puppeteerInput(list.map((u, k) => ({ url: u, uniqueKey: 'img' + k + u, userData: { kind: 'image', orig: u } })), cfg), { memory: 2048 });
}

export function newItem(url, extra = {}) {
  const u = cleanUrl(url);
  const det = detect(u);
  return {
    id: Math.random().toString(36).slice(2, 10), url: u, det, platform: det.platform, kind: det.kind,
    channelType: channelTypeFor(det.platform, det.kind, det), publication: '', journalist: '', date: '', headline: '', quotes: [],
    views: null, reach: '', image: null, fetched: {}, note: '', status: 'new', ...extra,
  };
}

// Fetch everything for a list of items (mutates items)
export async function enrichAll(apify, cfg, items, log, { images = true } = {}) {
  const by = (p) => items.filter((i) => i.platform === p);
  const jobs = [
    ['instagram', enrichInstagram], ['tiktok', enrichTikTok], ['youtube', enrichYouTube], ['facebook', enrichFacebook], ['web', enrichWeb],
  ];
  await Promise.all(jobs.map(async ([p, fn]) => {
    const list = by(p);
    if (!list.length) return;
    try { await fn(apify, cfg, list, log); } catch (e) { list.forEach((i) => (i.note = e.message)); log(`⚠️ ${p}: ${e.message}`); }
  }));
  if (images) {
    const need = items.filter((i) => !i.fetched.image && i.fetched.imageUrl);
    const failed = [];
    await pool(need, 6, async (i) => { const d = await tryFetchImage(i.fetched.imageUrl); if (d) i.fetched.image = d; else failed.push(i); });
    if (failed.length) {
      try {
        const res = await fetchImagesViaApify(apify, cfg, failed.map((i) => i.fetched.imageUrl), log);
        for (const i of failed) { const r = res.find((x) => x.url === i.fetched.imageUrl); if (r?.image) i.fetched.image = r.image; }
      } catch (e) { log('⚠️ תמונות: ' + e.message); }
    }
    for (const i of items) if (i.fetched.image) { try { i.fetched.image = await shrinkImage(i.fetched.image); } catch { i.fetched.image = null; } }
  }
  return items;
}

// ---------- optional: Claude for headline translation + positive quotes ----------
export async function aiQuotes(cfg, item) {
  if (!cfg.anthropicKey) return null;
  const f = item.fetched;
  const source = [f.title && `TITLE: ${f.title}`, f.author && `AUTHOR: ${f.author}`, f.site && `SITE: ${f.site}`, `TEXT:\n${(f.text || '').slice(0, 12000)}`].filter(Boolean).join('\n');
  if (!f.text && !f.title) return null;
  const prompt = `You help prepare a "Media Sample Reviews" PowerPoint report for Samsung Israel (SEIL). Below is a ${item.platform === 'web' ? 'news article / review' : item.platform + ' post caption'} (often in Hebrew) about a Samsung product.
Return ONLY a JSON object with these keys:
- "headline": the headline translated to natural English (for a social post: one-sentence English summary of the caption).
- "journalist": the author's name in English transliteration if it appears, else "".
- "publication": the publication / outlet name in English if known, else "".
- "quotes": an array of 3-7 POSITIVE statements about the product (pros) taken from the text, translated faithfully to English, each wrapped in “ ” quotation marks. Fewer if the text is short. No negatives.

${source}`;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': cfg.anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model: cfg.claudeModel || 'claude-sonnet-4-5', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!r.ok) throw new Error('Claude ' + r.status + ': ' + (await r.text()).slice(0, 150));
  const j = await r.json();
  const txt = j.content?.map((c) => c.text || '').join('') || '';
  const m = txt.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
}
