import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { liveHtml, createRebuilder, watchFiles, startLiveServer } from '../scripts/lib/live.mjs';
import { buildDashboard } from '../scripts/lib/pipeline.mjs';
import { sleep, until, request, events, serve as serveProcess } from './helpers/live-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVE = path.join(ROOT, 'scripts/serve.mjs');
const CSP = `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:`;
const SPAWN_MS = 30000; // generous: a usage-error spawn is quick, but the machine may be busy

test('liveHtml adds connect-src and the client; the original string is untouched', () => {
  const html = `<meta http-equiv="Content-Security-Policy" content="${CSP}"><body><p>x</p></body>`;
  const live = liveHtml(html, { token: 'abc"def' });
  assert.ok(live.includes(`content="${CSP}; connect-src 'self'"`));
  assert.ok(live.includes('"abc\\"def"'), 'token embedded as a JSON string');
  assert.ok(live.indexOf('EventSource') < live.indexOf('</body>'));
  assert.ok(!html.includes('connect-src'));
});

test('createRebuilder runs one build at a time and coalesces triggers into one more', async () => {
  let runs = 0;
  let release;
  const rb = createRebuilder(async () => { runs++; await new Promise((r) => { release = r; }); });
  rb.trigger(); rb.trigger(); rb.trigger();
  await sleep(10);
  assert.equal(runs, 1);
  release(); await sleep(10);
  assert.equal(runs, 2, 'exactly one follow-up');
  release(); await rb.idle();
  assert.equal(runs, 2);
});

test('createRebuilder reports a throwing run through onError and keeps going', async () => {
  const seen = [];
  let runs = 0;
  const rb = createRebuilder(async () => { runs++; if (runs === 1) throw new Error('boom'); }, { onError: (e) => seen.push(e.message) });
  rb.trigger(); await rb.idle();
  assert.deepEqual(seen, ['boom']);
  rb.trigger(); await rb.idle();
  assert.equal(runs, 2, 'a later trigger still runs');
});

test('watchFiles throws for a directory it cannot watch and leaves no watcher behind', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-watch-'));
  assert.throws(() => watchFiles([path.join(dir, 'a.csv'), path.join(dir, 'gone/b.csv')], () => {}), /ENOENT/);
});

// fs.watch (FSEvents on macOS) may not deliver anything for a write made in the moments right after it
// returns, so the test first writes at intervals until the watcher answers, then starts counting.
test('watchFiles fires once per burst, including rename-and-replace saves', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-watch-'));
  const file = path.join(dir, 'data.csv');
  fs.writeFileSync(file, 'a\n1\n');
  let fired = 0;
  const w = watchFiles([file], () => { fired++; }, { debounceMs: 250 });
  t.after(() => w.close()); // an assertion failure below must not leave a watcher keeping the process alive
  const settle = () => sleep(700); // outlasts the debounce several times over, even on a busy machine
  let primed = 0;
  let lastWrite = 0;
  await until(() => {
    if (Date.now() - lastWrite > 600) { lastWrite = Date.now(); fs.writeFileSync(file, `a\nprime ${primed++}\n`); }
    return fired >= 1;
  }, { label: 'the watcher to answer a write' });
  await settle();
  fired = 0;
  fs.writeFileSync(file, 'a\n2\n'); fs.writeFileSync(file, 'a\n3\n');
  await until(() => fired >= 1, { label: 'the first burst to fire' });
  await settle();
  assert.equal(fired, 1);
  fs.writeFileSync(path.join(dir, '.data.csv.tmp'), 'a\n4\n');
  fs.renameSync(path.join(dir, '.data.csv.tmp'), file);
  await until(() => fired >= 2, { label: 'the rename-and-replace save to fire' });
  await settle();
  assert.equal(fired, 2);
  fs.writeFileSync(path.join(dir, 'other.csv'), 'x');
  await settle();
  assert.equal(fired, 2, 'unrelated files are ignored');
});

// ---- end to end ------------------------------------------------------------
function project() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pa-live-')));
  fs.mkdirSync(path.join(dir, 'data'));
  fs.writeFileSync(path.join(dir, 'data/k.csv'), 'v\n41\n');
  const spec = {
    title: 'Live', sources: { k: { type: 'csv', path: 'data/k.csv' } },
    queries: { total: 'SELECT SUM(v) AS v FROM k' },
    kpis: [{ id: 'k1', title: 'Total', query: 'total', field: 'v' }],
  };
  fs.writeFileSync(path.join(dir, 'dashboard.json'), JSON.stringify(spec));
  return { dir, spec, file: path.join(dir, 'dashboard.json'), csv: path.join(dir, 'data/k.csv') };
}

const serve = (t, args) => serveProcess(t, SERVE, args);

