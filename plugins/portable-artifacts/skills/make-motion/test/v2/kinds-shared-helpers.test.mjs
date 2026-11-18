// Helpers more than one kind uses live once, in engine/kinds/shared.mjs: the desk highlighter behind emphasised runs
// (statement, quote) and the plain tag at a chosen scale step (number, quote). Each kind imports them; none keeps a copy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as shared from '../../engine/kinds/shared.mjs';
import * as highlighter from '../../engine/kinds/highlighter.mjs';
import * as plainTagModule from '../../engine/kinds/plain-tag.mjs';
import * as camera from '../../engine/kinds/camera.mjs';
import '../../engine/kinds/index.mjs';
import { expandShot, textNode, all } from './helpers/kinds.mjs';

const kindsDir = fileURLToPath(new URL('../../engine/kinds/', import.meta.url));
const source = (name) => readFileSync(`${kindsDir}${name}`, 'utf8');

test('the shared modules export the highlight helpers (highlighter.mjs), the plain tag (plain-tag.mjs) and the camera (camera.mjs)', () => {
  for (const name of ['highlightBands', 'highlightLines']) assert.equal(typeof highlighter[name], 'function', name);
  assert.equal(typeof plainTagModule.plainTag, 'function', 'plainTag');
  for (const name of ['defaultCamera', 'driftReach', 'pushLayer', 'cutEnd', 'regionFloor', 'withEstablishingView']) assert.equal(typeof camera[name], 'function', name);
  for (const name of ['highlightBands', 'plainTag', 'pushLayer']) assert.equal(shared[name], undefined, `${name} is no longer in shared.mjs`);
});

test('no kind keeps its own copy: statement, number and quote import the shared helpers', () => {
  assert.ok(!/function (emphasisRuns|bandBox|highlightLines|highlights)\b/.test(source('statement.mjs')), 'statement');
  assert.ok(!/function plainTag\b/.test(source('number.mjs')), 'number');
  assert.ok(!/function attributionTag\b/.test(source('quote-pop.mjs')), 'quote-pop');
  assert.ok(!existsSync(`${kindsDir}quote-emphasis.mjs`), 'quote-emphasis.mjs is gone');
});

test('the shared plain tag is the one number draws: a label tag at step 3 with its plate behind label caps', () => {
  const { nodes } = expandShot({ id: 'n', show: 'number', say: 'Revenue grew to 1,200.', value: 1200, label: 'Revenue' }, 'pop', '9:16');
  const label = textNode(nodes, 'n.label.text');
  assert.equal(label.props.role, 'tag');
  assert.ok(nodes.some((n) => n.id === 'n.label'), 'the tag group');
});

test('a snapped plain tag (the pop quote attribution) takes a scale step, never a size between two; the number label tag scales to fit', () => {
  const quote = expandShot({ id: 'q', show: 'quote', say: 'Every chart should show its work.', by: 'The data desk', role: 'House rule' }, 'pop', '9:16');
  const tag = textNode(quote.nodes, 'q.by.text');
  const steps = quote.ctx.look.scale.map((s) => s * quote.ctx.unit);
  assert.ok(steps.includes(tag.props.font.size), `the attribution at ${tag.props.font.size}, a step of ${steps}`);
});

// Each kind's own files: its module and the ones named after it (clipping also owns its close-ups and region marks).
const KIND_FILES = Object.freeze({
  free: [], statement: [], number: [], end: [], list: [], quote: [], compare: [], chart: [], clipping: [], media: [], screen: [], map: [],
  diagram: [], timeline: [], code: [], feed: [],
});
// editorial.mjs: the editorial family's columns and bounds, canvas or 9:16 safe zone (its own module: see its header)
// camera.mjs, highlighter.mjs, plain-tag.mjs: split out of shared.mjs by responsibility (review B M21); values.mjs: the
// value limit and the shown-as-zero rule number, compare and chart share (review B I4); arrivals.mjs: the reveal timing
// the second-wave kinds share (media, screen); close-ups.mjs, region-mark.mjs, clipping-rules.mjs: the region arithmetic
// and the cut to a close-up, clipping's first and now screen's too (plan 2026-11-16-pa2-shot-kinds-b Task 4: reused,
// not copied); emphasis.mjs and emphasis-flags.mjs: the emphasis styles as a table, read by statement and the caption
// styles (looks-four Task 1); stack-turn.mjs: the turned stack, part of stack.mjs's composition (statement and list,
// looks-four Task 7 round three); strike.mjs: the beat bar under a hero on a spoken word, chart, code, diagram and compare
// (gate-poster-2 ruling 3: one builder, the stack's beat bar)
const SHARED_MODULES = Object.freeze(['shared.mjs', 'stack.mjs', 'stack-turn.mjs','slug.mjs', 'words.mjs', 'editorial.mjs', 'secondary.mjs', 'camera.mjs', 'highlighter.mjs', 'plain-tag.mjs', 'values.mjs', 'arrivals.mjs', 'close-ups.mjs', 'region-mark.mjs', 'clipping-rules.mjs', 'emphasis.mjs', 'emphasis-flags.mjs', 'emphasis-fallback.mjs', 'strike.mjs', 'underline.mjs']);

