// Arguments, target resolution and the loopback server. The screenshot loop runs against a stub that never starts a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { UsageError } from '../cli.mjs';
import { parseShotArgs, pagesFor, startServer, liveBrowsers, findBrowserLib, main, BROWSER_PACKAGE, MAX_SHOT_HEIGHT } from '../shot.mjs';

const SHOT = fileURLToPath(new URL('../shot.mjs', import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pa-shot-'));
const usageError = (fn) => { try { fn(); } catch (e) { assert.ok(e instanceof UsageError, String(e)); return e; } throw new Error('did not throw'); };

function get(origin, urlPath, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(origin + urlPath, { method }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end();
  });
}

// --- arguments ---

test('parseShotArgs: defaults are 390 and 1280, no --out, one target', () => {
  assert.deepEqual(parseShotArgs(['page.html']), { target: 'page.html', widths: [390, 1280], out: undefined, json: false });
  assert.deepEqual(parseShotArgs(['d', '--widths', '320, 768,1440', '--out', 'o', '--json']), { target: 'd', widths: [320, 768, 1440], out: 'o', json: true });
  assert.deepEqual(parseShotArgs(['d', '--widths', '390,390']).widths, [390], 'a repeated width is shot once');
});

test('parseShotArgs: bad widths, no target, two targets, an empty --out and unknown flags are usage errors that say what is accepted', () => {
  for (const w of ['abc', '390,', '100', '5000', '39.5']) assert.match(usageError(() => parseShotArgs(['p.html', '--widths', w])).message, /--widths needs whole pixel widths from 200 to 4000/, w);
  assert.match(usageError(() => parseShotArgs(['p.html', '--widths=-390'])).message, /--widths needs whole pixel widths/);
  assert.match(usageError(() => parseShotArgs([])).message, /expected one page file or folder; usage: node shared\/shot\.mjs/);
  assert.match(usageError(() => parseShotArgs(['a', 'b'])).message, /expected one page file or folder/);
  assert.match(usageError(() => parseShotArgs(['a', '--out', ' '])).message, /--out needs a folder path/);
  assert.match(usageError(() => parseShotArgs(['a', '--width', '390'])).message, /did you mean '--widths'/);
});

test('parseShotArgs: --help is a help request carrying the usage line', () => {
  const e = usageError(() => parseShotArgs(['--help']));
  assert.equal(e.help, true);
  assert.match(e.message, /^node shared\/shot\.mjs <file\.html \| folder>/);
});

// --- targets ---

test('pagesFor: a file serves its folder, a folder serves index.html else every top-level .html, anything else is a usage error', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'a.html'), '<p>a</p>');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
  assert.deepEqual(pagesFor(path.join(dir, 'a.html')), { root: dir, pages: ['a.html'] });
  assert.deepEqual(pagesFor(dir), { root: dir, pages: ['a.html'] });
  fs.writeFileSync(path.join(dir, 'b.html'), '<p>b</p>');
  assert.deepEqual(pagesFor(dir).pages, ['a.html', 'b.html']);
  fs.writeFileSync(path.join(dir, 'index.html'), '<p>i</p>');
  assert.deepEqual(pagesFor(dir).pages, ['index.html']);
  assert.match(usageError(() => pagesFor(path.join(dir, 'notes.txt'))).message, /is not an \.html file/);
  assert.match(usageError(() => pagesFor(path.join(dir, 'missing.html'))).message, /no such file or folder/);
  assert.match(usageError(() => pagesFor(tmp())).message, /no \.html page in/);
});

// --- server ---

