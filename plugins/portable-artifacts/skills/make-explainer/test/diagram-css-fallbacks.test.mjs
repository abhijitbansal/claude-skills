// color-mix() wraps var() here, so an engine without it still accepts the declaration at
// parse time, fails it at computed-value time and draws the initial value; an earlier plain
// declaration cannot rescue it. Each color-mix declaration in the Present overlay's stylesheet
// therefore lives inside @supports (color: color-mix(...)), which such an engine skips whole.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../template/diagram.css', import.meta.url), 'utf8');

/** `text` without its `@supports (color: color-mix(...)) {...}` blocks (brace-matched). */
function withoutMixBlocks(text) {
  let out = '';
  let from = 0;
  for (const m of text.matchAll(/@supports\s*\(\s*color\s*:\s*color-mix\(/g)) {
    if (m.index < from) continue;
    let depth = 0;
    let end = text.indexOf('{', m.index);
    for (; end < text.length; end++) {
      if (text[end] === '{') depth++;
      else if (text[end] === '}' && --depth === 0) break;
    }
    out += text.slice(from, m.index);
    from = end + 1;
  }
  return out + text.slice(from);
}

/** Declarations using color-mix( outside an @supports color-mix block. */
export const unguarded = (text) => withoutMixBlocks(text).split(/[;{}]/).map((d) => d.trim()).filter((d) => /color-mix\(/.test(d));

test('the checker flags an unguarded color-mix and accepts a guarded one', () => {
  assert.equal(unguarded('.a{fill:red;fill:color-mix(in srgb,var(--x) 7%,blue)}').length, 1);
  assert.deepEqual(unguarded('.a{fill:red}@supports (color: color-mix(in srgb, red, red)){.a{fill:color-mix(in srgb,var(--x) 7%,blue)}}'), []);
});

test('diagram.css: every color-mix declaration sits inside @supports (color: color-mix(...))', () => {
  assert.match(css, /color-mix\(/, 'the stylesheet does use color-mix (else this test proves nothing)');
  assert.deepEqual(unguarded(css), []);
});
