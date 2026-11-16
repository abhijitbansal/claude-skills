// Captions (design 9.3, sound and captions plan Task 6): the spoken words of a narrated shot whose kind does not show its
// own words, drawn in the look's caption style, grouped by sense, leaving when their words end, and the four review
// rules that keep them in their zone, off the hero, on time and unclipped. All pure: no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registries } from '../../engine/registry.mjs';
import { spawnSync } from 'node:child_process';
import { captionGroups, kindContext, markedBoxes, CAPTION_HOLD } from '../../engine/captions/index.mjs';
import { auditFrame, CAPTION_LATE_SECONDS } from '../../engine/review/frame.mjs';
import { runInk, unionBox, compositionRect } from '../../engine/kinds/shared.mjs';
import { pathPoints } from '../../engine/devices/shared.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { sampleGraph } from '../../engine/graph/sample.mjs';
import { sample } from '../../engine/time/track.mjs';
import { buildFilm, shotContext } from '../../engine/graph/film.mjs';
import { safeRectFor } from '../../scripts/v2/review.mjs';
import { FPS, measure, canvasOf, viralOf, filmOf, filmFor, FILLER, centredPop, IMAGES } from './helpers/kinds.mjs';

const EPS = 1e-6;
const HOLD_LIMIT = 0.3; // the review's: a caption may stay this long after its last word ends
const textsOf = (groups) => groups.map((g) => g.words.map((w) => w.text).join(' '));
// Words as the timeline gives them: start and end in shot seconds, one after the other, 0.3 s each.
const wordsOf = (line, emphasised = []) => line.split(' ').map((text, i) => ({ text, start: 0.3 * i, end: 0.3 * i + 0.25, emphasis: emphasised.includes(i), aside: false }));

// ---- grouping ----

test('captionGroups breaks at a sentence end first: a group never runs across one', () => {
  const groups = captionGroups(wordsOf('Most charts hide it. This one shows you.'), { maxWords: 7, maxChars: 40 });
  assert.deepEqual(textsOf(groups), ['Most charts hide it.', 'This one shows you.']);
  assert.deepEqual(groups.map((g) => [g.first, g.last]), [[0, 3], [4, 7]]);
});

test('captionGroups breaks a long clause at its punctuation, and a clause with none into groups of at most maxWords, none of one word', () => {
  const clause = captionGroups(wordsOf('When the model writes one file, the scripts do the rest.'), { maxWords: 6, maxChars: 40 });
  assert.deepEqual(textsOf(clause), ['When the model writes one file,', 'the scripts do the rest.']);
  const plain = captionGroups(wordsOf('Every chart on this dashboard shows the exact query behind it.'), { maxWords: 4, maxChars: 40 });
  assert.ok(plain.every((g) => g.words.length >= 2 && g.words.length <= 4), JSON.stringify(textsOf(plain)));
  assert.equal(textsOf(plain).join(' '), 'Every chart on this dashboard shows the exact query behind it.');
  const chars = captionGroups(wordsOf('Scripts validate, lint and render everything locally today.'), { maxWords: 9, maxChars: 24 });
  assert.ok(chars.every((g) => g.words.map((w) => w.text).join(' ').length <= 24), JSON.stringify(textsOf(chars)));
});

test('captionGroups never splits a merged pair (two tokens sharing one time), even past maxWords', () => {
  const words = wordsOf('We lost $5 million.');
  const merged = words.map((w, i) => (i === 3 ? { ...w, start: words[2].start, end: words[2].end } : w));
  assert.deepEqual(textsOf(captionGroups(merged, { maxWords: 3, maxChars: 40 })), ['We lost', '$5 million.']);
  const pair = merged.slice(2);
  assert.deepEqual(textsOf(captionGroups(pair, { maxWords: 1, maxChars: 40 })), ['$5 million.']);
});

test('captionGroups leaves a one-word group only for a one-word sentence', () => {
  assert.deepEqual(textsOf(captionGroups(wordsOf('Go. Now we wait.'), { maxWords: 3, maxChars: 40 })), ['Go.', 'Now we wait.']);
  const five = captionGroups(wordsOf('Save this and build yours.'), { maxWords: 4, maxChars: 40 });
  assert.equal(five.length, 2);
  assert.ok(five.every((g) => g.words.length >= 2), JSON.stringify(textsOf(five)));
  assert.deepEqual(captionGroups([], { maxWords: 3, maxChars: 20 }), []);
});

test('captionGroups keeps a zero-length word (a spaced dash) with its clause', () => {
  const words = wordsOf('Built here — nothing leaves.');
  const dash = words.map((w, i) => (i === 2 ? { ...w, start: words[1].end, end: words[1].end } : w));
  const groups = captionGroups(dash, { maxWords: 3, maxChars: 40 });
  assert.deepEqual(textsOf(groups), ['Built here —', 'nothing leaves.']);
});

// ---- which shots get captions ----

const ON = Object.freeze({ captions: true }); // captions are opt-in in every mode
const CLIP = { id: 'c', show: 'clipping', src: 'shot.png', say: 'This one shows the query behind every chart. It never hides a *number* from you.' };
// Every spoken-caption text in a sampled tree with its canvas origin and its accumulated opacity (caption groups are
// upright and unscaled, so an origin is a sum of offsets).
const captionTexts = (nodes) => {
  const out = [];
  const walk = (n, ox, oy, opacity) => {
    const x = ox + n.x, y = oy + n.y, o = opacity * n.opacity;
    if (n.type === 'text' && n.props.caption) out.push({ node: n, ox: x, oy: y, o });
    n.children.forEach((child) => walk(child, x, y, o));
  };
  nodes.forEach((n) => walk(n, 0, 0, 1));
  return out;
};
const onScreen = (entries) => entries.filter((e) => e.o > 0);
const allNodes = (nodes) => nodes.flatMap((n) => [n, ...allNodes(n.children)]);
const captionsIn = (built, index, t) => captionTexts(built.sampleShot(index, t));