test('startServer: loopback only, serves files with a type, 404 for a missing file, HEAD has no body', async () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<h1>home</h1>');
  fs.writeFileSync(path.join(dir, 'sub', 'app.css'), 'body{}');
  fs.writeFileSync(path.join(dir, 'sub', 'index.html'), '<h1>sub</h1>');
  const s = await startServer(dir);
  try {
    assert.match(s.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.deepEqual(await get(s.origin, '/'), { status: 200, type: 'text/html; charset=utf-8', body: '<h1>home</h1>' });
    assert.deepEqual(await get(s.origin, '/sub/app.css'), { status: 200, type: 'text/css; charset=utf-8', body: 'body{}' });
    assert.equal((await get(s.origin, '/sub/')).body, '<h1>sub</h1>');
    assert.equal((await get(s.origin, '/index.html?v=2#x')).status, 200, 'a query string and a fragment are ignored');
    assert.equal((await get(s.origin, '/nope.png')).status, 404);
    assert.equal((await get(s.origin, '/index.html', 'HEAD')).body, '');
    assert.equal((await get(s.origin, '/', 'POST')).status, 404, 'read-only');
  } finally {
    await s.close();
  }
});

test('startServer: nothing outside the root, by dot-dot, encoded dot-dot, NUL or a symlink', async () => {
  const outer = tmp();
  fs.writeFileSync(path.join(outer, 'secret.txt'), 'secret');
  const root = path.join(outer, 'site');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'index.html'), 'ok');
  fs.symlinkSync(path.join(outer, 'secret.txt'), path.join(root, 'link.txt'));
  const s = await startServer(root);
  try {
    for (const p of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/sub/../../secret.txt', '/%00', '/link.txt', '/%E0%A4%A']) {
      const r = await get(s.origin, p);
      assert.equal(r.status, 404, p);
      assert.doesNotMatch(r.body, /secret$/, p);
    }
  } finally {
    await s.close();
  }
});

// --- guards ---

test('liveBrowsers lists pgrep lines and is empty when none run or pgrep is absent', () => {
  assert.deepEqual(liveBrowsers(() => ({ status: 0, stdout: '4242 /x/chrome-headless-shell --headless\n\n' })), ['4242 /x/chrome-headless-shell --headless']);
  assert.deepEqual(liveBrowsers(() => ({ status: 1, stdout: '' })), []);
  assert.deepEqual(liveBrowsers(() => ({ error: new Error('ENOENT') })), []);
});

test('findBrowserLib: this skill first, then a sibling skill, then (plugin source) any skill; null when none has it', () => {
  const has = (...dirs) => (p) => dirs.some((d) => p === path.join(d, 'node_modules', BROWSER_PACKAGE, 'package.json'));
  const list = (d) => (d === path.resolve('/p/skills') ? ['make-diagram', 'make-motion', 'make-scene'] : []);
  const diagram = path.resolve('/p/skills/make-diagram');
  const motion = path.resolve('/p/skills/make-motion');
  assert.equal(findBrowserLib(diagram, { exists: has(diagram, motion), list }), diagram);
  assert.equal(findBrowserLib(diagram, { exists: has(motion), list }), motion);
  assert.equal(findBrowserLib(diagram, { exists: has(), list }), null);
  const plugin = path.resolve('/p');
  assert.equal(findBrowserLib(plugin, { exists: has(motion), list }), motion, 'run from the plugin source folder: look inside skills/');
});

// --- command line, no browser: every case here ends before one could start ---

test('CLI: --help exits 0 with the usage line; a bad width and a missing target exit 2', () => {
  const help = spawnSync(process.execPath, [SHOT, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /^usage: node shared\/shot\.mjs/);
  assert.equal(spawnSync(process.execPath, [SHOT, 'x.html', '--widths', 'wide'], { encoding: 'utf8' }).status, 2);
  const missing = spawnSync(process.execPath, [SHOT, path.join(tmp(), 'gone.html')], { encoding: 'utf8' });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /no such file or folder/);
});

// --- the loop, against a stub browser that makes real requests to the real server ---

