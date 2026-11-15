// Shot kinds (statement, number, clipping), the cuts between shots and buildFilm. Pure scene-graph work, so it all
// runs in Node with a fake text measure; kinds-browser.test.mjs draws the same films in the page.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { registries } from '../../engine/registry.mjs';
import '../../engine/looks/index.mjs';
import '../../engine/modes/index.mjs';
import '../../engine/devices/index.mjs';
import '../../engine/kinds/index.mjs';
import '../../engine/cuts/index.mjs';
import { node } from '../../engine/graph/node.mjs';
import { sampleGraph, stateKey } from '../../engine/graph/sample.mjs';
import { sample } from '../../engine/time/track.mjs';
import { ease } from '../../engine/time/ease.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { buildFilm, shotContext, resolveLook } from '../../engine/graph/film.mjs';
import { gridX } from '../../engine/looks/index.mjs';
import { annotate } from '../../engine/page/bounds.mjs';
import { FORMATS, safeInsets, VIRAL_SAFE_ZONE } from '../../template/formats.mjs';
import { validateFilm, SpecError } from '../../scripts/v2/spec.mjs';
import { loadFilm } from '../../scripts/v2/pipeline.mjs';

const FPS = 30;
const EPS = 1e-6;
const measure = (text, font) => ({ width: [...text].length * font.size * 0.55, ascent: font.size * 0.8, descent: font.size * 0.2 });
const IMAGES = new Map([['shot.png', { width: 1600, height: 1000 }]]);
const canvasOf = (format) => ({ w: FORMATS[format].size[0], h: FORMATS[format].size[1] });
// The platform safe zone as the stage passes it (template/formats.mjs safeInsets with the viral zone).
const viralOf = (canvas) => safeInsets([canvas.w, canvas.h], VIRAL_SAFE_ZONE);
const modeOf = (look) => (look === 'pop' ? 'viral' : 'pro');

const filmOf = (shots, look = 'desk', format = '16:9', extra = {}) => ({ version: 2, mode: modeOf(look), look, format, fps: FPS, seed: 1, shots, ...extra });

// Expand shot `index` of a film (default: a one-shot film) exactly as buildFilm does.
function expandIn(film, index = 0) {
  const timeline = buildTimeline(film, { fps: FPS });
  const canvas = canvasOf(film.format);
  const ctx = shotContext({ film, index, timeline, canvas, measure, assets: IMAGES, viralInsets: viralOf(canvas) });
  const shot = film.shots[index];
  return { ...registries.kinds.get(shot.show).expand(shot, ctx), timing: timeline.shots[index], ctx, canvas };
}
const expandShot = (shot, look = 'desk', format = '16:9') => expandIn(filmOf([shot], look, format));
const filmFor = (shots, look = 'desk', format = '16:9', extra = {}) => {
  const film = filmOf(shots, look, format, extra);
  return buildFilm({ film, timeline: buildTimeline(film, { fps: FPS }), measure, assets: IMAGES, canvas: canvasOf(format), viralInsets: viralOf(canvasOf(format)) });
};

