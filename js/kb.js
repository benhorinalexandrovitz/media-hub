// Knowledge base: learns publication / journalist names per domain or social handle,
// so new links from known outlets & creators are filled in automatically.
import { detect, cleanUrl } from './extract.js';

export function emptyKB() { return { domains: {}, handles: {}, updatedAt: null }; }

const norm = (s) => String(s ?? '').trim();
function domainOf(url) { try { return new URL(url).hostname.replace(/^www\.|^m\./, '').toLowerCase(); } catch { return ''; } }
function bump(map, key, rec) {
  if (!key) return;
  const k = key.toLowerCase();
  const cur = map[k] || {};
  cur.counts ||= {};
  const sig = JSON.stringify(rec);
  cur.counts[sig] = (cur.counts[sig] || 0) + 1;
  map[k] = cur;
}
function best(entry) {
  if (!entry) return null;
  if (entry.fixed) return entry.fixed;
  const [sig] = Object.entries(entry.counts || {}).sort((a, b) => b[1] - a[1])[0] || [];
  return sig ? JSON.parse(sig) : null;
}

export function learnRow(kb, { url, publication, journalist, channelType }) {
  url = cleanUrl(url);
  if (!url) return;
  const det = detect(url);
  const rec = { publication: norm(publication), journalist: norm(journalist), channelType: norm(channelType) };
  if (!rec.publication && !rec.journalist) return;
  if (det.platform === 'web') bump(kb.domains, domainOf(url), rec);
  else if (det.handle) bump(kb.handles, det.handle, { ...rec, publication: rec.publication });
}
export function learnHandle(kb, handle, name) {
  if (!handle || !name) return;
  bump(kb.handles, handle, { publication: '', journalist: norm(name), channelType: '' });
}
export function lookup(kb, item) {
  if (!kb) return null;
  if (item.platform === 'web') return best(kb.domains[domainOf(item.url)]);
  const h = (item.fetched?.handle || item.det?.handle || '').toLowerCase();
  return h ? best(kb.handles[h]) : null;
}
// Remember manual corrections made in the editor
export function remember(kb, item) {
  const rec = { publication: item.publication, journalist: item.journalist, channelType: item.channelType };
  if (item.platform === 'web') {
    const d = domainOf(item.url); if (d) kb.domains[d] = { ...(kb.domains[d] || {}), fixed: rec };
  } else {
    const h = (item.fetched?.handle || item.det?.handle || '').toLowerCase();
    if (h && item.journalist) kb.handles[h] = { ...(kb.handles[h] || {}), fixed: rec };
  }
}
export function kbSize(kb) { return Object.keys(kb.domains).length + Object.keys(kb.handles).length; }