test('a clipping shot with narration gets caption nodes; a statement and a number shot show their own words and get none', () => {
  const statement = { id: 's', show: 'statement', say: 'Most dashboards cannot tell you where a number came from.' };
  const number = { id: 'n', show: 'number', say: 'Five skills. One file each.', value: 5, label: 'skills' };
  for (const look of ['desk', 'pop']) {
    const built = filmFor([CLIP, statement, number], look, look === 'pop' ? '9:16' : '16:9', { captions: true });
    const caps = captionsIn(built, 0, 0.1);
    assert.ok(caps.length > 1, `${look}: the clipping is captioned in more than one group`);
    for (const { node } of caps) {
      assert.equal(node.props.role, 'caption');
      assert.equal(node.props.furniture, true);
      assert.ok(node.id.startsWith('c.captions.'), node.id);
    }
    assert.deepEqual(captionsIn(built, 1, 0.1), [], `${look}: a statement shows its own words`);
    assert.deepEqual(captionsIn(built, 2, 0.1), [], `${look}: a number shows its own words`);
  }
  assert.equal(registries.kinds.get('statement').showsWords, true);
  assert.equal(registries.kinds.get('number').showsWords, true);
});

test('the mode data is the default and the film field overrides it: captions are opt-in in pro and viral, captions true or false wins', () => {
  const count = (look, format, extra) => captionsIn(filmFor([CLIP], look, format, extra), 0, 0.1).length;
  assert.equal(count('desk', '16:9', {}), 0, 'pro: off');
  assert.ok(count('desk', '16:9', { captions: true }) > 0, 'pro with captions: true');
  assert.equal(count('pop', '9:16', {}), 0, 'viral: off (the ruling round: opt-in in every mode for now)');
  assert.ok(count('pop', '9:16', { captions: true }) > 0, 'viral with captions: true');
  assert.equal(count('pop', '9:16', { captions: false }), 0, 'viral with captions: false');
  const silent = { ...CLIP, say: undefined, hold: 2 };
  assert.equal(captionsIn(filmFor([silent], 'pop', '9:16', ON), 0, 0.1).length, 0, 'no narration, no captions');
});

// ---- placement: each style keeps its text inside its zone, and the zone inside the safe area ----

// The ink of a caption text on the canvas (the fake measure's ink, per line, as the kinds measure it): what the review
// judges, flush edges included.
function inkOf({ node, ox, oy }) {
  const { layout, font } = node.props;
  return unionBox(layout.lines.map((line) => {
    const ink = runInk(line, font, measure);
    return [ox + ink.left, oy + line.y - ink.up, ink.right - ink.left, ink.up + ink.down];
  }));
}
const insideBox = (inner, outer, slack = EPS) => inner[0] >= outer[0] - slack && inner[1] >= outer[1] - slack
  && inner[0] + inner[2] <= outer[0] + outer[2] + slack && inner[1] + inner[3] <= outer[1] + outer[3] + slack;

for (const look of ['desk', 'pop']) {
  for (const format of ['16:9', '9:16']) {
    test(`${look} at ${format}: every caption group sits inside its zone, and the zone inside the safe area${look === 'pop' ? ' (the platform safe zone on 9:16)' : ''}`, () => {
      const film = filmOf([CLIP], look, format, { captions: true });
      const built = filmFor([CLIP], look, format, { captions: true });
      const canvas = canvasOf(format);
      const safe = safeRectFor(canvas, registries.looks.get(look));
      const safeBox = [safe.left, safe.top, safe.right - safe.left, safe.bottom - safe.top];
      const timeline = buildTimeline(film, { fps: FPS });
      const seen = new Set();
      for (const t of [0.05, ...timeline.shots[0].words.map((w) => w.start + 0.05)]) {
        for (const entry of onScreen(captionsIn(built, 0, t))) {
          seen.add(entry.node.id);
          const box = inkOf(entry);
          assert.ok(insideBox(box, entry.node.props.caption.zone), `${entry.node.id} at ${t}: ${box.map(Math.round)} outside ${entry.node.props.caption.zone.map(Math.round)}`);
          assert.ok(insideBox(entry.node.props.caption.zone, safeBox), `zone ${entry.node.props.caption.zone.map(Math.round)} outside the safe area`);
          if (look === 'pop' && format === '9:16') {
            const rect = compositionRect({ canvas, look: registries.looks.get('pop'), viralInsets: viralOf(canvas) });
            assert.ok(rect.safe && insideBox(box, [rect.left, rect.top, rect.w, rect.h]), 'inside the platform safe zone');
          }
        }
      }
      assert.ok(seen.size >= 2, `several groups seen: ${[...seen]}`);
    });
  }
}

test('desk lower: label caps on a taped paper card whose right edge is column 11 and whose bottom is the bottom margin, upright and pinned', () => {
  const built = filmFor([CLIP], 'desk', '16:9', { captions: true });
  const desk = registries.looks.get('desk');
  const nodes = built.sampleShot(0, 0.1);
  const card = allNodes(nodes).find((n) => n.id === 'c.captions');
  assert.ok(card, 'one caption card group per shot');
  assert.equal(card.props.fixed, true);
  assert.equal(card.rotate, 0);
  const paper = card.children.find((n) => n.id === 'c.captions.paper');
  assert.equal(paper.props.textCard, true, 'its paper keeps other texts off (the card-overlap rule)');
  assert.ok(card.children.some((n) => n.props.tape === true), 'taped');
  const pts = pathPoints(paper.props.d).map(([x, y]) => [card.x + x, card.y + y]);
  const right = Math.max(...pts.map((p) => p[0])), bottom = Math.max(...pts.map((p) => p[1]));
  const canvas = canvasOf('16:9');
  const col11Right = canvas.w - desk.grid.margin - (canvas.w - 2 * desk.grid.margin - 11 * desk.grid.gutter) / 12 - desk.grid.gutter;
  assert.ok(Math.abs(right - col11Right) < 3, `right edge ${right} on column 11's right edge ${col11Right}`);
  assert.ok(Math.abs(bottom - (canvas.h - desk.grid.margin)) < 3, `bottom ${bottom} on the bottom margin`);
  const [first] = onScreen(captionsIn(built, 0, 0.1));
  assert.equal(first.node.props.font.family, desk.fonts.label.family);
  const text = first.node.props.layout.lines.flatMap((l) => l.words.map((w) => w.text)).join(' ');
  assert.equal(text, text.toUpperCase(), 'caps');
  assert.ok(first.node.props.layout.lines.length <= 2, 'up to two lines');
});

