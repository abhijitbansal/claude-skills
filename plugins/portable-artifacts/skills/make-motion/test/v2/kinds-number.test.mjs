// The number kind: the count, its landing on the spoken figure, the desk and pop compositions. Pure scene-graph work
// with a fake text measure (helpers/kinds.mjs).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sample } from '../../engine/time/track.mjs';
import { ease } from '../../engine/time/ease.mjs';
import { gridX } from '../../engine/looks/index.mjs';
import { countSteps } from '../../engine/kinds/number.mjs';
import { validateFilm } from '../../scripts/v2/spec.mjs';
import '../../engine/looks/index.mjs';
import '../../engine/modes/index.mjs';
import '../../engine/devices/index.mjs';
import '../../engine/kinds/index.mjs';
import '../../engine/cuts/index.mjs';
import {
  FPS, EPS, canvasOf, viralOf, filmOf, expandIn, expandShot, all, textNode, near, inside, overlaps, shownAt, slugOf,
  centredPop, plateBox, visibleSteps,
} from './helpers/kinds.mjs';

let specDir;
before(() => {
  specDir = mkdtempSync(path.join(tmpdir(), 'mm-v2-kinds-'));
  writeFileSync(path.join(specDir, 'shot.png'), 'x');
});
after(() => rmSync(specDir, { recursive: true, force: true }));
test('a number lands its count on the spoken figure', () => {
  const { nodes, timing } = expandShot({ id: 'n', show: 'number', say: 'We saved forty one percent.', value: 41, suffix: '%', label: 'saved' }, 'desk');
  const fig = nodes.find((n) => n.id === 'n.value');
  assert.ok(fig, 'the figure is the top-level node n.value');
  const digits = textNode(fig.children, 'n.value.digits');
  const finalWords = digits.props.steps.at(-1).words; // word indexes of the final value's digits
  for (const i of finalWords) near(shownAt(digits.wordTracks[i].opacity), timing.words[2].start, 'final value appears on "forty"');
});

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

test('desk number: a one-digit figure up to 820 units, baseline at 72%, flush left on column 2 by its ink, no hairline; beside it, 48 units after its ink, the label in ink at step 4 over the delta in plain label caps at step 2 in ink2, the block bottom-aligned on the figure baseline', () => {
  const { nodes, ctx, canvas, boxes } = expandShot({ id: 'n', show: 'number', hold: 3, value: 5, label: 'skills', delta: 'one JSON file each' }, 'desk', '16:9');
  const look = ctx.look;
  const fig = nodes.find((n) => n.id === 'n.value');
  const digits = textNode(fig.children, 'n.value.digits');
  // hand-computed: a "5" is 0.55 em wide, its ink 0.02 em in from each side, so 0.51 em: columns 2 to 9 (1144 px)
  // would take it to 2243 px, so the 820 cap binds; its ink is 0.51 x 820 = 418.2 px, under half the span (572)
  assert.equal(digits.props.font.size, 820);
  const baseline = fig.props.y + digits.props.y + digits.props.layout.lines[0].y;
  near(baseline, 0.72 * 1080, 'baseline at 72%');
  near(boxes.value[0], 242, 'ink flush on column 2');
  near(boxes.value[2], 0.51 * 820, 'the figure box is its ink');
  assert.equal(nodes.find((n) => n.id === 'n.rule'), undefined, 'no hairline');
  const label = textNode(nodes, 'n.label');
  assert.equal(label.props.font.family, look.fonts.label.family, 'the label face');
  assert.equal(label.props.font.size, look.scale[3], 'scale step 4');
  assert.equal(label.props.fill, look.palette.ink, 'in ink, not ink2');
  near(label.props.font.tracking, look.tracking(look.scale[3], 'label'), 'the label tracking');
  assert.deepEqual(label.props.layout.lines[0].words.map((w) => w.text), ['SKILLS']);
  const labelInk = 242 + 418.2 + 48;
  near(label.props.x + 0.02 * 132, labelInk, 'label ink 48 units after the figure ink');
  // the delta: plain label caps, no plate
  const delta = all(nodes).find((n) => n.id === 'n.delta');
  assert.ok(!all([delta]).some((n) => n.type === 'path'), 'no plate');
  const deltaText = all([delta]).find((n) => n.type === 'text');
  assert.equal(deltaText.props.font.family, look.fonts.label.family);
  assert.equal(deltaText.props.font.size, look.scale[1], 'scale step 2');
  assert.equal(deltaText.props.fill, look.palette.ink2);
  assert.deepEqual(deltaText.props.layout.lines.flatMap((l) => l.words.map((w) => w.text)), ['ONE', 'JSON', 'FILE', 'EACH']);
  near(boxes.delta[0], labelInk, 'delta ink flush with the label ink');
  // bottom-aligned: the delta's last baseline on the figure baseline, the label's baseline 24 units over the delta's cap line
  near(boxes.delta[1] + boxes.delta[3] - 0.12 * 44, baseline, 'the delta sits on the figure baseline');
  const labelBaseline = label.props.y + label.props.layout.lines.at(-1).y;
  near(boxes.delta[1] - labelBaseline, 24, 'the label over the delta, 24 units from its baseline to the delta cap line');
  // reading order: 5, then SKILLS, then ONE JSON FILE EACH
  assert.ok(boxes.label[1] < boxes.delta[1], 'the label reads before the delta');
  assert.ok(boxes.label[0] + boxes.label[2] <= gridX(look, canvas, 13) + EPS && boxes.delta[0] + boxes.delta[2] <= gridX(look, canvas, 13) + EPS, 'inside the right margin');
});

