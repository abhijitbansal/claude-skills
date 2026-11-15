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
import { countSteps } from '../../engine/kinds/number.mjs';
import { pulsePeaks, enterStarts } from '../../engine/kinds/statement.mjs';
import { pulseScale } from '../../engine/kinds/shared.mjs';
import { landing } from '../../engine/devices/shared.mjs';
import { establishingFindings } from '../../engine/kinds/clipping-rules.mjs';
import { resolveAnchor } from '../../engine/script/anchors.mjs';
import { FORMATS, safeInsets, VIRAL_SAFE_ZONE } from '../../template/formats.mjs';
import { validateFilm, SpecError } from '../../scripts/v2/spec.mjs';
import { loadFilm } from '../../scripts/v2/pipeline.mjs';

const FPS = 30;
const EPS = 1e-6;
// A fake measure with ink, as the page's canvas reports it: capitals and b d f h k l t reach 0.74 em, other letters
// 0.5 em; g j p q y descend 0.22 em; the ink starts 0.02 em in and ends 0.02 em before the advance.
const inkUp = (text) => (/[A-Z0-9bdfhklt]/.test(text) ? 0.74 : 0.5);
const measure = (text, font) => {
  const width = [...text].length * font.size * 0.55;
  return {
    width, ascent: font.size * 0.8, descent: font.size * 0.2,
    inkAscent: inkUp(text) * font.size, inkDescent: (/[gjpqy]/.test(text) ? 0.22 : 0) * font.size, inkLeft: 0.02 * font.size, inkRight: width - 0.02 * font.size,
  };
};
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
// The shot as the second of a film: in viral mode the first shot reads from frame 0 (see the hook tests), later shots arrive word by word.
const FILLER = { id: 'filler', show: 'statement', hold: 1, text: 'Hi' };
const expandSecond = (shot, look = 'desk', format = '16:9') => expandIn(filmOf([FILLER, shot], look, format), 1);
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

// Every word track of a statement's hero: its text node's, or each line's of a stack, in word order.
const heroWords = (nodes, hero) => {
  const n = nodes.find((x) => x.id === hero);
  return n.type === 'group' ? n.children.flatMap((line) => line.wordTracks) : n.wordTracks;
};

test('statement words land on their spoken words', () => {
  const { nodes, timing } = expandSecond({ id: 'a', show: 'statement', say: 'One file. No server.' }, 'desk');
  const words = heroWords(nodes, 'a.text'), spoken = timing.words;
  assert.equal(words.length, spoken.length);
  words.forEach((w, i) => near(lastKey(w.opacity).t, spoken[i].start, `desk word ${i}`));
  // pop (viral) shows every word from the first frame and lights each on its spoken word
  const pop = expandSecond({ id: 'a', show: 'statement', say: 'One file. No server.' }, 'pop');
  const lit = heroWords(pop.nodes, 'a.text');
  assert.equal(lit.length, spoken.length);
  lit.forEach((w, i) => near(w.fill.points[1].t, pop.timing.words[i].start, `pop word ${i}`));
});

test("an emphasised word gets the look's emphasis and nothing else", () => {
  const desk = expandShot({ id: 'a', show: 'statement', say: 'It is *lying* to you.' }, 'desk').nodes;
  assert.equal(desk.filter((n) => n.props.under).length, 1);
  assert.ok(!textNode(desk).wordTracks.some((w) => w.fill), 'desk recolours nothing');
  const pop = expandSecond({ id: 'a', show: 'statement', say: 'It is *lying* to you.' }, 'pop').nodes;
  assert.equal(pop.filter((n) => n.props.under).length, 0);
  const look = registries.looks.get('pop');
  const words = heroWords(pop, 'a.text');
  assert.equal(lastKey(words[2].fill).v, look.palette.accent, 'the emphasised word lights in the accent');
  assert.deepEqual(words.filter((w) => lastKey(w.fill).v === look.palette.accent).length, 1, 'and only it');
  assert.ok(words.every((w) => w.scale === undefined), 'pop no longer scales an emphasised word');
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
  const out = registries.cuts.get('slide').apply({ from: [field(-20), fakeSampled('a', 100)], to, p: 0.5, canvas });
  assert.deepEqual(out.map((n) => n.id), ['field', 'a', 'b']);
  assert.equal(out[0], to[0], 'the incoming field, unmoved');
  near(out[1].x, 100 - 0.5 * 1920);
  near(out[2].x, 500 + 0.5 * 1920);
});

// ---- statement ----