test('no kind imports another kind\'s file: what several kinds use lives in the shared modules (shared, stack, slug, words, editorial, secondary, camera, highlighter, plain-tag, values, arrivals, close-ups, region-mark, clipping-rules)', async () => {
  const { readdirSync } = await import('node:fs');
  const files = readdirSync(kindsDir).filter((f) => f.endsWith('.mjs') && f !== 'index.mjs' && !SHARED_MODULES.includes(f));
  const owner = (file) => Object.keys(KIND_FILES).find((kind) => file === `${kind}.mjs` || file.startsWith(`${kind}-`) || KIND_FILES[kind].includes(file));
  for (const file of files) {
    const kind = owner(file);
    assert.ok(kind, `${file} belongs to a kind`);
    const imports = [...source(file).matchAll(/from '\.\/([^']+)'/g)].map((m) => m[1]);
    for (const target of imports) {
      assert.ok(SHARED_MODULES.includes(target) || owner(target) === kind, `${file} (${kind}) imports ${target}, another kind's file`);
    }
  }
});

// ---- fix round 1: blank text ----

// Every string property of a schema that is author text (not a picture path, not an enum, not an id), with its path.
function textFields(schema, at = '') {
  if (!schema || typeof schema !== 'object') return [];
  if (schema.type === 'string' && schema.enum === undefined && !/src/.test(at) && !['hero', 'background'].includes(at)) return [[at, schema]];
  const own = Object.entries(schema.properties ?? {}).flatMap(([k, s]) => textFields(s, at ? `${at}.${k}` : k));
  const items = schema.items ? textFields(schema.items, `${at}[]`) : [];
  const any = (schema.anyOf ?? []).flatMap((s) => textFields(s, at));
  // the shapes a schema picks by a condition (the chart's data by its type: allOf of if / then / else)
  const picked = [...(schema.allOf ?? []), ...[schema.then, schema.else].filter(Boolean)].flatMap((s) => textFields(s, at));
  return [...own, ...items, ...any, ...picked];
}

test('every text field of every kind refuses a blank string: its schema says not blank', async () => {
  const { registries } = await import('../../engine/registry.mjs');
  const { NOT_BLANK, HERO_SCHEMA } = await import('../../engine/kinds/shared.mjs');
  assert.equal(typeof NOT_BLANK, 'string', 'shared.mjs names the not-blank pattern');
  let fields = 0;
  // an id (a diagram node's id, the node a highlight names) takes the id pattern, which refuses a blank string too
  const refusesBlank = (s) => s.pattern === NOT_BLANK || s.pattern === HERO_SCHEMA.pattern;
  for (const name of registries.kinds.names()) {
    for (const [at, s] of textFields(registries.kinds.get(name).schema)) { fields += 1; assert.ok(refusesBlank(s), `${name}.${at}: pattern ${s.pattern}`); }
  }
  assert.ok(fields > 30, `the walk finds the text fields (${fields})`);
  const chartFields = textFields(registries.kinds.get('chart').schema).map(([at]) => at);
  for (const at of ['data[].label', 'data[].x', 'data.series[].name']) assert.ok(chartFields.includes(at), `the walk reaches the chart's ${at} (${chartFields})`);
});