test('desk lower and the clipping\'s own caption card never meet at rest: the author caption stays bottom left, the spoken one bottom right', () => {
  const shot = { ...CLIP, caption: 'Every chart shows its query' };
  const built = filmFor([shot], 'desk', '16:9', { captions: true });
  const nodes = built.sampleShot(0, 1);
  const author = allNodes(nodes).find((n) => n.id === 'c.caption.card');
  const spoken = allNodes(nodes).find((n) => n.id === 'c.captions');
  const paperBox = (group, id) => {
    const pts = pathPoints(group.children.find((n) => n.id === id).props.d).map(([x, y]) => [group.x + x, group.y + y]);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  };
  const a = paperBox(author, 'c.caption.card.paper'), b = paperBox(spoken, 'c.captions.paper');
  assert.ok(a[0] + a[2] < b[0] || b[0] + b[2] < a[0], `cards apart across: ${a.map(Math.round)} and ${b.map(Math.round)}`);
});

test('desk lower steps right of the clipping\'s caption card wherever a push takes it, so the two cards never meet in the shot', () => {
  for (const format of ['16:9', '9:16']) {
    const shot = { ...CLIP, caption: 'Every chart shows its query', regions: { query: [0.58, 0.14, 0.37, 0.24] }, on: [{ at: 'word:query', do: 'highlight', target: 'region:query' }] };
    const built = filmFor([shot], 'desk', format, { captions: true });
    const duration = buildTimeline(filmOf([shot], 'desk', format, { captions: true }), { fps: FPS }).shots[0].duration;
    const boxOf = (group, id) => {
      const pts = pathPoints(group.children.find((n) => n.id === id).props.d).map(([x, y]) => [group.x + x, group.y + y]);
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
    };
    for (let t = 0; t <= duration; t += 0.1) {
      const nodes = built.sampleShot(0, t);
      const author = nodes.find((n) => n.id === 'c.caption.card'), spoken = nodes.find((n) => n.id === 'c.captions');
      if (author.opacity <= 0 || spoken.opacity <= 0) continue;
      const a = boxOf(author, 'c.caption.card.paper'), b = boxOf(spoken, 'c.captions.paper');
      const apart = a[0] + a[2] <= b[0] || b[0] + b[2] <= a[0] || a[1] + a[3] <= b[1] || b[1] + b[3] <= a[1];
      assert.ok(apart, `${format} at ${t.toFixed(1)} s: ${a.map(Math.round)} meets ${b.map(Math.round)}`);
    }
  }
});

test('pop stack: display caps flush left on the stack edge, the spoken word in the accent and the rest in ink', () => {
  const film = filmOf([CLIP], 'pop', '9:16', ON);
  const built = filmFor([CLIP], 'pop', '9:16', ON);
  const pop = registries.looks.get('pop');
  const words = buildTimeline(film, { fps: FPS }).shots[0].words;
  const canvas = canvasOf('9:16');
  const rect = compositionRect({ canvas, look: pop, viralInsets: viralOf(canvas) });
  const k = 3; // "the"
  const t = (words[k].start + words[k].end) / 2;
  const [entry] = onScreen(captionsIn(built, 0, t));
  assert.equal(entry.node.props.font.family, pop.fonts.display.family);
  const shown = entry.node.props.layout.lines.flatMap((l) => l.words);
  const spoken = shown.find((w) => w.text === 'THE');
  assert.ok(spoken, `the spoken word is in this group: ${shown.map((w) => w.text)}`);
  assert.equal(entry.node.words[spoken.index].fill, pop.palette.accent, 'the spoken word in the accent');
  assert.ok(shown.filter((w) => w !== spoken).every((w) => entry.node.words[w.index].fill === pop.palette.ink), 'the others in ink');
  const box = inkOf(entry);
  assert.ok(Math.abs(box[0] - rect.left) < EPS, `flush left on the stack edge by its ink: ${box[0]} vs ${rect.left}`);
  assert.ok(shown.length <= 3, 'three words at a time');
});

// The ink of a word at its current scale and x (scaled about its centre on the baseline, as the page draws it), in
// canvas pixels.
function wordBox(entry, word, line) {
  const { node, ox, oy } = entry;
  const tr = node.words[word.index], s = tr.scale;
  const ink = runInk(line, node.props.font, measure, word.index, word.index);
  const c = line.x + word.x + word.width / 2;
  const left = ox + c + tr.x + (ink.left - c) * s, right = ox + c + tr.x + (ink.right - c) * s;
  return [left, oy + line.y + tr.y - ink.up * s, right - left, (ink.up + ink.down) * s];
}

test('pop: an emphasised word keeps the accent once spoken (the look\'s recolour), and nothing scales', () => {
  const shot = { id: 'c', show: 'clipping', src: 'shot.png', say: 'Your charts are *hiding* something.' };
  const built = filmFor([shot], 'pop', '9:16', ON);
  const words = buildTimeline(filmOf([shot], 'pop', '9:16', ON), { fps: FPS }).shots[0].words;
  const pop = registries.looks.get('pop');
  const entry = onScreen(captionsIn(built, 0, words[4].start + 0.05)).find((e) => e.node.props.layout.lines.some((l) => l.words.some((w) => w.text === 'HIDING')));
  assert.ok(entry, 'HIDING is on screen while SOMETHING is spoken');
  const hiding = entry.node.props.layout.lines.flatMap((l) => l.words).find((w) => w.text === 'HIDING');
  assert.equal(entry.node.words[hiding.index].fill, pop.palette.accent, 'still accent after it was spoken');
  assert.deepEqual(entry.node.props.caption.emphasis, [hiding.index]);
  assert.ok(entry.node.words.every((w) => w.scale === 1), 'pop recolours; it does not scale');
});

