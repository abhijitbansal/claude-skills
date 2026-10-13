// The harness behind live.test.mjs and serve.test.mjs must never be the reason a
// test file hangs: every wait is bounded and every child, request and socket is
// torn down. Each test below feeds it the failure it guards against.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { until, request, events, spawnReady, stopChild } from './helpers/live-harness.mjs';

const dead = (child) => child.exitCode !== null || child.signalCode !== null;
const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

test('until gives up with its label instead of waiting forever', async () => {
  const t0 = Date.now();
  await assert.rejects(until(() => false, { ms: 200, label: 'a rebuilt event' }), /timed out after 200 ms waiting for a rebuilt event/);
  assert.ok(Date.now() - t0 < 2000);
});

test('until returns as soon as the condition holds', async () => {
  let n = 0;
  await until(() => ++n >= 3, { ms: 5000 });
  assert.equal(n, 3);
});

test('a child that never gets ready is rejected at the deadline and killed', async (t) => {
  let child;
  await assert.rejects(
    spawnReady(t, ['-e', 'setInterval(() => {}, 1000)'], { startupMs: 300, ready: () => null, onSpawn: (c) => { child = c; } }),
    /did not start within 300 ms/,
  );
  await until(() => dead(child), { ms: 5000, label: 'the silent child to be killed' });
});

test('a child that exits before it is ready is rejected with its output', async (t) => {
  await assert.rejects(
    spawnReady(t, ['-e', 'console.log("boot failure"); process.exitCode = 3'], { startupMs: 5000, ready: () => null }),
    /exited 3 before it was ready.*boot failure/s,
  );
});

test('a child that ignores SIGTERM is SIGKILLed after the grace period', async (t) => {
  let child;
  await spawnReady(t, ['-e', 'process.on("SIGTERM", () => {}); console.log("up"); setInterval(() => {}, 1000)'], {
    startupMs: 5000, ready: (out) => (out.includes('up') ? {} : null), onSpawn: (c) => { child = c; },
  });
  const t0 = Date.now();
  await stopChild(child, 300);
  assert.ok(dead(child), 'child is gone when stopChild resolves');
  assert.equal(child.signalCode, 'SIGKILL');
  assert.ok(Date.now() - t0 < 5000);
});

test('stopChild on a child that already exited resolves at once', async (t) => {
  let child;
  await spawnReady(t, ['-e', 'console.log("up"); setTimeout(() => {}, 50)'], {
    startupMs: 5000, ready: (out) => (out.includes('up') ? {} : null), onSpawn: (c) => { child = c; },
  });
  await until(() => dead(child), { ms: 5000, label: 'the child to exit' });
  await stopChild(child, 300);
});

test('a request to a server that never answers times out', async () => {
  const server = http.createServer(() => {});
  const port = await listen(server);
  try {
    await assert.rejects(request(port, { ms: 200 }), /timed out|aborted/i);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('events() closed before the response arrives raises no uncaught error', async (t) => {
  const server = http.createServer(() => {});
  const port = await listen(server);
  const uncaught = [];
  const onUncaught = (e) => uncaught.push(e);
  process.on('uncaughtException', onUncaught);
  try {
    const es = events(t, port);
    es.close();
    await new Promise((r) => setTimeout(r, 200));
    assert.deepEqual(uncaught.map(String), []);
  } finally {
    process.off('uncaughtException', onUncaught);
    server.closeAllConnections();
    server.close();
  }
});

test('events() collects server-sent events and survives the server going away', async (t) => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('event: rebuilt\ndata: {"n":1}\n\n');
  });
  const port = await listen(server);
  const es = events(t, port);
  await until(() => es.seen.length === 1, { ms: 5000, label: 'the first event' });
  assert.deepEqual(es.seen[0], { event: 'rebuilt', data: { n: 1 } });
  server.closeAllConnections();
  server.close();
  await new Promise((r) => setTimeout(r, 100));
});
