// Local-only HTTP server for preview and render. Binds 127.0.0.1, accepts only
// local Host headers, serves the page template, vendored libraries from
// node_modules, the live spec, and the image and audio files the spec names.
import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync, statSync, createReadStream, watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAsset, resolveUrlPath } from './paths.mjs';
import { validateSpec, checkGeneratedBy } from './spec.mjs';
import { loadTheme, DEFAULT_THEME } from '../../shared/theme.mjs';
import { faviconLink } from '../../shared/icons.mjs';
import { provenanceHtml, buildDate } from '../../shared/provenance.mjs';
import { themeData, themeCss, FONTS_DIR } from './theme.mjs';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NODE_MODULES = path.join(SKILL_ROOT, 'node_modules');
const TEMPLATE_DIR = path.join(SKILL_ROOT, 'template');
const WATCH_DEBOUNCE_MS = 100;
const SSE_KEEPALIVE_MS = 15000;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
};

const VENDOR_ROOTS = {
  animejs: path.join(NODE_MODULES, 'animejs/dist/bundles'),
  vega: path.join(NODE_MODULES, 'vega/build'),
  'vega-lite': path.join(NODE_MODULES, 'vega-lite/build'),
  'vega-util': path.join(NODE_MODULES, 'vega-util/build'),
  'vega-interpreter': path.join(NODE_MODULES, 'vega-interpreter/build'),
};
const FONT_ROOTS = ['@fontsource/inter', '@fontsource/jetbrains-mono'].map((p) => path.join(NODE_MODULES, p, 'files'));

// Single byte range from a Range header against a file of `size` bytes; null when absent or malformed.
function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header ?? '');
  if (!m || (m[1] === '' && m[2] === '')) return null;
  if (m[1] === '') return { start: Math.max(0, size - Number(m[2])), end: size - 1 };
  return { start: Number(m[1]), end: m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1) };
}

// `rangeHeader` is only passed for /assets: media elements need byte ranges to seek.
// Ranges are advertised and honoured there only; every other route sends the whole file.
function sendFile(res, file, rangeHeader) {
  const size = statSync(file).size;
  const headers = {
    'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': size,
    'cache-control': 'no-store',
  };
  if (rangeHeader !== undefined) headers['accept-ranges'] = 'bytes';
  const range = parseRange(rangeHeader, size);
  let status = 200;
  let streamOpts;
  if (range && (range.start >= size || range.end < range.start)) {
    res.writeHead(416, { 'content-range': `bytes */${size}`, 'cache-control': 'no-store' });
    return res.end();
  }
  if (range) {
    status = 206;
    streamOpts = range;
    headers['content-length'] = range.end - range.start + 1;
    headers['content-range'] = `bytes ${range.start}-${range.end}/${size}`;
  }
  res.writeHead(status, headers);
  const stream = createReadStream(file, streamOpts);
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy()); // an aborted range request must not keep the fd open
  stream.pipe(res);
}

function reply(res, status, text) {
  res.writeHead(status, { 'content-type': 'text/plain' });
  res.end(text);
}
const notFound = (res) => reply(res, 404, 'not found');

// The index page, its CSP (script hash computed from the inline importmap) and mode marker.
function loadIndex(mode) {
  const template = readFileSync(path.join(TEMPLATE_DIR, 'index.html'), 'utf8');
  const importmap = /<script type="importmap">([\s\S]*?)<\/script>/.exec(template)?.[1] ?? '';
  const hash = createHash('sha256').update(importmap).digest('base64');
  const csp = ["default-src 'self'", "img-src 'self' data: blob:", "style-src 'self' 'unsafe-inline'",
    "font-src 'self'", "connect-src 'self'", `script-src 'self' 'sha256-${hash}'`, "object-src 'none'", "base-uri 'none'"].join('; ');
  return { html: template.replace('{{MODE}}', mode), csp };
}

function themeOrDefault(name) {
  try { return loadTheme(name ?? DEFAULT_THEME); } catch { return loadTheme(DEFAULT_THEME); }
}