test('a recolor-scale look: an emphasised word pops when spoken; through its pulse every word stays in the zone and no two neighbours meet, wherever it sits on its line', () => {
  const look = centredPop();
  // first on its line, mid-line (short, and long enough to grow past the word space into its neighbour), ending the first
  // line of two, ending a line of one long word, a full line, and a group whose one line would nearly fill the zone at
  // rest (it must be set narrower, or the pop pushes it out)
  const says = ['*Everything* stays here.', 'It *is* on.', 'I *protect* it.', 'Keep *every* record.', 'Ship *everything*.', 'Your charts are *hiding* something.', 'We *protect* data.'];
  for (const say of says) {
    const shot = { id: 'c', show: 'clipping', src: 'shot.png', say };
    const built = filmFor([shot], look, '9:16', { mode: 'viral', ...ON });
    const timeline = buildTimeline(filmOf([shot], look, '9:16', { mode: 'viral', ...ON }), { fps: FPS });
    let peak = 1;
    for (let f = 0; f < timeline.frameCount; f++) {
      for (const entry of onScreen(captionsIn(built, 0, f / FPS))) {
        const { zone, emphasis } = entry.node.props.caption;
        for (const line of entry.node.props.layout.lines) {
          const boxes = line.words.map((word) => ({ word, box: wordBox(entry, word, line) }));
          for (const { word, box } of boxes) {
            if (emphasis.includes(word.index)) peak = Math.max(peak, entry.node.words[word.index].scale);
            assert.ok(insideBox(box, zone, 0.5), `"${say}" frame ${f}: ${word.text} ${box.map(Math.round)} outside ${zone.map(Math.round)}`);
          }
          boxes.slice(1).forEach(({ word, box }, k) => {
            const before = boxes[k].box;
            assert.ok(before[0] + before[2] <= box[0] + entry.node.props.font.size / 96, `"${say}" frame ${f}: ${boxes[k].word.text} runs into ${word.text}`);
          });
        }
      }
    }
    assert.ok(peak > 1.05, `"${say}": the emphasised word pops (peak scale ${peak})`);
  }
});

// A style's nodes composed straight from `words` (shot seconds) in the ctx of a one-shot captioned film.
function composeWith(style, look, format, words) {
  const film = filmOf([{ id: 'm', show: 'clipping', src: 'shot.png', say: words.map((w) => w.text).join(' ') }], look, format, { captions: true });
  const timeline = buildTimeline(film, { fps: FPS });
  const canvas = canvasOf(format);
  const ctx = shotContext({ film, index: 0, timeline, canvas, measure, assets: IMAGES, viralInsets: viralOf(canvas) });
  return registries.captions.get(style).compose(words, { ...ctx, captionId: 'm.captions', hero: null, filmStart: 0, avoid: [] });
}

test('pop: the words of a merged pair (one shared time, as a voice gives "$5 million") light together in the accent', () => {
  const words = wordsOf('We lost $5 million today.');
  const merged = words.map((w, i) => (i === 3 ? { ...w, start: words[2].start, end: words[2].end } : w));
  const pop = registries.looks.get('pop');
  const [entry] = onScreen(captionTexts(sampleGraph(composeWith('stack', 'pop', '9:16', merged), merged[2].start + 0.1)));
  const shown = entry.node.props.layout.lines.flatMap((l) => l.words);
  const fill = (text) => entry.node.words[shown.find((w) => w.text === text).index].fill;
  assert.equal(fill('$5'), pop.palette.accent);
  assert.equal(fill('MILLION'), pop.palette.accent, 'the second token of the pair lights with the first');
  assert.equal(fill('TODAY.'), pop.palette.ink);
});

test('desk: a highlighter band on the last word of a group is whole by the group\'s last frame', () => {
  const words = wordsOf('It shows the query.', [3]);
  const nodes = composeWith('lower', 'desk', '16:9', words);
  const group = allNodes(nodes).find((n) => n.id === 'm.captions.0');
  const band = group.children.find((n) => n.type === 'path');
  const until = group.tracks.opacity.points.findLast((p) => p.v === 1).t;
  const last = until - 1 / FPS;
  assert.ok(until - words[3].start < registries.looks.get('desk').moves.draw.dur, 'the group leaves before a full draw would end');
  assert.equal(sample(band.tracks.reveal, last, band.step), 1, `the band is whole at ${last}`);
});

test('a captioned pop clipping on 9:16 composes above its caption zone: the picture and its own caption keep clear of the captions', () => {
  for (const own of [undefined, 'It shows its work.']) {
    const shot = { ...CLIP, ...(own ? { caption: own } : {}) };
    const film = filmOf([shot], 'pop', '9:16', ON);
    const timeline = buildTimeline(film, { fps: FPS });
    const canvas = canvasOf('9:16');
    const ctx = shotContext({ film, index: 0, timeline, canvas, measure, assets: IMAGES, viralInsets: viralOf(canvas) });
    const kind = registries.kinds.get('clipping');
    const zoneTop = registries.captions.get('stack').zone(ctx)[1];
    const out = kind.expand(shot, kindContext(film, kind, ctx));
    assert.ok(out.boxes.image[1] + out.boxes.image[3] < zoneTop, `${own ?? 'no caption'}: the picture ends at ${out.boxes.image[1] + out.boxes.image[3]}, above the zone at ${zoneTop}`);
    if (own) assert.ok(out.boxes.caption[1] + out.boxes.caption[3] < zoneTop, `its own caption ends above the zone: ${out.boxes.caption.map(Math.round)}`);
    assert.equal(kindContext({ ...film, captions: false }, kind, ctx), ctx, 'uncaptioned: the kind composes in the shot ctx as it is');
    assert.equal(kindContext(film, registries.kinds.get('statement'), ctx), ctx, 'a kind that shows its words is not captioned');
  }
});

// ---- timing ----

