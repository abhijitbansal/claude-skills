// Harness for tests that start serve.mjs and talk to it. Two rules keep a test
// file from ever hanging, whatever the machine load or a failed assertion:
//   - every wait has a deadline that fails with a message (no await without a bound);
//   - every child process, request and socket is torn down on every path
//     (t.after per test, plus a SIGKILL sweep when the file ends).
// test/live-harness.test.mjs feeds each guard the failure it exists for.
import { after } from 'node:test';
import http from 'node:http';
import { spawn } from 'node:child_process';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const WAIT_MS = 30000;      // a condition that normally holds within a second or two
const STARTUP_MS = 60000;   // a cold serve.mjs: DuckDB load plus first build, on a busy machine
const REQUEST_MS = 20000;
const KILL_GRACE_MS = 2000; // SIGTERM first, SIGKILL when the child ignores it

export async function until(fn, { ms = WAIT_MS, label = 'the condition' } = {}) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return;
    await sleep(50);
  }
  throw new Error(`timed out after ${ms} ms waiting for ${label}`);
}

const gone = (child) => child.exitCode !== null || child.signalCode !== null;
const running = new Set();

// Resolves once the child has exited. Never rejects, never waits longer than the grace period plus a margin.
export function stopChild(child, graceMs = KILL_GRACE_MS) {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(hard);
      clearTimeout(giveUp);
      child.stdout?.destroy();
      child.stderr?.destroy();
      running.delete(child);
      resolve();
    };
    const hard = setTimeout(() => child.kill('SIGKILL'), graceMs);
    const giveUp = setTimeout(finish, graceMs + 5000);
    if (gone(child)) { finish(); return; }
    child.once('exit', finish);
    child.kill('SIGTERM');
  });
}

after(() => Promise.all([...running].map((c) => stopChild(c, 500))));

// Start `node <args>`; ready(stdout, stderr) returns a truthy value (the resolved result) once the child is up.
// Rejects when the child exits first or startupMs passes; the child is stopped on every path.
export function spawnReady(t, args, { ready, startupMs = STARTUP_MS, onSpawn } = {}) {
  const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  running.add(child);
  onSpawn?.(child);
  t?.after(() => stopChild(child));
  let out = '';
  let err = '';
  child.stderr.on('data', (d) => { err += d; });
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const fail = (e) => { settle(reject, e); stopChild(child); };
    const timer = setTimeout(() => fail(new Error(`did not start within ${startupMs} ms: ${out}${err}`)), startupMs);
    child.stdout.on('data', (d) => {
      out += d;
      const result = ready(out, err);
      if (result) settle(resolve, { child, stderr: () => err, ...result });
    });
    child.once('exit', (code, signal) => fail(new Error(`exited ${code ?? signal} before it was ready: ${out}${err}`)));
    child.once('error', fail);
  });
}

// serve.mjs prints its URL (and, with --watch, a token) on stdout once listening.
export function serve(t, scriptPath, args, opts = {}) {
  const needToken = args.includes('--watch');
  return spawnReady(t, [scriptPath, ...args], {
    ...opts,
    ready: (out) => {
      const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)\//);
      const tok = out.match(/token: (\w+)/);
      return m && (!needToken || tok) ? { port: Number(m[1]), token: tok?.[1] } : null;
    },
  });
}

// One request on its own socket; rejects at the deadline rather than waiting on a stalled server.
export function request(port, { method = 'GET', path: p = '/', headers = {}, ms = REQUEST_MS } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers, agent: false, signal: AbortSignal.timeout(ms) }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
      res.on('error', reject);
    });
    req.on('error', (e) => reject(e.name === 'TimeoutError' || e.name === 'AbortError' ? new Error(`request ${method} ${p} timed out after ${ms} ms`) : e));
    req.end();
  });
}

// The /events stream. Closing it, or the server going away, is expected and never an error.
export function events(t, port) {
  const seen = [];
  const stream = { seen, connected: false, close: () => req.destroy() };
  let buf = '';
  const req = http.get({ host: '127.0.0.1', port, path: '/events', agent: false }, (res) => {
    res.setEncoding('utf8');
    res.on('error', () => {});
    res.on('data', (chunk) => {
      stream.connected = true; // the server writes ": connected" first; events sent before this would be missed
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const m = block.match(/^event: ([\w-]+)\ndata: (.*)$/m);
        if (!m) continue;
        try { seen.push({ event: m[1], data: JSON.parse(m[2]) }); } catch { /* a partial frame is not an event */ }
      }
    });
  });
  req.on('error', () => {});
  t?.after(stream.close);
  return stream;
}
