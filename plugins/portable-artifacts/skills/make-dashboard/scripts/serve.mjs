#!/usr/bin/env node
// node scripts/serve.mjs [dir] [--port n] [--open]   static server on 127.0.0.1 only, local Host headers only
// exit 2 on usage errors or when the port cannot be bound
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { UsageError, parseCli, exitUsage } from './lib/cli.mjs';

const USAGE = 'node scripts/serve.mjs [dir with index.html] [--port n] [--open]';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

let root;
let port;
let open;
try {
  const { values, positionals } = parseCli(process.argv.slice(2), { port: { type: 'string' }, open: { type: 'boolean' } }, USAGE);
  if (positionals.length > 1) throw new UsageError(`expected at most one directory; usage: ${USAGE}`);
  port = values.port === undefined ? 0 : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UsageError(`--port must be 0-65535; usage: ${USAGE}`);
  open = Boolean(values.open);
  const dir = path.resolve(positionals[0] ?? 'dist');
  try {
    root = fs.realpathSync(dir);
  } catch {
    throw new UsageError(`no such directory: ${dir}; run build.mjs first`);
  }
  if (!fs.existsSync(path.join(root, 'index.html'))) throw new UsageError(`no index.html in ${root}; run build.mjs first`);
} catch (e) {
  if (!(e instanceof UsageError)) throw e;
  exitUsage(e);
}

const inside = (p) => p === root || p.startsWith(root + path.sep);
const reply = (res, code, text) => res.writeHead(code, { 'content-type': 'text/plain' }).end(text);

// Only local Host headers are served (DNS rebinding); the port is known once listening.
const hostAllowed = (host) => {
  const { port: bound } = server.address();
  return host === `127.0.0.1:${bound}` || host === `localhost:${bound}`;
};

const server = http.createServer((req, res) => {
  if (!hostAllowed(req.headers.host)) {
    reply(res, 403, 'forbidden host');
    return;
  }
  let rel;
  try {
    rel = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
  } catch {
    reply(res, 400, 'bad request');
    return;
  }
  if (rel.includes('\0')) {
    reply(res, 400, 'bad request');
    return;
  }
  const wanted = path.resolve(root, `.${rel.endsWith('/') ? `${rel}index.html` : rel}`);
  if (!inside(wanted)) {
    reply(res, 403, 'forbidden');
    return;
  }
  fs.realpath(wanted, (err, real) => {
    if (err) { reply(res, 404, 'not found'); return; }
    if (!inside(real)) { reply(res, 403, 'forbidden'); return; }
    fs.readFile(real, (readErr, body) => {
      if (readErr) { reply(res, 404, 'not found'); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(real)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    });
  });
});

server.on('error', (e) => {
  process.stderr.write(`cannot listen on 127.0.0.1:${port}: ${e.code ?? e.message}\n`);
  process.exit(2);
});

server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}/`;
  process.stdout.write(`serving ${root}\n${url}\n`);
  if (open) {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    spawn(cmd, process.platform === 'win32' ? ['/c', 'start', '', url] : [url], { stdio: 'ignore', detached: true }).unref();
  }
});
