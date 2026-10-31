// Task 9: blocks. A block is a parameterised macro (`lower-third: name, role`) that expands, before anything else
// sees the spec, into a `group` of plain elements laid out for the canvas size the spec resolves to.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BLOCKS, BLOCK_NAMES, expandBlocks, paramOfPart } from '../template/blocks/index.mjs';
import { ENTER_SECONDS, STAGGER_SECONDS, LAST_MOTION_SHARE } from '../template/blocks/layout.mjs';
import { canvasSize, safeMargin, captionZone, FORMATS, FORMAT_NAMES } from '../template/formats.mjs';
import { flattenElements } from '../template/groups.mjs';
import { validateSpec, withDefaults, loadSpec } from '../scripts/lib/spec.mjs';
import { startServer } from '../scripts/lib/server.mjs';
import { launchBrowser } from '../scripts/lib/browser.mjs';
import { waitReady } from '../scripts/check.mjs';
import { probed } from './render-probe.mjs';
import { requireRender, BROWSER_ONLY, assertRendersIdentically } from './helpers/render.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = path.join(root, 'scripts/check.mjs');
const CLI = path.join(root, 'scripts/blocks.mjs');
const EXAMPLES = path.join(root, 'references/examples/blocks');
const GOLDEN = path.join(root, 'references/blocks');
const names = Object.keys(BLOCKS);
const TOKENS = ['surface', 'line', 'accent', 'text', 'text2', 'good'];
const EPSILON = 1e-9;

const block = (name, params, extra = {}) => ({ id: 'b', type: 'block', x: 960, y: 540, block: name, params, ...extra });
const oneScene = (elements, extra = {}, duration = 6) => ({ ...extra, scenes: [{ id: 's', duration, elements }] });
// Validated in the examples folder, so logo-outro's `src` (logo.svg) resolves.
const errs = (motion) => validateSpec(motion, { dir: EXAMPLES }).errors.map((e) => `${e.path}: ${e.message}`);
const partsOf = (spec) => flattenElements(spec.scenes[0].elements).map(({ el }) => el).filter((el) => el.type !== 'group');
const keyframesOf = (spec) => flattenElements(spec.scenes[0].elements).flatMap(({ el }) => el.keyframes ?? []);

// ---- params that push every limit: the longest strings, the most items, every enum value ------------------------------

const PROSE = 'Every release ships faster when the builds stay local and the checks run before review starts';
const prose = (n) => PROSE.repeat(Math.ceil(n / PROSE.length) + 1).slice(0, n).trimEnd();
function value(schema, pick) {
  if (schema.enum) return pick === 'first' ? schema.enum[0] : schema.enum.at(-1);
  switch (schema.type) {
    case 'string': return pick === 'small' ? 'Go' : prose(schema.maxLength);
    case 'number': case 'integer': return pick === 'small' ? (schema.minimum ?? 0) : (schema.maximum ?? 987654321);
    case 'boolean': return pick !== 'small';
    case 'array': return Array.from({ length: pick === 'small' ? schema.minItems : schema.maxItems }, () => value(schema.items, pick));
    default: throw new Error(`no test value for ${JSON.stringify(schema)}`);
  }
}
// `assets` params (logo-outro's src) keep the example's file, which exists in the examples folder.
function extremes(name) {
  const { params, example, assets = [] } = BLOCKS[name];
  const make = (pick) => Object.fromEntries(Object.entries(params.properties)
    .filter(([key]) => pick !== 'small' || params.required.includes(key))
    .map(([key, schema]) => [key, assets.includes(key) ? example[key] : value(schema, pick)]));
  return { example, first: make('first'), last: make('last'), small: make('small') };
}

// ---- the table: every block -------------------------------------------------------------------------------------------

