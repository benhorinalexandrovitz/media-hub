// AES-256-GCM encryption with a PBKDF2-SHA256 derived key.
// Works in browsers and in Node 20+ (uses globalThis.crypto / CompressionStream).
const te = new TextEncoder();
const td = new TextDecoder();
const MAGIC = [0x4d, 0x52, 0x45, 0x31]; // "MRE1"
export const KDF_ITERATIONS = 600000;

export function b64(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unb64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function streamBytes(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}
const gzip = (b) => streamBytes(b, new CompressionStream('gzip'));
const gunzip = (b) => streamBytes(b, new DecompressionStream('gzip'));

export async function deriveKey(password, saltB64, iterations = KDF_ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: unb64(saltB64), iterations, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}
export const exportKey = async (key) => b64(await crypto.subtle.exportKey('raw', key));
export const importKey = (raw) => crypto.subtle.importKey('raw', unb64(raw), 'AES-GCM', true, ['encrypt', 'decrypt']);
export const newSalt = () => b64(crypto.getRandomValues(new Uint8Array(16)));

// Binary envelope: MAGIC(4) | flags(1, bit0=gzip) | iv(12) | ciphertext
export async function encryptBytes(key, bytes, compress = true) {
  const data = compress ? await gzip(bytes) : bytes;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
  const out = new Uint8Array(5 + 12 + ct.length);
  out.set(MAGIC, 0); out[4] = compress ? 1 : 0; out.set(iv, 5); out.set(ct, 17);
  return out;
}
export async function decryptBytes(key, env) {
  const b = env instanceof Uint8Array ? env : new Uint8Array(env);
  if (MAGIC.some((m, i) => b[i] !== m)) throw new Error('bad envelope');
  const flags = b[4];
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.subarray(5, 17) }, key, b.subarray(17)));
  return flags & 1 ? gunzip(pt) : pt;
}
export const encryptJSON = (key, obj) => encryptBytes(key, te.encode(JSON.stringify(obj)), true);
export const decryptJSON = async (key, env) => JSON.parse(td.decode(await decryptBytes(key, env)));

// Config file (text): { v, kdf:{salt,it}, data: base64(envelope) }
export async function sealConfig(password, cfg, salt = newSalt(), it = KDF_ITERATIONS) {
  const key = await deriveKey(password, salt, it);
  const data = b64(await encryptJSON(key, cfg));
  return { text: JSON.stringify({ v: 1, kdf: { salt, it }, data }), key };
}
export async function sealConfigWithKey(key, salt, it, cfg) {
  return JSON.stringify({ v: 1, kdf: { salt, it }, data: b64(await encryptJSON(key, cfg)) });
}
export async function openConfig(text, { password, key }) {
  const j = JSON.parse(text);
  if (!key) key = await deriveKey(password, j.kdf.salt, j.kdf.it);
  const cfg = await decryptJSON(key, unb64(j.data)); // throws on wrong password
  return { cfg, key, salt: j.kdf.salt, it: j.kdf.it };
}