test('desk number: a figure wider than half the span takes the same block under its baseline: the label in ink 40 units below, the delta under it; three digits stop at 560', () => {
  for (const [format, toColumn] of [['16:9', 9], ['9:16', 11]]) {
    const { nodes, ctx, canvas, boxes } = expandShot({ id: 'n', show: 'number', hold: 3, value: 1459, suffix: 'K', label: 'rows in one file', delta: '+12%' }, 'desk', format);
    const look = ctx.look;
    const fig = nodes.find((n) => n.id === 'n.value');
    const digits = textNode(fig.children, 'n.value.digits');
    const size = digits.props.font.size;
    assert.ok(size >= look.scale[4] && size <= 560, `${format} size ${size}`);
    const span = gridX(look, canvas, toColumn + 1) - look.grid.gutter - gridX(look, canvas, 2);
    assert.ok(boxes.value[2] <= span + EPS && (size === 560 || boxes.value[2] > 0.97 * span), `${format} fills the span unless capped`);
    near(boxes.value[0], gridX(look, canvas, 2), `${format} flush left by its ink`);
    const baseline = fig.props.y + digits.props.y + digits.props.layout.lines[0].y;
    const label = textNode(nodes, 'n.label');
    const labelSize = label.props.font.size;
    assert.ok(look.scale.includes(labelSize) && labelSize <= look.scale[3] && size >= 3 * labelSize - EPS, `${format} label at step 4, or the step under it that keeps the figure 3 times its size: ${labelSize}`);
    assert.equal(label.props.fill, look.palette.ink);
    near(label.props.y + label.props.layout.lines[0].y - 0.74 * label.props.font.size, baseline + 40, `${format} label ink 40 units under the baseline`);
    near(label.props.x + 0.02 * label.props.font.size, gridX(look, canvas, 2), `${format} label flush left`);
    const labelBaseline = label.props.y + label.props.layout.lines.at(-1).y;
    near(boxes.delta[1] - labelBaseline, 24, `${format} the delta under the label`);
    near(boxes.delta[0], gridX(look, canvas, 2), `${format} the delta flush left`);
    assert.ok(boxes.delta[1] + boxes.delta[3] <= canvas.h - look.grid.margin + EPS, `${format} inside the bottom margin`);
    assert.ok(!overlaps(boxes.delta, boxes.value) && !overlaps(boxes.delta, boxes.label), `${format} delta clear`);
  }
  const three = expandShot({ id: 'n', show: 'number', hold: 3, value: 459, label: 'rows' }, 'desk', '16:9');
  assert.equal(textNode(three.nodes, 'n.value.digits').props.font.size, 560, 'three digits are capped at 560');
});

test('a figure too long for the span stops at scale step 5 and says it overflows', () => {
  const { nodes, ctx } = expandShot({ id: 'n', show: 'number', hold: 2, value: 123456789, suffix: 'rows', label: 'x' }, 'desk', '9:16');
  const digits = textNode(nodes, 'n.value.digits');
  assert.equal(digits.props.font.size, ctx.look.scale[4]);
  assert.equal(digits.props.layout.overflow, true);
});