for (const name of names) {
  const example = path.join(EXAMPLES, `${name}.json`);

  test(`${name}: example params validate, expand, and the expanded spec is valid`, () => {
    const motion = oneScene([block(name, BLOCKS[name].example)]);
    assert.deepEqual(errs(motion), []);
    const expanded = expandBlocks(motion);
    const [group] = expanded.scenes[0].elements;
    assert.equal(group.type, 'group');
    assert.equal(group.id, 'b');
    assert.deepEqual([group.x, group.y], [960, 540]);
    assert.ok(partsOf(expanded).every((el) => el.id.startsWith('b/')), 'every part id is <blockId>/<part>');
    assert.deepEqual(errs(expanded), []);
  });

  test(`${name}: references/examples/blocks/${name}.json is valid and references/blocks/${name}.png exists`, () => {
    const { spec, dir } = loadSpec(example);
    assert.deepEqual(validateSpec(spec, { dir }).errors, []);
    assert.ok(spec.scenes.some((s) => s.elements.some((el) => el.type === 'block' && el.block === name)), `the example uses ${name}`);
    assert.ok(existsSync(path.join(GOLDEN, `${name}.png`)), `references/blocks/${name}.png exists`);
  });

  test(`${name}: renders byte-identical twice`, async (t) => {
    if (!(await requireRender(t))) return;
    await assertRendersIdentically(t, example, ['--fps', '10', '--size', '320x180']);
  });

  test(`${name}: passes check.mjs`, async (t) => {
    if (!(await requireRender(t, BROWSER_ONLY))) return;
    const r = spawnSync(process.execPath, [CHECK, example], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^check: ok \(\d+ scenes?, \d+ moments\)\n$/);
    // A block's parts enter from opacity 0, so a block alone in scene 1 leaves frame 0 blank: that warning (and no
    // other) is expected. The examples keep a plain background so the golden sheet shows the block alone.
    for (const line of r.stderr.split('\n').filter(Boolean)) assert.match(line, /^warning: scenes\[0\]: scene "[^"]+" shows nothing at 0\.00s/);
  });

  test(`${name}: valid params never produce an error (example, largest and smallest params; 16:9, 9:16, 1:1, 320x180, 16x16; scenes of 0.2, 1 and 6 s)`, () => {
    const canvases = [{ format: '16:9' }, { format: '9:16' }, { format: '1:1' }, { size: [320, 180] }, { size: [16, 16] }];
    for (const [variant, params] of Object.entries(extremes(name))) {
      for (const canvas of canvases) {
        for (const duration of [0.2, 1, 6]) {
          const motion = oneScene([block(name, params)], canvas, duration);
          const where = `${variant} params, ${JSON.stringify(canvas)}, ${duration} s`;
          assert.deepEqual(errs(motion), [], where);
          for (const kf of keyframesOf(expandBlocks(motion))) {
            assert.ok(kf.t >= 0 && kf.t <= LAST_MOTION_SHARE * duration + EPSILON, `${where}: keyframe at ${kf.t} s is after 85 % of the scene`);
          }
        }
      }
    }
  });

  test(`${name}: colours are theme tokens; entrances use enter over 0.6 s, staggered at least 0.2 s`, () => {
    const parts = partsOf(expandBlocks(oneScene([block(name, BLOCKS[name].example)])));
    for (const el of parts) {
      for (const key of ['color', 'fill', 'stroke']) {
        if (el[key] !== undefined) assert.ok(TOKENS.includes(el[key]), `${el.id}.${key} is ${el[key]}, not a theme token`);
      }
    }
    const starts = [];
    for (const el of parts) {
      const kfs = el.keyframes ?? [];
      const from = kfs.findIndex((kf) => kf.opacity === 0);
      if (from < 0) continue;
      const to = kfs.slice(from + 1).find((kf) => kf.opacity !== undefined);
      assert.equal(to.opacity, 1, `${el.id} enters to opacity 1`);
      assert.equal(to.ease, 'enter', `${el.id} enters with the enter ease`);
      assert.ok(Math.abs(to.t - kfs[from].t - ENTER_SECONDS) < EPSILON, `${el.id} enters over ${ENTER_SECONDS} s`);
      starts.push(kfs[from].t);
    }
    assert.ok(starts.length >= 2, 'at least two parts enter');
    const distinct = [...new Set(starts)].sort((a, b) => a - b);
    assert.equal(distinct[0], 0, 'the first part enters at the scene start');
    distinct.slice(1).forEach((s, i) => assert.ok(s - distinct[i] >= STAGGER_SECONDS - EPSILON, `entrances ${distinct[i]} and ${s} are under ${STAGGER_SECONDS} s apart`));
  });
}

// ---- expansion ---------------------------------------------------------------------------------------------------------

