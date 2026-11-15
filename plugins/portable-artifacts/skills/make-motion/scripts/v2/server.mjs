// Loopback server for the v2 render page. Binds 127.0.0.1 on a free port, answers only the Host headers of that
// port, and serves a fixed set of routes: the page, engine modules (this skill's engine/ by an allow-list of
// extensions), the bundled fonts, two reused version 1 modules, /film.json and the files the film names, by index.
// A URL path is matched against a strict segment pattern before it is looked at, so `..`, an encoded separator or
// a backslash is refused outright; no file path is ever built from a request outside the roots below.
import http from 'node:http';
import { createReadStream, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registries } from '../../engine/registry.mjs';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENGINE_DIR = realpathSync(path.join(SKILL_ROOT, 'engine'));
const FONTS_DIR = realpathSync(path.join(SKILL_ROOT, 'shared/fonts'));
const PAGE_FILE = path.join(ENGINE_DIR, 'page/index.html');
const ENGINE_EXTENSIONS = new Set(['.mjs', '.html', '.woff2', '.glsl']);
const FONT_EXTENSIONS = new Set(['.woff2']);
const FONT_ROUTE = '/engine/fonts/shared/';
const ENGINE_ROUTE = '/engine/';

// The only files served from outside engine/: the module engine/registry.mjs imports, and the two version 1 modules.
const FIXED_FILES = Object.freeze({
  '/shared/errors.mjs': path.join(SKILL_ROOT, 'shared/errors.mjs'),
  '/v1/seeded.mjs': path.join(SKILL_ROOT, 'template/seeded.mjs'),
  '/v1/formats.mjs': path.join(SKILL_ROOT, 'template/formats.mjs'),
});

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2', '.glsl': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
});
const ASSET_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

const CSP = "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'";
// "/" or "/seg/seg": each segment starts with a letter or digit and holds only letters, digits, ".", "_" and "-".
const SAFE_PATH = /^\/(?:[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*)?$/;
const ASSET_ROUTE = /^\/asset\/(\d+)$/;
const MISSING_CODES = new Set(['ENOENT', 'ENOTDIR']);

function reply(res, status, text) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end(text);
}

function sendFile(req, res, file) {
  res.writeHead(200, {
    'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': statSync(file).size,
    'cache-control': 'no-store',
  });
  if (req.method === 'HEAD') return res.end();
  const stream = createReadStream(file);
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  return stream.pipe(res);
}

// The real path of `file` when it is a regular file inside `root` (symlinks resolved), else null. A missing file is
// null; any other filesystem error is real and propagates.
function fileInside(root, file) {
  let real;
  try {
    real = realpathSync(file);
    if (!real.startsWith(root + path.sep) || !statSync(real).isFile()) return null;
  } catch (err) {
    if (MISSING_CODES.has(err.code)) return null;
    throw err;
  }
  return real;
}

// `rel` is already a safe relative path; `extensions` is what may be served from `root`.
function serveUnder(req, res, root, rel, extensions) {
  if (!extensions.has(path.extname(rel).toLowerCase())) return reply(res, 404, 'not found');
  const file = fileInside(root, path.join(root, rel));
  return file ? sendFile(req, res, file) : reply(res, 404, 'not found');
}

function route(ctx, req, res) {
  const pathname = req.url.split('?')[0];
  if (!SAFE_PATH.test(pathname)) return reply(res, 400, 'bad path');
  if (pathname === '/') return sendFile(req, res, PAGE_FILE);
  if (Object.hasOwn(FIXED_FILES, pathname)) return sendFile(req, res, FIXED_FILES[pathname]);
  if (pathname === '/film.json') {
    res.writeHead(200, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
    return res.end(ctx.filmJson);
  }
  const asset = ASSET_ROUTE.exec(pathname);
  if (asset) return ctx.assets[Number(asset[1])] ? sendFile(req, res, ctx.assets[Number(asset[1])]) : reply(res, 404, 'not found');
  if (pathname.startsWith(FONT_ROUTE)) {
    const name = pathname.slice(FONT_ROUTE.length);
    return name.includes('/') ? reply(res, 404, 'not found') : serveUnder(req, res, FONTS_DIR, name, FONT_EXTENSIONS);
  }
  if (pathname.startsWith(ENGINE_ROUTE)) return serveUnder(req, res, ENGINE_DIR, pathname.slice(ENGINE_ROUTE.length), ENGINE_EXTENSIONS);
  return reply(res, 404, 'not found');
}

function handle(ctx, req, res) {
  res.setHeader('content-security-policy', CSP);
  res.setHeader('x-content-type-options', 'nosniff');
  if (!ctx.allowedHosts.has(req.headers.host)) return reply(res, 403, 'forbidden host');
  if (req.method !== 'GET' && req.method !== 'HEAD') return reply(res, 405, 'method not allowed');
  try {
    return route(ctx, req, res);
  } catch (err) {
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end(`error: ${err.message}`);
  }
}

// ---- the files a film names ----

// The file `src` names in shot `shotId`: a relative image path that stays inside specDir once symlinks are resolved.
function resolveSrc(specDir, shotId, src) {
  const label = `shot "${shotId}": src "${src}"`;
  if (typeof src !== 'string' || src === '') throw new Error(`${label} must be a non-empty path`);
  if (path.isAbsolute(src)) throw new Error(`${label} must be relative to the film's folder`);
  if (!ASSET_EXTENSIONS.has(path.extname(src).toLowerCase())) throw new Error(`${label} must be a png, jpg, webp or gif file`);
  const root = realpathSync(specDir);
  const file = fileInside(root, path.resolve(root, src));
  if (file === null) throw new Error(`${label} is not a file inside the film's folder`);
  return file;
}

// Each src a shot's kind names (its srcFields), in film order. A shot whose kind is not registered contributes none:
// the page reports the unknown kind when it expands the shot.
function assetFiles(film, specDir) {
  return film.shots.flatMap((shot) => {
    if (!registries.kinds.has(shot.show)) return [];
    const fields = registries.kinds.get(shot.show).srcFields ?? [];
    return fields.filter((field) => shot[field] !== undefined).map((field) => resolveSrc(specDir, shot.id, shot[field]));
  });
}

/**
 * @param {{ film: object, timeline: object, specDir: string }} opts specDir: the folder the film's src paths are relative to
 * @returns {Promise<{ url: string, close(): Promise<void> }>}
 */
export async function startV2Server({ film, timeline, specDir }) {
  if (!film || !Array.isArray(film.shots)) throw new TypeError('startV2Server: film must have a shots array');
  if (!timeline || !Array.isArray(timeline.shots)) throw new TypeError('startV2Server: timeline must have a shots array (see buildTimeline)');
  if (typeof specDir !== 'string') throw new TypeError('startV2Server: specDir must be a path');
  const assets = assetFiles(film, specDir);
  const ctx = { assets, filmJson: JSON.stringify({ film, timeline, assetCount: assets.length }), allowedHosts: new Set() };
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
      server.close(() => resolve());
      server.closeAllConnections();
    }),
  };
}
