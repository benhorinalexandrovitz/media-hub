// Apify client (runs actors asynchronously and polls until done)
export class Apify {
  constructor(token) { this.token = token; }
  async call(path, opts = {}) {
    const res = await fetch(`https://api.apify.com/v2${path}`, {
      ...opts,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    if (!res.ok) {
      const t = await res.text();
      let msg = t;
      try { msg = JSON.parse(t).error?.message || t; } catch {}
      throw new Error(`Apify ${res.status}: ${msg.slice(0, 220)}`);
    }
    return res.json();
  }
  async run(actor, input, { memory, timeoutSecs = 900, onStatus } = {}) {
    const id = actor.replace('/', '~');
    const q = new URLSearchParams({ timeout: String(timeoutSecs) });
    if (memory) q.set('memory', String(memory));
    const { data: run } = await this.call(`/acts/${id}/runs?${q}`, { method: 'POST', body: JSON.stringify(input) });
    let status = run.status, info = run;
    const start = Date.now();
    while (!['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
      await new Promise((r) => setTimeout(r, 4000));
      info = (await this.call(`/actor-runs/${run.id}`)).data;
      status = info.status;
      onStatus?.(status, Math.round((Date.now() - start) / 1000));
    }
    const items = await this.call(`/datasets/${info.defaultDatasetId}/items?clean=1&format=json`);
    if (status !== 'SUCCEEDED' && !items.length) throw new Error(`Apify run ${status} (${actor})`);
    return items;
  }
  async me() { return (await this.call('/users/me')).data; }
}

export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); } catch (e) { out[idx] = { error: e.message || String(e) }; }
    }
  });
  await Promise.all(workers);
  return out;
}