test('expandBlocks leaves a spec without blocks deepEqual, and never mutates its input', () => {
  const plain = oneScene([{ id: 't', type: 'text', text: 'hi', x: 1, y: 2 }, { id: 'g', type: 'group', x: 0, y: 0, children: [{ id: 'c', type: 'text', text: 'c', x: 0, y: 0 }] }], { size: [640, 360] });
  const copy = structuredClone(plain);
  const out = expandBlocks(plain);
  assert.deepEqual(out, copy);
  assert.notEqual(out, plain, 'a copy, not the same object');
  const withBlock = oneScene([block('kpi-counter', BLOCKS['kpi-counter'].example)]);
  const before = structuredClone(withBlock);
  expandBlocks(withBlock);
  assert.deepEqual(withBlock, before, 'the input is not mutated');
});

test('the block pose and keyframes go on the group; the parts are named <blockId>/<part>', () => {
  const kf = [{ t: 0, x: 900 }, { t: 1, x: 960, ease: 'move' }];
  const [group] = expandBlocks(oneScene([block('kpi-counter', { label: 'Users', to: 5 }, { id: 'kpi', opacity: 0.9, scale: 1.1, rotate: 2, keyframes: kf })])).scenes[0].elements;
  assert.deepEqual([group.opacity, group.scale, group.rotate, group.keyframes], [0.9, 1.1, 2, kf]);
  assert.ok(group.children.some((el) => el.id === 'kpi/label'));
  const steps = expandBlocks(oneScene([block('step-flow', { steps: ['Plan', 'Build', 'Ship'] }, { id: 'steps' })]));
  assert.ok(partsOf(steps).some((el) => el.id === 'steps/box-2'));
});

test('R3: a block lays out for the size its format resolves to, so a 9:16 spec gets a 1080x1920 layout', () => {
  assert.deepEqual(canvasSize({ format: '9:16' }), [1080, 1920]);
  assert.deepEqual(canvasSize({ size: [640, 360] }), [640, 360]);
  assert.deepEqual(canvasSize({}), [1920, 1080]);
  const params = { title: 'A title long enough to need the full width of the canvas to sit on two lines' };
  const wide = partsOf(expandBlocks(oneScene([block('title-card', params)])));
  const tall = partsOf(expandBlocks(oneScene([block('title-card', params, { x: 540, y: 960 })], { format: '9:16' })));
  const width = (parts) => parts.find((el) => el.id === 'b/title').maxWidth;
  assert.ok(width(tall) <= 1080 - 2 * safeMargin([1080, 1920]), `9:16 title fits 1080 wide (maxWidth ${width(tall)})`);
  assert.ok(width(wide) > width(tall), '16:9 title is laid out wider than the 9:16 one');
  // withDefaults runs the steps in order: the block expands for 1080x1920 before applyFormat writes that size.
  const defaulted = withDefaults(oneScene([block('title-card', params, { x: 540, y: 960 })], { format: '9:16' }));
  assert.deepEqual(defaulted.size, [1080, 1920]);
  assert.equal(width(partsOf(defaulted)), width(tall));
  // step-flow picks a column on a tall canvas and a row on a wide one.
  const steps = { steps: ['Plan', 'Build', 'Ship'] };
  const box = (spec, i) => partsOf(spec).find((el) => el.id === `b/box-${i}`);
  const row = expandBlocks(oneScene([block('step-flow', steps)]));
  const column = expandBlocks(oneScene([block('step-flow', steps, { x: 540, y: 960 })], { format: '9:16' }));
  assert.equal(box(row, 1).y, box(row, 2).y, 'a row on 16:9');
  assert.equal(box(column, 1).x, box(column, 2).x, 'a column on 9:16');
});

