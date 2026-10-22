import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normalisedBody, emptySiblingSvgs } from './helpers/golden.mjs';

// One golden per preset: the normalised body markup of its reference example.
// Baselines change only on purpose: UPDATE_GOLDEN=1 node --test test/golden.test.mjs
// after reading the diff, and say in the commit why the markup moved.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BUILD = path.join(ROOT, 'scripts/build.mjs');
const PRESETS = ['recap', 'checklist', 'concept', 'slides', 'plan'];

for (const preset of PRESETS) {
  test(`golden: body markup of the ${preset} example is unchanged`, () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-golden-')));
    try {
      const out = path.join(dir, `${preset}.html`);
      const spec = path.join(ROOT, `references/examples/${preset}.explainer.json`);
      const r = spawnSync(process.execPath, [BUILD, spec, '--out', out], { encoding: 'utf8', env: { ...process.env, EVAL_LOG: '', PA_OUTPUT_DIR: '', SOURCE_DATE_EPOCH: '1792000000' } }); // pinned: the footer carries the build date
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const actual = normalisedBody(fs.readFileSync(out, 'utf8'));
      const golden = path.join(ROOT, `test/golden/${preset}.body.html`);
      if (process.env.UPDATE_GOLDEN === '1') fs.writeFileSync(golden, actual);
      assert.ok(fs.existsSync(golden), 'no golden file; create it with UPDATE_GOLDEN=1 after reviewing the output');
      assert.equal(actual, fs.readFileSync(golden, 'utf8'));
      if (preset === 'recap') assert.ok(fs.statSync(out).size <= 600 * 1024, 'a recap with one diagram and one chart stays within 600 KB');
      assert.ok(actual.includes(`class="sec`) || actual.includes('slide'), 'the golden holds real section markup');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

test('normalisation empties sibling svgs (nested ones too), keeps wrappers and the explainer\'s own glyphs', () => {
  const html = '<figure class="dg"><svg class="pa-diagram" viewBox="0 0 1 1"><svg class="icon"><path d="M0"/></svg><rect fill="#2a78d6"/></svg></figure>'
    + '<span><svg class="gl" viewBox="0 0 16 16"><path d="M1"/></svg></span><div class="ch-svg"><svg width="600"><g/></svg></div>';
  assert.equal(
    emptySiblingSvgs(html),
    '<figure class="dg"><svg data-sibling-svg></svg></figure><span><svg class="gl" viewBox="0 0 16 16"><path d="M1"/></svg></span><div class="ch-svg"><svg data-sibling-svg></svg></div>',
  );
});
