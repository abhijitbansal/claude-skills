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
import '../../engine/kinds/index.mjs';
import { srcsOfShot } from '../../engine/assets.mjs';

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

const CSP = "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
// "/" or "/seg/seg": each segment starts with a letter or digit and holds only letters, digits, ".", "_" and "-".
const SAFE_PATH = /^\/(?:[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*)?$/;
const ASSET_ROUTE = /^\/asset\/(0|[1-9]\d*)$/; // a canonical index: not 00, 1.0 or 1e1
export const MAX_IMAGES = 64; // distinct images a film may use
const MISSING_CODES = new Set(['ENOENT', 'ENOTDIR']);

function reply(res, status, text) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end(text);
}

function sendFile(ctx, req, res, file) {
  res.writeHead(200, {
    'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': statSync(file).size,
    'cache-control': 'no-store',
  });
  if (req.method === 'HEAD') return res.end();
  const stream = createReadStream(file);
  stream.on('error', (err) => { // after the headers: all that is left is to say so and cut the response
    ctx.report(err);
    res.destroy();
  });
  res.on('close', () => stream.destroy());
  return stream.pipe(res);
}

// The real path of `file` when it is a regular file inside `root` (symlinks resolved), else null. A missing file is
// null; any other filesystem error is real and propagates.
export function fileInside(root, file) {
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
function serveUnder(ctx, req, res, root, rel, extensions) {
  if (!extensions.has(path.extname(rel).toLowerCase())) return reply(res, 404, 'not found');
  const file = fileInside(root, path.join(root, rel));
  return file ? sendFile(ctx, req, res, file) : reply(res, 404, 'not found');
}

// The asset is checked again on every request: it must still resolve, through its links, to an image file inside the
// film's folder, whatever has happened to the path since the server started.
function serveAsset(ctx, req, res, asset) {
  if (!asset) return reply(res, 404, 'not found');
  const file = fileInside(asset.root, asset.file);
  return file && ASSET_EXTENSIONS.has(path.extname(file).toLowerCase()) ? sendFile(ctx, req, res, file) : reply(res, 404, 'not found');
}

function route(ctx, req, res) {
  const pathname = req.url.split('?')[0];
  if (!SAFE_PATH.test(pathname)) return reply(res, 400, 'bad path');
  if (pathname === '/') return sendFile(ctx, req, res, PAGE_FILE);
  if (Object.hasOwn(FIXED_FILES, pathname)) return sendFile(ctx, req, res, FIXED_FILES[pathname]);
  if (pathname === '/film.json') {
    res.writeHead(200, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
    return res.end(ctx.filmJson);
  }
  const asset = ASSET_ROUTE.exec(pathname);
  if (asset) return serveAsset(ctx, req, res, ctx.assets[Number(asset[1])]);
  if (pathname.startsWith(FONT_ROUTE)) {
    const name = pathname.slice(FONT_ROUTE.length);
    return name.includes('/') ? reply(res, 404, 'not found') : serveUnder(ctx, req, res, FONTS_DIR, name, FONT_EXTENSIONS);
  }
  if (pathname.startsWith(ENGINE_ROUTE)) return serveUnder(ctx, req, res, ENGINE_DIR, pathname.slice(ENGINE_ROUTE.length), ENGINE_EXTENSIONS);
  return reply(res, 404, 'not found');
}

function handle(ctx, req, res) {
  res.setHeader('content-security-policy', CSP);
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('cross-origin-resource-policy', 'same-origin');
  if (!ctx.allowedHosts.has(req.headers.host)) return reply(res, 403, 'forbidden host');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('allow', 'GET, HEAD');
    return reply(res, 405, 'method not allowed');
  }
  try {
    return route(ctx, req, res);
  } catch (err) {
    ctx.report(err); // the detail (it can name paths) goes to the operator, never to the client
    if (res.headersSent) return res.destroy();
    return reply(res, 500, 'internal error');
  }
}

// ---- the files a film names ----

// The file `src` names in shot `shotId`: a relative image path that stays inside specDir once symlinks are resolved.
function resolveSrc(specDir, shotId, src) {
  const label = `shot "${shotId}": src "${src}"`;
  if (typeof src !== 'string' || src === '') throw new Error(`${label} must be a non-empty path`);
  if (path.isAbsolute(src)) throw new Error(`${label} must be relative to the film's folder`);
  const isImage = (file) => ASSET_EXTENSIONS.has(path.extname(file).toLowerCase());
  const notImage = `${label} must be a png, jpg, webp or gif file`;
  if (!isImage(src)) throw new Error(notImage);
  const root = realpathSync(specDir);
  const file = fileInside(root, path.resolve(root, src));
  if (file === null) throw new Error(`${label} is not a file inside the film's folder`);
  if (!isImage(file)) throw new Error(notImage); // a link named .png that points at something else
  return { root, file };
}

// The distinct src strings the film names (through each shot's kind srcFields), in first-seen order, each with the
// shot that first named it. A shot whose kind is not registered contributes none: the page reports the unknown kind
// when it expands the shot. A string used twice is one file, so one entry.
function distinctSrcs(film) {
  const seen = new Map();
  for (const shot of film.shots) {
    if (!registries.kinds.has(shot.show)) continue;
    for (const src of srcsOfShot(shot, registries.kinds.get(shot.show).srcFields)) {
      if (!seen.has(src)) seen.set(src, shot.id);
    }
  }
  if (seen.size > MAX_IMAGES) throw new Error(`a film may use at most ${MAX_IMAGES} images; this one names ${seen.size}`);
  return seen;
}

// { srcs, files }: the src strings /film.json lists, and for each (same index, so /asset/<n>) its { root, file }.
function assetList(film, specDir) {
  const seen = distinctSrcs(film);
  return { srcs: [...seen.keys()], files: [...seen].map(([src, shotId]) => resolveSrc(specDir, shotId, src)) };
}

// stderr is the last place to report to: if writing there fails there is nowhere left to say so.
function writeStderr(text) {
  try {
    process.stderr.write(text);
  } catch {
    // nothing further to do
  }
}

/**
 * @param {{ film: object, timeline: object, specDir: string, onError?: (err: Error) => void }} opts
 *   specDir: the folder the film's src paths are relative to. onError: told of every failure the server meets after it
 *   starts (a request that threw, a server error); each is also written to stderr, and none reaches a client.
 * @returns {Promise<{ url: string, close(): Promise<void>, server: import('node:http').Server }>} server is for tests
 */
export async function startV2Server({ film, timeline, specDir, onError }) {
  if (!film || !Array.isArray(film.shots)) throw new TypeError('startV2Server: film must have a shots array');
  if (!timeline || !Array.isArray(timeline.shots)) throw new TypeError('startV2Server: timeline must have a shots array (see buildTimeline)');
  if (typeof specDir !== 'string') throw new TypeError('startV2Server: specDir must be a path');
  const { srcs, files } = assetList(film, specDir);
  // A callback that throws must not take the server down with it: say so on stderr and carry on.
  const report = (err) => {
    writeStderr(`v2 server: ${err?.stack ?? err}\n`);
    if (!onError) return;
    try {
      onError(err);
    } catch (callbackErr) {
      writeStderr(`v2 server: onError threw: ${callbackErr?.stack ?? callbackErr}\n`);
    }
  };
  const ctx = { assets: files, filmJson: JSON.stringify({ film, timeline, assets: srcs }), allowedHosts: new Set(), report };
  const server = http.createServer((req, res) => handle(ctx, req, res));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  server.on('error', report); // once listening, an error is reported, not lost (or thrown as unhandled)
  const { port } = server.address();
  ctx.allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  return {
    url: `http://127.0.0.1:${port}/`,
    server,
    close: () => new Promise((resolve, reject) => {
      server.close((err) => (err && err.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(err) : resolve()));
      server.closeAllConnections();
    }),
  };
}