test('a group shows from its first word, and leaves by the next group or within 0.3 s of its last word, in film seconds', () => {
  const shot = { ...CLIP, cut: 'cut' };
  for (const look of ['desk', 'pop']) {
    const film = filmOf([FILLER, shot], look, look === 'pop' ? '9:16' : '16:9', { captions: true });
    const timeline = buildTimeline(film, { fps: FPS });
    const built = filmFor([FILLER, shot], look, look === 'pop' ? '9:16' : '16:9', { captions: true });
    const { start, words, duration } = timeline.shots[1];
    const texts = captionTexts(built.sampleShot(1, 0)).map((e) => e.node);
    assert.ok(texts.length > 1);
    let previousUntil = -Infinity;
    for (const n of texts) {
      const { end } = n.props.caption;
      const last = words.find((w) => Math.abs(start + w.end - end) < EPS);
      assert.ok(last, `${n.id}: end ${end} is a word end in film seconds (shot starts at ${start})`);
      const visible = (t) => onScreen(captionsIn(built, 1, t)).some((e) => e.node.id === n.id);
      const frames = Array.from({ length: Math.round(duration * FPS) }, (_, f) => f / FPS).filter(visible);
      assert.ok(frames.length > 0, `${n.id} is on screen`);
      assert.ok(frames.at(-1) <= end - start + HOLD_LIMIT + EPS, `${n.id} leaves within ${HOLD_LIMIT} s of its last word`);
      assert.ok(frames[0] >= previousUntil - EPS, `${n.id} never overlaps the group before it`);
      previousUntil = frames.at(-1) + 1 / FPS;
    }
  }
});

// ---- the four review rules ----

const CANVAS = { w: 1920, h: 1080 };
const reviewCtx = (extra = {}) => {
  const look = registries.looks.get('desk');
  return { look, canvas: CANVAS, mode: 'pro', shotId: 'c', shotIndex: 0, t: 1, safe: safeRectFor(CANVAS, look), ...extra };
};
const ZONE = [600, 820, 1000, 160];
// A caption text as annotate() reports it: three words of 44 px, 1.8 em wide and 2.4 em apart, the baseline 0.9 em under
// the top, the bbox the union of the words' ascent boxes at their scales (each scaled about its centre on the baseline).
const SIZE = 44, ASCENT = 0.9 * SIZE, DESCENT = 0.25 * SIZE;
function captionNode({ id = 'c.captions.0.text', x = 700, y = 860, scales = [1, 1, 1], caption = {}, opacity = 1 } = {}) {
  const words = scales.map((_, k) => ({ text: 'WORD', index: k, x: k * 2.4 * SIZE, width: 1.8 * SIZE }));
  const width = words.at(-1).x + words.at(-1).width;
  const boxes = words.map((w, k) => [x + w.x + w.width / 2 - (w.width * scales[k]) / 2, y + ASCENT - ASCENT * scales[k], w.width * scales[k], (ASCENT + DESCENT) * scales[k]]);
  const left = Math.min(...boxes.map((b) => b[0])), top = Math.min(...boxes.map((b) => b[1]));
  const bbox = [left, top, Math.max(...boxes.map((b) => b[0] + b[2])) - left, Math.max(...boxes.map((b) => b[1] + b[3])) - top];
  return {
    type: 'text', id, depth: 0, x, y, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity, visible: opacity > 0, children: [],
    props: { role: 'caption', furniture: true, caption: { zone: ZONE, end: 1, hero: 'c.image', emphasis: [], ...caption } },
    words: scales.map((scale) => ({ opacity: 1, x: 0, y: 0, scale })),
    layout: { size: SIZE, width, height: ASCENT + DESCENT, overflow: false, lines: [{ x: 0, y: ASCENT, width, words }] },
    bbox, spread: 0,
  };
}
const imageNode = (id, bbox, opacity = 1) => ({ type: 'image', id, depth: 0, x: bbox[0], y: bbox[1], scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity, visible: opacity > 0, children: [], props: {}, bbox, spread: 0 });
const groupNode = (id, bbox, children) => ({ type: 'group', id, depth: 0, x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, visible: true, children, props: {}, bbox, spread: 0 });
const rules = (findings) => findings.map((f) => f.rule);

test('a caption inside its zone, off the hero, on time and unclipped has no finding', () => {
  const hero = groupNode('c.image', [600, 200, 700, 500], [imageNode('c.image.photo', [620, 220, 660, 460])]);
  assert.deepEqual(auditFrame([hero, captionNode()], reviewCtx()), []);
});

test('rule 1: a caption outside its zone is mechanical (caption-zone)', () => {
  const f = auditFrame([captionNode({ x: 450 })], reviewCtx());
  assert.deepEqual(rules(f), ['caption-zone']);
  assert.equal(f[0].kind, 'mechanical');
  assert.match(f[0].message, /c\.captions\.0\.text.*outside its caption zone/);
});

const pathNode = (id, bbox) => ({ ...imageNode(id, bbox), type: 'path' });

