#!/usr/bin/env node
// node scripts/serve.mjs [dir] [--port n] [--open]   static server on 127.0.0.1 only, local Host headers only
// node scripts/serve.mjs --watch <spec.json> [--interval s] [--theme name] [--port n] [--open] [--allow-outside] [--timeout s]
//   rebuilds on change and live-reloads the page; the page on disk stays as built
// exit 2 on usage errors or when the port cannot be bound
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { UsageError, parseCli, parseTimeout, exitUsage } from '../shared/cli.mjs';
import { startLiveServer, MIN_INTERVAL_S, MAX_INTERVAL_S } from './lib/live.mjs';
import { printResult } from '../shared/errors.mjs';

const USAGE = 'node scripts/serve.mjs [dir with index.html] [--port n] [--open]\n   or: node scripts/serve.mjs --watch <spec.json> [--interval <seconds>] [--theme <name>] [--port n] [--open] [--allow-outside] [--timeout <seconds>]';
const OPTIONS = {
  port: { type: 'string' }, open: { type: 'boolean' }, watch: { type: 'string' }, interval: { type: 'string' },
  theme: { type: 'string' }, 'allow-outside': { type: 'boolean' }, timeout: { type: 'string' },
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

function openUrl(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  spawn(cmd, process.platform === 'win32' ? ['/c', 'start', '', url] : [url], { stdio: 'ignore', detached: true }).unref();
}

function serveStatic(root, port, open) {
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
    process.exitCode = 2;
  });

  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${server.address().port}/`;
    process.stdout.write(`serving ${root}\n${url}\n`);
    if (open) openUrl(url);
  });
}

try {
  const { values, positionals } = parseCli(process.argv.slice(2), OPTIONS, USAGE);
  const port = values.port === undefined ? 0 : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UsageError(`--port must be 0-65535; usage: ${USAGE}`);
  const open = Boolean(values.open);
  if (values.watch !== undefined) {
    if (positionals.length) throw new UsageError(`--watch takes a spec file, not a directory; usage: ${USAGE}`);
    const interval = values.interval === undefined ? undefined : Number(values.interval);
    if (interval !== undefined && !(Number.isFinite(interval) && interval >= MIN_INTERVAL_S && interval <= MAX_INTERVAL_S)) {
      throw new UsageError(`--interval must be between ${MIN_INTERVAL_S} and ${MAX_INTERVAL_S} seconds; usage: ${USAGE}`);
    }
    const live = await startLiveServer({
      specFile: path.resolve(values.watch), port, interval, theme: values.theme,
      allowOutside: values['allow-outside'], timeoutMs: parseTimeout(values.timeout, 30),
    });
    if (!live.ok) {
      printResult({ ok: false, errors: live.errors }, { label: 'build' });
      process.exitCode = 1;
    } else {
      process.stdout.write(`watching ${values.watch}\n${live.url}\ntoken: ${live.token}\n`);
      if (open) openUrl(live.url);
    }
  } else {
    if (['interval', 'theme', 'allow-outside', 'timeout'].some((k) => values[k] !== undefined)) {
      throw new UsageError(`--interval, --theme, --allow-outside and --timeout need --watch; usage: ${USAGE}`);
    }
    if (positionals.length > 1) throw new UsageError(`expected at most one directory; usage: ${USAGE}`);
    const dir = path.resolve(positionals[0] ?? 'dist');
    let root;
    try {
      root = fs.realpathSync(dir);
    } catch {
      throw new UsageError(`no such directory: ${dir}; run build.mjs first`);
    }
    if (!fs.existsSync(path.join(root, 'index.html'))) throw new UsageError(`no index.html in ${root}; run build.mjs first`);
    serveStatic(root, port, open);
  }
} catch (e) {
  if (!(e instanceof UsageError)) throw e;
  exitUsage(e);
}