// Stands in for the browser library: page.goto fetches the URL over HTTP and reports each response like the real one does.
function stubChromium({ log, height = 1200, scrollWidth = 0 }) {
  const browser = {
    newContext: async (opts) => {
      log.contexts.push(opts);
      return {
        close: async () => {},
        newPage: async () => {
          const listeners = {};
          return {
            on: (event, fn) => { listeners[event] = fn; },
            goto: async (url) => {
              const r = await get(new URL(url).origin, new URL(url).pathname + new URL(url).search);
              listeners.response?.({ ok: () => r.status >= 200 && r.status < 300, status: () => r.status, url: () => url });
              if (url.includes('page-with-bad-asset')) listeners.response?.({ ok: () => false, status: () => 404, url: () => `${new URL(url).origin}/missing.png` });
            },
            evaluate: async () => ({ height, scrollWidth: scrollWidth || opts.viewport.width }),
            screenshot: async (o) => { log.shots.push(o); fs.writeFileSync(o.path, 'png'); },
          };
        },
      };
    },
    close: async () => { log.closed = true; },
  };
  return { launch: async () => browser };
}

async function runMain(argv, deps) {
  let out = '';
  let err = '';
  const w = process.stdout.write.bind(process.stdout);
  const e = process.stderr.write.bind(process.stderr);
  const prev = process.exitCode;
  process.exitCode = undefined;
  // main does real I/O, so the test runner's own events (binary chunks on this same stream) arrive while we capture:
  // only the strings main writes are taken, anything else goes through untouched.
  process.stdout.write = (s, ...rest) => (typeof s === 'string' ? ((out += s), true) : w(s, ...rest));
  process.stderr.write = (s, ...rest) => (typeof s === 'string' ? ((err += s), true) : e(s, ...rest));
  try { await main(argv, deps); } finally { process.stdout.write = w; process.stderr.write = e; }
  const code = process.exitCode ?? 0;
  process.exitCode = prev;
  return { out, err, code };
}

const newLog = () => ({ contexts: [], shots: [], closed: false });

test('main: one PNG per page, width and scheme at a real viewport, deviceScaleFactor 1, then the browser is closed', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'My Page.html'), '<p>x</p>');
  const outDir = path.join(tmp(), 'shots');
  const log = newLog();
  const r = await runMain([path.join(dir, 'My Page.html'), '--out', outDir], { chromium: stubChromium({ log }), live: () => [] });
  assert.equal(r.code, 0, r.err);
  const names = ['my-page-390-light.png', 'my-page-390-dark.png', 'my-page-1280-light.png', 'my-page-1280-dark.png'];
  assert.deepEqual(r.out.trim().split('\n').sort(), names.map((n) => path.join(outDir, n)).sort());
  assert.deepEqual(fs.readdirSync(outDir).sort(), [...names].sort());
  assert.deepEqual(log.contexts.map((c) => [c.viewport.width, c.colorScheme, c.deviceScaleFactor]), [[390, 'light', 1], [390, 'dark', 1], [1280, 'light', 1], [1280, 'dark', 1]]);
  // Shots show the settled page: entrance animations (make-explainer's section rise-in) start at opacity 0.
  assert.ok(log.contexts.every((c) => c.reducedMotion === 'reduce'), 'every context asks for reduced motion');
  assert.ok(log.shots.every((s) => s.fullPage === true && s.clip === undefined));
  assert.equal(log.closed, true);
});

test('main: a non-2xx page or asset fails with exit 1 and names the URL; the PNGs are still written', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'page-with-bad-asset.html'), '<img src="missing.png">');
  const outDir = path.join(tmp(), 'o');
  const r = await runMain([dir, '--widths', '390', '--out', outDir], { chromium: stubChromium({ log: newLog() }), live: () => [] });
  assert.equal(r.code, 1);
  assert.match(r.err, /^error: 404 http:\/\/127\.0\.0\.1:\d+\/missing\.png$/m);
  assert.equal(r.err.match(/missing\.png/g).length, 1, 'the same failure is listed once, not once per shot');
  assert.equal(fs.readdirSync(outDir).length, 2);
  const json = JSON.parse((await runMain([dir, '--widths', '390', '--out', outDir, '--json'], { chromium: stubChromium({ log: newLog() }), live: () => [] })).out);
  assert.equal(json.ok, false);
  assert.equal(json.shots.length, 2);
  assert.match(json.problems[0], /^404 /);
});

