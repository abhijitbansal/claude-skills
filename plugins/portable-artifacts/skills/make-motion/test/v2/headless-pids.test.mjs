// headlessPidsUnder(root): the headless browsers that descend from one process. make.test.mjs uses it to ask whether
// a render it interrupted left ITS browser behind; counting every headless browser on the machine blames that render for
// the ones other test files (run in parallel) have up. No real browser: a process whose command line holds the name stands in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { headlessPids, headlessPidsUnder, isRunning } from './helpers/session.mjs';

const NAME = 'chrome-headless-shell';
const IDLE = 'setInterval(() => {}, 1000)';

// A tree: this test -> parent (node) -> a node whose command line names the browser. Resolves with { parent, browser }.
function tree(t) {
  const parent = spawn(process.execPath, ['-e', `const { spawn } = require('node:child_process'); const c = spawn(process.execPath, ['-e', '${IDLE}', '${NAME}'], { stdio: 'inherit' }); console.log(c.pid); ${IDLE}`], { stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(() => parent.kill('SIGKILL'));
  return new Promise((resolve) => parent.stdout.once('data', (chunk) => resolve({ parent, browser: Number(String(chunk).trim()) })));
}

test('headlessPidsUnder finds the browser below a process and ignores one outside its tree', async (t) => {
  const { parent, browser } = await tree(t);
  const decoy = spawn(process.execPath, ['-e', IDLE, NAME], { stdio: 'ignore' });
  t.after(() => { decoy.kill('SIGKILL'); process.kill(browser, 'SIGKILL'); });
  assert.ok(headlessPids().has(decoy.pid), 'the premise: the decoy looks like a headless browser to pgrep');
  assert.deepEqual([...headlessPidsUnder(parent.pid)], [browser]);
  assert.deepEqual([...headlessPidsUnder(decoy.pid)], []);
});

test('isRunning is true for a live process and false once it is gone', async (t) => {
  const idle = spawn(process.execPath, ['-e', IDLE], { stdio: 'ignore' });
  t.after(() => idle.kill('SIGKILL'));
  assert.equal(isRunning(idle.pid), true);
  const gone = new Promise((resolve) => idle.on('close', resolve));
  idle.kill('SIGKILL');
  await gone;
  assert.equal(isRunning(idle.pid), false);
});
