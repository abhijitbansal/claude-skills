import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { SECTIONS } from '../scripts/lib/sections.mjs';
import { itemId } from '../scripts/lib/render/checklist.mjs';
import { validateSpec } from '../scripts/lib/spec.mjs';

const sha10 = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 10);
const render = (section) => SECTIONS.checklist.render(section, { dir: process.cwd(), theme: {}, mode: 'page' });
const list = (groups, extra = {}) => ({ type: 'checklist', key: 'k', groups, ...extra });
const group = (title, ...texts) => ({ title, items: texts.map((text) => (typeof text === 'string' ? { text } : text)) });
const ids = (html) => [...html.matchAll(/data-id="([0-9a-f]{10})"/g)].map((m) => m[1]);

test('item id is the first 10 hex of sha256(group title, NUL, item text)', () => {
  assert.equal(itemId('Install', 'Skill installs'), sha10('Install\u0000Skill installs'));
  assert.match(itemId('a', 'b'), /^[0-9a-f]{10}$/);
  assert.notEqual(itemId('a', 'b'), itemId('ab', ''), 'the NUL keeps title and text apart');
  assert.notEqual(itemId('a', 'b'), itemId('b', 'a'));
});

test('every item renders one checkbox carrying its id, in order', () => {
  const html = render(list([group('Install', 'one', 'two'), group('Themes', 'three')]));
  assert.deepEqual(ids(html), [itemId('Install', 'one'), itemId('Install', 'two'), itemId('Themes', 'three')]);
  assert.equal((html.match(/<input type="checkbox"/g) ?? []).length, 3);
  assert.match(html, /data-checklist data-key="k" data-total="3"/);
});

test('reordering items or groups keeps every id; editing one item changes only its own', () => {
  const a = ids(render(list([group('G1', 'x', 'y'), group('G2', 'z')])));
  const reordered = ids(render(list([group('G2', 'z'), group('G1', 'y', 'x')])));
  assert.deepEqual([...reordered].sort(), [...a].sort());
  const edited = ids(render(list([group('G1', 'x', 'y edited'), group('G2', 'z')])));
  assert.equal(edited.filter((id) => a.includes(id)).length, 2);
  assert.ok(!edited.includes(itemId('G1', 'y')));
  const moved = ids(render(list([group('G1', 'x', 'y'), group('G2 renamed', 'z')])));
  assert.equal(moved.filter((id) => a.includes(id)).length, 2, 'renaming a group resets its items, nothing else');
});

test('each group shows its own tally and starts at 0 / n', () => {
  const html = render(list([group('Install', 'one', 'two'), group('Themes', 'three')]));
  assert.equal((html.match(/<span class="cl-tally"><span data-group-done>0<\/span> \/ 2/g) ?? []).length, 1);
  assert.equal((html.match(/<span class="cl-tally"><span data-group-done>0<\/span> \/ 1/g) ?? []).length, 1);
  assert.match(html, /<span data-done>0<\/span> \/ 3/);
});

test('tags render as labelled chips with a glyph and a word; no tag, no chip', () => {
  const html = render(list([group('G', { text: 'a', tag: 'regression' }, { text: 'b', tag: 'device' }, { text: 'c', tag: 'manual' }, { text: 'd', tag: 'visual' }, 'e')]));
  for (const label of ['Regression', 'Device', 'Manual', 'Visual']) assert.match(html, new RegExp(`<span class="chip[^"]*">\\s*<svg[^>]*>.*?</svg><span>${label}</span></span>`, 's'));
  assert.match(html, /<span class="chip tone-warn">[^]*?<span>Regression<\/span>/);
  assert.equal((html.match(/cl-item-chip/g) ?? []).length, 4);
});

test('item text takes inline markdown-lite and notes sit under the text', () => {
  const html = render(list([group('G', { text: 'Run `npx skills add` and **check** it', note: 'on a *fresh* machine' })]));
  assert.match(html, /Run <code>npx skills add<\/code> and <strong>check<\/strong> it/);
  assert.match(html, /<span class="cl-note">on a <em>fresh<\/em> machine<\/span>/);
});

test('the context block renders only with an intro, open by default and headed "What\'s in this branch"', () => {
  assert.ok(!render(list([group('G', 'a')])).includes('cl-context'));
  const html = render(list([group('G', 'a')], { intro: 'Covers **two** features.\n\n- one\n- two' }));
  assert.match(html, /<details class="det cl-context" open>\s*<summary>What&#39;s in this branch<\/summary>/);
  assert.match(html, /Covers <strong>two<\/strong> features\./);
  assert.match(html, /<ul>\s*<li>one<\/li>/);
});

test('the failure footer defaults to a three-step list and onFail replaces it', () => {
  const def = render(list([group('G', 'a')]));
  assert.match(def, /<h3 class="cl-fail-title">If something fails<\/h3>/);
  assert.match(def, /<li>Leave the box unticked\.<\/li>/);
  const custom = render(list([group('G', 'a')], { onFail: 'Ping **the owner** at [the tracker](https://example.com/t).' }));
  assert.match(custom, /If something fails/);
  assert.match(custom, /Ping <strong>the owner<\/strong> at <a href="https:\/\/example.com\/t" rel="noopener noreferrer">the tracker<\/a>\./);
  assert.ok(!custom.includes('Leave the box unticked'));
});

test('the bar has a progressbar, a reset button that starts aria-disabled, a hidden confirm and a hidden unsaved chip', () => {
  const html = render(list([group('G', 'a', 'b')]));
  assert.match(html, /role="progressbar" aria-label="Checklist progress" aria-valuemin="0" aria-valuemax="2" aria-valuenow="0"/);
  assert.match(html, /<button type="button" class="btn cl-reset" data-reset aria-disabled="true">Reset<\/button>/);
  assert.match(html, /<div class="cl-confirm" data-confirm hidden>/);
  assert.match(html, /<span class="cl-flag" data-unsaved hidden><span class="chip tone-neutral">[^]*?<span>Progress won&#39;t be saved in this browser<\/span><\/span><\/span>/);
  assert.match(html, /<button type="button" class="btn" data-reset-yes>Yes, reset<\/button>/);
  assert.match(html, /<button type="button" class="btn" data-reset-no>No<\/button>/);
});

// ---- validation -----------------------------------------------------------------------------

const errorsOf = async (spec) => (await validateSpec({ title: 'T', sections: [spec] })).errors;

test('the same item text twice in one group is an error naming both places', async () => {
  const errors = await errorsOf(list([group('Install', 'Skill installs', 'Other', 'Skill installs')]));
  assert.deepEqual(errors, [{
    path: 'sections[0].groups[0].items[2].text',
    message: 'duplicate item "Skill installs" in group "Install"; first at sections[0].groups[0].items[0].text; reword one so their ticks stay apart',
  }]);
});

test('two groups with the same title count as one group, so a repeated item is a collision', async () => {
  const errors = await errorsOf(list([group('Same', 'a'), group('Same', 'a')]));
  assert.equal(errors.length, 1);
  assert.equal(errors[0].path, 'sections[0].groups[1].items[0].text');
});

test('the same item text in different groups, and the same text in two checklists, is fine', async () => {
  assert.deepEqual(await errorsOf(list([group('One', 'a'), group('Two', 'a')])), []);
  const spec = { title: 'T', sections: [list([group('G', 'a')]), { ...list([group('G', 'a')]), key: 'other' }] };
  assert.equal((await validateSpec(spec)).ok, true);
});