test('main: the page itself missing from the server (a folder page that is gone) is a failure too', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'a.html'), 'x');
  const log = newLog();
  const chromium = stubChromium({ log });
  const real = chromium.launch;
  chromium.launch = async () => { fs.rmSync(path.join(dir, 'a.html')); return real(); };
  const r = await runMain([dir, '--widths', '390', '--out', path.join(tmp(), 'o')], { chromium, live: () => [] });
  assert.equal(r.code, 1);
  assert.match(r.err, /^error: 404 .*\/a\.html$/m);
});

test('main: horizontal overflow and a page taller than the cap are warnings; a tall page is cut at the cap', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'a.html'), 'x');
  const log = newLog();
  const r = await runMain([path.join(dir, 'a.html'), '--widths', '390', '--out', path.join(tmp(), 'o')], { chromium: stubChromium({ log, height: MAX_SHOT_HEIGHT + 500, scrollWidth: 520 }), live: () => [] });
  assert.equal(r.code, 0, 'warnings never fail the run');
  assert.match(r.err, /warning: a at 390px: the page is 520px wide \(horizontal overflow\)/);
  assert.match(r.err, new RegExp(`the shot is cut at ${MAX_SHOT_HEIGHT}px`));
  assert.deepEqual(log.shots[0].clip, { x: 0, y: 0, width: 390, height: MAX_SHOT_HEIGHT });
});

test('main: another headless browser running refuses with exit 2 before anything starts; ALLOW_BROWSER_RUN=1 lets a deliberate second run through', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'a.html'), 'x');
  const log = newLog();
  const argv = [path.join(dir, 'a.html'), '--widths', '390', '--out', path.join(tmp(), 'o')];
  const refused = await runMain(argv, { chromium: stubChromium({ log }), live: () => ['77 chrome-headless-shell'] });
  assert.equal(refused.code, 2);
  assert.match(refused.err, /another headless browser is running \(77 chrome-headless-shell\)/);
  assert.equal(log.contexts.length, 0);
  const prev = process.env.ALLOW_BROWSER_RUN;
  process.env.ALLOW_BROWSER_RUN = '1';
  try {
    assert.equal((await runMain(argv, { chromium: stubChromium({ log }), live: () => ['77 chrome-headless-shell'] })).code, 0);
  } finally {
    if (prev === undefined) delete process.env.ALLOW_BROWSER_RUN; else process.env.ALLOW_BROWSER_RUN = prev;
  }
});

test('main: a usage problem is exit 2 in text and in JSON, and --help is exit 0, without touching the browser', async () => {
  const boom = { launch: async () => assert.fail('no browser for a usage problem') };
  const text = await runMain(['nope.html'], { chromium: boom, live: () => [] });
  assert.equal(text.code, 2);
  assert.match(text.err, /no such file or folder: nope\.html/);
  const json = await runMain(['nope.html', '--json'], { chromium: boom, live: () => [] });
  assert.equal(json.code, 2);
  assert.equal(JSON.parse(json.out).ok, false);
  const help = await runMain(['--help'], { chromium: boom, live: () => [] });
  assert.equal(help.code, 0);
  assert.match(help.out, /^usage: /);
});

test('main: a browser that fails to navigate is one error line and exit 1, and still closes the browser and the server', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'a.html'), 'x');
  const log = newLog();
  const chromium = {
    launch: async () => ({
      newContext: async () => ({ close: async () => {}, newPage: async () => ({ on: () => {}, goto: async () => { throw new Error('Timeout 30000ms exceeded\n  at stack'); } }) }),
      close: async () => { log.closed = true; },
    }),
  };
  const r = await runMain([path.join(dir, 'a.html'), '--out', path.join(tmp(), 'o')], { chromium, live: () => [] });
  assert.equal(r.code, 1);
  assert.equal(r.err, 'error: Timeout 30000ms exceeded\n');
  assert.equal(log.closed, true);
});