test('--watch: CSV edit -> rebuilt; broken spec -> error and last good page stays; good save recovers', async (t) => {
  const { file, csv, spec, dir } = project();
  const { port } = await serve(t, ['--watch', file]);
  const es = events(t, port);
  await until(() => es.connected, { label: 'the event stream to connect' });
  fs.writeFileSync(csv, 'v\n41\n1\n');
  await until(() => es.seen.some((e) => e.event === 'rebuilt'), { label: 'a rebuilt event after the CSV edit' });
  assert.match((await request(port)).body, /class="kpi-value">42</);
  fs.writeFileSync(csv, 'v\n"unterminated\n');  // half-written file
  await until(() => es.seen.some((e) => e.event === 'build-error'), { label: 'a build-error event for the half-written CSV' });
  assert.match((await request(port)).body, /class="kpi-value">42</, 'last good page still served');
  fs.writeFileSync(csv, 'v\n50\n');
  await until(() => es.seen.filter((e) => e.event === 'rebuilt').length >= 2, { label: 'a second rebuilt event' });
  assert.match((await request(port)).body, /class="kpi-value">50</);
  fs.writeFileSync(file, JSON.stringify({ ...spec, queries: { total: 'SELEC 1' } }));
  await until(() => es.seen.filter((e) => e.event === 'build-error').length >= 2, { label: 'a second build-error event' });
  const disk = fs.readFileSync(path.join(dir, 'dist/index.html'), 'utf8');
  assert.ok(disk.includes(`content="${CSP}"`) && !disk.includes('connect-src'), 'disk copy keeps the strict CSP');
  assert.ok((await request(port)).body.includes("connect-src 'self'"), 'served copy allows the event stream');
});

test('POST /rebuild needs the token; other methods and foreign hosts are refused', async (t) => {
  const { file } = project();
  const { port, token } = await serve(t, ['--watch', file]);
  const es = events(t, port);
  await until(() => es.connected, { label: 'the event stream to connect' });
  assert.equal((await request(port, { method: 'POST', path: '/rebuild' })).status, 403);
  assert.equal((await request(port, { method: 'POST', path: '/rebuild', headers: { 'x-pa-token': 'nope' } })).status, 403);
  assert.equal((await request(port, { method: 'OPTIONS', path: '/rebuild' })).status, 405);
  assert.equal((await request(port, { headers: { host: `evil.test:${port}` } })).status, 403);
  assert.equal((await request(port, { method: 'POST', path: '/rebuild', headers: { 'x-pa-token': token } })).status, 202);
  await until(() => es.seen.some((e) => e.event === 'rebuilt'), { label: 'a rebuilt event after POST /rebuild' });
});

test('--interval rebuilds on a timer; --watch with a directory argument is a usage error', async (t) => {
  const { file, dir } = project();
  const { port } = await serve(t, ['--watch', file, '--interval', '5']);
  const es = events(t, port);
  await until(() => es.seen.some((e) => e.event === 'rebuilt'), { label: 'the --interval rebuild' });
  let r = spawnSync(process.execPath, [SERVE, path.join(dir, 'dist'), '--watch', file], { encoding: 'utf8', timeout: SPAWN_MS });
  assert.equal(r.status, 2);
  r = spawnSync(process.execPath, [SERVE, '--watch', file, '--interval', '2'], { encoding: 'utf8', timeout: SPAWN_MS });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--interval must be between 5 and 86400 seconds/);
  for (const bad of ['86401', '2147484', '1e10', 'abc']) {
    r = spawnSync(process.execPath, [SERVE, '--watch', file, '--interval', bad], { encoding: 'utf8', timeout: SPAWN_MS });
    assert.equal(r.status, 2, `--interval ${bad}`);
    assert.match(r.stderr, /--interval must be between 5 and 86400 seconds/);
  }
});

test('a vanished data folder is reported (event + stderr), then Rebuild now re-arms the watchers', async (t) => {
  const { file, dir, csv } = project();
  const { port, token, stderr } = await serve(t, ['--watch', file]);
  const es = events(t, port);
  await until(() => es.connected, { label: 'the event stream to connect' });
  fs.rmSync(path.join(dir, 'data'), { recursive: true });
  await until(() => es.seen.some((e) => e.event === 'build-error' && e.data.some((x) => x.path === 'watch')), { label: 'the watch build-error event' });
  assert.match(stderr(), /watch: watcher stopped: ENOENT; fix the folder and press Rebuild now/);
  assert.match((await request(port)).body, /class="kpi-value">41</, 'last good page still served');
  fs.mkdirSync(path.join(dir, 'data'));
  fs.writeFileSync(csv, 'v\n7\n');
  const rebuilt = () => es.seen.filter((e) => e.event === 'rebuilt').length;
  const before = rebuilt();
  assert.equal((await request(port, { method: 'POST', path: '/rebuild', headers: { 'x-pa-token': token } })).status, 202);
  await until(() => rebuilt() > before, { label: 'the rebuild after Rebuild now' });
  assert.match((await request(port)).body, /class="kpi-value">7</);
  const armed = rebuilt();
  let lastWrite = 0; // a watcher armed a moment ago may not hear the first write; write again until it does
  await until(() => {
    if (Date.now() - lastWrite > 700) { lastWrite = Date.now(); fs.writeFileSync(csv, 'v\n8\n'); }
    return rebuilt() > armed;
  }, { label: 'a rebuild from the re-armed watcher' });
  assert.match((await request(port)).body, /class="kpi-value">8</, 'watching resumed');
});