test('a blank text is a validation error in the usual <json.path>: <message> form', async () => {
  const { validateFilm } = await import('../../scripts/v2/spec.mjs');
  const cases = [
    [{ id: 'e', show: 'end', title: 'Make it', ask: '   ' }, 'shots[0].ask'],
    [{ id: 'l', show: 'list', items: ['One', ' ', 'Three'] }, 'shots[0].items[1]'],
    [{ id: 'q', show: 'quote', text: 'Ship it', by: ' ' }, 'shots[0].by'],
    [{ id: 'c', show: 'compare', left: { title: '  ' }, right: { title: 'B' } }, 'shots[0].left.title'],
  ];
  for (const [shot, at] of cases) {
    const { errors } = validateFilm({ version: 2, mode: 'pro', shots: [shot] }, { specDir: '/' });
    assert.ok(errors.some((e) => e.path === at && /blank/.test(e.message)), `${at}: ${JSON.stringify(errors)}`);
  }
});

test('expand never throws a TypeError on blank text: it names the field instead', () => {
  for (const [shot, field] of [
    [{ id: 'e', show: 'end', title: 'Make it', ask: '  ', mark: 'M' }, 'ask'],
    [{ id: 'e', show: 'end', title: 'Make it', mark: ' ' }, 'mark'],
    [{ id: 'l', show: 'list', items: ['One', { text: 'Two', note: ' ' }] }, 'items[1].note'],
    [{ id: 'q', show: 'quote', text: 'Ship it', by: ' ' }, 'by'],
    [{ id: 'c', show: 'compare', left: { title: ' ' }, right: { title: 'B' } }, 'left.title'],
  ]) {
    for (const look of ['desk', 'pop']) {
      assert.throws(() => expandShot(shot, look, '16:9'), (err) => !(err instanceof TypeError) && err.message.includes(field), `${look} ${field}`);
    }
  }
});

// ---- fix round 1: minors ----

test('M12-M14 nodeField: an object item points at its text, a pop side tag is not author text, the end mark points at mark', async () => {
  const { registries } = await import('../../engine/registry.mjs');
  const list = { id: 'l', show: 'list', items: ['One', { text: 'Two', note: 'n' }] };
  assert.equal(registries.kinds.get('list').nodeField(list, 'l.item1'), 'items[1].text');
  assert.equal(registries.kinds.get('list').nodeField(list, 'l.item0'), 'items[0]');
  const compare = { id: 'c', show: 'compare', left: { title: 'A' }, right: { title: 'B' } };
  assert.equal(registries.kinds.get('compare').nodeField(compare, 'c.left.kicker.text'), null);
  const end = { id: 'e', show: 'end', title: 'Go', mark: 'M' };
  assert.equal(registries.kinds.get('end').nodeField(end, 'e.mark.text'), 'mark');
  assert.equal(registries.kinds.get('end').nodeField(end, 'e.kicker.text'), 'mark');
});

test('M18 a compare number too small to show at three decimals is refused, not shown as 0', async () => {
  const { validateFilm } = await import('../../scripts/v2/spec.mjs');
  const { errors } = validateFilm({ version: 2, mode: 'pro', shots: [{ id: 'c', show: 'compare', left: { title: 'A', value: 0.0004 }, right: { title: 'B', value: 1 } }] }, { specDir: '/' });
  assert.ok(errors.some((e) => e.path === 'shots[0].left.value' && /0\.000/.test(e.message)), JSON.stringify(errors));
});

test('M19 desk list figures are the item numbers as written: 1 to 12, never 01', () => {
  const items = Array.from({ length: 10 }, (_, i) => `Item ${i + 1}`);
  const figures = all(expandShot({ id: 'l', show: 'list', hold: 6, numbered: true, items }, 'desk', '16:9').nodes).filter((n) => /^l\.figure\d+$/.test(n.id));
  assert.equal(figures[0].props.layout.lines[0].words.map((w) => w.text).join(''), '1');
});

test('M22 an end logo is at most a sixth of the short side: a small picture is never enlarged', async () => {
  const { fitLongestSide } = await import('../../engine/kinds/shared.mjs');
  const { pictureSize } = await import('../../engine/kinds/end.mjs');
  assert.deepEqual(pictureSize({ width: 100, height: 50 }, { w: 1920, h: 1080 }), { w: 100, h: 50 }, 'a small logo keeps its size');
  assert.deepEqual(pictureSize({ width: 1600, height: 800 }, { w: 1920, h: 1080 }), fitLongestSide({ width: 1600, height: 800 }, 180));
});