test('a short scene compresses the schedule so nothing moves after 85 % of it', () => {
  const motion = oneScene([block('checklist', { items: ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'] })], {}, 1.5);
  const last = Math.max(...keyframesOf(expandBlocks(motion)).map((kf) => kf.t));
  assert.ok(last <= 0.85 * 1.5 + EPSILON, `last keyframe at ${last}`);
  assert.ok(last > 0.8 * 1.5, 'the schedule fills the scene up to the 85 % line');
});

test('kpi-counter counts from `from` to `to` after its card enters, and nothing animates after 85 % of the scene', () => {
  const parts = partsOf(expandBlocks(oneScene([block('kpi-counter', { label: 'Revenue', from: 10, to: 42, prefix: '$', suffix: 'M', decimals: 1, delta: '+18% on Q2' }, { id: 'kpi' })], {}, 4)));
  const value = parts.find((el) => el.id === 'kpi/value');
  assert.deepEqual([value.type, value.from, value.to, value.prefix, value.suffix, value.decimals], ['counter', 10, 42, '$', 'M', 1]);
  const track = value.keyframes.filter((kf) => kf.value !== undefined);
  assert.deepEqual(track.map((kf) => kf.value), [10, 42]);
  assert.ok(track[0].t > 0, 'the count starts after the card');
  assert.ok(track[1].t <= 0.85 * 4 + EPSILON);
  assert.equal(parts.find((el) => el.id === 'kpi/delta').color, 'good', 'a rising delta is good');
  const falling = partsOf(expandBlocks(oneScene([block('kpi-counter', { label: 'Errors', to: 3, delta: '-40% on Q2' }, { id: 'kpi' })])));
  assert.equal(falling.find((el) => el.id === 'kpi/delta').color, 'text2', 'a falling delta is not painted good');
});

// ---- validation: errors point at the block's params, never at its expansion ---------------------------------------------

test('validator order: an unknown block names the closest one and lists them all', () => {
  const list = BLOCK_NAMES.join(', ');
  assert.deepEqual(errs(oneScene([block('kpi', { label: 'x', to: 1 })])), [`scenes[0].elements[0].block: unknown block "kpi"; did you mean "kpi-counter"? (blocks: ${list})`]);
  assert.deepEqual(errs(oneScene([block('nope', {})])), [`scenes[0].elements[0].block: unknown block "nope" (blocks: ${list})`]);
});

test('params errors come from the block schema at scenes[i].elements[j].params.<field>', () => {
  const e = errs(oneScene([{ id: 't', type: 'text', text: 'x', x: 1, y: 1 }, block('kpi-counter', { lable: 'Users', to: 'many' })]));
  assert.ok(e.includes('scenes[0].elements[1].params.lable: unknown property; did you mean "label"?'), e.join('\n'));
  assert.ok(e.includes('scenes[0].elements[1].params.to: must be number'), e.join('\n'));
  assert.ok(e.every((line) => line.startsWith('scenes[0].elements[1].params.')), e.join('\n'));
  assert.deepEqual(errs(oneScene([block('lower-third', { name: 'Ada', side: 'top' })])), ['scenes[0].elements[0].params.side: must be one of "left", "right"']);
  assert.deepEqual(errs(oneScene([block('step-flow', { steps: ['one'] })])), ['scenes[0].elements[0].params.steps: must NOT have fewer than 2 items']);
});

test('params caps: a 40-word title, an over-long label (</script> padded past 80 characters) and an empty items list are errors at params.<field>, never at the expansion', () => {
  const words40 = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
  assert.deepEqual(errs(oneScene([block('title-card', { title: words40 })])), ['scenes[0].elements[0].params.title: must NOT have more than 80 characters']);
  const script = `</script><script>alert(1)</script>${'x'.repeat(60)}`;
  assert.deepEqual(errs(oneScene([block('kpi-counter', { label: script, to: 1 })])), ['scenes[0].elements[0].params.label: must NOT have more than 80 characters']);
  assert.deepEqual(errs(oneScene([block('checklist', { items: [] })])), ['scenes[0].elements[0].params.items: must NOT have fewer than 2 items']);
  // A short `</script>` is within the cap: it is text, drawn as text (the page sets textContent; see the probe test).
  assert.deepEqual(errs(oneScene([block('kpi-counter', { label: '</script>', to: 1 })])), []);
});

test('a block element is checked as a block: its own fields, its keyframes, a missing params, a block inside a group', () => {
  assert.deepEqual(errs(oneScene([block('title-card', { title: 'Hi' }, { text: 'no' })])), ['scenes[0].elements[0].text: not valid on block; allowed: id, type, x, y, opacity, scale, rotate, keyframes, block, params']);
  assert.deepEqual(errs(oneScene([{ id: 'b', type: 'block', x: 0, y: 0, block: 'title-card' }])), ['scenes[0].elements[0].params: required for type block']);
  assert.deepEqual(errs(oneScene([block('title-card', { title: 'Hi' }, { keyframes: [{ t: 0, draw: 0 }] })])), ['scenes[0].elements[0].keyframes[0].draw: not animatable on block; animatable: opacity, x, y, scale, rotate']);
  assert.deepEqual(errs(oneScene([block('title-card', { title: 'Hi' }, { keyframes: [{ t: 9, x: 1 }] })])), ['scenes[0].elements[0].keyframes[0].t: 9 exceeds scene duration 6']);
  const nested = { id: 'g', type: 'group', x: 0, y: 0, children: [block('title-card', { title: 'Hi' })] };
  assert.deepEqual(errs(oneScene([nested])), ['scenes[0].elements[0].children[0].type: a block goes directly in a scene\'s elements, not inside a group; move "b" out of group "g"']);
});

test('logo-outro checks its src at params.src, like an image src', () => {
  assert.deepEqual(errs(oneScene([block('logo-outro', { src: 'missing.png' })])), ['scenes[0].elements[0].params.src: file not found: missing.png']);
  assert.deepEqual(errs(oneScene([block('logo-outro', { src: '../x.png' })])), ['scenes[0].elements[0].params.src: must stay inside the spec folder']);
});

test('an id that clashes with a block part is reported at the block, not at the expansion', () => {
  const e = errs(oneScene([{ id: 'kpi/label', type: 'text', text: 'x', x: 960, y: 100 }, block('kpi-counter', { label: 'Users', to: 5 }, { id: 'kpi' })]));
  assert.equal(e.length, 1, e.join('\n'));
  assert.match(e[0], /^scenes\[0\]\.elements\[1\]\.id: /);
  assert.match(e[0], /"kpi\/label"/);
  assert.ok(!e[0].includes('children'), e[0]);
});

// ---- the page and the server see the expansion -------------------------------------------------------------------------

test('the render page draws a block as its parts, and a </script> label as plain text', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const motion = oneScene([block('kpi-counter', { label: '</script>', to: 7 }, { id: 'kpi' })], { size: [1920, 1080] });
  const found = await probed(motion, () => ({
    ids: [...document.querySelectorAll('#stage .el')].map((n) => n.dataset.id),
    label: document.querySelector('.el[data-id="kpi/label"]').textContent,
    scripts: document.querySelectorAll('#stage script').length,
  }));
  assert.deepEqual(found.ids, ['kpi', 'kpi/card', 'kpi/label', 'kpi/value']);
  assert.equal(found.label, '</script>');
  assert.equal(found.scripts, 0);
});

test('/assets serves a file a block names in its params (logo-outro src)', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'block-srv-'));
  writeFileSync(path.join(dir, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>');
  writeFileSync(path.join(dir, 'other.svg'), 'unreferenced');
  const specPath = path.join(dir, 'm.json');
  writeFileSync(specPath, JSON.stringify(oneScene([block('logo-outro', { src: 'logo.svg' })])));
  const srv = await startServer({ specPath, mode: 'preview' });
  try {
    assert.equal((await fetch(new URL('/assets/logo.svg', srv.url))).status, 200);
    assert.equal((await fetch(new URL('/assets/other.svg', srv.url))).status, 404);
  } finally { await srv.close(); }
});

// ---- blocks.mjs --------------------------------------------------------------------------------------------------------

const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

test('blocks.mjs list names every block; show kpi-counter prints the params table; show nope exits 2 with a suggestion', () => {
  const list = cli('list');
  assert.equal(list.status, 0, list.stderr);
  const lines = list.stdout.trim().split('\n');
  assert.deepEqual(lines.map((l) => l.split('  ')[0]), names);
  assert.ok(lines.includes('title-card  params: title, subtitle?, kicker?'), list.stdout);
  for (const l of lines) assert.match(l, /^[a-z-]+ {2}params: [a-zA-Z?, ]+$/);

  const show = cli('show', 'kpi-counter');
  assert.equal(show.status, 0, show.stderr);
  assert.match(show.stdout, /^param +type +required +default +description$/m);
  assert.match(show.stdout, /^label +string≤80 +yes +- +/m);
  assert.match(show.stdout, /^prefix +string≤6 +no +- +/m);
  assert.match(show.stdout, /^decimals +integer 0–4 +no +0 +/m);
  const json = JSON.parse(show.stdout.slice(show.stdout.indexOf('{')));
  assert.deepEqual(json.params, BLOCKS['kpi-counter'].example);
  assert.equal(json.block, 'kpi-counter');

  const nope = cli('show', 'nope');
  assert.equal(nope.status, 2);
  assert.equal(nope.stderr, `unknown block "nope" (blocks: ${BLOCK_NAMES.join(', ')})\n`);
  const kpi = cli('show', 'kpi');
  assert.equal(kpi.status, 2);
  assert.match(kpi.stderr, /^unknown block "kpi"; did you mean "kpi-counter"\? \(blocks: /);
  assert.equal(cli().status, 2);
  assert.equal(cli('lsit').status, 2);
});

// ---- fix round 1 -----------------------------------------------------------------------------------------------------

// The canvas extent [top, bottom] of every rect and ellipse part (cards, rows, boxes: the containers the texts sit in),
// with the block's group at (x, y).
const shapeBoxes = (spec, x, y) => partsOf(spec).filter((el) => el.type === 'shape' && el.shape !== 'line')
  .map((el) => ({ id: el.id, top: y + el.y - el.height / 2, bottom: y + el.y + el.height / 2, left: x + el.x - el.width / 2, right: x + el.x + el.width / 2 }));

test('lower-third at its place() keeps its card above the caption zone and inside the safe area, at every format, with 80-character name and role, on either side', () => {
  for (const format of FORMAT_NAMES) {
    const size = FORMATS[format].size;
    const zone = captionZone(size, format);
    const m = safeMargin(size);
    for (const side of ['left', 'right']) {
      const { x, y } = BLOCKS['lower-third'].place(size, format, side);
      const params = { name: prose(80), role: PROSE.slice(9, 89).trimEnd(), side };
      const [card] = shapeBoxes(expandBlocks(oneScene([block('lower-third', params, { x, y })], { format })), x, y).filter((b) => b.id === 'b/card');
      const where = `${format} ${side}`;
      assert.ok(card.bottom <= zone.top, `${where}: card bottom ${card.bottom} reaches the caption zone at ${zone.top}`);
      assert.ok(card.top >= m && card.left >= m && card.right <= size[0] - m, `${where}: card ${JSON.stringify(card)} leaves the safe area`);
    }
  }
});

test('with captions, an 8-item checklist and a 6-step column step-flow at their place() fit between the safe area and the caption zone (16:9)', () => {
  const size = [1920, 1080];
  const zone = captionZone(size, '16:9');
  const m = safeMargin(size);
  const items = Array.from({ length: 8 }, (_, i) => PROSE.slice(i * 6).slice(0, 40).trimEnd());
  const steps = ['Configure the deployment', 'Provision every service', 'Migrate the old database', 'Validate the release plan', 'Announce the maintenance', 'Celebrate with the team'];
  for (const [name, params] of [['checklist', { items }], ['step-flow', { steps, direction: 'column' }]]) {
    for (const captions of [[{ src: 'c.srt' }], undefined]) {
      const { x, y } = BLOCKS[name].place(size, '16:9');
      const spec = expandBlocks(oneScene([block(name, params, { x, y })], { format: '16:9', ...(captions ? { captions } : {}) }));
      const floor = captions ? zone.top : size[1] - m;
      for (const box of shapeBoxes(spec, x, y)) {
        assert.ok(box.top >= m && box.bottom <= floor, `${name}${captions ? ' with captions' : ''}: ${box.id} spans ${box.top}..${box.bottom}, outside ${m}..${floor}`);
      }
    }
  }
});

test('every block text is at least 40 px at 1080 on the short side, for the example, largest and smallest params', () => {
  for (const name of names) {
    for (const [variant, params] of Object.entries(extremes(name))) {
      for (const format of ['16:9', '9:16', '1:1']) {
        const size = FORMATS[format].size;
        const floor = Math.round((40 * Math.min(...size)) / 1080);
        for (const el of partsOf(expandBlocks(oneScene([block(name, params)], { format })))) {
          if (el.type === 'text' || el.type === 'counter') assert.ok(el.fontSize >= floor, `${name} ${variant} ${format}: ${el.id} is ${el.fontSize} px`);
        }
      }
    }
  }
});

test('a duplicate block id is one error at the block id, not one per part', () => {
  const kpi = (extra) => block('kpi-counter', { label: 'Users', to: 5 }, { id: 'kpi', ...extra });
  assert.deepEqual(errs(oneScene([kpi(), kpi({ y: 300 })])), ['scenes[0].elements[1].id: duplicate id "kpi" (first used at scenes[0].elements[0].id)']);
});

test('blocks.mjs show prints caps in the type column and where a right-side lower-third goes', () => {
  const show = cli('show', 'lower-third');
  assert.equal(show.status, 0, show.stderr);
  assert.match(show.stdout, /^name +string≤80 +yes +- +/m);
  assert.match(show.stdout, /^side +left\|right +no +left +.*x is the right edge/m);
  assert.match(show.stdout, /^place with "side": "right" \(x, y\): 16:9 x 1820 y \d+; 9:16 x 980 y \d+;/m);
  const checklist = cli('show', 'checklist');
  assert.match(checklist.stdout, /^items +string≤40\[2–8\] +yes +- +/m);
  assert.match(checklist.stdout, /^tickAfter +number 0\.1–2 +no +0\.25 +/m);
});

test('check.mjs names the block and the param to change when a finding is inside a block', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const dir = mkdtempSync(path.join(tmpdir(), 'block-check-'));
  const file = path.join(dir, 'm.json');
  // A left-side lower-third anchored near the right edge: its card grows rightward, off the safe area.
  writeFileSync(file, JSON.stringify(oneScene([block('lower-third', { name: 'Ada Lovelace from the research team' }, { id: 'lt', x: 1500, y: 818 })], { format: '16:9' }, 3)));
  const r = spawnSync(process.execPath, [CHECK, file], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const lines = r.stdout.trim().split('\n');
  assert.equal(lines.length, 2, r.stdout);
  assert.match(lines[0], /^scenes\[0\]\.elements\[0\]: text "lt\/name" leaves the safe area \(right\) at \d+\.\d\ds \(block "lower-third", part "name"\); shorten params\.name or move the block$/);
  assert.equal(lines[1], 'check: 1 problem');
});

// ---- fix round 2 -----------------------------------------------------------------------------------------------------

const SRT = '1\n00:00:00,200 --> 00:00:05,800\nCaptions stay on screen the whole time here\n';
const CAPTION_SECONDS = 6;

// A temp folder holding the spec (and the captions file and logo it names): the spec file's path.
function captionedSpec(motion) {
  const dir = mkdtempSync(path.join(tmpdir(), 'block-cc-'));
  writeFileSync(path.join(dir, 'c.srt'), SRT);
  writeFileSync(path.join(dir, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#f2a65a"/></svg>');
  const file = path.join(dir, 'm.json');
  writeFileSync(file, JSON.stringify(motion));
  return file;
}

// The lowest edge of any drawn part (cards, shapes, images and texts; groups excluded) once everything has landed
// (85 % of the scene), in canvas px, as the render page lays it out: { bottom, id }.
async function lowestPart(browser, file, size) {
  const srv = await startServer({ specPath: file, mode: 'render' });
  const page = await browser.newPage({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1 });
  try {
    await page.goto(srv.url);
    await waitReady(page);
    await page.evaluate((s) => window.__motion.seek(s), LAST_MOTION_SHARE * CAPTION_SECONDS);
    return await page.evaluate(() => {
      const stage = document.getElementById('stage').getBoundingClientRect();
      const k = window.__motion.size[0] / stage.width;
      return [...document.querySelectorAll('#stage .el:not(.group)')]
        .map((n) => ({ id: n.dataset.id, bottom: (n.getBoundingClientRect().bottom - stage.top) * k }))
        .reduce((a, b) => (b.bottom > a.bottom ? b : a));
    });
  } finally { await page.close(); await srv.close(); }
}

test('with captions, every block at its place() with the largest params keeps its whole box above the caption zone, at every format (the 1:1 checklist of long items is a named check error instead)', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const browser = await launchBrowser({ quiet: true });
  try {
    for (const name of names) {
      for (const variant of ['first', 'last']) {
        const params = extremes(name)[variant];
        for (const format of FORMAT_NAMES) {
          const size = FORMATS[format].size;
          const { x, y } = BLOCKS[name].place(size, format, params.side);
          const motion = { format, captions: [{ src: 'c.srt' }], scenes: [{ id: 's', duration: CAPTION_SECONDS, elements: [block(name, params, { x, y })] }] };
          const file = captionedSpec(motion);
          if (name === 'checklist' && format === '1:1') {
            const r = spawnSync(process.execPath, [CHECK, file], { encoding: 'utf8' });
            assert.equal(r.status, 1, r.stdout + r.stderr);
            assert.match(r.stdout, /\(block "checklist", part "item-\d"\).*params\.items\[\d\]/);
            continue;
          }
          const low = await lowestPart(browser, file, size);
          const top = captionZone(size, format).top;
          assert.ok(low.bottom <= top + 0.5, `${name} (${variant} params) at ${format}: "${low.id}" reaches y ${low.bottom.toFixed(1)}, into the caption zone at ${top}`);
        }
      }
    }
  } finally { await browser.close(); }
});

test('check.mjs hints match the finding inside a block: a caption-zone finding names the block, an overlap says to move one of the blocks', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  // A lower-third whose bottom sits deep in the caption zone.
  const low = captionedSpec({ format: '16:9', captions: [{ src: 'c.srt' }], scenes: [{ id: 's', duration: 3, elements: [block('lower-third', { name: 'Ada Lovelace' }, { id: 'lt', x: 100, y: 1000 })] }] });
  const zone = spawnSync(process.execPath, [CHECK, low], { encoding: 'utf8' });
  assert.equal(zone.status, 1, zone.stdout + zone.stderr);
  assert.match(zone.stdout, /^scenes\[0\]\.elements\[0\]: text "lt\/name" sits in the caption zone \(y >= 842\) at \d+\.\d\ds; move it above y 842 or end the captions before it \(block "lower-third", part "name"\)$/m);
  // Two lower-thirds in the same place.
  const twin = (id) => block('lower-third', { name: 'Ada Lovelace' }, { id, x: 100, y: 818 });
  const both = captionedSpec({ format: '16:9', scenes: [{ id: 's', duration: 3, elements: [twin('one'), twin('two')] }] });
  const overlap = spawnSync(process.execPath, [CHECK, both], { encoding: 'utf8' });
  assert.equal(overlap.status, 1, overlap.stdout + overlap.stderr);
  assert.match(overlap.stdout, /^scenes\[0\]\.elements\[1\]: text "two\/name" overlaps text "one\/name" at \d+\.\d\ds \(block "lower-third", part "name"\); move one of the blocks or shorten params\.name$/m);
});

// ---- fix round 2: a block name is a registry key, never a property of Object.prototype --------------------------------

const PROTOTYPE_NAMES = ['constructor', 'toString', '__proto__', 'hasOwnProperty'];

test('a block named like an Object.prototype key is an unknown block: validate, expand and paramOfPart never throw', () => {
  const list = BLOCK_NAMES.join(', ');
  for (const name of PROTOTYPE_NAMES) {
    const spec = oneScene([block(name, { title: 'x' })]);
    let found;
    assert.doesNotThrow(() => { found = errs(spec); }, `validating block "${name}"`);
    assert.equal(found.length, 1, `${name}: ${found.join(' | ')}`);
    assert.match(found[0], new RegExp(`^scenes\\[0\\]\\.elements\\[0\\]\\.block: unknown block ${JSON.stringify(name)}(; did you mean ".+"\\?)? \\(blocks: ${list}\\)$`), name);
    assert.doesNotThrow(() => expandBlocks(spec), `expanding block "${name}"`);
    assert.deepEqual(expandBlocks(spec), spec, `${name}: left as written`);
    assert.equal(paramOfPart(name, 'title'), null, name);
  }
});

test('blocks.mjs show <prototype key> exits 2 with the unknown-block message and the list', () => {
  for (const name of PROTOTYPE_NAMES) {
    const r = cli('show', name);
    assert.equal(r.status, 2, `${name}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, new RegExp(`^unknown block ${JSON.stringify(name)}(; did you mean ".+"\\?)? \\(blocks: ${BLOCK_NAMES.join(', ')}\\)\\n$`), name);
  }
});
