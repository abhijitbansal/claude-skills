// Live reload for `serve.mjs --watch`: rebuild on change, push server-sent
// events, serve a rewritten copy of the page. The page on disk is untouched.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { buildDashboard } from './pipeline.mjs';
import { UsageError } from '../../shared/cli.mjs';

const LIVE_JS = new URL('../../template/live.js', import.meta.url);
const LIVE_CSS = '.pa-live{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:6px 16px;background:var(--surface);border-bottom:1px solid var(--line);font-size:.8rem;color:var(--text-2)}.pa-live button{border:1px solid var(--line);background:none;border-radius:6px;padding:2px 8px;cursor:pointer}#pa-live-banner{flex-basis:100%;color:var(--bad)}';
const KEEPALIVE_MS = 15000;
export const MIN_INTERVAL_S = 5;
// setInterval is int32 ms: above ~2147483 s Node clamps to 1 ms (endless reload loop).
export const MAX_INTERVAL_S = 86400;

// Function replacers throughout: "$&" in the token or the client must stay literal.
export function liveHtml(html, { token }) {
  const client = fs.readFileSync(LIVE_JS, 'utf8').replace('__PA_TOKEN__', () => JSON.stringify(token)).replace(/<\/(script)/gi, '<\\/$1');
  const tail = `<style>${LIVE_CSS}</style>\n<script>${client}</script>\n`;
  const withCsp = html.replace(/(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(")/, (_, a, csp, b) => `${a}${csp}; connect-src 'self'${b}`);
  const at = withCsp.lastIndexOf('</body>');
  return at < 0 ? withCsp + tail : withCsp.slice(0, at) + tail + withCsp.slice(at);
}

// onError(e) hears anything run() throws; the queue keeps going afterwards.
export function createRebuilder(run, { onError } = {}) {
  let running = null;
  let pending = false;
  const loop = async () => {
    try {
      do {
        pending = false;
        try {
          await run();
        } catch (e) {
          onError?.(e);
        }
      } while (pending);
    } finally {
      running = null;
    }
  };
  return {
    trigger() {
      if (running) { pending = true; return; }
      running = loop();
    },
    idle: () => running ?? Promise.resolve(),
  };
}

// Watch parent directories (rename-and-replace saves defeat a file watch),
// filter by file name, debounce bursts into one call.
// A watcher that errors is closed and reported through onError(e); fs.watch itself
// throws (ENOENT, EMFILE...) when a directory cannot be watched.
export function watchFiles(paths, onChange, { debounceMs = 300, onError } = {}) {
  const byDir = new Map();
  for (const p of paths) {
    const dir = path.dirname(p);
    if (!byDir.has(dir)) byDir.set(dir, new Set());
    byDir.get(dir).add(path.basename(p));
  }
  let timer = null;
  const watchers = [];
  try {
    for (const [dir, names] of byDir) {
      const w = fs.watch(dir, (_event, name) => {
        if (name && !names.has(String(name))) return;
        clearTimeout(timer);
        timer = setTimeout(onChange, debounceMs);
      });
      w.on('error', (e) => { w.close(); onError?.(e); });
      watchers.push(w);
    }
  } catch (e) {
    watchers.forEach((w) => w.close());
    throw e;
  }
  return { close: () => { clearTimeout(timer); watchers.forEach((w) => w.close()); } };
}

// Resolves { ok: true, url, token, close } or { ok: false, errors } when the first build fails.
// Throws UsageError for usage/IO problems (also on the first build) and when the port is busy.
// `watch` replaces watchFiles in tests, to make arming fail after a good build.
export async function startLiveServer({ specFile, port = 0, interval, theme, allowOutside = false, timeoutMs, out, watch = watchFiles }) {
  const token = crypto.randomBytes(16).toString('hex');
  const clients = new Set();
  const state = { html: null, watcher: null, watchPaths: [], warning: null };
  const frame = (event, payload) => `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  const send = (event, payload) => { for (const c of clients) c.write(frame(event, payload)); };
  // The watcher note outlives the reload that follows a good build: new clients hear it on connect.
  const warn = (problem) => { state.warning = problem; send('watch-warning', problem); };
  const watchProblem = (e) => ({ path: 'watch', code: e.code ?? e.message, message: `watcher stopped: ${e.code ?? e.message}; fix the folder and press Rebuild now` });

  // (Re)arm the file watchers on every build, so a deleted and recreated data
  // folder is picked up again. Returns a problem entry, or null when armed.
  function arm(paths) {
    state.watcher?.close();
    state.watcher = null;
    state.watchPaths = paths;
    state.warning = null;
    try {
      state.watcher = watch(paths, () => rebuilder.trigger(), {
        onError: (e) => {
          const problem = watchProblem(e);
          process.stderr.write(`${problem.path}: ${problem.message}\n`);
          warn(problem); // the page itself is fine: not a build failure
        },
      });
      return null;
    } catch (e) {
      const problem = watchProblem(e);
      process.stderr.write(`${problem.path}: ${problem.message}\n`);
      return problem;
    }
  }

  async function build() {
    let result;
    try {
      result = await buildDashboard(specFile, { out, theme, allowOutside, timeoutMs });
      if (result.ok) state.html = liveHtml(fs.readFileSync(result.target, 'utf8'), { token });
    } catch (e) {
      if (state.html === null && e instanceof UsageError) throw e; // first build: report as usage error
      result = { ok: false, errors: [{ path: '', message: String(e.message).split('\n')[0] }] };
    }
    const problem = arm(result.ok ? result.watch : state.watchPaths);
    if (!result.ok) {
      send('build-error', problem ? [...result.errors, problem] : result.errors);
      return result;
    }
    // The build was good, so the page reloads; a watcher problem is a separate, non-error note.
    send('rebuilt', { at: new Date().toISOString() });
    if (problem) warn(problem);
    return result;
  }
  const rebuilder = createRebuilder(build, {
    onError: (e) => {
      const message = String(e?.message ?? e).split('\n')[0];
      process.stderr.write(`rebuild failed: ${message}\n`);
      send('build-error', [{ path: '', message: `rebuild failed: ${message}` }]);
    },
  });

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
      if (state.warning) res.write(frame('watch-warning', state.warning));
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