test('rule 2: a caption over the hero\'s ink, or over any picture on screen, is mechanical (caption-hero); a hero that fills the frame is the ground', () => {
  const hero = groupNode('c.image', [600, 600, 700, 400], [imageNode('c.image.photo', [620, 620, 660, 360])]);
  assert.deepEqual(rules(auditFrame([hero, captionNode()], reviewCtx())), ['caption-hero']);
  const mounted = groupNode('c.image', [600, 400, 700, 600], [pathNode('c.image.card.paper', [600, 400, 700, 600]), imageNode('c.image.photo', [650, 450, 600, 350])]);
  assert.deepEqual(rules(auditFrame([mounted, captionNode()], reviewCtx())), [], 'the paper and shadow a picture is mounted on are not its ink');
  const drawn = pathNode('c.image', [650, 850, 300, 100]);
  assert.deepEqual(rules(auditFrame([drawn, captionNode()], reviewCtx())), ['caption-hero'], 'a hero that is itself a path is its own ink');
  const close = imageNode('c.close0.photo', [650, 700, 500, 300]);
  assert.deepEqual(rules(auditFrame([close, captionNode()], reviewCtx())), ['caption-hero']);
  const hidden = groupNode('c.image', [600, 600, 700, 400], []);
  assert.deepEqual(rules(auditFrame([{ ...hidden, opacity: 0, visible: false }, captionNode()], reviewCtx())), [], 'a hidden hero is not on screen');
  const pushed = groupNode('c.image', [-400, -300, 2800, 1800], [imageNode('c.image.photo', [-380, -280, 2760, 1760])]);
  assert.deepEqual(rules(auditFrame([pushed, captionNode()], reviewCtx())), [], 'a pushed-in picture filling the frame is the ground, not a figure');
  const zooming = { ...groupNode('c.image', [300, 300, 1400, 700], [imageNode('c.image.photo', [320, 320, 1360, 660])]), scale: 1.2 };
  assert.deepEqual(rules(auditFrame([zooming, captionNode()], reviewCtx())), [], 'a picture the camera has pushed in on (1.2 or more) is the ground too');
  const punched = { ...zooming, scale: 1.08 };
  assert.deepEqual(rules(auditFrame([punched, captionNode()], reviewCtx())), ['caption-hero'], 'a punch (1.08) is still a figure');
});

test('rule 3: a caption still on screen more than 0.3 s after its last word ends is mechanical (caption-late)', () => {
  assert.deepEqual(rules(auditFrame([captionNode()], reviewCtx({ t: 1.29 }))), []);
  const f = auditFrame([captionNode()], reviewCtx({ t: 1.31 }));
  assert.deepEqual(rules(f), ['caption-late']);
  assert.match(f[0].message, /0\.31 s after its last word/);
  assert.deepEqual(rules(auditFrame([captionNode({ opacity: 0 })], reviewCtx({ t: 5 }))), [], 'gone is gone');
});

test('rule 4: an emphasised caption word clipped by the zone mid-pulse is mechanical (caption-clipped); the same scale on a plain word is not this rule', () => {
  // the last word's right edge 4.6 px inside the zone at rest; at 1.3 it grows 11.9 px each way, past the zone
  const edge = (scales, emphasis) => captionNode({ x: ZONE[0] + ZONE[2] - 6.6 * SIZE - 4.6, scales, caption: { emphasis } });
  assert.deepEqual(rules(auditFrame([edge([1, 1, 1], [2])], reviewCtx())), [], 'at rest it fits');
  const f = auditFrame([edge([1, 1, 1.3], [2])], reviewCtx());
  assert.deepEqual(rules(f), ['caption-clipped']);
  assert.match(f[0].message, /emphasised word "WORD"/);
  assert.deepEqual(rules(auditFrame([edge([1, 1, 1.3], [])], reviewCtx())), [], 'not emphasised: not this rule, and not landed, so not the zone rule either');
});

test('the caption rules leave the clipping\'s own caption alone; the card-overlap rule keeps a spoken caption off the author caption card', () => {
  const author = { ...captionNode({ id: 'c.caption', x: 100 }), props: { role: 'caption', furniture: true } };
  assert.deepEqual(rules(auditFrame([author], reviewCtx({ t: 9 }))), []);
  const paper = { type: 'path', id: 'c.caption.card.paper', depth: 0, x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, visible: true, children: [], props: { textCard: true }, bbox: [680, 840, 400, 120], spread: 0 };
  const card = groupNode('c.caption.card', [680, 840, 400, 120], [paper]);
  assert.deepEqual(rules(auditFrame([card, captionNode()], reviewCtx())), ['card-overlap']);
});

// ---- a film without captions is unchanged ----

const GATE = new URL('../../references/examples/v2/', import.meta.url);
const GATE_ASSETS = new Map([['clipping.png', { width: 1600, height: 1000 }]]);
// The node ids of both gate films before captions existed (each shot sampled at half its duration), recorded from the
// engine as it stood before this task (.scratch/sound/gate-ids.mjs).
// gate-pop's ask stack has one more line since look revision 2 (a stack grows to fill its band)
const BEFORE = {
  'gate-desk': [["field","problem.slug","problem.slug.shadow","problem.slug.paper","problem.slug.tape1","problem.slug.tape2","problem.slug.number","problem.kicker","problem.hl0","problem.text"],["field","proof.image","proof.image.card","proof.image.card.shadow","proof.image.card.paper","proof.image.card.tape1","proof.image.card.tape2","proof.image.cutout","proof.image.cutout.shadow","proof.image.cutout.keyline","proof.image.cutout.image","proof.on0","proof.on0.scrim","proof.on0.side0","proof.on0.side0.pass2","proof.on0.side1","proof.on0.side1.pass2","proof.on0.side2","proof.on0.side2.pass2","proof.on0.side3","proof.on0.side3.pass2","proof.slug","proof.slug.shadow","proof.slug.paper","proof.slug.tape1","proof.slug.tape2","proof.slug.number","proof.kicker","proof.caption.card","proof.caption.card.shadow","proof.caption.card.paper","proof.caption.card.tape1","proof.caption.card.tape2","proof.caption"],["field","how.slug","how.slug.shadow","how.slug.paper","how.slug.tape1","how.slug.tape2","how.slug.number","how.kicker","how.hl0","how.text"],["field","count.slug","count.slug.shadow","count.slug.paper","count.slug.tape1","count.slug.tape2","count.slug.number","count.kicker","count.value","count.value.digits","count.label","count.delta","count.delta.text"],["field","close.slug","close.slug.shadow","close.slug.paper","close.slug.tape1","close.slug.tape2","close.slug.number","close.kicker","close.hl0","close.text"]],
  'gate-pop': [["field","hook.text","hook.text.line0","hook.text.line1","hook.text.line2"],["field","proof.image","proof.image.cutout","proof.image.cutout.shadow","proof.image.cutout.keyline","proof.image.cutout.image","proof.close0","proof.close0.cutout","proof.close0.cutout.shadow","proof.close0.cutout.shadow.emphasis","proof.close0.cutout.keyline","proof.close0.cutout.image","proof.caption"],["field","count.value","count.value.digits","count.label","count.label.plate","count.label.text","count.delta","count.delta.text"],["field","local.text","local.text.line0","local.text.line1","local.text.line2"],["field","ask.kicker","ask.kicker.plate","ask.kicker.text","ask.text","ask.text.line0","ask.text.line1","ask.text.line2"]],
};