test('a watcher problem after a GOOD build sends rebuilt then watch-warning, never build-error; later clients hear it too', async (t) => {
  const { file } = project();
  let armed = 0;
  // The first arming works; every later one throws, as when the data folder vanishes between build and watch.
  const watch = (paths, onChange, opts) => {
    armed += 1;
    if (armed > 1) throw Object.assign(new Error('gone'), { code: 'EMFILE' });
    return watchFiles(paths, onChange, opts);
  };
  const live = await startLiveServer({ specFile: file, watch });
  const port = Number(new URL(live.url).port);
  const es = events(t, port);
  try {
    await until(() => es.connected, { label: 'the event stream to connect' });
    assert.equal((await request(port, { method: 'POST', path: '/rebuild', headers: { 'x-pa-token': live.token } })).status, 202);
    await until(() => es.seen.some((e) => e.event === 'watch-warning'), { label: 'the watch-warning event' });
    assert.deepEqual(es.seen.map((e) => e.event), ['rebuilt', 'watch-warning']);
    assert.equal(es.seen[1].data.code, 'EMFILE');
    assert.match(es.seen[1].data.message, /watcher stopped: EMFILE/);
    const later = events(t, port);
    await until(() => later.seen.length > 0, { label: 'the replayed watch-warning' });
    assert.equal(later.seen[0].event, 'watch-warning', 'a page that just reloaded still learns the watcher is paused');
  } finally {
    await live.close();
  }
});

// A stand-in for the build that counts its calls and holds every call after the first until released,
// so a test knows a build is in flight (and how many started) instead of hoping the timing works out.
function gatedBuilder() {
  const gate = { calls: 0, release: null, held: null };
  gate.held = new Promise((resolve) => { gate.release = resolve; });
  const build = async (...args) => {
    gate.calls += 1;
    if (gate.calls > 1) await gate.held;
    return buildDashboard(...args);
  };
  return { gate, build };
}
const post = (live) => request(Number(new URL(live.url).port), { method: 'POST', path: '/rebuild', headers: { 'x-pa-token': live.token } });
const armedWatch = () => {
  const armed = new Set();
  const watch = (paths, onChange, opts) => {
    const real = watchFiles(paths, onChange, opts);
    const handle = { close: () => { real.close(); armed.delete(handle); } };
    armed.add(handle);
    return handle;
  };
  return { armed, watch };
};

test('close() during a rebuild waits for it and leaves no watcher armed', async (t) => {
  const { file } = project();
  const { armed, watch } = armedWatch();
  const { gate, build } = gatedBuilder();
  const live = await startLiveServer({ specFile: file, watch, buildFn: build });
  t.after(() => { gate.release(); live.close(); armed.forEach((w) => w.close()); });
  assert.equal(armed.size, 1);
  assert.equal((await post(live)).status, 202);
  await until(() => gate.calls === 2, { label: 'the POST-triggered build to be in flight' });
  let closed = false;
  const closing = live.close().then(() => { closed = true; });
  await sleep(200);
  assert.equal(closed, false, 'close() waits for the build that is in flight');
  gate.release();
  await closing;
  await sleep(300); // long enough for a leaked build to re-arm
  assert.equal(gate.calls, 2);
  assert.equal(armed.size, 0, 'a build that finished after close() armed a watcher nobody will close');
});

test('close() cancels a rebuild that was queued behind the one in flight: nothing builds or writes after close', async (t) => {
  const { file, dir } = project();
  const out = path.join(dir, 'dist');
  const page = path.join(out, 'index.html');
  const { gate, build } = gatedBuilder();
  const live = await startLiveServer({ specFile: file, out, buildFn: build });
  t.after(() => { gate.release(); live.close(); });
  assert.equal((await post(live)).status, 202);
  await until(() => gate.calls === 2, { label: 'the POST-triggered build to be in flight' });
  assert.equal((await post(live)).status, 202); // queued behind it
  const closing = live.close();
  gate.release();
  await closing;
  fs.rmSync(page);
  await sleep(500);
  assert.equal(gate.calls, 2, 'the queued build never ran');
  assert.equal(fs.existsSync(page), false, 'and nothing was written to the output after close()');
});

test('createRebuilder.cancel() drops a queued run and keeps later triggers from running', async () => {
  let runs = 0;
  let release;
  const rb = createRebuilder(async () => { runs++; await new Promise((r) => { release = r; }); });
  rb.trigger(); rb.trigger();
  await sleep(10);
  rb.cancel();
  release(); await rb.idle();
  assert.equal(runs, 1, 'the queued run was dropped');
  rb.trigger(); await sleep(20);
  assert.equal(runs, 1, 'a cancelled rebuilder stays cancelled');
});