test('a number with a kicker gets the slug; without one, none', () => {
  const film = filmOf([{ id: 'n', show: 'number', hold: 3, value: 5, label: 'skills', kicker: 'The count' }, { id: 'm', show: 'number', hold: 3, value: 6, label: 'x' }]);
  const slug = slugOf(expandIn(film, 0).nodes, 'n');
  assert.ok(slug, 'a slug');
  assert.equal(slug.group.children.find((n) => n.id === 'n.slug.number').props.layout.lines[0].words[0].text, '01');
  assert.equal(slugOf(expandIn(film, 1).nodes, 'm'), null);
});

test('pop number: the figure fills the safe width up to 900 units, flush left; label tag at step 3 40 units under the baseline; delta plain label caps in ink2 at step 2, no plate, flush left, 16 under that; the block centred', () => {
  const { nodes, ctx, boxes, timing, canvas } = expandShot({ id: 'n', show: 'number', say: 'Five skills. One file each.', value: 5, label: 'skills', delta: 'one JSON file each' }, 'pop', '9:16');
  const look = ctx.look;
  const safe = viralOf(canvas);
  const fig = nodes.find((n) => n.id === 'n.value');
  const digits = textNode(fig.children, 'n.value.digits');
  // hand-computed: a "5" is 0.51 em of ink; 765 px of safe width would take it to 1500 px, so the 900 cap binds
  assert.equal(digits.props.font.size, 900);
  near(boxes.value[0], safe.left, 'figure ink flush left on the safe edge');
  const baseline = fig.props.y + digits.props.y + digits.props.layout.lines[0].y;
  const label = nodes.find((n) => n.id === 'n.label');
  const labelBox = plateBox(label);
  near(labelBox[0], safe.left, 'label tag flush left');
  near(labelBox[1], baseline + 40, 'label tag 40 units under the baseline');
  assert.equal(label.children.find((n) => n.type === 'path').props.fill, look.palette.accent);
  assert.equal(label.children.find((n) => n.type === 'text').props.font.size, look.scale[2], 'scale step 3');
  const delta = nodes.find((n) => n.id === 'n.delta');
  assert.ok(!all([delta]).some((n) => n.type === 'path'), 'no plate');
  const deltaText = all([delta]).find((n) => n.type === 'text');
  assert.equal(deltaText.props.fill, look.palette.ink2);
  assert.equal(deltaText.props.font.size, look.scale[1], 'scale step 2');
  assert.equal(deltaText.props.font.family, look.fonts.label.family);
  assert.ok(deltaText.props.layout.lines[0].words.every((w) => w.text === w.text.toUpperCase()), 'label caps');
  const deltaBox = boxes.delta;
  near(deltaBox[0], safe.left, 'delta ink flush left');
  near(deltaBox[1], labelBox[1] + labelBox[3] + 16, 'delta cap line 16 units under the label tag');
  near((boxes.value[1] + deltaBox[1] + deltaBox[3]) / 2, safe.top + (canvas.h - safe.top - safe.bottom) / 2, 'the block centred in the safe zone');
  const land = timing.words[0].start;
  assert.ok(sample(fig.tracks.scale, land + look.moves.emphasize.dur) > 1, 'the figure still pulses as it lands');
  const three = expandShot({ id: 'n', show: 'number', hold: 2, value: 459, label: 'x' }, 'pop', '16:9');
  assert.equal(textNode(three.nodes, 'n.value.digits').props.font.size, 760, 'three digits up to 760');
  near(three.boxes.value[0], gridX(look, canvasOf('16:9'), 1), 'flush left on column 1 on 16:9');
});

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

test('the count lands on a hyphenated number, on the figure rather than a lone "one", and past a year', () => {
  const land = (say, value) => {
    const r = expandShot({ id: 'n', show: 'number', say, value, suffix: '%', label: 'x' });
    const digits = textNode(r.nodes, 'n.value.digits');
    return { at: shownAt(digits.wordTracks[digits.props.steps.at(-1).words[0]].opacity), words: r.timing.words };
  };
  const hyphen = land('We saved forty-one percent.', 41);
  near(hyphen.at, hyphen.words[2].start, '"forty-one"');
  const lone = land('No one knows, but 41 percent.', 41);
  near(lone.at, lone.words[4].start, '"41", not "one"');
  const year = land('In 2024, forty one percent.', 41);
  near(year.at, year.words[2].start, '"forty", not "2024"');
});

