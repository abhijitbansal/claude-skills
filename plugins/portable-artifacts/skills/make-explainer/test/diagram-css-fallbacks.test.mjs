// An engine without color-mix() drops the whole declaration and keeps the earlier
// one for that property, so each color-mix declaration in the Present overlay's
// stylesheet must follow a plain declaration of the same property.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../template/diagram.css', import.meta.url), 'utf8');

/** Modern declarations with no plain one of the same property directly before them (custom properties skipped). */
export function unguarded(text) {
  const bad = [];
  for (const [, body] of text.matchAll(/\{([^{}]*)\}/g)) {
    const decls = body.split(';').map((d) => d.trim()).filter(Boolean);
    decls.forEach((d, i) => {
      if (!/color-mix\(|context-stroke/.test(d)) return;
      const prop = d.slice(0, d.indexOf(':')).trim();
      if (prop.startsWith('--')) return;
      const prev = decls[i - 1];
      if (!prev || prev.slice(0, prev.indexOf(':')).trim() !== prop || /color-mix\(|context-stroke/.test(prev)) bad.push(d);
    });
  }
  return bad;
}

test('diagram.css: every color-mix declaration follows a plain one for the same property', () => {
  assert.match(css, /color-mix\(/, 'the stylesheet does use color-mix (else this test proves nothing)');
  assert.deepEqual(unguarded(css), []);
});
