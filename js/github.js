// Minimal GitHub Contents API client. Encrypted data lives on a separate branch
// so that saving data does not trigger a GitHub Pages rebuild.
import { b64, encryptJSON, decryptJSON, encryptBytes, decryptBytes } from './crypto.js';

export class GitHubStore {
  constructor({ token, owner, repo, dataBranch = 'data', siteBranch = 'main' }, key) {
    Object.assign(this, { token, owner, repo, dataBranch, siteBranch, key });
    this.shaCache = new Map();
  }
  async api(path, opts = {}) {
    const res = await fetch(`https://api.github.com/repos/${this.owner}/${this.repo}${path}`, {
      cache: 'no-store',
      ...opts,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        Accept: 'application/vnd.github+json',
        ...(opts.headers || {}),
      },
    });
    return res;
  }
  async getRaw(path, branch = this.dataBranch) {
    const res = await this.api(`/contents/${encodeURI(path)}?ref=${branch}&t=${Date.now()}`, { headers: { Accept: 'application/vnd.github.raw' } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub ${res.status} בקריאת ${path}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  async getSha(path, branch) {
    const res = await this.api(`/contents/${encodeURI(path)}?ref=${branch}&t=${Date.now()}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const j = await res.json();
    return j.sha;
  }
  async putRaw(path, bytes, message, branch = this.dataBranch) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const sha = await this.getSha(path, branch);
      const res = await this.api(`/contents/${encodeURI(path)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, content: b64(bytes), branch, ...(sha ? { sha } : {}) }),
      });
      if (res.ok) return true;
      if (res.status === 404 && branch === this.dataBranch && !this._branchTried) { this._branchTried = true; await this.ensureBranch(branch); continue; }
      if (res.status === 409 || res.status === 422) { await new Promise((r) => setTimeout(r, 800)); continue; }
      const t = await res.text();
      throw new Error(`שמירה ל-GitHub נכשלה (${res.status}): ${t.slice(0, 200)}`);
    }
    throw new Error('שמירה ל-GitHub נכשלה (התנגשות גרסאות)');
  }
  async ensureBranch(branch) {
    const head = await this.api(`/git/ref/heads/${this.siteBranch}`);
    if (!head.ok) throw new Error('GitHub: לא נמצא הענף הראשי');
    const sha = (await head.json()).object.sha;
    await this.api('/git/refs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }) });
  }
  async list(dir, branch = this.dataBranch) {
    const res = await this.api(`/contents/${encodeURI(dir)}?ref=${branch}&t=${Date.now()}`);
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    return res.json();
  }
  // encrypted helpers
  async readJSON(path, fallback = null) {
    const raw = await this.getRaw(path);
    if (!raw) return fallback;
    return decryptJSON(this.key, raw);
  }
  async writeJSON(path, obj, message = `update ${path}`) {
    return this.putRaw(path, await encryptJSON(this.key, obj), message);
  }
  async readBytes(path) {
    const raw = await this.getRaw(path);
    return raw ? decryptBytes(this.key, raw) : null;
  }
  async writeBytes(path, bytes, message = `update ${path}`) {
    return this.putRaw(path, await encryptBytes(this.key, bytes, true), message);
  }
  async writeSiteText(path, text, message) {
    return this.putRaw(path, new TextEncoder().encode(text), message, this.siteBranch);
  }
}
