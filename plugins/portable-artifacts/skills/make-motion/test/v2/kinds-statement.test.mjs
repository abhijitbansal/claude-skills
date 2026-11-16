// The statement kind (desk editorial, the centred test look and the pop stack): fitting, slug, highlights, word
// timing, emphasis and the viral hook. Pure scene-graph work with a fake text measure (helpers/kinds.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import { sampleGraph } from '../../engine/graph/sample.mjs';
import { sample } from '../../engine/time/track.mjs';
import { ease } from '../../engine/time/ease.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { gridX } from '../../engine/looks/index.mjs';
import { pulsePeaks, enterStarts } from '../../engine/kinds/statement.mjs';
import { wordTimes } from '../../engine/kinds/words.mjs';
import { pulseScale } from '../../engine/kinds/shared.mjs';
import { landing } from '../../engine/devices/shared.mjs';
import { subtreeBox } from './helpers/boxes.mjs';
import '../../engine/looks/index.mjs';
import '../../engine/modes/index.mjs';
import '../../engine/devices/index.mjs';
import '../../engine/kinds/index.mjs';
import '../../engine/cuts/index.mjs';
import {
  FPS, EPS, measure, canvasOf, viralOf, filmOf, expandIn, expandShot, FILLER, expandSecond, filmFor, all,
  textNode, lastKey, near, inside, landsOn, overlaps, heroWords, slugOf, centredPop, stackLinesOf, plateBox,
  wordSpans,
} from './helpers/kinds.mjs';

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

test('a 30-word statement on 9:16 reports overflow', () => {
  const { nodes } = expandShot({ id: 'a', show: 'statement', hold: 3, text: Array(30).fill('paragraph').join(' ') }, 'pop', '9:16');
  assert.equal(textNode(nodes).props.layout.overflow, true);
});

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