function gateIds(name, extra) {
  const film = { ...JSON.parse(readFileSync(new URL(`${name}.json`, GATE), 'utf8')), ...extra };
  const timeline = buildTimeline(film, { fps: FPS });
  const canvas = canvasOf(film.format);
  const built = buildFilm({ film, timeline, measure, assets: GATE_ASSETS, canvas, viralInsets: viralOf(canvas) });
  const ids = (nodes) => nodes.flatMap((n) => [n.id, ...ids(n.children)]);
  return timeline.shots.map((s, i) => ids(built.sampleShot(i, s.duration / 2)));
}

test('both gate films, as written (no captions field) and with captions off, have exactly the nodes they had before captions existed', () => {
  for (const name of ['gate-desk', 'gate-pop']) {
    assert.deepEqual(gateIds(name, {}), BEFORE[name], `${name} as written`);
    assert.deepEqual(gateIds(name, { captions: false }), BEFORE[name], `${name} with captions: false`);
  }
  const on = gateIds('gate-pop', ON);
  assert.ok(on[1].some((id) => id.startsWith('proof.captions')), 'captions: true captions the clipping');
  assert.deepEqual(on.filter((_, i) => i !== 1), BEFORE['gate-pop'].filter((_, i) => i !== 1), 'and nothing else');
});

test('captions are pure: the same film gives the same caption nodes', () => {
  const a = captionsIn(filmFor([CLIP], 'pop', '9:16', ON), 0, 0.5).map((e) => JSON.stringify(e.node));
  const b = captionsIn(filmFor([CLIP], 'pop', '9:16', ON), 0, 0.5).map((e) => JSON.stringify(e.node));
  assert.ok(a.length > 0);
  assert.deepEqual(a, b);
});

// ---- fix wave (final review I5 and Minors 15 to 20, 27) ----

// A stroked path at the canvas origin whose points (`d`, which the mark boxes read: engine/review/marks.mjs) are `box` in
// its parent's space, and whose snapshot bbox is `bbox`.
const strokeNode = (id, bbox, extra = {}, box = bbox) => ({ ...pathNode(id, bbox), x: 0, y: 0, props: { stroke: '#d63a2f', d: `M${box[0]} ${box[1]}L${box[0] + box[2]} ${box[1]}L${box[0] + box[2]} ${box[1] + box[3]}L${box[0]} ${box[1] + box[3]}Z`, ...extra.props }, draw: 1, ...extra });

test('I5: a caption over the region a highlight marks is a caption-covers finding (creative since branch review A, I3) even when the picture is pushed in, while the mark is on screen', () => {
  const marked = { caption: { marks: ['c.on0'] } };
  // inside the picture pushed in at 2: points at half the frame coordinates
  const frame = groupNode('c.on0', [650, 820, 400, 120], [{ ...pathNode('c.on0.scrim', [-400, -300, 2800, 1800]), props: { fill: '#f3eee3' } }, strokeNode('c.on0.side0', [650, 820, 400, 120], {}, [325, 410, 200, 60])]);
  const pushed = { ...groupNode('c.image', [-400, -300, 2800, 1800], [imageNode('c.image.photo', [-380, -280, 2760, 1760]), frame]), scale: 2 };
  // the caption rules only: the hand-built scrim and caption carry no colours for the contrast rule to read
  const captionRules = (nodes) => rules(auditFrame(nodes, reviewCtx())).filter((r) => r.startsWith('caption'));
  assert.deepEqual(captionRules([pushed, captionNode(marked)]), ['caption-covers']);
  const covers = auditFrame([pushed, captionNode(marked)], reviewCtx()).find((x) => x.rule === 'caption-covers');
  assert.match(covers.message, /covers the region marked by "c\.on0"/);
  assert.equal(covers.kind, 'creative');
  const drawing = { ...pushed, children: [pushed.children[0], { ...frame, children: [frame.children[0], { ...frame.children[1], draw: 0 }] }] };
  assert.deepEqual(captionRules([drawing, captionNode(marked)]), [], 'a mark not yet drawn is not on screen');
  const away = { ...pushed, children: [pushed.children[0], groupNode('c.on0', [650, 200, 400, 120], [strokeNode('c.on0.side0', [650, 200, 400, 120], {}, [325, 100, 200, 60])])] };
  assert.deepEqual(captionRules([away, captionNode(marked)]), [], 'a caption over unmarked picture that fills the frame is still over ground');
  assert.deepEqual(captionRules([pushed, captionNode()]), [], 'only the marks the caption names (its shot\'s) are judged');
});

test('I5: a caption over any text that is not landed (a hero mid-pulse at 1.3, set large) is a caption-covers finding (creative since branch review A, I3); landed pairs stay with the overlap rule', () => {
  const hero = { ...captionNode({ id: 'c.text', x: 700, y: 860 }), props: { role: 'hero' }, scale: 1.3 };
  const f = auditFrame([captionNode(), hero], reviewCtx({ restScales: new Map([['c.text', 1]]) }));
  assert.ok(rules(f).includes('caption-covers'), JSON.stringify(rules(f)));
  assert.match(f.find((x) => x.rule === 'caption-covers').message, /covers the text "c\.text"/);
  const landed = { ...captionNode({ id: 'c.text', x: 700, y: 860 }), props: { role: 'hero' } };
  assert.deepEqual(rules(auditFrame([captionNode(), landed], reviewCtx())).filter((r) => r === 'caption-covers'), [], 'a landed pair is the overlap rule\'s');
});

