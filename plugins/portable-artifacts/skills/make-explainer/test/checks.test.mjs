import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateSpec } from '../scripts/lib/spec.mjs';
import { IMAGE_MAX_BYTES, svgProblem } from '../scripts/lib/image.mjs';

const PNG = fs.readFileSync(new URL('./fixtures/pixel.png', import.meta.url));

function folder(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-checks-'));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  return { dir, done: () => fs.rmSync(dir, { recursive: true }) };
}
const image = (src) => ({ title: 'T', sections: [{ type: 'image', src, alt: 'a picture' }] });
const messages = (r) => r.errors.map((e) => `${e.path}: ${e.message}`).join('\n');

test('a small real png validates', async () => {
  const { dir, done } = folder({ 'a.png': PNG });
  try { assert.equal((await validateSpec(image('a.png'), { dir })).ok, true); } finally { done(); }
});

test('an image over 1.5 MB is rejected with its size and the limit', async () => {
  const { dir, done } = folder({ 'big.png': Buffer.concat([PNG, Buffer.alloc(IMAGE_MAX_BYTES)]) });
  try {
    const r = await validateSpec(image('big.png'), { dir });
    assert.equal(r.ok, false);
    assert.match(messages(r), /sections\[0\]\.src: image is 1\.50 MB; the limit is 1\.5 MB/);
  } finally { done(); }
});

test('an extension that lies about the content is rejected', async () => {
  const { dir, done } = folder({ 'fake.png': '<html>not a png</html>', 'fake.jpg': PNG });
  try {
    assert.match(messages(await validateSpec(image('fake.png'), { dir })), /not a png image/);
    assert.match(messages(await validateSpec(image('fake.jpg'), { dir })), /not a jpeg image/);
  } finally { done(); }
});

const SVG = (inner, attrs = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"${attrs}>${inner}</svg>`;

test('svg: script, handlers, external hrefs, foreignObject and entities are rejected', async () => {
  const bad = {
    'script.svg': SVG('<script>alert(1)</script>'),
    'onload.svg': SVG('<rect width="4" height="4"/>', ' onload="x()"'),
    'onclick.svg': SVG('<rect onclick = "x()" width="4" height="4"/>'),
    'href.svg': SVG('<a href="https://evil.example"><rect width="4" height="4"/></a>'),
    'xlink.svg': SVG('<use xlink:href="data:image/svg+xml;base64,AAAA"/>'),
    'fo.svg': SVG('<foreignObject><div/></foreignObject>'),
    'entity.svg': `<!DOCTYPE svg [<!ENTITY x "y">]>${SVG('<text>&x;</text>')}`,
  };
  const { dir, done } = folder(bad);
  try {
    for (const name of Object.keys(bad)) {
      const r = await validateSpec(image(name), { dir });
      assert.equal(r.ok, false, `${name} must be rejected`);
      assert.match(messages(r), /svg is not safe to inline/, name);
    }
  } finally { done(); }
});

test('svg: a clean file with a #fragment href and text that mentions onclick passes', async () => {
  const good = SVG('<defs><path id="p" d="M0 0L4 4"/></defs><use href="#p"/><text>onclick = nothing</text>');
  assert.equal(svgProblem(good), null);
  const { dir, done } = folder({ 'ok.svg': good });
  try { assert.equal((await validateSpec(image('ok.svg'), { dir })).ok, true); } finally { done(); }
});

const cards = (icon) => ({ title: 'T', sections: [{ type: 'cards', items: [{ title: 'A', text: 'b', icon }] }] });

test('cards: a catalog icon validates, an unknown one gets did-you-mean, a bare name a prefix hint', async () => {
  assert.equal((await validateSpec(cards('lucide:palette'))).ok, true);
  const typo = messages(await validateSpec(cards('lucide:palete')));
  assert.match(typo, /sections\[0\]\.items\[0\]\.icon: unknown icon "lucide:palete"; did you mean "lucide:palette"\?/);
  assert.match(messages(await validateSpec(cards('palette'))), /needs a "lucide:" or "brand:" prefix/);
});

test('cards without icons never load the sibling', async () => {
  const r = await validateSpec({ title: 'T', sections: [{ type: 'cards', items: [{ title: 'A', text: 'b' }] }] });
  assert.equal(r.ok, true);
});