// Favicon and provenance footer for the current spec, read fresh. Only `generatedBy` (valid against its own
// schema) and `theme` (a known name) matter: an unrelated spec error never blanks the stamp, and a hostile
// generatedBy falls back to "not reported".
function pageChrome(ctx) {
  let spec;
  try { spec = JSON.parse(readFileSync(ctx.specFile, 'utf8')); } catch { spec = undefined; }
  const gen = spec?.generatedBy;
  return {
    favicon: faviconLink('make-motion', themeOrDefault(spec?.theme ?? ctx.theme)),
    provenance: provenanceHtml('make-motion', checkGeneratedBy(gen) ? gen : undefined, buildDate()),
  };
}

function indexHtml(ctx) {
  const { favicon, provenance } = pageChrome(ctx);
  return ctx.index.html.replace('{{FAVICON}}', () => favicon).replace('{{PROVENANCE}}', () => provenance);
}

// Image and audio srcs named by the current spec; /assets serves nothing else.
function referencedAssets(specFile) {
  try {
    const spec = JSON.parse(readFileSync(specFile, 'utf8'));
    const images = spec.scenes.flatMap((s) => s.elements).filter((e) => e.type === 'image').map((e) => e.src);
    const audio = (spec.audio ?? []).map((a) => a.src);
    return new Set([...images, ...audio].map((src) => path.posix.normalize(String(src))));
  } catch { return new Set(); }
}

function serveAsset(ctx, req, res, rel) {
  let decoded;
  try { decoded = decodeURIComponent(rel); } catch { return notFound(res); }
  if (!referencedAssets(ctx.specFile).has(path.posix.normalize(decoded))) return notFound(res);
  const { file } = resolveAsset(ctx.specDir, decoded);
  return file ? sendFile(res, file, req.headers.range ?? '') : notFound(res);
}

function serveUnder(res, root, rel) {
  const file = resolveUrlPath(root, rel);
  return file ? sendFile(res, file) : notFound(res);
}

function serveFont(res, name) {
  for (const root of FONT_ROOTS) {
    const file = resolveUrlPath(root, name);
    if (file) return sendFile(res, file);
  }
  return notFound(res);
}

// The shared theme a spec names: its JSON for the colours, a stylesheet for the fonts.
function serveTheme(res, name, kind) {
  const theme = themeData(name);
  if (!theme) return notFound(res);
  if (kind === 'json') return sendBody(res, MIME['.json'], JSON.stringify(theme));
  return sendBody(res, MIME['.css'], themeCss(theme));
}

// Only the font files themselves: a plain "<name>.woff2" after one decode. Anything left holding a
// slash, a backslash, a percent sign or a leading dot (an encoded slash or dot-segment, or a name
// that was encoded twice) is not a font name, so there is no second decode for it to hide in.
const FONT_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.woff2$/;
function serveThemeFont(res, rawName) {
  const name = safeDecode(rawName);
  const { file } = FONT_FILE.test(name) && !name.includes('..') ? resolveAsset(FONTS_DIR, name) : {};
  return file ? sendFile(res, file) : notFound(res);
}

function sendBody(res, type, body) {
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

function serveEvents(ctx, req, res) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  res.write(': connected\n\n');
  ctx.clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), SSE_KEEPALIVE_MS);
  req.on('close', () => { clearInterval(ping); ctx.clients.delete(res); });
}

const safeDecode = (text) => { try { return decodeURIComponent(text); } catch { return ''; } };

