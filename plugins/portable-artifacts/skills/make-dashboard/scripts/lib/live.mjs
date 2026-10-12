// Live reload for `serve.mjs --watch`: rebuild on change, push server-sent
// events, serve a rewritten copy of the page. The page on disk is untouched.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { buildDashboard } from './pipeline.mjs';
import { UsageError } from './cli.mjs';

const LIVE_JS = new URL('../../template/live.js', import.meta.url);
const LIVE_CSS = '.pa-live{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:6px 16px;background:var(--surface);border-bottom:1px solid var(--line);font-size:.8rem;color:var(--text-2)}.pa-live button{border:1px solid var(--line);background:none;border-radius:6px;padding:2px 8px;cursor:pointer}#pa-live-banner{flex-basis:100%;color:var(--bad)}';
const KEEPALIVE_MS = 15000;
export const MIN_INTERVAL_S = 5;

// Function replacers throughout: "$&" in the token or the client must stay literal.
export function liveHtml(html, { token }) {
  const client = fs.readFileSync(LIVE_JS, 'utf8').replace('__PA_TOKEN__', () => JSON.stringify(token)).replace(/<\/(script)/gi, '<\\/$1');
  const tail = `<style>${LIVE_CSS}</style>\n<script>${client}</script>\n`;
  const withCsp = html.replace(/(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(")/, (_, a, csp, b) => `${a}${csp}; connect-src 'self'${b}`);
  const at = withCsp.lastIndexOf('</body>');
  return at < 0 ? withCsp + tail : withCsp.slice(0, at) + tail + withCsp.slice(at);
}

export function createRebuilder(run) {
  let running = null;
  let pending = false;
  const loop = async () => {
    try {
      do {
        pending = false;
        await run();
      } while (pending);
    } finally {
      running = null;
    }
  };
  return {
    trigger() {
      if (running) { pending = true; return; }
      running = loop().catch(() => {});
    },
    idle: () => running ?? Promise.resolve(),
  };
}

// Watch parent directories (rename-and-replace saves defeat a file watch),
// filter by file name, debounce bursts into one call.
export function watchFiles(paths, onChange, { debounceMs = 300 } = {}) {
  const byDir = new Map();
  for (const p of paths) {
    const dir = path.dirname(p);
    if (!byDir.has(dir)) byDir.set(dir, new Set());
    byDir.get(dir).add(path.basename(p));
  }
  let timer = null;
  const watchers = [...byDir].map(([dir, names]) => {
    const w = fs.watch(dir, (_event, name) => {
      if (name && !names.has(String(name))) return;
      clearTimeout(timer);
      timer = setTimeout(onChange, debounceMs);
    });
    w.on('error', () => {}); // directory removed: stop reloading quietly
    return w;
  });
  return { close: () => { clearTimeout(timer); watchers.forEach((w) => w.close()); } };
}

// Resolves { ok: true, url, token, close } or { ok: false, errors } when the first build fails.
// Throws UsageError for usage/IO problems (also on the first build) and when the port is busy.
export async function startLiveServer({ specFile, port = 0, interval, theme, allowOutside = false, timeoutMs, out }) {
  const token = crypto.randomBytes(16).toString('hex');
  const clients = new Set();
  const state = { html: null, watcher: null, watchKey: '' };
  const send = (event, payload) => { for (const c of clients) c.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`); };

  async function build() {
    let result;
    try {
      result = await buildDashboard(specFile, { out, theme, allowOutside, timeoutMs });
      if (result.ok) state.html = liveHtml(fs.readFileSync(result.target, 'utf8'), { token });
    } catch (e) {
      if (state.html === null && e instanceof UsageError) throw e; // first build: report as usage error
      result = { ok: false, errors: [{ path: '', message: String(e.message).split('\n')[0] }] };
    }
    if (!result.ok) {
      send('build-error', result.errors);
      return result;
    }
    const key = result.watch.join('\n');
    if (key !== state.watchKey) {
      state.watcher?.close();
      state.watcher = watchFiles(result.watch, () => rebuilder.trigger());
      state.watchKey = key;
    }
    send('rebuilt', { at: new Date().toISOString() });
    return result;
  }
  const rebuilder = createRebuilder(build);

  const first = await build();
  if (!first.ok) return { ok: false, errors: first.errors };
  const timer = interval ? setInterval(() => rebuilder.trigger(), interval * 1000) : null;

  const server = http.createServer((req, res) => {
    const { port: bound } = server.address();
    if (req.headers.host !== `127.0.0.1:${bound}` && req.headers.host !== `localhost:${bound}`) return res.writeHead(403).end('forbidden host');
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    if (req.method === 'POST' && pathname === '/rebuild') {
      if (req.headers['x-pa-token'] !== token) return res.writeHead(403).end('forbidden');
      rebuilder.trigger();
      return res.writeHead(202).end('rebuilding');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405).end('method not allowed');
    if (pathname === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(': connected\n\n');
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), KEEPALIVE_MS);
      req.on('close', () => { clearInterval(ping); clients.delete(res); });
      return undefined;
    }
    if (pathname === '/' || pathname === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(state.html);
    }
    return res.writeHead(404).end('not found');
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  } catch (e) {
    clearInterval(timer);
    state.watcher?.close();
    throw new UsageError(`cannot listen on 127.0.0.1:${port}: ${e.code ?? e.message}`);
  }
  return {
    ok: true,
    url: `http://127.0.0.1:${server.address().port}/`,
    token,
    close: () => new Promise((resolve) => {
      clearInterval(timer);
      state.watcher?.close();
      for (const c of clients) c.end();
      server.close(() => resolve());
      server.closeAllConnections();
    }),
  };
}