const all = (nodes) => nodes.flatMap((n) => [n, ...all(n.children)]);
const textNode = (nodes, id) => all(nodes).find((n) => n.type === 'text' && (id === undefined || n.id === id));
const lastKey = (tr) => tr.points.at(-1);
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ''} ${a} vs ${b}`);
const inside = (box, insets, canvas, msg) => {
  const [x, y, w, h] = box;
  assert.ok(x >= insets.left - EPS && y >= insets.top - EPS && x + w <= canvas.w - insets.right + EPS && y + h <= canvas.h - insets.bottom + EPS,
    `${msg}: ${JSON.stringify(box.map((v) => Math.round(v)))} outside the safe area of ${canvas.w}x${canvas.h}`);
};
// A device lands on `at`: full at `at`, and not full before it, except that a stepped (12 fps) desk mark settles on the
// last step at or before `at`, up to 1/12 s early.
function landsOn(n, name, at, msg) {
  const tr = n.tracks[name];
  near(sample(tr, at, n.step), 1, `${msg}: full at the anchor`);
  const early = n.step === undefined ? EPS : 1 / n.step + EPS;
  assert.ok(sample(tr, at - early, n.step) < 1, `${msg}: not full more than ${early} s before`);
}
// The width of a rectangle path written as M0 0H<w>V<h>H0Z.
const ruleWidth = (n) => Number(/H([\d.]+)/.exec(n.props.d)[1]);
const overlaps = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
// A sampled node whose whole subtree is text or groups: its box can be computed without the page.
const isTextOnly = (n) => (n.type === 'text' || n.type === 'group') && n.children.every(isTextOnly);
// The first time a stepped 0/1 opacity track reads 1 (the time of its first key with v 1).
const shownAt = (tr) => tr.points.find((p) => p.v === 1).t;

let specDir;
before(() => {
  specDir = mkdtempSync(path.join(tmpdir(), 'mm-v2-kinds-'));
  writeFileSync(path.join(specDir, 'shot.png'), 'x');
});
after(() => rmSync(specDir, { recursive: true, force: true }));

// ---- the brief's binding tests (adapted to the real API; see the report) ----

test('statement words land on their spoken words', () => {
  for (const look of ['desk', 'pop']) {
    const { nodes, timing } = expandShot({ id: 'a', show: 'statement', say: 'One file. No server.' }, look);
    const text = textNode(nodes), spoken = timing.words;
    assert.equal(text.wordTracks.length, spoken.length);
    text.wordTracks.forEach((w, i) => near(lastKey(w.opacity).t, spoken[i].start, `${look} word ${i}`));
  }
});

test("an emphasised word gets the look's emphasis and nothing else", () => {
  const desk = expandShot({ id: 'a', show: 'statement', say: 'It is *lying* to you.' }, 'desk').nodes;
  assert.equal(desk.filter((n) => n.props.under).length, 1);
  assert.ok(!textNode(desk).wordTracks.some((w) => w.fill), 'desk recolours nothing');
  const pop = expandShot({ id: 'a', show: 'statement', say: 'It is *lying* to you.' }, 'pop').nodes;
  assert.equal(pop.filter((n) => n.props.under).length, 0);
  const words = textNode(pop).wordTracks;
  assert.ok(words[2].fill);
  assert.equal(words.filter((w) => w.fill).length, 1);
});

test('a number lands its count on the spoken figure', () => {
  const { nodes, timing } = expandShot({ id: 'n', show: 'number', say: 'We saved forty one percent.', value: 41, suffix: '%', label: 'saved' }, 'desk');
  const fig = nodes.find((n) => n.id === 'n.value');
  assert.ok(fig, 'the figure is the top-level node n.value');
  const digits = textNode(fig.children, 'n.value.digits');
  const finalWords = digits.props.steps.at(-1).words; // word indexes of the final value's digits
  for (const i of finalWords) near(shownAt(digits.wordTracks[i].opacity), timing.words[2].start, 'final value appears on "forty"');
});

test('a match cut with no shared id is a validator error', () => {
  const r = validateFilm({ version: 2, shots: [{ id: 'a', show: 'statement', say: 'Hi.' }, { id: 'b', show: 'number', cut: 'match', value: 1, label: 'x', hold: 2 }] }, { specDir });
  assert.equal(r.errors[0].path, 'shots[1].cut');
  assert.match(r.errors[0].message, /"match" needs a node id shared with shot "a"/);
  const ok = validateFilm({ version: 2, shots: [{ id: 'a', show: 'statement', say: 'Hi.', hero: 'big' }, { id: 'b', show: 'number', cut: 'match', value: 1, label: 'x', hold: 2, hero: 'big' }] }, { specDir });
  assert.deepEqual(ok.errors, []);
});

test('a missing clipping image is an error with its path, exit 2', () => {
  const file = path.join(specDir, 'film.json');
  writeFileSync(file, JSON.stringify({ version: 2, shots: [{ id: 'c', show: 'clipping', src: 'nope.png', hold: 2 }] }));
  assert.throws(() => loadFilm(file), (err) => {
    assert.ok(err instanceof SpecError);
    assert.equal(err.errors[0].path, 'shots[0].src');
    assert.match(err.errors[0].message, /file not found: "nope\.png"/);
    return true;
  });
});

test('a 30-word statement on 9:16 reports overflow', () => {
  const { nodes } = expandShot({ id: 'a', show: 'statement', hold: 3, text: Array(30).fill('paragraph').join(' ') }, 'pop', '9:16');
  assert.equal(textNode(nodes).props.layout.overflow, true);
});

// ---- every shot ----

test('every shot draws the look field first, at depth 1, 6% past every edge', () => {
  const shots = [
    { id: 'a', show: 'statement', say: 'One file.' },
    { id: 'n', show: 'number', value: 3, label: 'x', hold: 2 },
    { id: 'c', show: 'clipping', src: 'shot.png', hold: 2 },
  ];
  for (const look of ['desk', 'pop']) {
    for (const shot of shots) {
      const { nodes, canvas } = expandShot(shot, look);
      const [field] = nodes;
      assert.equal(field.type, 'field');
      assert.equal(field.depth, 1);
      assert.equal(field.props.field, registries.looks.get(look).field.field);
      assert.ok(Number.isInteger(field.props.w) && Number.isInteger(field.props.h));
      assert.ok(field.props.x <= -0.06 * canvas.w + 1 && field.props.x + field.props.w >= canvas.w * 1.06 - 1);
      assert.ok(field.props.y <= -0.06 * canvas.h + 1 && field.props.y + field.props.h >= canvas.h * 1.06 - 1);
    }
  }
});

test('one surface per film: every shot has the same field, seeded by the film seed alone', () => {
  const film = filmOf([{ id: 'a', show: 'statement', say: 'One file.' }, { id: 'n', show: 'number', value: 3, label: 'x', hold: 2 },
    { id: 'c', show: 'clipping', src: 'shot.png', hold: 2 }], 'desk', '16:9', { seed: 42 });
  const fields = [0, 1, 2].map((i) => expandIn(film, i).nodes[0]);
  for (const f of fields) {
    assert.equal(f.id, 'field');
    assert.equal(f.props.seed, 42);
    assert.deepEqual(f.props, fields[0].props, 'the same plan in every shot');
  }
});

test('a slide moves everything but the field', () => {
  const canvas = { w: 1920, h: 1080 };
  const field = (x) => Object.freeze({ ...fakeSampled('field', x), depth: 1 });
  const to = [field(-20), fakeSampled('b', 500)];
  const out = registries.cuts.get('slide').apply({ from: [field(-10), fakeSampled('a', 100)], to, p: 0.5, canvas });
  assert.deepEqual(out.map((n) => n.id), ['field', 'a', 'b']);
  assert.equal(out[0], to[0], 'the incoming field, unmoved');
  near(out[1].x, 100 - 0.5 * 1920);
  near(out[2].x, 500 + 0.5 * 1920);
});

// ---- statement ----

test('desk statement sits flush left on column 2 with its ink centred at 44% of the height', () => {
  const { nodes, ctx, canvas } = expandShot({ id: 'a', show: 'statement', say: 'Most dashboards cannot tell you where a number came from.' });
  const text = textNode(nodes);
  const look = ctx.look;
  assert.equal(text.props.x, gridX(look, canvas, 2));
  const { layout, font } = text.props;
  assert.ok(layout.width <= gridX(look, canvas, 10) - look.grid.gutter - gridX(look, canvas, 2) + EPS, 'stays inside columns 2 to 9');
  assert.ok(font.size >= look.scale[2] && font.size <= look.scale[4]);
  assert.ok(layout.lines.length <= look.maxLines.display);
  assert.equal(font.family, look.fonts.display.family);
  assert.equal(text.props.fill, look.palette.ink);
  const inkTop = text.props.y + layout.lines[0].y - 0.7 * font.size;
  const inkBottom = text.props.y + layout.lines.at(-1).y;
  near((inkTop + inkBottom) / 2, 0.44 * canvas.h, 'ink centre');
});

test('desk statement runs to column 11 on vertical formats', () => {
  for (const format of ['9:16', '1:1', '4:5']) {
    const { nodes, ctx, canvas } = expandShot({ id: 'a', show: 'statement', say: 'Most dashboards cannot tell you where a number came from.' }, 'desk', format);
    const { layout } = textNode(nodes).props;
    const right = gridX(ctx.look, canvas, 12) - ctx.look.grid.gutter;
    assert.ok(layout.width <= right - gridX(ctx.look, canvas, 2) + EPS, format);
    assert.ok(layout.width > gridX(ctx.look, canvas, 10) - gridX(ctx.look, canvas, 2), `${format} uses the wider measure`);
  }
});

test('desk kicker: label caps at step 1 in ink2, 28 units over the cap line, with a hairline 12 units above it', () => {
  const { nodes, ctx } = expandShot({ id: 'a', show: 'statement', say: 'One file.', kicker: 'Chapter one' });
  const look = ctx.look;
  const text = textNode(nodes, 'a.text');
  const kicker = textNode(nodes, 'a.kicker');
  assert.equal(kicker.props.layout.lines[0].words.map((w) => w.text).join(' '), 'CHAPTER ONE');
  assert.equal(kicker.props.font.family, look.fonts.label.family);
  assert.equal(kicker.props.font.size, look.scale[0]);
  assert.equal(kicker.props.fill, look.palette.ink2);
  assert.equal(kicker.props.x, text.props.x);
  const capLine = text.props.y + text.props.layout.lines[0].y - 0.7 * text.props.font.size;
  near(kicker.props.y + kicker.props.layout.lines[0].y, capLine - 28, 'kicker baseline');
  const rule = nodes.find((n) => n.id === 'a.rule');
  assert.equal(rule.props.fill, look.palette.rule);
  const kickerCap = kicker.props.y + kicker.props.layout.lines[0].y - 0.7 * kicker.props.font.size;
  near(rule.props.y + 2, kickerCap - 12, 'hairline bottom');
  near(rule.props.x, text.props.x);
});

test('desk highlights one run of adjacent emphasised words per line', () => {
  const run = expandShot({ id: 'a', show: 'statement', say: 'It is *so very* wrong.', text: 'It is | so very wrong.' });
  const lines = textNode(run.nodes).props.layout.lines.map((l) => l.words.map((w) => w.text));
  assert.ok(lines.some((l) => l.includes('so') && l.includes('very')), `precondition: one line holds both, got ${JSON.stringify(lines)}`);
  const highlights = run.nodes.filter((n) => n.props.under);
  assert.equal(highlights.length, 1);
  landsOn(highlights[0], 'reveal', run.timing.words[2].start, 'lands on the first emphasised word');
  const textIndex = run.nodes.findIndex((n) => n.id === 'a.text');
  assert.ok(run.nodes.indexOf(highlights[0]) < textIndex, 'placed before the text');
  const split = expandShot({ id: 'a', show: 'statement', say: '*Really* *lying* now.', text: 'Really | lying now' });
  assert.equal(split.nodes.filter((n) => n.props.under).length, 2, 'emphasised words on two lines give two highlights');
});

test('pop statement is centred caps; an emphasised word turns accent and pulses to the emphasize scale', () => {
  const { nodes, ctx, canvas, timing } = expandShot({ id: 'a', show: 'statement', say: 'It is *lying* to you.' }, 'pop', '9:16');
  const look = ctx.look;
  const text = textNode(nodes);
  const words = text.props.layout.lines.flatMap((l) => l.words.map((w) => w.text));
  assert.deepEqual(words, ['IT', 'IS', 'LYING', 'TO', 'YOU.']);
  assert.ok(text.props.font.size >= look.scale[3] && text.props.font.size <= look.scale[4]);
  const safe = viralOf(canvas);
  const safeW = canvas.w - safe.left - safe.right;
  near(text.props.x + text.props.layout.lines[0].x + text.props.layout.lines[0].width / 2, safe.left + safeW / 2, 'centred on the safe zone');
  assert.ok(text.props.layout.width <= safeW + EPS, 'fitted to the safe width');
  const ink = (text.props.y + text.props.layout.lines[0].y - 0.7 * text.props.font.size + text.props.y + text.props.layout.lines.at(-1).y) / 2;
  near(ink, (safe.top + canvas.h - safe.bottom) / 2, 'ink centred on the safe zone vertically');
  const { fill, scale } = text.wordTracks[2];
  const start = timing.words[2].start;
  assert.equal(sample(fill, start), look.palette.ink);
  assert.equal(sample(fill, start + 5), look.palette.accent);
  near(sample(scale, start + look.moves.emphasize.dur), look.moves.emphasize.scale, 'peak');
  near(sample(scale, start + 5), 1, 'back to 1');
  const later = timing.words[3].start;
  near(sample(text.wordTracks[3].scale, later - look.moves.enter.dur), look.moves.enter.scale, 'words pop from the enter scale');
});

test('with no say, words stagger 0.09 s apart from 0.2 s', () => {
  const { nodes } = expandShot({ id: 'a', show: 'statement', hold: 3, text: 'Three small words' });
  textNode(nodes).wordTracks.forEach((w, i) => near(lastKey(w.opacity).t, 0.2 + 0.09 * i, `word ${i}`));
});

test('an on-screen word with no spoken match lands with the nearest earlier matched word', () => {
  const { nodes, timing } = expandShot({ id: 'a', show: 'statement', say: 'Most dashboards cannot tell you where a number came from.', text: 'Where did this | number come from?' });
  const at = textNode(nodes).wordTracks.map((w) => lastKey(w.opacity).t);
  const spoken = (i) => timing.words[i].start;
  [5, 5, 5, 7, 7, 9].forEach((s, i) => near(at[i], spoken(s), `word ${i}`));
});

test('statement targets and boxes: text and each word', () => {
  const kind = registries.kinds.get('statement');
  assert.deepEqual(kind.targets({ say: 'One file. No server.' }), ['text', 'word:0', 'word:1', 'word:2', 'word:3']);
  assert.deepEqual(kind.targets({ text: 'Where | did this|  go', say: 'x' }), ['text', 'word:0', 'word:1', 'word:2', 'word:3']);
  const { boxes } = expandShot({ id: 'a', show: 'statement', say: 'One file. No server.' });
  for (const t of kind.targets({ say: 'One file. No server.' })) assert.equal(boxes[t].length, 4, t);
  assert.ok(boxes['word:1'][0] > boxes['word:0'][0]);
});

test('on events: a highlight on a word goes before the text, a circle after it, at the anchor', () => {
  const { nodes, timing } = expandShot({ id: 'a', show: 'statement', say: 'One file. No server.', on: [
    { at: 'word:server', do: 'highlight', target: 'word:3' },
    { at: 'word:file', do: 'circle', target: 'word:1' },
    { at: 'start', do: 'arrow', target: 'text' },
  ] });
  const ids = nodes.map((n) => n.id);
  assert.ok(ids.indexOf('a.on0') < ids.indexOf('a.text'));
  assert.ok(ids.indexOf('a.on1') > ids.indexOf('a.text'));
  assert.ok(ids.includes('a.on2'));
  landsOn(nodes.find((n) => n.id === 'a.on1'), 'draw', timing.words[1].start, 'the circle lands on file');
});

test('a matched hero is on screen from the first frame', () => {
  const film = filmOf([{ id: 'a', show: 'statement', say: 'One file.', hero: 'h' }, { id: 'b', show: 'statement', say: 'No server.', hero: 'h', cut: 'match' }]);
  const { nodes, hero } = expandIn(film, 1);
  assert.equal(hero, 'h');
  const words = sampleGraph(nodes, 0).find((n) => n.id === 'h').words;
  assert.ok(words.every((w) => w.opacity === 1));
});

// ---- number ----

test('the count lands at 60% of the shot with no spoken number, and on a spoken digit', () => {
  const quiet = expandShot({ id: 'n', show: 'number', say: 'We saved a lot of money.', value: 41, label: 'saved' });
  const steps = (r) => textNode(r.nodes, 'n.value.digits');
  const final = (r) => shownAt(steps(r).wordTracks[steps(r).props.steps.at(-1).words[0]].opacity);
  near(final(quiet), 0.6 * quiet.timing.duration, 'no number word');
  const held = expandShot({ id: 'n', show: 'number', hold: 2, value: 41, label: 'saved' });
  near(final(held), 1.2, 'no say');
  const digit = expandShot({ id: 'n', show: 'number', say: 'We saved 41 percent.', value: 41, label: 'saved' });
  near(final(digit), digit.timing.words[2].start, 'spoken digits');
});

test('number digits sit in fixed advances and every step is a real value of the count', () => {
  const { nodes } = expandShot({ id: 'n', show: 'number', say: 'Four hundred fifty nine rows.', value: 459, decimals: 0, label: 'rows' });
  const digits = textNode(nodes, 'n.value.digits');
  const words = digits.props.layout.lines[0].words;
  const strings = digits.props.steps.map((s) => s.text);
  assert.equal(strings[0], '0');
  assert.equal(strings.at(-1), '459');
  const nums = strings.map(Number);
  assert.deepEqual([...nums].sort((a, b) => a - b), nums, 'counts up');
  const advance = digits.props.advance;
  for (const step of digits.props.steps) {
    step.words.forEach((wi, k) => near(words[wi].x + words[wi].width / 2, advance * (k + 0.5), `cell ${k} of ${step.text}`));
  }
});

test('number formats decimals and thousands, and puts the suffix on the cap line at 45%', () => {
  const { nodes } = expandShot({ id: 'n', show: 'number', hold: 2, value: 1204.5, decimals: 1, prefix: '$', suffix: 'M', label: 'raised' });
  const digits = textNode(nodes, 'n.value.digits');
  assert.equal(digits.props.steps.at(-1).text, '1,204.5');
  const suffix = textNode(nodes, 'n.value.suffix');
  const prefix = textNode(nodes, 'n.value.prefix');
  near(suffix.props.font.size, 0.45 * digits.props.font.size, 'suffix size');
  const figCap = digits.props.y + digits.props.layout.lines[0].y - 0.7 * digits.props.font.size;
  near(suffix.props.y + suffix.props.layout.lines[0].y - 0.7 * suffix.props.font.size, figCap, 'suffix cap line');
  assert.ok(prefix.props.x < digits.props.x && suffix.props.x > digits.props.x);
});

test('desk number: a hero numeral fitted to columns 2 to 9, baseline at 60%, hairline the figure width, label at step 3, delta on its baseline', () => {
  for (const [format, toColumn] of [['16:9', 9], ['9:16', 11]]) {
    const { nodes, ctx, canvas, boxes } = expandShot({ id: 'n', show: 'number', hold: 3, value: 1459, suffix: 'K', label: 'rows in one file', delta: '+12%' }, 'desk', format);
    const look = ctx.look;
    const fig = nodes.find((n) => n.id === 'n.value');
    const digits = textNode(fig.children, 'n.value.digits');
    const baseline = fig.props.y + digits.props.y + digits.props.layout.lines[0].y;
    near(baseline, 0.6 * canvas.h, `${format} baseline`);
    const size = digits.props.font.size;
    assert.ok(size >= look.scale[4] && size <= 560, `${format} size ${size}`);
    const span = gridX(look, canvas, toColumn + 1) - look.grid.gutter - gridX(look, canvas, 2);
    assert.ok(boxes.value[2] <= span + EPS, `${format} inside the span`);
    assert.ok(size === 560 || boxes.value[2] > 0.97 * span, `${format} fills the span unless capped: ${boxes.value[2]} of ${span}`);
    near(boxes.value[0], gridX(look, canvas, 2), `${format} flush left by its ink`);
    const rule = nodes.find((n) => n.id === 'n.rule');
    near(rule.props.y, baseline + 28, 'hairline 28 under');
    near(rule.props.x, boxes.value[0]);
    near(ruleWidth(rule), boxes.value[2], 'the hairline spans exactly the figure');
    const label = textNode(nodes, 'n.label');
    assert.equal(label.props.font.size, look.scale[2]);
    assert.equal(label.props.fill, look.palette.ink2);
    near(label.props.y + label.props.layout.lines[0].y - 0.7 * label.props.font.size, baseline + 28 + 2 + 24, 'label cap top');
    const last = label.props.layout.lines.at(-1);
    const tag = nodes.find((n) => n.id === 'n.delta');
    const tagText = tag.children.find((n) => n.type === 'text');
    const labelBottom = boxes.label[1] + boxes.label[3];
    if (boxes.delta[1] < labelBottom) {
      near(tag.props.y + tagText.props.y + tagText.props.layout.lines[0].y, label.props.y + last.y, `${format} delta on the label baseline`);
      near(boxes.delta[0], label.props.x + last.x + last.width + 32, `${format} delta 32 units after the label`);
    } else {
      assert.equal(format, '9:16', 'only a narrow format drops the delta under the label');
      near(boxes.delta[0], label.props.x, 'under the label, flush left');
    }
    assert.ok(!overlaps(boxes.delta, [rule.props.x, rule.props.y, ruleWidth(rule), 2]), 'delta clear of the hairline');
  }
});

test('a figure too long for the span stops at scale step 5 and says it overflows', () => {
  const { nodes, ctx } = expandShot({ id: 'n', show: 'number', hold: 2, value: 123456789, suffix: 'rows', label: 'x' }, 'desk', '9:16');
  const digits = textNode(nodes, 'n.value.digits');
  assert.equal(digits.props.font.size, ctx.look.scale[4]);
  assert.equal(digits.props.layout.overflow, true);
});

test('pop number: fitted inside the 9:16 safe zone and centred on it; label tag at step 3, delta at step 2', () => {
  const { nodes, ctx, boxes, timing, canvas } = expandShot({ id: 'n', show: 'number', say: 'We are forty one percent faster.', value: 41, suffix: '%', label: 'faster', delta: 'vs last year' }, 'pop', '9:16');
  const look = ctx.look;
  const safe = viralOf(canvas);
  const safeW = canvas.w - safe.left - safe.right;
  const cx = safe.left + safeW / 2, cy = (safe.top + canvas.h - safe.bottom) / 2;
  const fig = nodes.find((n) => n.id === 'n.value');
  near(boxes.value[0] + boxes.value[2] / 2, cx, 'figure centred on the safe zone');
  assert.ok(boxes.value[2] <= safeW + EPS && boxes.value[2] > 0.97 * safeW, `fills the safe width: ${boxes.value[2]} of ${safeW}`);
  assert.ok(textNode(fig.children, 'n.value.digits').props.font.size <= 760);
  const top = boxes.value[1], bottom = boxes.delta[1] + boxes.delta[3];
  near((top + bottom) / 2, cy, 'the block centred on the safe zone');
  const land = timing.words[2].start;
  near(sample(fig.tracks.scale, land + look.moves.emphasize.dur), look.moves.emphasize.scale, 'pulse on landing');
  assert.equal(sample(fig.tracks.scale, Math.max(0, land - look.moves.count.dur)), look.moves.enter.scale);
  assert.ok(boxes.label[1] >= boxes.value[1] + boxes.value[3], 'label under the figure');
  near(boxes.label[0] + boxes.label[2] / 2, cx, 'label tag centred');
  assert.equal(textNode(nodes, 'n.label.text').props.font.size, look.scale[2]);
  assert.equal(nodes.find((n) => n.id === 'n.label').children.find((n) => n.type === 'path').props.fill, look.palette.accent);
  assert.ok(boxes.delta[1] >= boxes.label[1] + boxes.label[3]);
  const delta = textNode(nodes, 'n.delta');
  assert.equal(delta.props.fill, look.palette.ink2);
  assert.equal(delta.props.font.size, look.scale[1]);
});

test('pop number on 16:9 fits columns 1 to 12 up to 760 units, centred on the canvas', () => {
  const { nodes, ctx, canvas, boxes } = expandShot({ id: 'n', show: 'number', hold: 2, value: 7, label: 'x' }, 'pop', '16:9');
  const size = textNode(nodes, 'n.value.digits').props.font.size;
  assert.equal(size, 760, 'a short figure is capped at 760');
  near(boxes.value[0] + boxes.value[2] / 2, canvas.w / 2);
  assert.ok(boxes.value[2] <= gridX(ctx.look, canvas, 13) - gridX(ctx.look, canvas, 1) + EPS);
});

// ---- clipping ----

test('desk clipping: cutout on a card 48 units larger, rotated -2 degrees, 62% of the short side, rising in', () => {
  const { nodes, ctx, canvas, hero } = expandShot({ id: 'c', show: 'clipping', src: 'shot.png', hold: 3, caption: 'The query' });
  const look = ctx.look;
  const pic = nodes.find((n) => n.id === hero);
  assert.equal(hero, 'c.image');
  assert.equal(pic.props.rotate, -2);
  assert.equal(pic.props.x, 0.54 * canvas.w);
  assert.equal(pic.props.y, 0.52 * canvas.h);
  near(sample(pic.tracks.y, 0), 0.52 * canvas.h + 80, 'starts 80 below');
  near(lastKey(pic.tracks.y).t, look.moves.enter.dur);
  const image = all([pic]).find((n) => n.type === 'image');
  near(Math.max(image.props.w, image.props.h), 0.62 * 1080, 'size');
  const paper = all([pic]).find((n) => n.id === 'c.image.card.paper');
  assert.ok(paper, 'a card');
  const card = pic.children.find((n) => n.id === 'c.image.card');
  assert.ok(pic.children.indexOf(card) < pic.children.findIndex((n) => n.id === 'c.image.cutout'), 'card under the cutout');
  assert.ok(textNode(nodes, 'c.caption'));
});

test('pop clipping: cutout only, upright, centred on the safe zone at 92% of its width, popping in', () => {
  const { nodes, canvas, hero, ctx } = expandShot({ id: 'c', show: 'clipping', src: 'shot.png', hold: 3 }, 'pop', '9:16');
  const safe = viralOf(canvas);
  const safeW = canvas.w - safe.left - safe.right;
  const pic = nodes.find((n) => n.id === hero);
  assert.equal(pic.props.rotate ?? 0, 0);
  near(pic.props.x, safe.left + safeW / 2);
  near(pic.props.y, (safe.top + canvas.h - safe.bottom) / 2);
  near(all([pic]).find((n) => n.type === 'image').props.w, 0.92 * safeW, 'width');
  assert.ok(!all([pic]).some((n) => n.id.includes('card')));
  near(sample(pic.tracks.scale, 0), ctx.look.moves.enter.scale);
});

test('desk clipping on vertical formats is 92% of the width inside the margins', () => {
  for (const format of ['9:16', '4:5', '1:1']) {
    const { nodes, ctx, canvas, hero } = expandShot({ id: 'c', show: 'clipping', src: 'shot.png', hold: 3 }, 'desk', format);
    const available = gridX(ctx.look, canvas, 13) - gridX(ctx.look, canvas, 1);
    near(all([nodes.find((n) => n.id === hero)]).find((n) => n.type === 'image').props.w, 0.92 * available, format);
  }
});

test('a region box is the region inside the drawn picture, through its rotation', () => {
  const shot = { id: 'c', show: 'clipping', src: 'shot.png', hold: 3, regions: { query: [0.25, 0.5, 0.5, 0.25] } };
  const pop = expandShot(shot, 'pop');
  // 1600x1000 -> 669.6 x 418.5 centred at (960, 540): left 625.2, top 330.75
  const W = 0.62 * 1080, H = W * 1000 / 1600;
  const left = 960 - W / 2, top = 540 - H / 2;
  pop.boxes['region:query'].forEach((v, i) => near(v, [left + 0.25 * W, top + 0.5 * H, 0.5 * W, 0.25 * H][i], `pop ${i}`));
  // desk: the corners turned by the group's -2 degrees and the cutout's own seeded tilt about (0.54 w, 0.52 h).
  const desk = expandShot(shot, 'desk');
  const pic = desk.nodes.find((n) => n.id === 'c.image');
  const tilt = pic.children.find((n) => n.id === 'c.image.cutout').props.rotate ?? 0;
  const a = ((-2 + tilt) * Math.PI) / 180, cx = 0.54 * 1920, cy = 0.52 * 1080;
  const corners = [[0.25, 0.5], [0.75, 0.5], [0.25, 0.75], [0.75, 0.75]].map(([fx, fy]) => {
    const lx = fx * W - W / 2, ly = fy * H - H / 2;
    return [cx + lx * Math.cos(a) - ly * Math.sin(a), cy + lx * Math.sin(a) + ly * Math.cos(a)];
  });
  const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]);
  const want = [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  desk.boxes['region:query'].forEach((v, i) => near(v, want[i], `desk ${i}`));
});

test('a mark on a region goes over the picture, and the desk camera pushes until the region fills 62% of the width', () => {
  const shot = { id: 'c', show: 'clipping', src: 'shot.png', say: 'This one shows the query behind every chart.', regions: { query: [0.6, 0.2, 0.3, 0.2] },
    on: [{ at: 'word:query', do: 'circle', target: 'region:query' }] };
  for (const format of ['16:9', '9:16']) {
    const { nodes, camera, timing, ctx, boxes, canvas } = expandShot(shot, 'desk', format);
    const ids = nodes.map((n) => n.id);
    assert.ok(ids.indexOf('c.on0') > ids.indexOf('c.image'), 'mark drawn over the picture');
    const push = camera.find((layer) => layer.some((k) => k.zoom !== undefined));
    const at = timing.words[4].start;
    const want = Math.min(3.2, Math.max(1.2, (0.62 * canvas.w) / boxes['region:query'][2]));
    near(push.at(-1).t, at, `${format} lands on the event`);
    near(push.at(-1).zoom, want, `${format} zoom`);
    assert.equal(push.at(-1).ease, ctx.look.moves.enter.ease);
    near(push[0].t, at - 0.9, 'over 0.9 s');
  }
  const still = expandShot({ ...shot, on: [{ at: 'word:query', do: 'circle', target: 'image' }] });
  assert.ok(!still.camera.some((layer) => layer.some((k) => k.zoom !== undefined)), 'no region target, no push');
});

test('a pushed region sits on the composition centre, as far as the field allows', () => {
  const shot = { id: 'c', show: 'clipping', src: 'shot.png', hold: 3, regions: { mid: [0.4, 0.4, 0.2, 0.2] }, on: [{ at: 1, do: 'underline', target: 'region:mid' }] };
  const { boxes, canvas } = expandShot(shot, 'desk', '16:9');
  const f = filmFor([shot], 'desk', '16:9');
  const pic = f.sampleAt(2).find((n) => n.id === 'c.image');
  const rest = expandShot(shot, 'desk', '16:9').nodes.find((n) => n.id === 'c.image');
  const [bx, by, bw, bh] = boxes['region:mid'];
  // the region centre moves with the picture group: rest offset scaled by the camera zoom
  const zoom = pic.scale / (rest.props.scale ?? 1);
  const rx = pic.x + (bx + bw / 2 - rest.props.x) * zoom, ry = pic.y + (by + bh / 2 - rest.props.y) * zoom;
  assert.ok(Math.abs(rx - canvas.w / 2) < 4 && Math.abs(ry - canvas.h / 2) < 4, `region at ${rx}, ${ry}`);
});

test('a highlight on a region is a hand-drawn marker frame with the rest of the picture dimmed in desk', () => {
  const shot = { id: 'c', show: 'clipping', src: 'shot.png', say: 'This one shows the query behind every chart.', regions: { query: [0.6, 0.2, 0.3, 0.2] },
    on: [{ at: 'word:query', do: 'highlight', target: 'region:query' }] };
  const { nodes, timing, ctx } = expandShot(shot, 'desk');
  const at = timing.words[4].start;
  const pic = nodes.find((n) => n.id === 'c.image');
  assert.ok(!all(nodes).some((n) => n.props.under), 'no filled band');
  const sides = all([pic]).filter((n) => /^c\.on0\.side\d$/.test(n.id));
  assert.equal(sides.length, 4, 'four strokes inside the picture');
  for (const s of sides) {
    assert.equal(s.props.stroke, ctx.look.palette.accent);
    assert.equal(s.props.strokeWidth, 12);
    assert.equal(s.props.lineCap, 'round');
    assert.equal(s.props.blend, undefined);
  }
  const lands = sides.map((s) => lastKey(s.tracks.draw).t);
  assert.deepEqual([...lands].sort((a, b) => a - b), lands, 'drawn on in order');
  landsOn(sides[3], 'draw', at, 'the frame closes on the event');
  const dim = all([pic]).find((n) => n.id === 'c.on0.dim');
  assert.equal(dim.props.fill, ctx.look.palette.ink);
  assert.equal(dim.props.d.match(/M/g).length, 2, 'the region is cut out of the overlay');
  near(sample(dim.tracks.opacity, 0), 0);
  near(sample(dim.tracks.opacity, at), 0.32, 'dims with the frame');
});

// ---- pop clipping: a region event is a cut to a close-up ----

const POP_SHOT = { id: 'c', show: 'clipping', src: 'shot.png', say: 'This one shows the query and then the chart below it.',
  regions: { query: [0.6, 0.2, 0.3, 0.2], chart: [0.1, 0.3, 0.4, 0.3] },
  on: [{ at: 'word:query', do: 'underline', target: 'region:query' }, { at: 'word:chart', do: 'highlight', target: 'region:chart' }] };
const opacityAt = (n, t) => sample(n.tracks.opacity, t, n.step);

test('pop: the whole picture until the first region event, then a hard switch to the region as its own cut-out', () => {
  const { nodes, timing, canvas, ctx } = expandShot(POP_SHOT, 'pop', '9:16');
  const at = timing.words[4].start; // "query"
  const pic = nodes.find((n) => n.id === 'c.image');
  const close = nodes.find((n) => n.id === 'c.close0');
  near(opacityAt(pic, at - 1 / FPS), 1, 'the whole picture just before');
  near(opacityAt(close, at - 1 / FPS), 0, 'no close-up just before');
  near(opacityAt(pic, at), 0, 'the whole picture gone on the event frame');
  near(opacityAt(close, at), 1, 'the close-up on the event frame');
  const image = all([close]).find((n) => n.type === 'image');
  assert.deepEqual(image.props.clip, [0.6 * 1600, 0.2 * 1000, 0.3 * 1600, 0.2 * 1000], 'the region in image pixels');
  assert.equal(image.props.src, 'shot.png');
  assert.ok(all([close]).some((n) => n.id.endsWith('.keyline')) && all([close]).some((n) => n.id.endsWith('.shadow')), 'a cutout: keyline and shadow');
  const safe = viralOf(canvas);
  const safeW = canvas.w - safe.left - safe.right, safeH = canvas.h - safe.top - safe.bottom;
  const fitsWidth = Math.abs(image.props.w - 0.92 * safeW) < 1e-6, fitsHeight = Math.abs(image.props.h - 0.7 * safeH) < 1e-6;
  assert.ok(fitsWidth || fitsHeight, `92% of the safe width or 70% of its height: ${image.props.w} x ${image.props.h}`);
  assert.ok(image.props.w <= 0.92 * safeW + EPS && image.props.h <= 0.7 * safeH + EPS);
  near(image.props.w / image.props.h, (0.3 * 1600) / (0.2 * 1000), 'the region keeps its shape');
  const cutoutGroup = close.children.find((n) => n.id === 'c.close0.cutout');
  near(cutoutGroup.props.x, safe.left + safeW / 2);
  near(cutoutGroup.props.y, safe.top + safeH / 2);
  const punch = ctx.look.devices.punch.scale;
  const switchKeys = (expandShot(POP_SHOT, 'pop', '9:16').camera).flat().filter((k) => k.zoom === punch);
  assert.ok(switchKeys.some((k) => Math.abs(k.t - at) < 1e-6), 'the switch lands with a punch');
});

test('pop: a second, different region event switches to that close-up; devices sit against the close-up and draw on after the cut', () => {
  const { nodes, timing, boxes } = expandShot(POP_SHOT, 'pop', '9:16');
  const first = timing.words[4].start, second = timing.words[8].start; // "query", "chart"
  const [a, b] = ['c.close0', 'c.close1'].map((id) => nodes.find((n) => n.id === id));
  near(opacityAt(a, second - 1 / FPS), 1); near(opacityAt(b, second - 1 / FPS), 0);
  near(opacityAt(a, second + 1e-6), 0); near(opacityAt(b, second + 1e-6), 1); // anchors round to 1e-6 s
  const underline = all([a]).find((n) => n.id === 'c.on0');
  assert.ok(underline, 'the underline belongs to its close-up');
  const [, by, , bh] = boxes['region:query'];
  const ys = underline.props.d.match(/-?\d+(?:\.\d+)?/g).map(Number).filter((_, i) => i % 2 === 1);
  assert.ok(Math.min(...ys) > by + bh, 'under the close-up');
  near(lastKey(underline.tracks.draw).t, first + registries.looks.get('pop').moves.draw.dur, 'starts drawing on the cut');
  const sides = all([b]).filter((n) => /^c\.on1\.side\d$/.test(n.id));
  assert.equal(sides.length, 4, 'a ruled frame around the second close-up');
  for (const s of sides) { assert.equal(s.props.strokeWidth, 10); assert.equal(s.props.lineCap, 'square'); }
  assert.ok(!all([b]).some((n) => n.id === 'c.on1.dim'), 'no overlay on a close-up');
  const [cx, cy, cw, ch] = boxes['region:chart'];
  const xs = sides.flatMap((s) => s.props.d.match(/-?\d+(?:\.\d+)?/g).map(Number).filter((_, i) => i % 2 === 0));
  assert.ok(Math.min(...xs) < cx && Math.max(...xs) > cx + cw, 'the frame goes around the close-up');
  assert.ok(ch > 0);
});

test('pop clippings never push the camera, and the pop field ignores the camera', () => {
  const { camera, nodes } = expandShot(POP_SHOT, 'pop', '9:16');
  const punch = registries.looks.get('pop').devices.punch.scale;
  assert.ok(camera.flat().every((k) => k.zoom === undefined || k.zoom === 1 || k.zoom === punch), 'only punch zooms');
  assert.equal(nodes[0].props.fixed, true, 'pop field fixed');
  assert.equal(expandShot(POP_SHOT, 'desk').nodes[0].props.fixed, undefined, 'desk field moves with the camera');
  const out = registries.cuts.get('punch').apply({ from: [], to: [nodes[0]].map((n) => sampleGraph([n], 0)[0]), p: 0.5, canvas: canvasOf('9:16') });
  assert.equal(out[0].scale, 1, 'a punch cut leaves a fixed field alone');
});

test('the validator lets a clipping take a highlight on a region in pop, and still refuses highlight on text in pop', () => {
  const pop = (shots) => validateFilm({ version: 2, mode: 'viral', shots }, { specDir });
  const clip = { id: 'c', show: 'clipping', src: 'shot.png', hold: 3, regions: { q: [0.1, 0.1, 0.2, 0.2] } };
  assert.deepEqual(pop([{ ...clip, on: [{ at: 1, do: 'highlight', target: 'region:q' }] }]).errors, []);
  const onImage = pop([{ ...clip, on: [{ at: 1, do: 'highlight', target: 'image' }] }]);
  assert.match(onImage.errors[0].message, /device "highlight" is not supported by look "pop"/);
  const onText = pop([{ id: 'a', show: 'statement', say: 'One file.', on: [{ at: 0, do: 'highlight', target: 'text' }] }]);
  assert.match(onText.errors[0].message, /device "highlight" is not supported by look "pop"/);
});

test('the push never shows the edge of the field', () => {
  const shot = { id: 'c', show: 'clipping', src: 'shot.png', hold: 3, regions: { corner: [0.9, 0.9, 0.1, 0.1] }, on: [{ at: 1, do: 'circle', target: 'region:corner' }] };
  for (const [look, format] of [['desk', '16:9'], ['desk', '9:16'], ['pop', '9:16']]) {
    const f = filmFor([shot], look, format);
    const canvas = canvasOf(format);
    for (const t of [0.5, 1, 2, 3]) {
      const field = f.sampleAt(t)[0];
      const left = field.x, top = field.y, w = field.props.w * field.scale, h = field.props.h * field.scale;
      assert.ok(left <= 0 && top <= 0 && left + w >= canvas.w && top + h >= canvas.h, `${look} ${format} t=${t}`);
    }
  }
});

// ---- camera ----

test('desk drifts half a drift either side, alternating by shot; pop is locked', () => {
  const film = filmOf([{ id: 'a', show: 'statement', say: 'One.' }, { id: 'b', show: 'statement', say: 'Two.' }]);
  const drift = registries.looks.get('desk').camera.drift;
  const [even] = expandIn(film, 0).camera, [odd] = expandIn(film, 1).camera;
  const duration = expandIn(film, 0).timing.duration;
  assert.deepEqual(even.map((k) => [k.t, k.x]), [[0, -drift / 2], [duration, drift / 2]]);
  assert.deepEqual(odd.map((k) => [k.t, k.x]), [[0, drift / 2], [expandIn(film, 1).timing.duration, -drift / 2]]);
  assert.deepEqual(expandShot({ id: 'a', show: 'statement', say: 'One.' }, 'pop').camera, []);
});

// ---- cuts ----

const fakeSampled = (id, x, extra = {}) => sampleGraph([node('path', id, { d: 'M0 0H10V10H0Z', fill: '#ff0000', x, y: 100, ...extra })], 0)[0];

test('every cut returns the outgoing frame at p 0 and the incoming frame at p 1', () => {
  const from = [fakeSampled('a', 100), fakeSampled('s', 300)];
  const to = [fakeSampled('b', 500), fakeSampled('s', 700, { rotate: 30 })];
  for (const name of ['cut', 'slide', 'punch', 'match']) {
    const cut = registries.cuts.get(name);
    const args = { from, to, canvas: { w: 1920, h: 1080 }, look: registries.looks.get('desk') };
    assert.deepEqual(cut.apply({ ...args, p: 0 }), from, `${name} p 0`);
    assert.deepEqual(cut.apply({ ...args, p: 1 }), to, `${name} p 1`);
  }
  assert.deepEqual([0, 0.4, 0.2, 0.5].map((_, i) => registries.cuts.get(['cut', 'slide', 'punch', 'match'][i]).dur), [0, 0.4, 0.2, 0.5]);
});

test('slide moves the outgoing frame left a canvas width while the incoming one enters from the right', () => {
  const canvas = { w: 1920, h: 1080 };
  const out = registries.cuts.get('slide').apply({ from: [fakeSampled('a', 100)], to: [fakeSampled('b', 500)], p: 0.25, canvas });
  const e = ease('inOutCubic')(0.25);
  near(out.find((n) => n.id === 'a').x, 100 - e * 1920);
  near(out.find((n) => n.id === 'b').x, 500 + (1 - e) * 1920);
});

test('punch starts the incoming frame at zoom 1.15 and settles', () => {
  const canvas = { w: 1920, h: 1080 };
  const out = registries.cuts.get('punch').apply({ from: [fakeSampled('a', 100)], to: [fakeSampled('b', 500)], p: 0.5, canvas });
  const z = 1.15 + (1 - 1.15) * ease('outExpo')(0.5);
  assert.deepEqual(out.map((n) => n.id), ['b']);
  near(out[0].scale, z);
  near(out[0].x, 960 + (500 - 960) * z);
});

test('match interpolates a shared node at p 0.5 and fades the others', () => {
  const canvas = { w: 1920, h: 1080 };
  const a = { ...fakeSampled('s', 100, { opacity: 1, rotate: 0 }), bbox: [100, 100, 10, 10] };
  const b = { ...fakeSampled('s', 700, { opacity: 0.5, rotate: 40, scale: 2 }), bbox: [700, 100, 20, 20] };
  const out = registries.cuts.get('match').apply({ from: [fakeSampled('o', 0), a], to: [fakeSampled('i', 0), b], p: 0.5, canvas });
  const shared = out.find((n) => n.id === 's');
  assert.deepEqual(shared.bbox, [400, 100, 15, 15]);
  const [fromCopy, toCopy] = shared.children;
  near(fromCopy.rotate, 20); near(toCopy.rotate, 20);
  near(fromCopy.opacity + toCopy.opacity, 0.75, 'opacity interpolated');
  // each copy's box is mapped onto the interpolated box: centre (407.5, 107.5), size 15
  near(fromCopy.scale, 1.5); near(toCopy.scale, 2 * 0.75);
  near(out.find((n) => n.id === 'o').opacity, 0, 'outgoing others are gone after 40%');
  near(out.find((n) => n.id === 'i').opacity, (0.5 - 0.4) / 0.6, 'incoming others fade in over the last 60%');
  const plainMatch = registries.cuts.get('match').apply({ from: [fakeSampled('s', 100)], to: [fakeSampled('s', 700)], p: 0.5, canvas });
  near(plainMatch[0].children[0].x, 400, 'without bboxes the origins interpolate');
});

// ---- buildFilm ----

const THREE = [
  { id: 'a', show: 'statement', say: 'Most dashboards cannot tell you *where a number came from*.', kicker: 'The problem', hero: 'h' },
  { id: 'n', show: 'number', say: 'Four hundred fifty nine rows. One file.', value: 459, suffix: 'rows', label: 'in one file', delta: '+12%', cut: 'slide' },
  { id: 'c', show: 'clipping', src: 'shot.png', say: 'This one shows the query behind every chart.', regions: { query: [0.6, 0.2, 0.3, 0.2] }, cut: 'cut',
    on: [{ at: 'word:query', do: 'highlight', target: 'region:query' }] },
];

test('buildFilm expands every shot once and gives the same frame for the same t in any order', () => {
  const kind = registries.kinds.get('statement');
  const original = kind.expand;
  let calls = 0;
  try {
    kind.expand = (...args) => { calls++; return original(...args); };
    const f = filmFor(THREE);
    assert.equal(calls, 1, 'statement expanded once');
    const times = Array.from({ length: 12 }, (_, i) => (i * f.duration) / 11);
    const forward = times.map((t) => stateKey(f.sampleAt(t)));
    const g = filmFor(THREE);
    const backward = [...times].reverse().map((t) => stateKey(g.sampleAt(t))).reverse();
    assert.deepEqual(forward, backward);
    assert.deepEqual(times.map((t) => stateKey(f.sampleAt(t))), forward, 'a second pass on the same film');
    assert.equal(f.frameCount, buildTimeline(filmOf(THREE), { fps: FPS }).frameCount);
  } finally {
    kind.expand = original;
  }
});

test('a cut starts on the plain outgoing frame and ends on the plain incoming one', () => {
  for (const [look, cut] of [['desk', 'slide'], ['desk', 'match'], ['pop', 'punch'], ['pop', 'slide']]) {
    const s = [{ ...THREE[0], hero: 'h' }, { ...THREE[0], id: 'b', say: 'One file. No server.', cut, hero: 'h' }];
    const f = filmFor(s, look);
    const [first, second] = buildTimeline(filmOf(s, look), { fps: FPS }).shots;
    const dur = registries.cuts.get(cut).dur;
    assert.equal(stateKey(f.sampleAt(second.start)), stateKey(f.sampleShot(0, first.duration)), `${look} ${cut} starts on the outgoing end`);
    assert.equal(stateKey(f.sampleAt(second.start + dur)), stateKey(f.sampleShot(1, dur)), `${look} ${cut} ends on the incoming frame`);
    assert.notEqual(stateKey(f.sampleAt(second.start + dur / 2)), stateKey(f.sampleShot(1, dur / 2)), `${look} ${cut} differs mid-cut`);
    // just before the end the cut is already almost the incoming frame: the hero sits within a pixel of its place
    const late = f.sampleAt(second.start + dur - 1 / 600).findLast((n) => n.id === 'h'); // the incoming copy
    const plain = f.sampleShot(1, dur - 1 / 600).find((n) => n.id === 'h');
    if (cut !== 'match') assert.ok(Math.abs(late.x - plain.x) < 2, `${look} ${cut} converges`);
  }
});

test('heroes carry their box so a match can morph them', () => {
  const f = filmFor(THREE);
  const hero = f.sampleAt(1).find((n) => n.id === 'h');
  assert.equal(hero.bbox.length, 4);
  assert.ok(hero.bbox[2] > 0 && hero.bbox[3] > 0);
});

test('resolveLook applies the mode default and the accent', () => {
  assert.equal(resolveLook({ shots: [] }).name, 'desk');
  assert.equal(resolveLook({ mode: 'viral', shots: [] }).name, 'pop');
  assert.equal(resolveLook({ accent: '#ff6600', shots: [] }).palette.accent, '#ff6600');
});

// ---- vertical formats ----

test('every kind stays inside the safe area on every format once its entrances have landed', () => {
  const shots = [
    { id: 'a', show: 'statement', say: 'Most dashboards cannot tell you where a number came from.', kicker: 'The problem' },
    { id: 'n', show: 'number', say: 'Four hundred fifty nine rows.', value: 459, prefix: '$', suffix: 'K', label: 'rows in one file, with no server behind it', delta: '+12% this year' },
    { id: 'c', show: 'clipping', src: 'shot.png', hold: 3, caption: 'Figure one: the query', regions: { q: [0.1, 0.1, 0.8, 0.8] } },
  ];
  // pop sets a hook of a few words (design 5.2: at most seven); a desk statement is a full sentence
  const popStatement = { id: 'a', show: 'statement', say: 'One file. No server.', kicker: 'The problem' };
  for (const look of ['desk', 'pop']) {
    for (const format of ['16:9', '9:16', '1:1', '4:5']) {
      for (const shot of look === 'pop' ? [popStatement, ...shots.slice(1)] : shots) {
        const { boxes, canvas, nodes, timing } = expandShot(shot, look, format);
        if (shot.show === 'statement') assert.equal(textNode(nodes).props.layout.overflow, false, `${look} ${format} fits`);
        // pop on 9:16 composes inside the platform safe zone; everything else inside the plain safe margin
        const insets = look === 'pop' && format === '9:16' ? viralOf(canvas) : safeInsets([canvas.w, canvas.h]);
        for (const [target, box] of Object.entries(boxes)) inside(box, insets, canvas, `${look} ${format} ${shot.show} ${target}`);
        // Every all-text node as drawn once landed (kicker, label, caption, the figure group). Nodes with paths (the
        // card, tags, hairlines) need the page to measure and are covered by their target boxes above.
        const drawn = annotate(sampleGraph(nodes, timing.duration).filter(isTextOnly));
        for (const n of drawn) inside(n.bbox, insets, canvas, `${look} ${format} ${shot.show} node ${n.id}`);
      }
    }
  }
});

// ---- details found in the review renders ----

test('an apostrophe inside a word is set as the typographic one, and the word still lands on its spoken word', () => {
  const { nodes, timing } = expandShot({ id: 'a', show: 'statement', say: "Dashboards can't say." });
  const text = textNode(nodes);
  assert.ok(text.props.layout.lines.flatMap((l) => l.words).some((w) => w.text === 'can\u2019t'));
  near(lastKey(text.wordTracks[1].opacity).t, timing.words[1].start);
});

test('the caption fades out while the camera pushes in on a region', () => {
  const shot = { id: 'c', show: 'clipping', src: 'shot.png', say: 'This one shows the query behind every chart.', caption: 'The query',
    regions: { query: [0.6, 0.2, 0.3, 0.2] }, on: [{ at: 'word:query', do: 'highlight', target: 'region:query' }] };
  const { nodes, timing } = expandShot(shot);
  const caption = textNode(nodes, 'c.caption');
  const shown = lastKey(caption.tracks.y).t; // the entrance has landed
  near(sample(caption.tracks.opacity, shown), 1, 'shown once it has entered');
  near(sample(caption.tracks.opacity, timing.words[4].start), 0, 'gone when it lands');
  const quiet = textNode(expandShot({ ...shot, on: undefined }).nodes, 'c.caption');
  near(sample(quiet.tracks.opacity, 5), 1, 'stays without a push');
});

test('a match keeps the shared field first, under the outgoing frame, and the hero above it', () => {
  const field = (x) => Object.freeze({ ...fakeSampled('field', x), depth: 1 });
  const out = registries.cuts.get('match').apply({
    from: [field(0), fakeSampled('old', 0), fakeSampled('h', 10)],
    to: [field(0), fakeSampled('h', 20), fakeSampled('new', 0)],
    p: 0.5, canvas: { w: 1920, h: 1080 },
  });
  assert.deepEqual(out.map((n) => n.id), ['field', 'old', 'h', 'new']);
});



// ---- the count's rhythm and the device notes from the review ----

const visibleSteps = (digits, t) => digits.props.steps.filter((step) => step.words.every((i) => sample(digits.wordTracks[i].opacity, t) === 1)).length;

test('exactly one count step is visible at every frame, at most 24 steps, at the look rhythm, each formatted like the final value', () => {
  for (const look of ['desk', 'pop']) {
    const { nodes, timing } = expandShot({ id: 'n', show: 'number', say: 'We counted twelve thousand three hundred forty five point six rows.', value: 12345.6, decimals: 1, label: 'rows' }, look);
    const digits = textNode(nodes, 'n.value.digits');
    const steps = digits.props.steps;
    assert.ok(steps.length <= 24, `${look}: ${steps.length} steps`);
    for (let frame = 0; frame <= Math.ceil(timing.duration * FPS); frame++) {
      assert.equal(visibleSteps(digits, frame / FPS), 1, `${look} frame ${frame}`);
    }
    for (const step of steps) assert.match(step.text, /^\d{1,3}(,\d{3})*\.\d$/, `${look} step ${step.text}`);
    const gaps = steps.slice(2).map((s, i) => s.t - steps[i + 1].t);
    const rhythm = look === 'desk' ? 12 : FPS;
    assert.ok(gaps.every((g) => g >= 1 / rhythm - 1e-9), `${look}: steps at most ${rhythm} a second`);
  }
});

test('a punch at 0 keeps both of its keys at t 0, so the shot opens on the peak', () => {
  const f = filmFor([{ id: 'a', show: 'statement', say: 'One file.', on: [{ at: 0, do: 'punch', target: 'text' }] }], 'pop', '9:16');
  const peak = registries.looks.get('pop').devices.punch.scale;
  near(f.sampleShot(0, 0).find((n) => n.id === 'a.text').scale, peak, 'the jump survives the merge');
  near(f.sampleShot(0, 1).find((n) => n.id === 'a.text').scale, 1, 'and settles');
});