function route(ctx, req, res) {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store', 'content-security-policy': ctx.index.csp });
    return res.end(indexHtml(ctx));
  }
  if (pathname === '/spec.json') return serveSpec(ctx, res);
  if (pathname === '/events') return serveEvents(ctx, req, res);
  if (pathname.startsWith('/template/')) return serveUnder(res, TEMPLATE_DIR, pathname.slice('/template/'.length));
  if (pathname.startsWith('/assets/')) return serveAsset(ctx, req, res, pathname.slice('/assets/'.length));
  if (pathname.startsWith('/theme/fonts/')) return serveThemeFont(res, pathname.slice('/theme/fonts/'.length));
  const themeRoute = /^\/theme\/([^/]+)\.(json|css)$/.exec(pathname);
  if (themeRoute) return serveTheme(res, safeDecode(themeRoute[1]), themeRoute[2]);
  if (pathname.startsWith('/vendor/fonts/')) return serveFont(res, pathname.slice('/vendor/fonts/'.length));
  const vendor = /^\/vendor\/([^/]+)\/(.*)$/.exec(pathname);
  if (vendor && VENDOR_ROOTS[vendor[1]]) return serveUnder(res, VENDOR_ROOTS[vendor[1]], vendor[2]);
  return notFound(res);
}

// The spec as written; an embedding tool may give the server a theme for specs that name none.
function specBody(ctx) {
  const body = readFileSync(ctx.specFile);
  if (ctx.theme === undefined) return body;
  try {
    const spec = JSON.parse(body.toString('utf8'));
    return spec !== null && typeof spec === 'object' && !Array.isArray(spec) && spec.theme === undefined ? JSON.stringify({ ...spec, theme: ctx.theme }) : body;
  } catch { return body; }
}

function serveSpec(ctx, res) {
  try {
    const body = specBody(ctx);
    res.writeHead(200, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
    return res.end(body);
  } catch { return notFound(res); }
}

function handle(ctx, req, res) {
  if (!ctx.allowedHosts.has(req.headers.host)) return reply(res, 403, 'forbidden host');
  if (req.method !== 'GET' && req.method !== 'HEAD') return reply(res, 405, 'method not allowed');
  try { return route(ctx, req, res); } catch (e) {
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
    return res.end(`error: ${e.message}`);
  }
}

// Tell connected previews whether the changed spec is usable.
function broadcastSpecState(ctx) {
  let errors;
  try {
    const spec = JSON.parse(readFileSync(ctx.specFile, 'utf8'));
    errors = validateSpec(spec, { dir: ctx.specDir }).errors;
  } catch (e) {
    errors = [{ path: '(root)', message: `not valid JSON: ${e.message}` }];
  }
  const message = errors.length ? `event: spec-error\ndata: ${JSON.stringify(errors)}\n\n` : 'data: reload\n\n';
  for (const c of ctx.clients) c.write(message);
}

// The spec file, or any image/audio file it references (also in subfolders), triggers a reload.
function isWatched(ctx, name) {
  if (!name) return false;
  const rel = path.posix.normalize(String(name).replaceAll('\\', '/'));
  return rel === path.basename(ctx.specFile) || referencedAssets(ctx.specFile).has(rel);
}

function watchSpec(ctx) {
  let timer = null;
  const onChange = (_event, name) => {
    if (!isWatched(ctx, name)) return;
    clearTimeout(timer);
    timer = setTimeout(() => broadcastSpecState(ctx), WATCH_DEBOUNCE_MS);
  };
  let watcher;
  try { watcher = watch(ctx.specDir, { recursive: true }, onChange); } catch { watcher = watch(ctx.specDir, onChange); }
  watcher.on('error', () => {}); // directory removed: previews just stop reloading
  return { stop: () => { clearTimeout(timer); watcher.close(); } };
}

// `theme`: a shared theme name for specs that set none (render --theme).
export async function startServer({ specPath, mode = 'preview', theme }) {
  const specFile = path.resolve(specPath);
  const ctx = { specFile, theme, specDir: path.dirname(specFile), clients: new Set(), allowedHosts: new Set(), index: loadIndex(mode) };
  const watcher = watchSpec(ctx);
  const server = http.createServer((req, res) => handle(ctx, req, res));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  ctx.allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise((resolve) => {
      watcher.stop();
      for (const c of ctx.clients) c.end();
      server.close(() => resolve());
      server.closeAllConnections();
    }),
  };
}
