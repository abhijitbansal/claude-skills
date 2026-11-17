// A parked look (look.experimental): a film that names it still validates and renders, but the look is left out of every
// listing (names(), --list looks, unknown-look hints) unless --list looks --all asks for it, where it is marked
// experimental; a film using it gets one info line and `look: { name, experimental: true }` in its JSON report, never a
// finding and never another exit code. cosmos was parked this way after gate review 3 and is listed again since the
// final gate review passed it; the mechanism is tested here on a throwaway look (each test file runs in its own process).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registries } from '../../engine/registry.mjs';
import { allLookNames } from '../../engine/looks/index.mjs';
import { listEntries, formatList } from '../../scripts/v2/list.mjs';
import { parseMakeArgs } from '../../scripts/v2/cli.mjs';
import { experimentalLook } from '../../scripts/v2/report.mjs';
import { runMake } from '../../scripts/v2/run.mjs';

const MAKE = fileURLToPath(new URL('../../scripts/make.mjs', import.meta.url));
const make = (args) => spawnSync(process.execPath, [MAKE, ...args], { encoding: 'utf8', timeout: 120_000 });
const FILM = (look) => ({ version: 2, mode: 'pro', look, format: '16:9', fps: 30, shots: [{ id: 'a', show: 'statement', say: 'Light takes *eight minutes* to reach us.' }] });
const PARKED = 'parked-test';
if (!registries.looks.has(PARKED)) registries.looks.add(PARKED, Object.freeze({ ...registries.looks.get('desk'), name: PARKED, experimental: true }));

test('cosmos and ledger are listed: in names(), --list looks and the unknown-look hint', () => {
  assert.equal(registries.looks.get('cosmos').experimental, undefined);
  assert.equal(registries.looks.get('ledger').experimental, undefined, 'ledger listed after its gate (looks-four Task 5)');
  assert.deepEqual(registries.looks.names(), ['desk', 'pop', 'cosmos', 'ledger']);
  assert.deepEqual(listEntries('looks').map((e) => e.name), ['desk', 'pop', 'cosmos', 'ledger']);
  const listed = make(['--list', 'looks']).stdout;
  assert.match(listed, /^cosmos {2}/m);
  assert.match(listed, /^ledger {2}/m);
});

test('a parked look is registered and resolvable, but out of names(), --list looks and unknown-look hints', () => {
  assert.equal(registries.looks.has(PARKED), true);
  assert.deepEqual(registries.looks.names(), ['desk', 'pop', 'cosmos', 'ledger']);
  assert.throws(() => registries.looks.get('parked-tst'), { message: 'unknown look "parked-tst" (have: desk, pop, cosmos, ledger)' });
  assert.deepEqual(allLookNames(), ['desk', 'pop', 'cosmos', 'ledger', 'poster', PARKED], 'every registered look, the parked ones included');
});

test('--list looks --all shows the parked look, marked experimental; without --all it is not there', () => {
  const entries = listEntries('looks', { all: true });
  assert.deepEqual(entries.map((e) => e.name), ['desk', 'pop', 'cosmos', 'ledger', 'poster', PARKED]);
  assert.deepEqual(entries.map((e) => e.experimental ?? false), [false, false, false, false, true, true]);
  assert.match(formatList('looks', entries), /^parked-test {2}\(experimental\) /m);
  assert.equal(listEntries('looks').some((e) => e.name === PARKED), false);
});

test('--all goes only with --list; unknown flags are still rejected with the accepted ones', () => {
  assert.equal(parseMakeArgs(['--list', 'looks', '--all']).all, true);
  assert.equal(parseMakeArgs(['--list', 'looks']).all, false);
  assert.throws(() => parseMakeArgs(['film.json', '--all']), /--all only goes with --list/);
  const run = make(['--list', 'looks', '--alll']);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /--all/);
});

test('a film in a parked look: one info line, look { name, experimental } in the report, exit 0, no finding', async () => {
  assert.deepEqual(experimentalLook(FILM(PARKED)), { name: PARKED, experimental: true });
  assert.equal(experimentalLook(FILM('cosmos')), null, 'a listed look adds nothing');
  const dir = mkdtempSync(path.join(tmpdir(), 'mm-v2-parked-'));
  try {
    for (const look of [PARKED, 'cosmos']) {
      const specPath = path.join(dir, `${look}.json`);
      writeFileSync(specPath, JSON.stringify(FILM(look)));
      const lines = [];
      const { report, exitCode } = await runMake({ specPath, out: null, exact: false, noRender: true, outline: true }, { log: (l) => lines.push(l) });
      assert.equal(exitCode, 0, JSON.stringify(report));
      assert.deepEqual(report.findings, []);
      const notes = lines.filter((l) => /experimental/.test(l));
      if (look === PARKED) {
        assert.deepEqual(report.look, { name: PARKED, experimental: true });
        assert.deepEqual(notes, [`make: look "${PARKED}" is experimental: it renders, but it is not one of the listed looks and may change`]);
      } else {
        assert.equal(report.look, undefined);
        assert.deepEqual(notes, []);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
