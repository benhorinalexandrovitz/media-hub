export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmtNum = (n) => (n == null || n === '' || isNaN(n) ? '—' : Number(n).toLocaleString('he-IL'));
export const fmtDT = (ts) => new Date(ts).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });

let toastT;
export function toast(msg, bad = false, ms = 3800) {
  const t = $('#toast');
  t.textContent = msg; t.classList.toggle('bad', bad); t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), ms);
}
export function busy(on, text = 'רגע…') { $('#busy').hidden = !on; $('#busyText').textContent = text; }
export async function withBusy(text, fn) {
  busy(true, text);
  try { return await fn(); } catch (e) { console.error(e); toast(e.message || String(e), true, 6000); } finally { busy(false); }
}
export function logger(el) {
  return (msg) => {
    el.hidden = false;
    const d = document.createElement('div');
    d.textContent = `${new Date().toLocaleTimeString('he-IL')}  ${msg}`;
    el.appendChild(d); el.scrollTop = el.scrollHeight;
  };
}
export function wireDrop(label, input, onFile) {
  ['dragenter', 'dragover'].forEach((e) => label.addEventListener(e, (ev) => { ev.preventDefault(); label.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((e) => label.addEventListener(e, (ev) => { ev.preventDefault(); label.classList.remove('over'); }));
  label.addEventListener('drop', (ev) => { const f = ev.dataTransfer.files?.[0]; if (f) onFile(f); });
  input.addEventListener('change', () => { const f = input.files?.[0]; if (f) onFile(f); input.value = ''; });
}
export function pickFile(accept) {
  return new Promise((res) => {
    const i = Object.assign(document.createElement('input'), { type: 'file', accept });
    i.onchange = () => res(i.files?.[0] || null);
    i.click();
  });
}
export const fileToDataURL = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
export const today = () => new Date().toISOString().slice(0, 10);