test('the count shows at most 24 values, a centred count centres every value, -$5 reads right, and huge values are refused', () => {
  const steps = countSteps({ value: 9999, decimals: 0, start: 0, land: 1, rate: 60, curve: ease('outCubic') });
  assert.ok(steps.length <= 24, `${steps.length} values`);
  const { nodes } = expandShot({ id: 'n', show: 'number', say: 'Four hundred fifty nine rows.', value: 1459, label: 'rows' }, centredPop(), '9:16');
  const digits = textNode(nodes, 'n.value.digits');
  const words = digits.props.layout.lines[0].words;
  const centreOf = (step) => { const first = words[step.words[0]], last = words[step.words.at(-1)]; return (first.x + last.x + last.width) / 2; };
  const final = centreOf(digits.props.steps.at(-1));
  for (const step of digits.props.steps) near(centreOf(step), final, `step ${step.text} centred`);
  // a stack counts flush left: every value starts in the same first cell
  const flush = textNode(expandShot({ id: 'n', show: 'number', say: 'Four hundred fifty nine rows.', value: 1459, label: 'rows' }, 'pop', '9:16').nodes, 'n.value.digits');
  const flushWords = flush.props.layout.lines[0].words;
  for (const step of flush.props.steps) near(flushWords[step.words[0]].x, flushWords[flush.props.steps.at(-1).words[0]].x, `pop step ${step.text} starts flush`);
  const negative = expandShot({ id: 'n', show: 'number', hold: 2, value: -5, prefix: '$', label: 'x' });
  assert.equal(textNode(negative.nodes, 'n.value.prefix').props.layout.lines[0].words.map((w) => w.text).join(''), '-$');
  assert.equal(textNode(negative.nodes, 'n.value.digits').props.steps.at(-1).text, '5');
  const huge = validateFilm({ version: 2, shots: [{ id: 'n', show: 'number', hold: 2, value: 1e15, label: 'x' }] }, { specDir });
  assert.equal(huge.errors[0].path, 'shots[0].value');
});

test('pop number: a kicker is a tag at step 2, flush left, 28 units over the figure cap line, the block still centred in the safe zone (it is never dropped)', () => {
  const { nodes, ctx, boxes, canvas } = expandShot({ id: 'n', show: 'number', say: 'Five skills.', value: 5, label: 'skills', kicker: 'In numbers' }, 'pop', '9:16');
  const look = ctx.look;
  const safe = viralOf(canvas);
  const kicker = nodes.find((n) => n.id === 'n.kicker');
  assert.ok(kicker, 'the kicker is drawn');
  assert.equal(kicker.children.find((n) => n.type === 'path').props.fill, look.palette.accent);
  const text = kicker.children.find((n) => n.type === 'text');
  assert.equal(text.props.font.size, look.scale[1], 'scale step 2');
  assert.deepEqual(text.props.layout.lines[0].words.map((w) => w.text), ['IN', 'NUMBERS']);
  const box = plateBox(kicker);
  near(box[0], safe.left, 'flush left');
  near(boxes.value[1] - (box[1] + box[3]), 28, '28 units over the figure cap line');
  assert.ok(box[1] >= safe.top - EPS, 'inside the safe zone');
  near((box[1] + boxes.label[1] + boxes.label[3]) / 2, safe.top + (canvas.h - safe.top - safe.bottom) / 2, 'the block, kicker included, centred');
});

test('desk number: the label steps down from step 4 until the figure is at least three times its size (the review hero rule)', () => {
  for (const format of ['16:9', '9:16', '1:1', '4:5']) {
    const { nodes } = expandShot({ id: 'n', show: 'number', say: 'Four hundred fifty nine rows. One file.', value: 459, suffix: 'rows', label: 'in one file', delta: '+12%' }, 'desk', format);
    const figure = textNode(nodes, 'n.value.digits').props.font.size;
    const label = textNode(nodes, 'n.label').props.font.size;
    assert.ok(figure >= 3 * label - EPS, `${format}: figure ${figure} against label ${label}`);
  }
  const { nodes } = expandShot({ id: 'n', show: 'number', hold: 3, value: 5, label: 'skills' }, 'desk', '16:9');
  assert.equal(textNode(nodes, 'n.label').props.font.size, 132, 'a big figure keeps the label at step 4');
});
