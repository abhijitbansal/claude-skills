// Shared helpers for the page and build tests: temp scene folders and a pinned build clock.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const FIXTURES = new URL('../fixtures/', import.meta.url);
export const PINNED_ENV = { SOURCE_DATE_EPOCH: '1792368000' }; // 2026-10-19

const ROWS = [
  { group: 'api', t: '2026-W30', value: 12, label: 'api W30' },
  { group: 'web', t: '2026-W30', value: 5 },
  { group: 'api', t: '2026-W31', value: 7 },
  { group: 'web', t: '2026-W31', value: 9 },
];

/** A fresh temp folder; `cleanup` registers removal with the test. */
export function tempDir(t, prefix = 'scene-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Writes scene.json (+ rows.json from the fixtures when the spec reads it) into a fresh folder; returns the spec path. */
export function writeScene(t, spec, { rows = ROWS, links = [], name = 'scene.json' } = {}) {
  const dir = tempDir(t);
  fs.writeFileSync(path.join(dir, 'rows.json'), JSON.stringify({ rows, links }));
  const file = path.join(dir, name);
  fs.writeFileSync(file, `${JSON.stringify(spec, null, 2)}\n`);
  return file;
}

/** The city fixture as an object with its data inlined, so a test needs no folder. */
export function citySpec(overrides = {}) {
  const spec = JSON.parse(fs.readFileSync(new URL('city.scene.json', FIXTURES), 'utf8'));
  return { ...spec, data: { rows: ROWS }, ...overrides };
}

export { ROWS };