test('desk slug: a taped card turned +3 degrees, its right margin equal to the text block left margin (right edge of column 11), top at 14%, holding the shot number and the kicker, in the same place every shot', () => {
  const film = filmOf([
    { id: 'a', show: 'statement', say: 'One file.', kicker: 'The problem' },
    { id: 'n', show: 'number', value: 3, label: 'skills', hold: 2 },
    { id: 'b', show: 'statement', say: 'Scripts do the rest of it.', kicker: 'portable-artifacts' },
    { id: 'c', show: 'statement', say: 'No kicker here.' },
  ]);
  const look = registries.looks.get('desk');
  const canvas = canvasOf('16:9');
  // the text block starts on column 2, so the card's right margin is that wide: it ends on the right edge of column 11
  const right = canvas.w - gridX(look, canvas, 2), top = 0.14 * canvas.h;
  const slugs = [['a', 0, '01'], ['b', 2, '03']].map(([id, index, number]) => {
    const { nodes } = expandIn(film, index);
    const slug = slugOf(nodes, id);
    assert.ok(slug, `${id} has a slug`);
    assert.equal(slug.group.props.rotate, 3, `${id}: turned exactly +3 degrees`);
    assert.ok(Math.abs(slug.right - right) < 2, `${id}: right edge ${slug.right} at ${right}, within the paper's hand jitter`);
    assert.ok(Math.abs(slug.top - top) < 2, `${id}: top ${slug.top} at 14% (${top})`);
    assert.ok(slug.group.children.some((n) => n.id === `${id}.slug.tape1`), 'taped');
    assert.equal(slug.group.children.find((n) => n.id === `${id}.slug.paper`).props.textCard, true, 'its paper is a text card, for the review');
    const numeral = slug.group.children.find((n) => n.id === `${id}.slug.number`);
    assert.equal(numeral.props.layout.lines[0].words[0].text, number);
    assert.equal(numeral.props.font.family, look.fonts.display.family);
    const kicker = slug.group.children.find((n) => n.id === `${id}.kicker`);
    assert.equal(kicker.props.font.family, look.fonts.label.family);
    assert.equal(kicker.props.font.size, look.scale[1], 'kicker at scale step 2');
    assert.equal(kicker.props.role, 'kicker');
    assert.equal(kicker.props.furniture, true, 'the slug kicker is frame furniture');
    assert.equal(numeral.props.furniture, true, 'and so is its numeral');
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
    return slug;
  });
  assert.equal(slugOf(expandIn(film, 3).nodes, 'c'), null, 'no kicker, no slug');
  // a kicker wider than three columns wraps on the card, after its hyphen: a slug, not a banner
  const long = slugs[1].group.children.find((n) => n.id === 'b.kicker').props.layout;
  assert.deepEqual(long.lines.map((l) => l.words.map((w) => w.text).join(' ')), ['PORTABLE-', 'ARTIFACTS']);
  const three = gridX(look, canvas, 4) - look.grid.gutter - gridX(look, canvas, 1);
  assert.ok(long.width <= three + EPS, `kicker ${long.width} within three columns (${three})`);
  // when the text would run under the card it is kept clear of it: the span stops a column earlier, or (when narrowing
  // would take it under the hero ratio) the block drops below the card; a tall card from a wrapped kicker over a sentence
  // that fills columns 2 to 9
  const tall = filmOf([{ id: 't', show: 'statement', say: 'Every chart on this page shows the query behind it.', kicker: 'one two three four five six seven' }]);
  const tallText = textNode(expandIn(tall, 0).nodes, 't.text');
  const tallSlug = slugOf(expandIn(tall, 0).nodes, 't');
  const textRight = tallText.props.x + tallText.props.layout.width;
  const textTop = tallText.props.y + tallText.props.layout.lines[0].y - 0.74 * tallText.props.font.size;
  assert.ok(textRight <= tallSlug.right - tallSlug.w || textTop >= tallSlug.top + tallSlug.h, `text (right ${textRight}, top ${textTop}) clear of the card (left ${tallSlug.right - tallSlug.w}, bottom ${tallSlug.top + tallSlug.h})`);
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

test('pop stack: lines by sense, each filling the safe width, capped at 400 units or held within the look\'s ratio of its neighbour, flush left, 0.08 apart, on the safe zone\'s optical centre', () => {
  const { nodes, canvas, ctx } = expandSecond({ id: 'a', show: 'statement', say: 'Your charts are *hiding* something.' }, 'pop', '9:16');
  const safe = viralOf(canvas);
  const left = safe.left, width = canvas.w - safe.left - safe.right; // 120 and 765 on 1080 x 1920
  const lines = stackLinesOf(nodes, 'a.text');
  assert.deepEqual(lines.map((l) => l.text), ['YOUR CHARTS', 'ARE HIDING', 'SOMETHING.']);
  // hand-computed: "SOMETHING." is 10 glyphs of 0.55 em tracked -0.02 em; its ink runs from 0.02 em to
  // 5.5 - 0.02 - 9 x 0.02 = 5.3 em, so 5.28 em wide; fitted 0.5 px inside the 765 px width: 764.5 / 5.28 = 144.792 px
  near(lines[2].size, 764.5 / 5.28, 'SOMETHING. hand-computed size');
  for (const l of lines) {
    const held = lines.some((m) => m !== l && Math.abs(l.size - m.size * ctx.look.stack.ratio) < 1e-6);
    assert.ok(Math.abs(l.right - l.left - width) <= 1 || Math.abs(l.size - 400) < EPS || held, `${l.text}: ink ${l.right - l.left} fills ${width}, 400 units, or the ratio`);
    near(l.left, left, `${l.text}: flush left on the safe edge`);
    assert.equal(l.node.props.font.wordSpace, 0.18);
    assert.equal(l.node.props.stack, 'a.text', 'every line names its stack');
    assert.equal(l.node.props.role, 'hero');
  }
  lines.slice(1).forEach((l, k) => near(l.top - lines[k].bottom, 0.08 * Math.max(l.size, lines[k].size), `gap over ${l.text}`));
  near((lines[0].top + lines.at(-1).bottom) / 2, safe.top + ctx.look.stack.centre * (canvas.h - safe.top - safe.bottom), 'block on the optical centre of the safe zone');
  assert.ok(lines.every((l) => l.size >= ctx.look.scale[2] - EPS), 'never below scale step 3');
  // a short line would need more than 400 units to fill the width: it stops at 400, or within the look's ratio of its
  // neighbour (look revision 1), flush left
  const short = stackLinesOf(expandSecond({ id: 'b', show: 'statement', say: 'No. Never.', text: 'No. | Never.' }, 'pop', '9:16').nodes, 'b.text');
  near(short[0].size, Math.min(400, short[1].size * ctx.look.stack.ratio), 'held at 400 units or the ratio');
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
  // the fix pass (F5): a ghost is an opaque colour, ink mixed 40% into paper (#ffffff into #111111), not ink at an alpha
  assert.equal(sample(hiding.fill, at), '#707070', 'the ghost colour until it is spoken...');
  assert.equal(hiding.opacity, undefined, '...opaque throughout: the field never shows through the letters');
  assert.equal(sample(hiding.fill, at + look.moves.emphasize.dur), look.palette.accent, 'accent one emphasize move later');
  assert.ok(sample(hiding.fill, at + look.moves.emphasize.dur / 2) !== look.palette.ink, 'changing on the way');
  for (const l of lines) for (const w of l.node.wordTracks) assert.equal(w.scale, undefined, 'no word scales in a stack');
});

test('viral ghost words on every statement: all words on screen in the opaque ghost colour (ink mixed 40% into paper) from the first frame, each lighting as spoken; with no say, the first at the shot start, the rest 0.09 s apart from 0.2 s', () => {
  const shots = [{ id: 'one', show: 'statement', say: 'Your charts are *hiding* something.' }, { id: 'two', show: 'statement', say: 'No cloud. No *upload*.', cut: 'cut' },
    { id: 'three', show: 'statement', hold: 2, text: 'Three quiet words' }];
  const film = filmFor(shots, 'pop', '9:16');
  const look = registries.looks.get('pop');
  const timeline = buildTimeline(filmOf(shots, 'pop', '9:16'), { fps: FPS });
  for (const [index, id] of [[0, 'one'], [1, 'two'], [2, 'three']]) {
    const texts = (t) => film.sampleShot(index, t).find((n) => n.id === `${id}.text`).children;
    const first = texts(0).flatMap((n) => n.words);
    assert.ok(first.every((w) => w.opacity === 1 && w.fill === '#707070'), `${id}: every word on screen, opaque, in the ghost colour on frame 0`);
    const end = texts(timeline.shots[index].duration).flatMap((n) => n.words);
    assert.ok(end.every((w) => (w.fill === look.palette.ink || w.fill === look.palette.accent) && w.opacity === 1), `${id}: every word lit by the end`);
  }
  const upload = film.sampleShot(1, timeline.shots[1].duration).find((n) => n.id === 'two.text').children.flatMap((n) => n.words).at(-1);
  assert.equal(upload.fill, look.palette.accent, 'the emphasised word lights in the accent');
  const quiet = expandIn(filmOf(shots, 'pop', '9:16'), 2).nodes.find((n) => n.id === 'three.text').children.flatMap((n) => n.wordTracks);
  quiet.forEach((w, i) => assert.equal(w.fill.points.at(-1).t, noSayAt(i) + look.moves.emphasize.dur, `word ${i} lights at ${noSayAt(i)} s`));
});

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

// With no say: the first word lands on the shot's first frame (a shot never opens empty, as a narrated shot's first
// word does on a measured timeline), the rest stagger 0.09 s apart from 0.2 s.
const noSayAt = (i) => (i === 0 ? 0 : 0.2 + 0.09 * i);

test('with no say, the first word lands at the shot start and the rest stagger 0.09 s apart from 0.2 s', () => {
  const { nodes } = expandShot({ id: 'a', show: 'statement', hold: 3, text: 'Three small words' });
  textNode(nodes).wordTracks.forEach((w, i) => near(lastKey(w.opacity).t, noSayAt(i), `word ${i}`));
});

test('wordTimes with no narration: the first word at 0, the rest from NO_SAY_START, never past the shot', () => {
  assert.deepEqual(wordTimes(['A', 'quiet', 'breath.'], { words: [], duration: 2 }).map((w) => [w.at, w.spoken]), [0, 1, 2].map((i) => [noSayAt(i), null]));
  assert.deepEqual(wordTimes(['A', 'b'], { words: [], duration: 0.1 }).map((w) => w.at), [0, 0.1]);
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

test('an apostrophe inside a word is set as the typographic one, and the word still lands on its spoken word', () => {
  const { nodes, timing } = expandShot({ id: 'a', show: 'statement', say: "Dashboards can't say." });
  const text = textNode(nodes);
  assert.ok(text.props.layout.lines.flatMap((l) => l.words).some((w) => w.text === 'can\u2019t'));
  near(lastKey(text.wordTracks[1].opacity).t, timing.words[1].start);
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

test('a desk statement with a slug is not narrowed or traded for a nicer break below three times the slug kicker, so the hero keeps its ratio (the review hero rule)', () => {
  const look = registries.looks.get('desk');
  // On 16:9 each of these fits at that size across columns 2 to 9 (with the fake measure), so it must fit and hold the
  // floor (restored, look gate fix pass M1c: no skip on overflow). Only 16:9: on 1:1, 4:5 and 9:16 the floor is a
  // preference of the fitter (tradeFloor), not a rule; since the furniture ruling no review rule compares a statement
  // with its slug's kicker, so a long statement there may legitimately be set below it.
  for (const say of ['The model writes *one small file*. Scripts do the rest.', 'Built on your machine. *Nothing* leaves it.', 'Most dashboards can\'t tell you where a number *came from*.']) {
    const { nodes } = expandShot({ id: 'a', show: 'statement', say, kicker: 'How it works' }, 'desk', '16:9');
    const text = textNode(nodes, 'a.text');
    assert.equal(text.props.layout.overflow, false, `16:9 "${say}" fits`);
    assert.ok(text.props.font.size >= 3 * look.scale[1] - EPS, `16:9 "${say}": ${text.props.font.size}`);
  }
});

// The ink of a landed text (the fake measure's ink, helpers/kinds.mjs) in canvas pixels, from its sampled position. The
// measure leaves the font's tracking out; canvas adds it after every glyph but the last.
function textInk(n) {
  const { layout, font } = n.props;
  const boxes = layout.lines.flatMap((line) => line.words.map((w) => {
    const m = measure(w.text, font);
    const tracked = (font.tracking ?? 0) * font.size * ([...w.text].length - 1);
    const left = n.x + line.x + w.x + m.inkLeft, baseline = n.y + line.y;
    return [left, baseline - m.inkAscent, m.inkRight + tracked - m.inkLeft, m.inkAscent + m.inkDescent];
  }));
  const l = Math.min(...boxes.map((b) => b[0])), t = Math.min(...boxes.map((b) => b[1]));
  return [l, t, Math.max(...boxes.map((b) => b[0] + b[2])) - l, Math.max(...boxes.map((b) => b[1] + b[3])) - t];
}

test('fix pass F4: a desk statement\'s ink clears the slug card, its tape included, by at least two gutters in both axes, through the camera drift', () => {
  const says = ['Most dashboards can\'t tell you where a number *came from*.', 'The model writes *one small file*. Scripts do the rest.', 'Built on your machine. *Nothing* leaves it.', 'Every chart shows the query behind it.'];
  const kickers = ['The problem', 'How it works', 'portable-artifacts', 'A much longer kicker for the card'];
  for (const format of ['16:9', '9:16', '1:1', '4:5']) {
    for (const say of says) {
      for (const kicker of kickers) {
        for (const second of [false, true]) { // the drift runs the other way in the second shot of a film
          const shot = { id: 'a', show: 'statement', say, kicker, cut: 'cut' };
          const shots = second ? [FILLER, shot] : [shot];
          const film = filmFor(shots, 'desk', format);
          const index = shots.length - 1;
          const { timing, ctx } = expandIn(filmOf(shots, 'desk', format), index);
          const gutter = ctx.look.grid.gutter * ctx.unit;
          for (const t of [timing.duration - 1 / FPS, timing.duration - 1]) {
            const sampled = film.sampleShot(index, t);
            const slug = ['a.slug.paper', 'a.slug.tape1', 'a.slug.tape2'].map((id) => subtreeBox(sampled, id));
            assert.ok(slug.every(Boolean), 'the paper and two tape strips');
            const card = [Math.min(...slug.map((b) => b[0])), Math.min(...slug.map((b) => b[1]))];
            card.push(Math.max(...slug.map((b) => b[0] + b[2])) - card[0], Math.max(...slug.map((b) => b[1] + b[3])) - card[1]);
            const text = all(sampled).find((n) => n.id === 'a.text');
            const ink = textInk(text);
            // EPS: a block dropped under the card sits exactly two gutters below it, to float noise
            const clear = [card[0] - 2 * gutter + EPS, card[1] - 2 * gutter + EPS, card[2] + 4 * gutter - 2 * EPS, card[3] + 4 * gutter - 2 * EPS];
            assert.ok(!overlaps(clear, ink), `${format} "${say}" / "${kicker}"${second ? ' (second shot)' : ''} at ${t.toFixed(2)}: ink ${ink.map(Math.round)} within two gutters of the slug ${card.map(Math.round)}`);
          }
        }
      }
    }
  }
});