test('I5: a captioned shot\'s caption names the marks of its shot, and the marks stand where the camera puts them (frame coordinates)', () => {
  const shot = { ...CLIP, regions: { query: [0.58, 0.14, 0.37, 0.24] }, on: [{ at: 'word:query', do: 'highlight', target: 'region:query' }] };
  const film = filmOf([shot], 'desk', '16:9', ON);
  const timeline = buildTimeline(film, { fps: FPS });
  const built = filmFor([shot], 'desk', '16:9', ON);
  const [first] = captionTexts(built.sampleShot(0, 0.1)).map((e) => e.node);
  assert.deepEqual(first.props.caption.marks, ['c.on0']);
  const canvas = canvasOf('16:9');
  const end = timeline.shots[0].duration;
  const boxes = markedBoxes(built.sampleShot(0, end - 0.01), ['c.on0']);
  assert.equal(boxes.length, 1);
  const [x, y, w, h] = boxes[0];
  assert.ok(x > 0 && y > 0 && x + w < canvas.w && y + h < canvas.h && w > canvas.w * 0.3, `the pushed-in region frame on the canvas: ${boxes[0].map(Math.round)}`);
});

test('I5: desk lower steps right of a marked region that comes into its band, as it does of a pinned card', () => {
  const film = filmOf([CLIP], 'desk', '16:9', ON);
  const timeline = buildTimeline(film, { fps: FPS });
  const canvas = canvasOf('16:9');
  const ctx = shotContext({ film, index: 0, timeline, canvas, measure, assets: IMAGES, viralInsets: viralOf(canvas) });
  const lower = registries.captions.get('lower');
  const free = lower.zone(ctx);
  const stepped = lower.zone({ ...ctx, avoid: [], marks: [[free[0] - 40, free[1] + 10, 200, 60]] });
  assert.ok(stepped[0] > free[0] + 160, `the zone starts right of the mark: ${stepped[0]} vs ${free[0]}`);
});

test('Minor 15: each caption module can be imported first, on its own, in a fresh process', () => {
  for (const file of ['groups.mjs', 'lower.mjs', 'stack.mjs', 'index.mjs']) {
    const url = new URL(`../../engine/captions/${file}`, import.meta.url).href;
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(url)});`], { encoding: 'utf8' });
    assert.equal(run.status, 0, `${file} first: ${run.stderr}`);
  }
});

test('Minor 16: a group too long for the zone at its size is set smaller, down to the look\'s smallest step, rather than leave the zone', () => {
  for (const [style, look, format] of [['lower', 'desk', '16:9'], ['lower', 'desk', '9:16'], ['stack', 'pop', '9:16']]) {
    for (const line of ['Supercalifragilisticexpialidocious.', 'Simple internationalisation works.']) {
      const words = wordsOf(line);
      const nodes = composeWith(style, look, format, words);
      for (const t of words.map((w) => w.start + 0.05)) {
        for (const entry of onScreen(captionTexts(sampleGraph(nodes, t)))) {
          const { layout, font } = entry.node.props;
          assert.ok(!layout.overflow && layout.lines.length <= 2, `${style} ${format} "${line}": ${layout.lines.length} lines`);
          assert.ok(insideBox(inkOf(entry), entry.node.props.caption.zone), `${style} ${format} "${line}" inside its zone`);
          assert.ok(font.size >= registries.looks.get(look).scale[0] - EPS, `never below the look's smallest step: ${font.size}`);
        }
      }
    }
  }
});

test('Minor 17: lower keeps to the platform safe zone for a look that composes in it', () => {
  const desk = registries.looks.get('desk');
  if (!registries.looks.has('desk-viral-test')) registries.looks.add('desk-viral-test', { ...desk, name: 'desk-viral-test', modes: ['viral'] });
  const film = filmOf([CLIP], 'desk-viral-test', '9:16', { mode: 'viral', ...ON });
  const timeline = buildTimeline(film, { fps: FPS });
  const canvas = canvasOf('9:16');
  const ctx = shotContext({ film, index: 0, timeline, canvas, measure, assets: IMAGES, viralInsets: viralOf(canvas) });
  const rect = compositionRect(ctx);
  assert.ok(rect.safe);
  assert.ok(insideBox(registries.captions.get('lower').zone(ctx), [rect.left, rect.top, rect.w, rect.h]), 'inside the platform safe zone');
});

test('Minor 18: a caption style must have a summary, a zone and a compose to register', () => {
  assert.throws(() => registries.captions.add('test-bad', { summary: 'x' }), /caption style "test-bad": zone must be a function/);
  assert.throws(() => registries.captions.add('test-bad', { zone: () => [0, 0, 1, 1], compose: () => [] }), /caption style "test-bad": summary must be a string/);
  assert.equal(registries.captions.has('test-bad'), false);
});

test('Minor 19: lower in a look that does not style a card fails naming the device and the look', () => {
  const desk = registries.looks.get('desk');
  const { card: _card, ...devices } = desk.devices;
  if (!registries.looks.has('desk-no-card-test')) registries.looks.add('desk-no-card-test', { ...desk, name: 'desk-no-card-test', devices });
  const shot = { ...CLIP, show: 'free', src: undefined, nodes: [] };
  assert.throws(() => filmFor([shot], 'desk-no-card-test', '16:9', ON), /look "desk-no-card-test" does not style device "card"/);
});

test('Minor 20: the viral hook rule judges the opening text, never a caption that happens to be larger', () => {
  const opening = { ...captionNode({ id: 'h.text', x: 200, y: 200, scales: Array(9).fill(1) }), props: { role: 'hero' } };
  const caption = { ...captionNode({ id: 'h.captions.0', x: 200, y: 860 }), layout: { ...captionNode().layout, size: 96 } };
  const f = auditFrame([opening, caption], reviewCtx({ mode: 'viral', isFirstShot: true, look: registries.looks.get('pop'), safe: { left: 0, top: 0, right: 1920, bottom: 1080 } }));
  assert.ok(rules(f).includes('hook-words'), JSON.stringify(rules(f)));
});

test('Minor 27: a caption group leaves inside the time the review allows', () => {
  assert.ok(CAPTION_HOLD < CAPTION_LATE_SECONDS, `${CAPTION_HOLD} < ${CAPTION_LATE_SECONDS}`);
});