test('desk statement carries the frame: fitted up to 300 units in 64% of the height and columns 2 to 9, its ink centred at 50%', () => {
  // hand-computed: "Dashboards." is one word of 11 glyphs of 0.55 em, tracked -0.01 em at this size: 5.94 em; columns
  // 2 to 9 on 1920 x 1080 run from 242 to 1386 (1144 px), so the width binds at floor(1144 / 5.94) = 192 px, under 300
  const short = expandShot({ id: 'a', show: 'statement', say: 'Dashboards.' });
  const one = textNode(short.nodes);
  assert.equal(one.props.font.size, 192);
  assert.equal(one.props.x, 242);
  near(one.props.y + one.props.layout.lines[0].y - 0.7 * 192 / 2, 540, 'cap line to baseline centred on 50%');
  // a long sentence: at most 4 lines, its block within 64% of the height, inside the span, ink centred on 50%
  const { nodes, ctx, canvas } = expandShot({ id: 'a', show: 'statement', say: 'Most dashboards cannot tell you where a number came from.' });
  const text = textNode(nodes);
  const look = ctx.look;
  const { layout, font } = text.props;
  assert.equal(text.props.x, gridX(look, canvas, 2));
  assert.ok(layout.width <= gridX(look, canvas, 10) - look.grid.gutter - gridX(look, canvas, 2) + EPS, 'stays inside columns 2 to 9');
  assert.ok(layout.height <= 0.64 * canvas.h + EPS, `block ${layout.height} within 64% of the height`);
  assert.ok(font.size >= look.scale[2] && font.size <= 300, `size ${font.size}`);
  assert.ok(layout.lines.length <= look.maxLines.display);
  assert.equal(font.lineHeight, 1.1);
  assert.equal(text.props.fill, look.palette.ink);
  const inkTop = text.props.y + layout.lines[0].y - 0.7 * font.size;
  near((inkTop + text.props.y + layout.lines.at(-1).y) / 2, 0.5 * canvas.h, 'ink centre');
  const capped = expandShot({ id: 'a', show: 'statement', say: 'Hi.' }, 'desk', '9:16');
  assert.equal(textNode(capped.nodes).props.font.size, 300, 'a short word stops at 300 units');
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

// The slug's card as built: its group (the card's entrance) and the box it would have unturned, in canvas pixels.
function slugOf(nodes, id) {
  const group = all(nodes).find((n) => n.id === `${id}.slug`);
  if (!group) return null;
  const paper = group.children.find((n) => n.id === `${id}.slug.paper`);
  const xs = paper.props.d.match(/-?\d+(?:\.\d+)?/g).map(Number).filter((_, i) => i % 2 === 0);
  const ys = paper.props.d.match(/-?\d+(?:\.\d+)?/g).map(Number).filter((_, i) => i % 2 === 1);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  return { group, w, h, right: group.props.x + Math.max(...xs), top: group.props.y + Math.min(...ys) };
}

test('desk slug: a taped card turned +3 degrees, right on column 12, top at 14%, holding the shot number and the kicker, in the same place every shot', () => {
  const film = filmOf([
    { id: 'a', show: 'statement', say: 'One file.', kicker: 'The problem' },
    { id: 'n', show: 'number', value: 3, label: 'skills', hold: 2 },
    { id: 'b', show: 'statement', say: 'Scripts do the rest of it.', kicker: 'portable-artifacts' },
    { id: 'c', show: 'statement', say: 'No kicker here.' },
  ]);
  const look = registries.looks.get('desk');
  const canvas = canvasOf('16:9');
  const right = gridX(look, canvas, 13), top = 0.14 * canvas.h;
  const slugs = [['a', 0, '01'], ['b', 2, '03']].map(([id, index, number]) => {
    const { nodes, timing } = expandIn(film, index);
    const slug = slugOf(nodes, id);
    assert.ok(slug, `${id} has a slug`);
    assert.equal(slug.group.props.rotate, 3, `${id}: turned exactly +3 degrees`);
    assert.ok(Math.abs(slug.right - right) < 2, `${id}: right edge ${slug.right} on column 12 (${right}), within the paper's hand jitter`);
    assert.ok(Math.abs(slug.top - top) < 2, `${id}: top ${slug.top} at 14% (${top})`);
    assert.ok(slug.group.children.some((n) => n.id === `${id}.slug.tape1`), 'taped');
    const numeral = slug.group.children.find((n) => n.id === `${id}.slug.number`);
    assert.equal(numeral.props.layout.lines[0].words[0].text, number);
    assert.equal(numeral.props.font.family, look.fonts.display.family);
    const kicker = slug.group.children.find((n) => n.id === `${id}.kicker`);
    assert.equal(kicker.props.font.family, look.fonts.label.family);
    assert.equal(kicker.props.font.size, look.scale[1], 'kicker at scale step 2');
    assert.equal(kicker.props.role, 'kicker');
    assert.ok(kicker.props.layout.lines[0].words.every((w) => w.text === w.text.toUpperCase()), 'caps');
    near(sample(slug.group.tracks.opacity, look.moves.enter.dur), 1, 'enters with the look at the shot start');
    near(sample(slug.group.tracks.opacity, 0), 0);
    // never over the text block: the turned card's box and the text's ink box do not meet
    const text = textNode(nodes, `${id}.text`);
    const ink = [text.props.x + text.props.layout.lines[0].x, text.props.y + text.props.layout.lines[0].y - 0.74 * text.props.font.size,
      text.props.layout.width, text.props.layout.lines.at(-1).y - text.props.layout.lines[0].y + 0.96 * text.props.font.size];
    const a = 3 * Math.PI / 180, cw = slug.w * Math.cos(a) + slug.h * Math.sin(a), ch = slug.w * Math.sin(a) + slug.h * Math.cos(a);
    const turned = [slug.group.props.x - cw / 2, slug.group.props.y - ch / 2, cw, ch];
    assert.ok(!overlaps(turned, ink), `${id}: slug ${JSON.stringify(turned.map(Math.round))} clear of text ${JSON.stringify(ink.map(Math.round))}`);
    void timing;
    return slug;
  });
  assert.equal(slugOf(expandIn(film, 3).nodes, 'c'), null, 'no kicker, no slug');
  // a kicker wider than three columns wraps on the card, after its hyphen: a slug, not a banner
  const long = slugs[1].group.children.find((n) => n.id === 'b.kicker').props.layout;
  assert.deepEqual(long.lines.map((l) => l.words.map((w) => w.text).join(' ')), ['PORTABLE-', 'ARTIFACTS']);
  const three = gridX(look, canvas, 4) - look.grid.gutter - gridX(look, canvas, 1);
  assert.ok(long.width <= three + EPS, `kicker ${long.width} within three columns (${three})`);
  // when the text would run under the card the span stops a column earlier: a tall card from a wrapped kicker over a
  // sentence that fills columns 2 to 9
  const tall = filmOf([{ id: 't', show: 'statement', say: 'Every chart on this page shows the query behind it.', kicker: 'one two three four five six seven' }]);
  const tallText = textNode(expandIn(tall, 0).nodes, 't.text');
  const tallSlug = slugOf(expandIn(tall, 0).nodes, 't');
  const textRight = tallText.props.x + tallText.props.layout.width;
  assert.ok(textRight <= tallSlug.right - tallSlug.w, `text ends at ${textRight}, before the card starts at ${tallSlug.right - tallSlug.w}`);
  assert.ok(tallText.props.layout.width <= gridX(look, canvas, 10) - look.grid.gutter - gridX(look, canvas, 2) + EPS);
});

test('a slug never squeezes a desk statement into overflow: narrowing stops first and the block drops below the card', () => {
  const long = expandShot({ id: 'b', show: 'statement', say: 'Most dashboards cannot tell you where a number came from.', kicker: 'The problem' }, 'desk', '1:1');
  const text = textNode(long.nodes, 'b.text');
  assert.equal(text.props.layout.overflow, false, 'a sentence that cannot fit at the floor is set smaller rather than overflow');
  // and still clear of the card: narrowing stopped before overflow, so the block dropped below it
  const slug = slugOf(long.nodes, 'b');
  const a3 = 3 * Math.PI / 180, cw = slug.w * Math.cos(a3) + slug.h * Math.sin(a3), ch = slug.w * Math.sin(a3) + slug.h * Math.cos(a3);
  const turned = [slug.group.props.x - cw / 2, slug.group.props.y - ch / 2, cw, ch];
  const ink = [text.props.x, text.props.y + text.props.layout.lines[0].y - 0.74 * text.props.font.size, text.props.layout.width, text.props.layout.lines.at(-1).y - text.props.layout.lines[0].y + 0.96 * text.props.font.size];
  assert.ok(!overlaps(turned, ink), 'clear of the card');
});

test('desk highlight band holds its words\' ink, descenders included, and touches neither neighbouring line', () => {
  const { nodes } = expandShot({ id: 'c', show: 'statement', say: 'On your machine. *Nothing* is sent.', text: 'On your | machine. | Nothing | is sent.' });
  const text = textNode(nodes, 'c.text');
  const { layout, font } = text.props;
  const band = nodes.find((n) => n.props.under);
  const lineIndex = layout.lines.findIndex((l) => l.words.some((w) => w.text === 'Nothing'));
  assert.equal(lineIndex, 2, 'precondition: Nothing sits between two lines');
  const baseline = (k) => text.props.y + layout.lines[k].y;
  const em = font.size;
  const inkTop = baseline(2) - 0.74 * em, inkBottom = baseline(2) + 0.22 * em; // N rises 0.74 em, g descends 0.22 em
  const points = band.props.d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  const ys = points.filter((_, i) => i % 2 === 1);
  const topEdge = ys.slice(0, 5), bottomEdge = ys.slice(5);
  assert.ok(Math.max(...topEdge) <= inkTop + EPS, `top edge ${Math.max(...topEdge)} above the ink top ${inkTop}`);
  assert.ok(Math.min(...bottomEdge) >= inkBottom - EPS, `bottom edge ${Math.min(...bottomEdge)} below the descender ${inkBottom}`);
  // the line above ends at its own baseline plus its descender ("your": y), the line below starts at its ascenders
  const aboveBottom = baseline(1) + 0.22 * em, belowTop = baseline(3) - 0.74 * em;
  assert.ok(Math.min(...ys) > aboveBottom, `band top ${Math.min(...ys)} clear of the line above (${aboveBottom})`);
  assert.ok(Math.max(...ys) < belowTop, `band bottom ${Math.max(...ys)} clear of the line below (${belowTop})`);
  // the band is designed 0.06 em past the ink: its middle rows are there (the hand jitter moves the corners only)
  const mid = (edge) => edge[2]; // the point where the two quadratic segments of an edge meet
  assert.ok(Math.abs(mid(topEdge) - (inkTop - 0.06 * em)) <= 3 + 3 * 0.6 + EPS, 'top edge middle at 0.06 em above the ink, within the corner jitter and its bow');
});

test('a highlight look gets a creative finding when the emphasis covers half or more of a statement\'s words', () => {
  const kind = registries.kinds.get('statement');
  const look = registries.looks.get('desk');
  const review = (say, l = look) => kind.review({ id: 's', show: 'statement', say }, { look: l, timing: { words: [], duration: 3 }, at: () => 0 });
  assert.deepEqual(review('Built on your machine. *Nothing leaves it*.'), [], 'close: 3 of 7 is under half');
  const [found] = review('Most dashboards can\'t tell you *where a number came from*.');
  assert.equal(found.path, 'say');
  assert.equal(found.message, 'emphasis covers 5 of 10 words; mark fewer');
  assert.equal(review('One *two* three four.').length, 0, '1 of 4');
  assert.deepEqual(review('Save this. *Build yours*.', registries.looks.get('pop')), [], 'a recolour look points with colour, not paint: no rule');
});

test('a highlight run that spans more than one laid-out line is marked on the text, for the review', () => {
  // the old problem script: five emphasised words that break across two lines
  const old = expandShot({ id: 'p', show: 'statement', say: 'Most dashboards can\'t tell you *where a number came from*.' });
  const lines = textNode(old.nodes, 'p.text').props.layout.lines.map((l) => l.words.map((w) => w.text));
  const spanned = lines.filter((l) => l.some((w) => ['where', 'a', 'number', 'came', 'from.'].includes(w))).length;
  assert.ok(spanned > 1, `precondition: the run is laid out over ${spanned} lines: ${JSON.stringify(lines)}`);
  assert.equal(textNode(old.nodes, 'p.text').props.highlightLines, spanned);
  // four forced lines leave no room to break the run (maxLines 4): it spans one line
  const close = expandShot({ id: 'c', show: 'statement', say: 'Your data never moves. *It stays*.', text: 'Your | data | never moves. | It stays.' });
  const closeLines = textNode(close.nodes, 'c.text').props.layout.lines.map((l) => l.words.map((w) => w.text).join(' '));
  assert.ok(closeLines.includes('It stays.'), `precondition: ${JSON.stringify(closeLines)}`);
  assert.equal(textNode(close.nodes, 'c.text').props.highlightLines, 1, 'one line');
  const plain = expandShot({ id: 'q', show: 'statement', say: 'No emphasis here.' });
  assert.equal(textNode(plain.nodes, 'q.text').props.highlightLines, undefined, 'no run, no mark');
  const pop = expandSecond({ id: 'r', show: 'statement', say: 'Your charts are *hiding something today*.' }, 'pop', '9:16');
  assert.ok(all(pop.nodes).every((n) => n.props.highlightLines === undefined), 'a recolour look is exempt');
});

test('the stack is one hero: the group carries the hero id and box for a match, text means the whole stack, word:n reads across lines', () => {
  const shots = [{ id: 'a', show: 'statement', say: 'Your charts are hiding something.', hero: 'h' }, { id: 'b', show: 'statement', say: 'Your charts are hiding something.', hero: 'h', cut: 'match' }];
  const first = expandIn(filmOf(shots, 'pop', '9:16'), 0);
  assert.equal(first.hero, 'h');
  const group = first.nodes.find((n) => n.id === 'h');
  assert.equal(group.type, 'group', 'the hero id is the group');
  const lines = stackLinesOf(first.nodes, 'h');
  const wordBoxes = Object.entries(first.boxes).filter(([k]) => k.startsWith('word:')).map(([, b]) => b);
  const union = [Math.min(...wordBoxes.map((b) => b[0])), Math.min(...wordBoxes.map((b) => b[1])), Math.max(...wordBoxes.map((b) => b[0] + b[2])), Math.max(...wordBoxes.map((b) => b[1] + b[3]))];
  first.boxes.text.forEach((v, i) => near(v, [union[0], union[1], union[2] - union[0], union[3] - union[1]][i], 'text is the union of every word of the stack'));
  assert.ok(first.boxes.text[1] < lines[0].bottom && first.boxes.text[1] + first.boxes.text[3] >= lines.at(-1).bottom, 'from the first line to the last');
  const words = lines.flatMap((l) => l.node.props.layout.lines[0].words.map((w) => ({ w, x: l.node.props.x, y: l.node.props.y + l.node.props.layout.lines[0].y })));
  words.forEach(({ w, x, y }, i) => {
    const box = first.boxes[`word:${i}`];
    assert.ok(box[0] >= x + w.x - 1e-6 && box[0] <= x + w.x + w.width && box[1] < y && box[1] + box[3] > y, `word:${i} is "${w.text}" in reading order`);
  });
  // a match between the two stacks morphs the shared hero group, carrying its box
  const film = filmFor(shots, 'pop', '9:16');
  const at = buildTimeline(filmOf(shots, 'pop', '9:16'), { fps: FPS }).shots[1].start + 0.25;
  const matched = film.sampleAt(at).find((n) => n.id === 'h');
  assert.equal(matched.props.match, true, 'the like heroes morph as one group');
  assert.equal(matched.bbox.length, 4);
  const on = expandSecond({ id: 's', show: 'statement', say: 'No cloud. No upload.', on: [{ at: 'word:upload', do: 'underline', target: 'word:3' }] }, 'pop', '9:16');
  const underline = on.nodes.find((n) => n.id === 's.on0');
  const ys = underline.props.d.match(/-?\d+(?:\.\d+)?/g).map(Number).filter((_, i) => i % 2 === 1);
  assert.ok(Math.min(...ys) > on.boxes['word:3'][1] + on.boxes['word:3'][3] - 1, 'word:3 (UPLOAD., on the second line) carries the underline');
});

test('desk highlights one run of adjacent emphasised words per line', () => {
  const run = expandShot({ id: 'a', show: 'statement', say: 'It is *so very* wrong.', text: 'It is | so very wrong.' });
  const lines = textNode(run.nodes).props.layout.lines.map((l) => l.words.map((w) => w.text));
  assert.ok(lines.some((l) => l.includes('so') && l.includes('very')), `precondition: one line holds both, got ${JSON.stringify(lines)}`);
  const highlights = run.nodes.filter((n) => n.props.under);
  assert.equal(highlights.length, 1);
  landsOn(highlights[0], 'reveal', run.timing.words[3].start, 'lands on the last emphasised word');
  assert.ok(sample(highlights[0].tracks.reveal, run.timing.words[2].start, highlights[0].step) < 1, 'not full when the first emphasised word lands');
  const textIndex = run.nodes.findIndex((n) => n.id === 'a.text');
  assert.ok(run.nodes.indexOf(highlights[0]) < textIndex, 'placed before the text');
  const split = expandShot({ id: 'a', show: 'statement', say: '*Really* *lying* now.', text: 'Really | lying now' });
  assert.equal(split.nodes.filter((n) => n.props.under).length, 2, 'emphasised words on two lines give two highlights');
});

// A centred look with the pulse emphasis (pop before revision 1), kept to cover the centred composition and recolor-scale.
function centredPop() {
  const pop = registries.looks.get('pop');
  if (!registries.looks.has('pop-centred-test')) registries.looks.add('pop-centred-test', Object.freeze({ ...pop, name: 'pop-centred-test', composition: 'centred', emphasis: 'recolor-scale' }));
  return 'pop-centred-test';
}

test('a centred look centres caps; with recolor-scale an emphasised word turns accent and pulses to the emphasize scale', () => {
  const { nodes, ctx, canvas, timing } = expandSecond({ id: 'a', show: 'statement', say: 'It is *lying* to you.' }, centredPop(), '9:16');
  const look = ctx.look;
  const text = textNode(nodes);
  const words = text.props.layout.lines.flatMap((l) => l.words.map((w) => w.text));
  assert.deepEqual(words, ['IT', 'IS', 'LYING', 'TO', 'YOU.']);
  assert.ok(text.props.font.size >= look.scale[2] && text.props.font.size <= look.scale[4], 'fitted between scale steps 3 and 5');
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
  const peak = sample(scale, start + look.moves.emphasize.dur);
  assert.ok(peak > 1 && peak <= look.moves.emphasize.scale + EPS, `the pulse peaks at ${peak}, not above the look's ${look.moves.emphasize.scale}`);
  near(sample(scale, start + 5), 1, 'back to 1');
  const later = timing.words[3].start;
  near(sample(text.wordTracks[3].scale, later - look.moves.enter.dur), look.moves.enter.scale, 'words pop from the enter scale');
});

// ---- pop: the stack ----

// The lines of a stack: the text nodes inside the hero group, in order, each with its ink in canvas pixels (the fake
// measure's ink: 0.02 em in from each end, capitals 0.74 em tall, no descenders in caps).
function stackLinesOf(nodes, hero) {
  const group = nodes.find((n) => n.id === hero);
  return group.children.map((n) => {
    const { layout, font } = n.props;
    const line = layout.lines[0];
    const first = line.words[0], last = line.words.at(-1);
    const track = font.tracking * font.size;
    const left = n.props.x + line.x + first.x + 0.02 * font.size;
    const right = n.props.x + line.x + last.x + [...last.text].length * 0.55 * font.size - 0.02 * font.size + track * ([...last.text].length - 1);
    const baseline = n.props.y + line.y;
    return { node: n, size: font.size, left, right, top: baseline - 0.74 * font.size, bottom: baseline, text: line.words.map((w) => w.text).join(' ') };
  });
}

test('pop stack: lines by sense, each filling the safe width or capped at 400 units, flush left, 0.08 apart, centred in the safe zone', () => {
  const { nodes, canvas, ctx } = expandSecond({ id: 'a', show: 'statement', say: 'Your charts are *hiding* something.' }, 'pop', '9:16');
  const safe = viralOf(canvas);
  const left = safe.left, width = canvas.w - safe.left - safe.right; // 120 and 765 on 1080 x 1920
  const lines = stackLinesOf(nodes, 'a.text');
  assert.deepEqual(lines.map((l) => l.text), ['YOUR CHARTS', 'ARE HIDING', 'SOMETHING.']);
  // hand-computed: "SOMETHING." is 10 glyphs of 0.55 em tracked -0.02 em; its ink runs from 0.02 em to
  // 5.5 - 0.02 - 9 x 0.02 = 5.3 em, so 5.28 em wide; fitted 0.5 px inside the 765 px width: 764.5 / 5.28 = 144.792 px
  near(lines[2].size, 764.5 / 5.28, 'SOMETHING. hand-computed size');
  for (const l of lines) {
    assert.ok(Math.abs(l.right - l.left - width) <= 1 || Math.abs(l.size - 400) < EPS, `${l.text}: ink ${l.right - l.left} fills ${width}, or 400 units`);
    near(l.left, left, `${l.text}: flush left on the safe edge`);
    assert.equal(l.node.props.font.wordSpace, 0.26);
    assert.equal(l.node.props.stack, 'a.text', 'every line names its stack');
    assert.equal(l.node.props.role, 'hero');
  }
  lines.slice(1).forEach((l, k) => near(l.top - lines[k].bottom, 0.08 * Math.max(l.size, lines[k].size), `gap over ${l.text}`));
  near((lines[0].top + lines.at(-1).bottom) / 2, safe.top + (canvas.h - safe.top - safe.bottom) / 2, 'block centred in the safe zone');
  assert.ok(lines.every((l) => l.size >= ctx.look.scale[2] - EPS), 'never below scale step 3');
  // a short line would need more than 400 units to fill the width: it stops at 400, flush left
  const short = stackLinesOf(expandSecond({ id: 'b', show: 'statement', say: 'No. Never.', text: 'No. | Never.' }, 'pop', '9:16').nodes, 'b.text');
  assert.equal(short[0].size, 400);
  near(short[0].left, left);
  assert.ok(short[0].right - short[0].left < width);
  // on 16:9 the stack fills columns 1 to 12
  const wide = stackLinesOf(expandSecond({ id: 'c', show: 'statement', say: 'Your charts are hiding something.' }, 'pop', '16:9').nodes, 'c.text');
  const look = registries.looks.get('pop'), wideCanvas = canvasOf('16:9');
  for (const l of wide) {
    near(l.left, gridX(look, wideCanvas, 1), 'columns 1 to 12: left');
    assert.ok(Math.abs(l.right - gridX(look, wideCanvas, 13)) <= 1 || Math.abs(l.size - 400) < EPS, `${l.text} fills columns 1 to 12 or is capped`);
  }
});

test('pop stack: an emphasised word takes the accent with a flash of its fill, never a scale', () => {
  const { nodes, timing, ctx } = expandSecond({ id: 'a', show: 'statement', say: 'Your charts are *hiding* something.' }, 'pop', '9:16');
  const look = ctx.look;
  const lines = stackLinesOf(nodes, 'a.text');
  const hiding = lines[1].node.wordTracks[1]; // ARE HIDING: HIDING is word 1 of the line
  const at = timing.words[3].start;
  assert.equal(sample(hiding.fill, at), look.palette.ink2, 'ink2 until it is spoken');
  assert.equal(sample(hiding.fill, at + look.moves.emphasize.dur), look.palette.accent, 'accent one emphasize move later');
  assert.ok(sample(hiding.fill, at + look.moves.emphasize.dur / 2) !== look.palette.ink2, 'changing on the way');
  for (const l of lines) for (const w of l.node.wordTracks) assert.equal(w.scale, undefined, 'no word scales in a stack');
});

test('viral ghost words on every statement: all words on screen in ink2 from the first frame, each lighting as spoken; with no say, in order 0.09 s apart from 0.2 s', () => {
  const shots = [{ id: 'one', show: 'statement', say: 'Your charts are *hiding* something.' }, { id: 'two', show: 'statement', say: 'No cloud. No *upload*.', cut: 'cut' },
    { id: 'three', show: 'statement', hold: 2, text: 'Three quiet words' }];
  const film = filmFor(shots, 'pop', '9:16');
  const look = registries.looks.get('pop');
  const timeline = buildTimeline(filmOf(shots, 'pop', '9:16'), { fps: FPS });
  for (const [index, id] of [[0, 'one'], [1, 'two'], [2, 'three']]) {
    const texts = (t) => film.sampleShot(index, t).find((n) => n.id === `${id}.text`).children;
    const first = texts(0).flatMap((n) => n.words);
    assert.ok(first.every((w) => w.opacity === 1 && w.fill === look.palette.ink2), `${id}: every word on screen in ink2 on frame 0`);
    const end = texts(timeline.shots[index].duration).flatMap((n) => n.words);
    assert.ok(end.every((w) => w.fill === look.palette.ink || w.fill === look.palette.accent), `${id}: every word lit by the end`);
  }
  const upload = film.sampleShot(1, timeline.shots[1].duration).find((n) => n.id === 'two.text').children.flatMap((n) => n.words).at(-1);
  assert.equal(upload.fill, look.palette.accent, 'the emphasised word lights in the accent');
  const quiet = expandIn(filmOf(shots, 'pop', '9:16'), 2).nodes.find((n) => n.id === 'three.text').children.flatMap((n) => n.wordTracks);
  quiet.forEach((w, i) => assert.equal(w.fill.points.find((p) => p.v !== look.palette.ink2).t, 0.2 + 0.09 * i + look.moves.emphasize.dur, `word ${i} lights 0.09 s after the one before, from 0.2 s`));
});

// A tag group's plate as a canvas box (the plate path is about the group's centre).
function plateBox(tag) {
  const plate = tag.children.find((n) => n.type === 'path');
  const nums = plate.props.d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
  return [tag.props.x + Math.min(...xs), tag.props.y + Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
}

test('pop kicker: an accent tag at scale step 2, flush left, 28 units over the first line, inside the safe zone; a tall stack shrinks to keep it there', () => {
  const { nodes, canvas, ctx } = expandSecond({ id: 'a', show: 'statement', say: 'Save this. Build yours.', text: 'Save this. | Build yours.', kicker: 'portable-artifacts' }, 'pop', '9:16');
  const safe = viralOf(canvas);
  const tag = nodes.find((n) => n.id === 'a.kicker');
  const plate = tag.children.find((n) => n.type === 'path');
  assert.equal(plate.props.fill, ctx.look.palette.accent);
  const label = tag.children.find((n) => n.type === 'text');
  assert.equal(label.props.font.size, ctx.look.scale[1], 'scale step 2');
  const box = plateBox(tag);
  near(box[0], safe.left, 'flush left');
  const lines = stackLinesOf(nodes, 'a.text');
  near(lines[0].top - (box[1] + box[3]), 28, '28 units over the first line');
  assert.ok(box[1] >= safe.top - EPS, 'inside the safe zone');
  const tall = expandSecond({ id: 'b', show: 'statement', say: 'A b c d e f g h.', text: 'A | B | C | D | E | F | G | H.', kicker: 'tall' }, 'pop', '9:16');
  const tallTag = tall.nodes.find((n) => n.id === 'b.kicker');
  const tallLines = stackLinesOf(tall.nodes, 'b.text');
  assert.ok(plateBox(tallTag)[1] >= safe.top - EPS, 'the tag stays inside the safe zone');
  assert.ok(tallLines.at(-1).bottom <= canvas.h - safe.bottom + EPS, 'and so does the stack, fitted smaller');
  assert.ok(tallLines.every((l) => l.size < 400), 'smaller than the cap');
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

test('desk number: a one-digit figure up to 820 units, baseline at 72%, flush left on column 2 by its ink, no hairline; label caps at step 3 beside it on its baseline 48 units on; delta tag 12 units above the label', () => {
  const { nodes, ctx, canvas, boxes } = expandShot({ id: 'n', show: 'number', hold: 3, value: 5, label: 'skills', delta: 'one JSON spec each' }, 'desk', '16:9');
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
  assert.equal(label.props.font.family, look.fonts.label.family);
  assert.equal(label.props.font.size, look.scale[2], 'scale step 3');
  near(label.props.font.tracking, look.tracking(look.scale[2], 'label'), 'the label tracking');
  assert.deepEqual(label.props.layout.lines[0].words.map((w) => w.text), ['SKILLS']);
  near(label.props.x + 0.02 * 72, 242 + 418.2 + 48, 'label ink 48 units after the figure ink');
  near(label.props.y + label.props.layout.lines.at(-1).y, baseline, 'label on the figure baseline');
  const labelInkTop = baseline - 0.74 * 72;
  near(boxes.delta[1] + boxes.delta[3], labelInkTop - 12, 'delta 12 units above the label');
  near(boxes.delta[0], label.props.x + 0.02 * 72, 'delta flush with the label');
  assert.ok(boxes.delta[0] + boxes.delta[2] <= gridX(look, canvas, 13) + EPS, 'inside the right margin');
});

test('desk number: a figure wider than half the span takes the label under it, 40 units below its baseline, the delta to its right; three digits stop at 560', () => {
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
    near(label.props.y + label.props.layout.lines[0].y - 0.74 * label.props.font.size, baseline + 40, `${format} label ink 40 units under the baseline`);
    near(label.props.x + 0.02 * label.props.font.size, gridX(look, canvas, 2), `${format} label flush left`);
    const last = label.props.layout.lines.at(-1);
    if (boxes.delta[1] < boxes.label[1] + boxes.label[3]) {
      near(boxes.delta[0], label.props.x + last.x + last.width + 32, `${format} delta 32 units to the right of the label`);
    } else {
      near(boxes.delta[0], label.props.x + 0.02 * label.props.font.size, `${format} too wide beside it: under the label, flush left`);
    }
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

test('pop number: the figure fills the safe width up to 900 units, flush left; label tag at step 3 40 units under the baseline; delta a rule tag 16 under that; the block centred', () => {
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
  const deltaBox = plateBox(delta);
  near(deltaBox[0], safe.left, 'delta tag flush left');
  near(deltaBox[1], labelBox[1] + labelBox[3] + 16, 'delta 16 units under the label tag');
  assert.equal(delta.children.find((n) => n.type === 'path').props.fill, look.palette.rule);
  assert.equal(delta.children.find((n) => n.type === 'text').props.fill, look.palette.ink);
  near((boxes.value[1] + deltaBox[1] + deltaBox[3]) / 2, safe.top + (canvas.h - safe.top - safe.bottom) / 2, 'the block centred in the safe zone');
  const land = timing.words[0].start;
  assert.ok(sample(fig.tracks.scale, land + look.moves.emphasize.dur) > 1, 'the figure still pulses as it lands');
  const three = expandShot({ id: 'n', show: 'number', hold: 2, value: 459, label: 'x' }, 'pop', '16:9');
  assert.equal(textNode(three.nodes, 'n.value.digits').props.font.size, 760, 'three digits up to 760');
  near(three.boxes.value[0], gridX(look, canvasOf('16:9'), 1), 'flush left on column 1 on 16:9');
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

test('pop establishing picture on a vertical format: a 4:5 crop of the source, as tall as the image allows, centred on the first targeted region', () => {
  const imageOf = (shot, format = '9:16') => {
    const r = expandShot(shot, 'pop', format);
    return { image: all([r.nodes.find((n) => n.id === 'c.image')]).find((n) => n.type === 'image'), canvas: r.canvas };
  };
  // hand-computed: 1600 x 1000 at 4:5 is 800 x 1000; the query region's centre is at 0.75 x 1600 = 1200, so the
  // window would start at 800, which is also the furthest right it can go (1600 - 800)
  const targeted = imageOf({ ...POP_SHOT, on: [{ at: 'word:query', do: 'underline', target: 'region:query' }] });
  assert.deepEqual(targeted.image.props.clip, [800, 0, 800, 1000]);
  const safe = viralOf(targeted.canvas), safeW = targeted.canvas.w - safe.left - safe.right;
  near(targeted.image.props.w, 0.92 * safeW, 'a cutout 92% of the safe width');
  near(targeted.image.props.w / targeted.image.props.h, 4 / 5, '4:5');
  const centred = imageOf({ id: 'c', show: 'clipping', src: 'shot.png', hold: 3, regions: { mid: [0.3, 0.3, 0.2, 0.2] } });
  assert.deepEqual(centred.image.props.clip, [400, 0, 800, 1000], 'no region target: the crop is centred');
  const left = imageOf({ id: 'c', show: 'clipping', src: 'shot.png', hold: 3, regions: { l: [0.05, 0.3, 0.2, 0.2] }, on: [{ at: 1, do: 'underline', target: 'region:l' }] });
  assert.deepEqual(left.image.props.clip, [0, 0, 800, 1000], 'clamped inside the image');
  assert.equal(imageOf({ id: 'c', show: 'clipping', src: 'shot.png', hold: 3 }, '16:9').image.props.clip, undefined, 'a wide format shows the whole picture');
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

test('a mark on a region goes over the picture, and the desk camera pushes until the region fills 50% of the width', () => {
  const shot = { id: 'c', show: 'clipping', src: 'shot.png', say: 'This one shows the query behind every chart.', regions: { query: [0.6, 0.2, 0.3, 0.2] },
    on: [{ at: 'word:query', do: 'circle', target: 'region:query' }] };
  for (const format of ['16:9', '9:16']) {
    const { nodes, camera, timing, ctx, boxes, canvas } = expandShot(shot, 'desk', format);
    const ids = nodes.map((n) => n.id);
    assert.ok(ids.indexOf('c.on0') > ids.indexOf('c.image'), 'mark drawn over the picture');
    const push = camera.find((layer) => layer.some((k) => k.zoom !== undefined));
    const at = Math.max(timing.words[4].start, 0.6 + 0.9); // the first shot shows the whole picture for 0.6 s before a push of 0.9 s
    const want = Math.min(2.6, Math.max(1.2, (0.5 * canvas.w) / boxes['region:query'][2]));
    near(push.at(-1).t, at, `${format} lands on the event`);
    near(push.at(-1).zoom, want, `${format} zoom`);
    assert.equal(push.at(-1).ease, ctx.look.moves.enter.ease);
    near(push[0].t, at - 0.9, 'over 0.9 s');
  }
  const still = expandShot({ ...shot, on: [{ at: 'word:query', do: 'circle', target: 'image' }] });
  assert.ok(!still.camera.some((layer) => layer.some((k) => k.zoom !== undefined)), 'no region target, no push');
});

test('a pushed region sits on the composition centre, as far as the field allows', () => {
  const shot = { id: 'c', show: 'clipping', src: 'shot.png', hold: 3, regions: { mid: [0.4, 0.4, 0.2, 0.2] }, on: [{ at: 2, do: 'underline', target: 'region:mid' }] };
  const { boxes, canvas } = expandShot(shot, 'desk', '16:9');
  const f = filmFor([shot], 'desk', '16:9');
  const pic = f.sampleAt(2).find((n) => n.id === 'c.image'); // the landing time; the drift moves on after it
  const rest = expandShot(shot, 'desk', '16:9').nodes.find((n) => n.id === 'c.image');
  const [bx, by, bw, bh] = boxes['region:mid'];
  // the region centre moves with the picture group: rest offset scaled by the camera zoom
  const zoom = pic.scale / (rest.props.scale ?? 1);
  const rx = pic.x + (bx + bw / 2 - rest.props.x) * zoom, ry = pic.y + (by + bh / 2 - rest.props.y) * zoom;
  // the drift's pan at the landing time is allowed for, so the region sits on the centre to well under a pixel
  assert.ok(Math.abs(rx - canvas.w / 2) < 0.5 && Math.abs(ry - canvas.h / 2) < 0.5, `region at ${rx}, ${ry}`);
});

test('a highlight on a region is a hand-drawn marker frame with the rest of the picture dimmed in desk', () => {
  const shot = { id: 'c', show: 'clipping', src: 'shot.png', say: 'This one shows the query behind every chart.', regions: { query: [0.6, 0.2, 0.3, 0.2] },
    on: [{ at: 'word:query', do: 'highlight', target: 'region:query' }] };
  const { nodes, timing, ctx } = expandShot(shot, 'desk');
  const at = Math.max(timing.words[4].start, 0.6 + 0.9);
  const pic = nodes.find((n) => n.id === 'c.image');
  assert.ok(!all(nodes).some((n) => n.props.under), 'no filled band');
  const sides = all([pic]).filter((n) => /^c\.on0\.side\d$/.test(n.id));
  const passes = all([pic]).filter((n) => /^c\.on0\.side\d\.pass2$/.test(n.id));
  assert.equal(sides.length, 4, 'four strokes inside the picture');
  assert.equal(passes.length, 4, 'each drawn twice: a second pass of the same stroke');
  for (const s of [...sides, ...passes]) {
    assert.equal(s.props.stroke, ctx.look.palette.accent);
    assert.equal(s.props.strokeWidth, 7, '7 units wide');
    assert.equal(s.props.lineCap, 'round');
    assert.equal(s.props.blend, undefined);
  }
  sides.forEach((s, i) => {
    const second = passes[i];
    assert.notEqual(second.props.d, s.props.d, 'the second pass is offset');
    const shift = (d) => d.match(/-?\d+(?:\.\d+)?/g).map(Number);
    const [a, b] = [shift(s.props.d), shift(second.props.d)];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    a.forEach((v, k) => near(b[k] - v, k % 2 === 0 ? dx : dy, `side ${i}: the same geometry, moved`));
    assert.ok(Math.hypot(dx, dy) > 0 && Math.hypot(dx, dy) <= 3, `a small offset: ${Math.hypot(dx, dy)}`);
  });
  const lands = sides.map((s) => lastKey(s.tracks.draw).t);
  assert.deepEqual([...lands].sort((a, b) => a - b), lands, 'drawn on in order');
  landsOn(sides[3], 'draw', at, 'the frame closes on the event');
  // geometry in the picture's own space: the region [0.6, 0.2, 0.3, 0.2] of the drawn picture
  const W = 0.62 * 1080, H = W * 1000 / 1600;
  const region = [0.6 * W - W / 2, 0.2 * H - H / 2, 0.3 * W, 0.2 * H];
  const pts = (s) => s.props.d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  const ys = [...sides, ...passes].flatMap((s) => pts(s).filter((_, i) => i % 2 === 1));
  const xs = [...sides, ...passes].flatMap((s) => pts(s).filter((_, i) => i % 2 === 0));
  const half = 3.5;
  // the bottom stroke is the lowest ink: the side strokes do not overshoot downward into the picture below the region,
  // so the frame reaches the gap plus its own width, plus at most 2 units of hand wobble
  assert.ok(Math.max(...ys) + half <= region[1] + region[3] + 6 + 7 + 2 + EPS, `the frame reaches ${(Math.max(...ys) + half - region[1] - region[3]).toFixed(1)} below the region: at most the gap, one width and the wobble`);
  // the frame overshoots each corner by at most 10 units past the gap and stroke
  assert.ok(Math.min(...xs) >= region[0] - 6 - half - 10 - EPS && Math.max(...xs) <= region[0] + region[2] + 6 + half + 10 + EPS, 'overshoot at most 10 units');
  // it hugs the region: the top stroke's points sit 6 units plus half the stroke above it, within the hand wobble
  const top = pts(sides[0]).filter((_, i) => i % 2 === 1);
  const mean = top.reduce((a, b) => a + b, 0) / top.length;
  assert.ok(Math.abs(mean - (region[1] - 6 - half)) <= 1.5 + EPS, `top stroke centre ${mean} at the 6-unit gap (${region[1] - 6 - half})`);
  const dim = all([pic]).find((n) => n.id === 'c.on0.dim');
  assert.equal(dim.props.fill, ctx.look.palette.ink);
  assert.equal(dim.props.d.match(/M/g).length, 2, 'the region is cut out of the overlay');
  near(sample(dim.tracks.opacity, 0), 0);
  near(sample(dim.tracks.opacity, at), 0.2, 'dims to 0.20 with the frame');
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
  assert.ok(!all([b]).some((n) => /^c\.on1\.side/.test(n.id)), 'a highlight on a pop close-up draws no frame');
  assert.ok(!all([b]).some((n) => n.id === 'c.on1.dim'), 'no overlay on a close-up');
  assert.ok(boxes['region:chart'][3] > 0);
});

test('pop region highlight: the close-up\'s hard shadow turns from accent2 to accent and grows from 10 to 18 units on the event, with the emphasize ease; nothing else is drawn', () => {
  const { nodes, timing, ctx } = expandShot(POP_SHOT, 'pop', '9:16');
  const look = ctx.look;
  const at = timing.words[8].start; // chart: the highlight
  const close = nodes.find((n) => n.id === 'c.close1');
  const shadows = all([close]).filter((n) => /\.shadow(\.emphasis)?$/.test(n.id));
  const base = shadows.find((n) => n.id.endsWith('.shadow')), lifted = shadows.find((n) => n.id.endsWith('.shadow.emphasis'));
  assert.equal(base.props.fill, look.palette.accent2);
  assert.equal(lifted.props.fill, look.palette.accent);
  near(opacityAt(base, at - 1 / FPS), 1); near(opacityAt(lifted, at - 1 / FPS), 0);
  const on = at + 1e-6; // anchors round to 1e-6 s
  near(opacityAt(base, on), 0, 'a step change on the event'); near(opacityAt(lifted, on), 1);
  near(sample(lifted.tracks.x, on), 10, 'from 10'); near(sample(lifted.tracks.y, on), 10);
  near(sample(lifted.tracks.x, at + look.moves.emphasize.dur), 18, 'grown to 18 one emphasize move later');
  near(sample(lifted.tracks.y, at + 5), 18);
  const halfway = sample(lifted.tracks.x, at + look.moves.emphasize.dur / 2);
  assert.ok(Math.abs(halfway - (10 + 8 * ease(look.moves.emphasize.ease)(0.5))) < 1e-3, `with the emphasize ease: ${halfway}`);
  assert.equal(all(nodes).filter((n) => n.id.startsWith('c.on1')).length, 0, 'no device nodes for the highlight');
  // the underline on the first close-up stays as it is
  assert.ok(all([nodes.find((n) => n.id === 'c.close0')]).some((n) => n.id === 'c.on0'));
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

test('slide and punch smear their moving content: 5 samples across one frame of travel, the outer four at a fifth of the opacity behind the centre one at full; a slide shows both shots at p 0.5', () => {
  const canvas = { w: 1920, h: 1080 };
  const frame = 1 / (30 * 0.4); // the p of one frame of a 0.4 s slide at 30 fps
  const field = Object.freeze({ ...fakeSampled('field', -20), depth: 1 });
  const out = registries.cuts.get('slide').apply({ from: [field, fakeSampled('a', 1500)], to: [field, fakeSampled('b', 200)], p: 0.5, canvas, frame });
  assert.equal(out.filter((n) => n.id === 'field').length, 1, 'the shared field is not smeared');
  const a = out.filter((n) => n.id === 'a'), b = out.filter((n) => n.id === 'b');
  assert.equal(a.length, 5); assert.equal(b.length, 5);
  // drawn back to front: the outer samples (0, 1, 3, 4 across the frame) at a fifth, then the centre one (p itself) at full
  const order = [0, 1, 3, 4, 2];
  [...a, ...b].forEach((n, i) => near(n.opacity, i % 5 === 4 ? 1 : 0.2, `copy ${i}: the centre sample last at full opacity, the others at a fifth`));
  const e = (q) => ease('inOutCubic')(q);
  a.forEach((n, i) => near(n.x, 1500 - e(0.5 + frame * (order[i] / 4 - 0.5)) * 1920, `outgoing sample ${order[i]}`));
  b.forEach((n, i) => near(n.x, 200 + (1 - e(0.5 + frame * (order[i] / 4 - 0.5))) * 1920, `incoming sample ${order[i]}`));
  const onScreen = (n) => n.x + 10 > 0 && n.x < canvas.w; // the fake node is a 10 px square at its x
  assert.ok(a.some(onScreen) && b.some(onScreen), 'both shots on screen mid-cut');
  const punch = registries.cuts.get('punch').apply({ from: [], to: [fakeSampled('b', 500)], p: 0.5, canvas, frame: 1 / 6 });
  assert.equal(punch.length, 5);
  punch.forEach((n, i) => near(n.scale, 1.15 + (1 - 1.15) * ease('outExpo')(0.5 + (1 / 6) * (order[i] / 4 - 0.5)), `punch sample ${order[i]}`));
  near(punch.at(-1).opacity, 1, 'the punch draws its centre sample whole, so a picture is never tinted by the shadows of the copies under it');
  // a real film: a slide in pop shows smeared copies of both shots' text mid-cut, and none once it has run
  const shots = [{ id: 'one', show: 'statement', say: 'Your charts lie.' }, { id: 'two', show: 'statement', say: 'No cloud.', cut: 'slide' }];
  const f = filmFor(shots, 'pop', '9:16');
  const second = buildTimeline(filmOf(shots, 'pop', '9:16'), { fps: FPS }).shots[1];
  const mid = f.sampleAt(second.start + 0.2);
  assert.equal(mid.filter((n) => n.id === 'one.text').length, 5, 'the outgoing statement smeared');
  assert.equal(mid.filter((n) => n.id === 'two.text').length, 5, 'the incoming statement smeared');
  assert.equal(f.sampleAt(second.start + 0.5).filter((n) => n.id === 'two.text').length, 1, 'crisp once the cut has run');
  // a desk slide between two statements: at p 0.5 the outgoing text still reaches onto the canvas and the incoming one has arrived on it
  const desk = [{ id: 'one', show: 'statement', say: 'Most dashboards cannot tell you where a number came from.' }, { id: 'two', show: 'statement', say: 'This one is different.', cut: 'slide' }];
  const g = filmFor(desk, 'desk', '16:9');
  const at = buildTimeline(filmOf(desk, 'desk', '16:9'), { fps: FPS }).shots[1].start + 0.2;
  const texts = (id) => g.sampleAt(at).filter((n) => n.id === id);
  assert.ok(texts('one.text').some((n) => n.x + n.props.layout.width > 0), 'the outgoing text is on screen at p 0.5');
  assert.ok(texts('two.text').some((n) => n.x < canvas.w), 'the incoming text is on screen at p 0.5');
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
  // coverage, not a sum: the outgoing copy keeps the full interpolated opacity underneath and only the incoming one
  // fades in over it, so the pair never reads thinner than either end
  near(fromCopy.opacity, 0.75, 'outgoing copy at the interpolated opacity');
  near(toCopy.opacity, 0.75 * 0.5, 'incoming copy fading in over it (smoothstep 0.5 at mid-cut)');
  assert.ok(shared.children.indexOf(fromCopy) < shared.children.indexOf(toCopy), 'outgoing underneath');
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
        // A stack sets its lines flush left by their ink, so a line's advance box starts a side bearing before the
        // edge; its ink is checked through the `text` and word boxes above (the review measures ink the same way).
        const drawn = annotate(sampleGraph(nodes, timing.duration).filter(isTextOnly).filter((n) => !n.children.some((c) => c.props.stack)));
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
  near(sample(caption.tracks.opacity, Math.max(timing.words[4].start, 0.6 + 0.9)), 0, 'gone when it lands');
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

// ---- code review fixes ----

test('a match passes an identical node through unchanged, and the field never dips', () => {
  const canvas = { w: 1920, h: 1080 };
  const field = Object.freeze({ ...fakeSampled('field', -20), depth: 1 });
  const same = fakeSampled('same', 40);
  const out = registries.cuts.get('match').apply({ from: [field, same, fakeSampled('h', 10)], to: [field, same, fakeSampled('h', 300)], p: 0.5, canvas });
  assert.equal(out.find((n) => n.id === 'field'), field, 'the shared field passes through');
  assert.equal(out.find((n) => n.id === 'same'), same, 'an identical node passes through');
  // a real desk match: at every frame of the cut the field is one node, fully opaque, where the incoming shot has it
  const s = [{ ...THREE[0], hero: 'h' }, { ...THREE[0], id: 'b', say: 'One file. No server.', cut: 'match', hero: 'h' }];
  const f = filmFor(s, 'desk');
  const second = buildTimeline(filmOf(s, 'desk'), { fps: FPS }).shots[1];
  for (let i = 0; i <= 15; i++) {
    const local = i / FPS;
    const fields = f.sampleAt(second.start + local).filter((n) => n.id === 'field');
    const plain = f.sampleShot(1, local)[0];
    assert.equal(fields.length, 1, `frame ${i}: one field`);
    assert.equal(fields[0].type, 'field');
    assert.equal(fields[0].opacity, 1, `frame ${i}: the field is fully opaque`);
    assert.ok(Math.abs(fields[0].x - plain.x) < 1 && Math.abs(fields[0].scale - plain.scale) < 1e-3, `frame ${i}: where the incoming shot has it`);
  }
});

test('a slide out of a pushed-in shot eases the field from its outgoing state to the incoming one', () => {
  const canvas = { w: 1920, h: 1080 };
  const pushed = Object.freeze({ ...fakeSampled('field', -300), depth: 1, scale: 1.4 });
  const rest = Object.freeze({ ...fakeSampled('field', -100), depth: 1, scale: 1 });
  const out = registries.cuts.get('slide').apply({ from: [pushed], to: [rest], p: 0.5, canvas });
  const e = ease('inOutCubic')(0.5);
  near(out[0].x, -300 + (-100 + 300) * e, 'x eases');
  near(out[0].scale, 1.4 + (1 - 1.4) * e, 'scale eases');
});

test('layout follows the look composition, not its emphasis system', () => {
  const desk = registries.looks.get('desk');
  if (!registries.looks.has('desk-centred-test')) registries.looks.add('desk-centred-test', Object.freeze({ ...desk, name: 'desk-centred-test', composition: 'centred' }));
  const film = { version: 2, mode: 'pro', look: 'desk-centred-test', format: '16:9', fps: FPS, seed: 1, shots: [{ id: 'a', show: 'statement', say: 'One file. No server.' }] };
  const { nodes, canvas } = expandIn(film);
  const text = textNode(nodes);
  const line = text.props.layout.lines[0];
  near(text.props.x + line.x + line.width / 2, canvas.w / 2, 'a centred composition centres the statement');
  assert.equal(nodes.filter((n) => n.props.under).length, 0, 'no emphasis here, so no highlight');
});

test('a kind that needs a device the look does not style fails naming the look and the device', () => {
  const desk = registries.looks.get('desk');
  if (!registries.looks.has('bare-test')) registries.looks.add('bare-test', Object.freeze({ ...desk, name: 'bare-test', devices: {} }));
  const film = { version: 2, mode: 'pro', look: 'bare-test', format: '16:9', fps: FPS, seed: 1, shots: [{ id: 'c', show: 'clipping', src: 'shot.png', hold: 2 }] };
  assert.throws(() => expandIn(film), /look "bare-test".*"cutout"|"cutout".*look "bare-test"/);
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

test('on-screen words align to spoken words by longest common subsequence', () => {
  const times = (say, text) => {
    const { nodes, timing } = expandShot({ id: 'a', show: 'statement', say, text });
    return { at: textNode(nodes).wordTracks.map((w) => lastKey(w.opacity).t), spoken: (i) => timing.words[i].start };
  };
  const repeated = times('The cat saw the dog and the bird.', 'The dog and the bird');
  // "The dog and the bird" matches spoken the(3) dog(4) and(5) the(6) bird(7), not the first "The"
  [3, 4, 5, 6, 7].forEach((s, i) => near(repeated.at[i], repeated.spoken(s), `repeated word ${i}`));
  const review = times('Forty one percent of the budget.', 'The cost: 41 percent of the budget');
  // The and cost precede every match, so they land with the next matched word (41 = forty)
  [0, 0, 0, 2, 3, 4, 5].forEach((s, i) => near(review.at[i], review.spoken(s), `review word ${i}`));
  const digits = times('Seven days, twelve hours, ninety nine minutes.', '7 days, 12 hours, 99 minutes');
  [0, 1, 2, 3, 4, 6].forEach((s, i) => near(digits.at[i], digits.spoken(s), `digit word ${i}`));
  const percent = times('Up forty percent.', 'Up 40 %');
  [0, 1, 2].forEach((s, i) => near(percent.at[i], percent.spoken(s), `percent word ${i}`));
});

test('the validator checks clipping regions, close-up timing, image targets after a switch and reserved hero ids', () => {
  const check = (shot, mode = 'pro') => validateFilm({ version: 2, mode, shots: [shot] }, { specDir }).errors;
  const clip = { id: 'c', show: 'clipping', src: 'shot.png', hold: 3 };
  const zero = check({ ...clip, regions: { q: [0.1, 0.1, 0, 0.2] } });
  assert.equal(zero[0].path, 'shots[0].regions.q');
  assert.match(zero[0].message, /w and h must be above 0/);
  const past = check({ ...clip, regions: { q: [0.8, 0.1, 0.3, 0.2] } });
  assert.equal(past[0].path, 'shots[0].regions.q');
  assert.match(past[0].message, /x \+ w/);
  const regions = { a: [0.1, 0.1, 0.2, 0.2], b: [0.5, 0.5, 0.2, 0.2] };
  const together = check({ ...clip, regions, on: [{ at: 1, do: 'underline', target: 'region:a' }, { at: 1, do: 'underline', target: 'region:b' }] }, 'viral');
  assert.equal(together[0].path, 'shots[0].on[1].at');
  assert.match(together[0].message, /same time/);
  const image = check({ ...clip, regions, on: [{ at: 1, do: 'underline', target: 'region:a' }, { at: 2, do: 'arrow', target: 'image' }] }, 'viral');
  assert.equal(image[0].path, 'shots[0].on[1].target');
  assert.match(image[0].message, /target the region/);
  assert.deepEqual(check({ ...clip, regions, on: [{ at: 1, do: 'underline', target: 'region:a' }, { at: 1, do: 'circle', target: 'region:b' }] }).filter((e) => /same time/.test(e.message)), [], 'desk pushes, so no rule');
  const hero = check({ id: 'a', show: 'statement', say: 'Hi.', hero: 'field' });
  assert.equal(hero[0].path, 'shots[0].hero');
  assert.match(hero[0].message, /reserved/);
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

test('pop close-ups: a punch on a region keeps its keys, an early event shortens the entrance, the caption never appears after the switch', () => {
  const shot = { id: 'c', show: 'clipping', src: 'shot.png', hold: 3, caption: 'The query', regions: { q: [0.6, 0.2, 0.3, 0.2] },
    on: [{ at: 0.1, do: 'underline', target: 'region:q' }, { at: 1.5, do: 'punch', target: 'region:q' }] };
  const { nodes, camera, ctx } = expandShot(shot, 'pop', '9:16');
  const punch = ctx.look.devices.punch.scale;
  assert.ok(camera.flat().some((k) => k.zoom === punch && Math.abs(k.t - 1.5) < 1e-6), 'the punch at 1.5 s keeps its keys');
  const pic = nodes.find((n) => n.id === 'c.image');
  const lastIn = 0.6 - 1 / FPS; // the event at 0.1 s is moved to 0.6 s, after the establishing view
  near(sample(pic.tracks.opacity, lastIn), 1, 'the entrance ends one frame before the switch');
  assert.ok(sample(pic.tracks.opacity, lastIn / 2) > 0, 'and is not collapsed to nothing');
  near(sample(pic.tracks.opacity, 0.6), 0, 'gone on the switch');
  const caption = textNode(nodes, 'c.caption');
  for (const t of [0.6, 0.7, 1, 1.5, 2]) near(sample(caption.tracks.opacity, t), 0, `no caption at ${t}`);
});

// ---- the director's round 1: highlight, hook, pulse ----

// The boxes the words of a sampled text node occupy at one frame: each word's layout box scaled about its own centre.
function wordSpans(node) {
  return node.props.layout.lines.map((line) => line.words.map((word) => {
    const track = node.words?.[word.index] ?? { x: 0, scale: 1, opacity: 1 };
    const half = (word.width * Math.abs(track.scale)) / 2;
    const centre = node.x + line.x + word.x + word.width / 2 + track.x;
    return { index: word.index, left: centre - half, right: centre + half, opacity: track.opacity };
  }));
}

test('a desk highlight over a run of words grows with them: never ahead of the last word on screen', () => {
  const shot = { id: 'close', show: 'statement', say: 'It is *so very* wrong.', text: 'It is | so very wrong.' };
  const film = filmFor([shot]);
  const built = expandShot(shot);
  const band = built.nodes.find((n) => n.props.under);
  assert.ok(band, 'a highlight');
  const text = textNode(built.nodes);
  const run = text.props.layout.lines.flatMap((l) => l.words).filter((w) => ['so', 'very'].includes(w.text));
  assert.equal(run.length, 2);
  const line = text.props.layout.lines.find((l) => l.words.some((w) => w.text === 'so'));
  const left = text.props.x + line.x + run[0].x, right = text.props.x + line.x + run.at(-1).x + run.at(-1).width;
  const reach = 5, total = right - left + 2 * reach;
  let aheadBy = -Infinity, sawGrowth = false;
  const frames = Math.round(built.timing.duration * FPS);
  for (let i = 0; i < frames; i++) {
    const t = i / FPS;
    const sampled = film.sampleShot(0, t);
    const sampledText = sampled.find((n) => n.type === 'text');
    const shift = sampledText.x - text.props.x; // the camera drift moves the band and the text alike
    const words = wordSpans(sampledText).flat();
    const shown = words.filter((w) => run.some((r) => r.index === w.index) && w.opacity > 0);
    const revealed = sample(band.tracks.reveal, t, band.step);
    const bandRight = shift + left - reach + revealed * total;
    if (revealed > 0 && revealed < 1) sawGrowth = true;
    const visibleRight = shown.length === 0 ? -Infinity : Math.max(...shown.map((w) => w.right));
    if (revealed > 0) aheadBy = Math.max(aheadBy, bandRight - Math.max(visibleRight, shift + left - reach));
  }
  assert.ok(sawGrowth, 'the band is partly revealed on some frames');
  assert.ok(aheadBy <= reach + 0.5, `the band runs ${aheadBy.toFixed(1)} px ahead of the last visible word (a hand swipe may run ${reach} px past the end of the text)`);
  const lastLands = built.timing.words[3].start;
  near(sample(band.tracks.reveal, lastLands, band.step), 1, 'full when the last emphasised word lands');
  assert.ok(sample(band.tracks.reveal, built.timing.words[2].start, band.step) < 1, 'not full when the first of them lands');
});

test('no frame of an emphasis pulse has a word overlapping its neighbour on the line, and the peak is capped to the gaps and never above the look', () => {
  const look = registries.looks.get('pop');
  for (const [text, format] of [['Your charts are *hiding* something.', '16:9'], ['A *superfragilistic* B', '16:9'], ['No cloud. No account. *No upload*.', '9:16'], ['Your charts are *hiding* something.', '9:16']]) {
    const shot = { id: 'p', show: 'statement', say: text };
    const film = filmFor([FILLER, shot], centredPop(), format); // the pulse lives on in recolor-scale looks
    const frames = Math.round(film.duration * FPS);
    const spokenWords = buildTimeline(filmOf([FILLER, shot], centredPop(), format), { fps: FPS }).shots[1].words;
    const emphasised = spokenWords.findIndex((w) => w.emphasis), emphasisAt = spokenWords[emphasised].start;
    let peak = 1;
    for (let i = 0; i < frames; i++) {
      const node = film.sampleShot(1, Math.max(0, i / FPS - 1)).find((n) => n.type === 'text');
      if (i / FPS < 1) continue;
      for (const line of wordSpans(node)) {
        line.forEach((w, k) => { if (k > 0) assert.ok(line[k - 1].right <= w.left + 1e-6, `${text}: frame ${i}: word ${k - 1} meets word ${k} by ${(line[k - 1].right - w.left).toFixed(2)} px`); });
      }
      if (i / FPS - 1 >= emphasisAt) peak = Math.max(peak, node.words[emphasised].scale); // after it has landed: the pulse alone
    }
    assert.ok(peak > 1, `${text}: the word does pulse`);
  }
  // a long word between short ones has little room: its pulse is capped to the gap, whatever the ease does on the way
  const gapLook = registries.looks.get('pop');
  const line = { words: [{ index: 0, x: 0, width: 100 }, { index: 1, x: 130, width: 1000 }, { index: 2, x: 1160, width: 100 }] };
  const words = line.words.map((word) => ({ line, word }));
  const peaks = pulsePeaks(words, gapLook);
  assert.ok(peaks.get(1) < gapLook.moves.emphasize.scale, 'the gap, not the look, limits the long word');
  const pulse = pulseScale(gapLook, { pulse: 0, peak: peaks.get(1) });
  const highest = Math.max(...Array.from({ length: 200 }, (_, i) => sample(pulse, i / 200)));
  assert.ok(highest <= 1 + 30 / 1000 + 1e-6, `the long word's pulse reaches ${highest}; the gap allows ${1 + 30 / 1000}`);
  // the entrance spring runs past 1 as well: it starts nearer to 1 where the gap is small, and as the look has it where there is room
  const starts = enterStarts(words, gapLook);
  assert.ok(starts.get(1) > gapLook.moves.enter.scale, 'the long word pops from a start nearer to 1');
  const entering = landing(0.5, { ...gapLook.moves.enter }, starts.get(1), 1);
  const reach = Math.max(...Array.from({ length: 200 }, (_, i) => sample(entering, 0.5 - gapLook.moves.enter.dur + (i / 200) * gapLook.moves.enter.dur)));
  assert.ok(reach <= 1 + 30 / 1000 + 1e-6, `the long word's entrance reaches ${reach}`);
  assert.equal(enterStarts([{ line: { words: [{ index: 0, x: 0, width: 400 }] }, word: { index: 0, x: 0, width: 400 } }], gapLook).get(0), gapLook.moves.enter.scale, 'a word with room pops as the look has it');
  assert.equal(pulsePeaks([{ line: { words: [{ index: 0, x: 0, width: 400 }] }, word: { index: 0, x: 0, width: 400 } }], gapLook).get(0), gapLook.moves.emphasize.scale, 'a word with no neighbour keeps the look value');
});

// ---- a match between unlike heroes ----

test('a match between unlike heroes does not scale them: the outgoing one drifts up to half the way and fades over the first 60%, the incoming one fades and moves in over the last 60%', () => {
  const canvas = { w: 1920, h: 1080 };
  const layoutOf = (...words) => ({ lines: [{ x: 0, y: 40, width: 100, words: words.map((text, index) => ({ text, index, x: 0, width: 50 })) }] });
  const heroText = { ...fakeSampled('h', 200, { scale: 1.5 }), type: 'text', props: { layout: layoutOf('Hello', 'there') }, bbox: [200, 100, 400, 100] };
  const heroFigure = { ...fakeSampled('h', 1000, { scale: 1 }), type: 'group', children: [{ ...fakeSampled('h.digits', 0), type: 'text', props: { layout: layoutOf('42') }, children: [] }], bbox: [900, 500, 400, 200] };
  const cut = registries.cuts.get('match');
  const kicker = fakeSampled('k', 300);
  const at = (p) => cut.apply({ from: [kicker, heroText], to: [heroFigure], p, canvas });
  const [fromCentre, toCentre] = [[400, 150], [1100, 600]];
  // p 0.3: half of the fade (p / 0.6)
  const early = at(0.3);
  const leaving = early.find((n) => n.id === 'h' && n.type === 'text');
  const arriving = early.find((n) => n.id === 'h' && n.type === 'group');
  near(leaving.scale, 1.5, 'the outgoing hero is not scaled');
  near(leaving.opacity, 0.5, 'half faded');
  near(leaving.x, 200 + (toCentre[0] - fromCentre[0]) * 0.5 * 0.5, 'drifted half of the half way');
  near(arriving.opacity, 0, 'the incoming hero has not started');
  near(early.find((n) => n.id === 'k').x, 300 + (toCentre[0] - fromCentre[0]) * 0.5 * 0.5, 'the rest of the outgoing frame drifts with its hero, so a highlight is not left behind the text');
  // p 0.6: the outgoing one is gone and has gone half the way; the incoming one is a third of the way in
  const middle = at(0.6);
  const gone = middle.find((n) => n.id === 'h' && n.type === 'text');
  near(gone.opacity, 0); near(gone.x, 200 + (toCentre[0] - fromCentre[0]) * 0.5, 'at most half the way');
  near(middle.find((n) => n.type === 'group').opacity, (0.6 - 0.4) / 0.6, 'fading in over the last 60%');
  // the end: the incoming hero is home
  const end = at(0.999);
  const home = end.find((n) => n.type === 'group');
  assert.ok(Math.abs(home.x - 1000) < 1 && Math.abs(home.opacity - 1) < 0.01, 'the incoming hero ends where it belongs');
  // identical heroes still morph
  const twin = { ...heroText, bbox: [1000, 500, 400, 100], x: 1000 };
  const morphed = cut.apply({ from: [heroText], to: [twin], p: 0.5, canvas }).find((n) => n.id === 'h');
  assert.equal(morphed.props.match, true, 'a like pair morphs into one group of two copies');
});

// ---- an establishing view before a region is singled out ----

const CLIP = (extra = {}) => ({ id: 'c', show: 'clipping', src: 'shot.png', say: 'This one shows the query behind every chart on the page today.', regions: { r: [0.1, 0.1, 0.3, 0.3] }, on: [{ at: 'word:one', do: 'circle', target: 'region:r' }], ...extra });
const pushLanding = (camera) => camera.find((layer) => layer.some((k) => k.zoom !== undefined && k.zoom > 1))?.findLast((k) => k.zoom > 1);

test('desk: the push starts no earlier than the incoming cut ends plus 0.6 s, so the whole picture is seen first', () => {
  const early = expandIn(filmOf([FILLER, CLIP({ cut: 'slide' })]), 1);
  const landing = pushLanding(early.camera);
  const layer = early.camera.find((l) => l.some((k) => k.zoom > 1));
  near(landing.t, 0.4 + 0.6 + 0.9, 'a slide ends at 0.4 s: the push lands 0.6 s plus its own 0.9 s after that');
  assert.ok(layer[0].t >= 0.4 + 0.6 - EPS, `the push starts at ${layer[0].t}`);
  const first = expandIn(filmOf([CLIP()]), 0);
  near(pushLanding(first.camera).t, 0.6 + 0.9, 'the first shot has no cut: 0.6 s of the picture, then the push');
  const late = expandIn(filmOf([FILLER, CLIP({ cut: 'slide', on: [{ at: 2.5, do: 'circle', target: 'region:r' }] })]), 1);
  near(pushLanding(late.camera).t, 2.5, 'an event that is late enough stays where the narration puts it');
});

test('pop: the close-up switch is no earlier than the incoming cut ends plus 0.6 s', () => {
  const clip = CLIP({ cut: 'punch', on: [{ at: 'word:one', do: 'underline', target: 'region:r' }] });
  const { nodes } = expandIn(filmOf([FILLER, clip], 'pop', '9:16'), 1);
  const hero = nodes.find((n) => n.id === 'c.image');
  const hideAt = hero.tracks.opacity.points.at(-1).t;
  assert.ok(hideAt >= 0.2 + 0.6 - EPS, `the picture goes at ${hideAt}`);
});

test('an event that was moved is reported at shots[i].on[j] with how early the word is', () => {
  const clip = CLIP({ cut: 'slide' });
  const film = filmOf([FILLER, clip]);
  const timeline = buildTimeline(film, { fps: FPS });
  const timing = timeline.shots[1];
  const [found] = establishingFindings(clip, { look: registries.looks.get('desk'), timing, at: (ref) => resolveAnchor(ref, timing) });
  assert.equal(found.path, 'on[0]');
  const wordOne = timing.words.find((w) => w.text === 'one' || w.text === 'One');
  const by = 0.4 + 0.6 + 0.9 - resolveAnchor('word:one', timing);
  assert.match(found.message, new RegExp(`comes ${by.toFixed(2)} s too early to show the whole picture first`));
  assert.match(found.message, /move the word later in the narration by/);
  void wordOne;
  const later = establishingFindings({ ...clip, on: [{ at: 2.5, do: 'circle', target: 'region:r' }] }, { look: registries.looks.get('desk'), timing, at: (ref) => resolveAnchor(ref, timing) });
  assert.deepEqual(later, []);
  assert.deepEqual(establishingFindings({ ...clip, on: [{ at: 0.1, do: 'highlight', target: 'image' }] }, { look: registries.looks.get('desk'), timing, at: (ref) => resolveAnchor(ref, timing) }), [], 'an event on the whole picture needs no establishing view');
});
