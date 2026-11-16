// A parked look (look.experimental: cosmos since gate review 3): a film that names it still validates and renders, but
// the look is left out of every listing (names(), --list looks, unknown-look hints) unless --list looks --all asks for
// it, where it is marked experimental; a film using it gets one info line on stderr and `look: { name, experimental:
// true }` in its JSON report, never a finding and never another exit code.
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

const MAKE = fileURLToPath(new URL('../../scripts/make.mjs', import.meta.url));
const make = (args) => spawnSync(process.execPath, [MAKE, ...args], { encoding: 'utf8', timeout: 120_000 });
const FILM = (look) => ({ version: 2, mode: 'pro', look, format: '16:9', fps: 30, shots: [{ id: 'a', show: 'statement', say: 'Light takes *eight minutes* to reach us.' }] });

test('cosmos is parked: registered and resolvable, but out of names(), --list looks and unknown-look hints', () => {
  assert.equal(registries.looks.get('cosmos').experimental, true);
  assert.equal(registries.looks.has('cosmos'), true);
  assert.deepEqual(registries.looks.names(), ['desk', 'pop']);
  assert.deepEqual(listEntries('looks').map((e) => e.name), ['desk', 'pop']);
  assert.throws(() => registries.looks.get('cosmo'), { message: 'unknown look "cosmo" (have: desk, pop)' });
  assert.deepEqual(allLookNames(), ['desk', 'pop', 'cosmos'], 'every registered look, the parked one included');
});

test('--list looks --all shows the parked look, marked experimental; without --all it is not there', () => {
  const entries = listEntries('looks', { all: true });
  assert.deepEqual(entries.map((e) => e.name), ['desk', 'pop', 'cosmos']);
  assert.deepEqual(entries.map((e) => e.experimental ?? false), [false, false, true]);
  assert.match(formatList('looks', entries), /^cosmos {2}\(experimental\) /m);
  const all = make(['--list', 'looks', '--all']);
  assert.equal(all.status, 0, all.stderr);
  assert.match(all.stdout, /^cosmos {2}\(experimental\) /m);
  const shipped = make(['--list', 'looks']);
  assert.equal(shipped.status, 0);
  assert.doesNotMatch(shipped.stdout, /cosmos/);
  const json = JSON.parse(make(['--list', 'looks', '--all', '--json']).stdout);
  assert.deepEqual(json.entries.find((e) => e.name === 'cosmos').experimental, true);
});

test('--all goes only with --list; unknown flags are still rejected with the accepted ones', () => {
  assert.equal(parseMakeArgs(['--list', 'looks', '--all']).all, true);
  assert.equal(parseMakeArgs(['--list', 'looks']).all, false);
  assert.throws(() => parseMakeArgs(['film.json', '--all']), /--all only goes with --list/);
  const run = make(['--list', 'looks', '--alll']);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /--all/);
});

test('a film in a parked look: one info line on stderr, look { name, experimental } in the report, exit 0, no finding', () => {
  assert.deepEqual(experimentalLook(FILM('cosmos')), { name: 'cosmos', experimental: true });
  assert.equal(experimentalLook(FILM('desk')), null);
  const dir = mkdtempSync(path.join(tmpdir(), 'mm-v2-parked-'));
  try {
    for (const look of ['cosmos', 'desk']) {
      const file = path.join(dir, `${look}.json`);
      writeFileSync(file, JSON.stringify(FILM(look)));
      const run = make([file, '--outline', '--json']);
      assert.equal(run.status, 0, run.stderr);
      const report = JSON.parse(run.stdout);
      assert.deepEqual(report.findings, []);
      const notes = run.stderr.split('\n').filter((l) => /experimental/.test(l));
      if (look === 'cosmos') {
        assert.deepEqual(report.look, { name: 'cosmos', experimental: true });
        assert.equal(notes.length, 1, run.stderr);
        assert.match(notes[0], /^make: look "cosmos" is experimental/);
      } else {
        assert.equal(report.look, undefined, 'a listed look adds nothing');
        assert.equal(notes.length, 0);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
