// Look revision round 1: rules every kind gets from the shared text and stack layout, and the look-data rules the
// director ruled on (rulings 1, 6, 8, 9 and the phone-size minimums). Pure scene-graph work with the fake measure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { breakBySense, stackLines } from '../../engine/text/breaks.mjs';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import { composeStack, stackArea } from '../../engine/kinds/stack.mjs';
import { expandShot, expandSecond, all } from './helpers/kinds.mjs';

const WEAK = new Set(['a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'from', 'with', 'as', 'and', 'or', 'but']);
const endsWeak = (words, rows) => rows.slice(0, -1).some((row) => WEAK.has(words[row.at(-1)].toLowerCase().replace(/[^a-z]/g, '')));

test('ruling 1: no line but the last ends on an article, preposition or conjunction when another break exists (both breakers)', () => {
  const words = 'Write the script. The engine does the rest.'.split(' ');
  const widths = words.map((w) => w.length);
  for (const maxWidth of [18, 20, 22, 25, 30]) {
    assert.ok(!endsWeak(words, breakBySense(words, widths, 1, maxWidth)), `breakBySense at ${maxWidth}: ${JSON.stringify(breakBySense(words, widths, 1, maxWidth))}`);
  }
  for (const text of ['Write the script and ship the film', 'Post the MP4 for the team', 'A look that does not reach the bar']) {
    const ws = text.split(' ');
    assert.ok(!endsWeak(ws, stackLines(ws)), `stackLines: ${text}`);
  }
});

test('ruling 9: adjacent lines of one stack differ by at most the look\'s ratio; a short line stays smaller rather than growing', () => {
  const pop = registries.looks.get('pop');
  assert.ok(pop.stack && Number.isFinite(pop.stack.ratio) && pop.stack.ratio > 1, 'the ratio is look data');
  const { ctx } = expandShot({ id: 's', show: 'statement', say: 'Stop dragging keyframes.' }, 'pop', '9:16');
  for (const text of ['RUN ONE COMMAND', 'WRITE JSON', 'A LOOK THAT DOES NOT REACH THE BAR IS CUT', 'STOP DRAGGING KEYFRAMES.']) {
    const { lines } = composeStack(text, { id: 's' }, ctx);
    for (let k = 1; k < lines.length; k++) {
      const [a, b] = [lines[k - 1].font.size, lines[k].font.size];
      assert.ok(Math.max(a, b) / Math.min(a, b) <= pop.stack.ratio + 1e-6, `${text}: ${a} then ${b}`);
    }
  }
});

test('ruling 9: pop word spacing never stretches a line: the display word space is a normal word space (at most 0.2 em)', () => {
  assert.ok(registries.looks.get('pop').fonts.display.wordSpace <= 0.2);
});

test('ruling 8: a pop stack sits on the safe zone\'s optical centre (look data), not hung from the top', () => {
  const pop = registries.looks.get('pop');
  assert.ok(Number.isFinite(pop.stack?.centre), 'the optical centre is look data');
  for (const say of ['Stop dragging keyframes.', 'One.']) {
    const { nodes, ctx } = expandShot({ id: 's', show: 'statement', say }, 'pop', '9:16');
    const area = stackArea(ctx);
    const lines = all(nodes).filter((n) => n.type === 'text' && n.props.stack === 's.text');
    const top = Math.min(...lines.map((n) => n.props.y + n.props.layout.lines[0].y - 0.74 * n.props.font.size));
    const bottom = Math.max(...lines.map((n) => n.props.y + n.props.layout.lines[0].y));
    const centre = (top + bottom) / 2;
    assert.ok(Math.abs(centre - (area.top + pop.stack.centre * area.h)) <= 0.06 * area.h, `${say}: centre ${Math.round(centre)} against ${Math.round(area.top + pop.stack.centre * area.h)}`);
  }
});

test('ruling 6: one yellow: the chart highlight, the region frame and the highlighter composite the same look colour the same way', () => {
  const desk = registries.looks.get('desk');
  const blend = desk.devices.highlight.blend;
  const chart = all(expandShot({ id: 'g', show: 'chart', type: 'column', title: 'Q3', say: 'Up. Q3 led.', data: [{ label: 'Q1', value: 1 }, { label: 'Q3', value: 3 }], highlight: 'Q3' }, 'desk', '16:9').nodes);
  const accent = chart.find((n) => n.id === 'g.mark.1.accent');
  const seen = '#' + [1, 3, 5].map((i) => Math.round(parseInt(desk.palette.accent.slice(i, i + 2), 16) * parseInt(desk.palette.paper.slice(i, i + 2), 16) / 255).toString(16).padStart(2, '0')).join('');
  assert.equal(blend, 'multiply');
  assert.equal(accent.props.fill, seen, 'the chart highlight is the highlighter\'s yellow as it shows on the paper');
  const clip = all(expandShot({ id: 'c', show: 'clipping', src: 'shot.png', say: 'This one shows the query.', regions: { query: [0.6, 0.2, 0.3, 0.2] }, on: [{ at: 'word:query', do: 'highlight', target: 'region:query' }] }, 'desk', '16:9').nodes);
  const side = clip.find((n) => /\.side0$/.test(n.id));
  assert.equal(side.props.stroke, seen, 'the region frame is the same yellow');
  const pop = registries.looks.get('pop');
  const popChart = all(expandShot({ id: 'g', show: 'chart', type: 'column', title: 'Q3', say: 'Up. Q3 led.', data: [{ label: 'Q1', value: 1 }, { label: 'Q3', value: 3 }], highlight: 'Q3' }, 'pop', '9:16').nodes);
  assert.equal(popChart.find((n) => n.id === 'g.mark.1.accent').props.fill, pop.palette.accent, 'pop has no multiply: its accent as is');
});

test('ruling 10: a pop list keeps its tag at one y for the whole shot, whatever each item\'s height', () => {
  const shot = { id: 'l', show: 'list', title: 'How it works', items: ['Write JSON', 'Run one command and wait for it', 'Post the MP4'], say: 'Write JSON. Run one command and wait for it. Post the MP4.' };
  for (const format of ['9:16', '16:9']) {
    const { nodes } = expandShot(shot, 'pop', format);
    const tags = [0, 1, 2].map((k) => all(nodes).find((n) => n.id === `l.item${k}.kicker`));
    assert.ok(tags.every(Boolean), 'every item has its tag');
    const ys = tags.map((t) => t.props.y);
    assert.ok(Math.max(...ys) - Math.min(...ys) < 1e-6, `${format}: tag ys ${ys.map(Math.round)}`);
  }
});

test('ruling 11: a pop compare on a tall frame keeps both sides on screen, A above B, the unspoken side dimmed, a tag on each; wide frames keep one at a time', async () => {
  const { sample } = await import('../../engine/time/track.mjs');
  const shot = { id: 'v', show: 'compare', say: 'Keyframes, by hand. A script, words set the timing.', left: { title: 'Keyframes', points: ['By hand'] }, right: { title: 'A script', points: ['Words set the timing'] } };
  const tall = expandShot(shot, 'pop', '9:16');
  const side = (nodes, key) => all(nodes).find((n) => n.id === `v.${key}`);
  const [a, b] = [side(tall.nodes, 'left'), side(tall.nodes, 'right')];
  const end = tall.ctx.timing.duration - 0.01;
  const dim = registries.looks.get('pop').kinds.compare.dim;
  assert.ok(Number.isFinite(dim) && dim > 0 && dim < 1, 'the dim is look data');
  assert.equal(sample(a.tracks.opacity, 0.05), 1, 'A speaks first: full');
  assert.equal(sample(b.tracks.opacity, 0.05), dim, 'B is on screen from frame 0, dimmed');
  assert.equal(sample(a.tracks.opacity, end), dim, 'after the turn A is dimmed, still on screen');
  assert.equal(sample(b.tracks.opacity, end), 1);
  const [boxA, boxB] = [tall.boxes.left, tall.boxes.right];
  assert.ok(boxA[1] + boxA[3] <= boxB[1], `A above B: ${boxA.map(Math.round)} / ${boxB.map(Math.round)}`);
  assert.ok(all(tall.nodes).some((n) => n.id === 'v.left.kicker') && all(tall.nodes).some((n) => n.id === 'v.right.kicker'), 'a tag on each');
  const wide = expandShot(shot, 'pop', '16:9');
  assert.equal(sample(side(wide.nodes, 'right').tracks.opacity, 0.05), 0, 'wide: one side at a time');
  assert.deepEqual(registries.kinds.get('compare').partWindow(shot, tall.ctx.timing, 'right', tall.ctx.look, tall.ctx.canvas), [0, Infinity], 'both sides are on screen the whole shot');
});

test('ruling 12: the pop quote mark sits above the first line, never over it; the lines keep the look\'s ratio', () => {
  const pop = registries.looks.get('pop');
  const shot = { id: 'q', show: 'quote', say: 'A look that does not reach the bar is *cut*, not shipped weak.', by: 'The design' };
  for (const format of ['9:16', '16:9']) {
    const { nodes } = expandShot(shot, 'pop', format);
    const mark = all(nodes).find((n) => n.id === 'q.mark');
    const ys = mark.props.d.match(/-?\d+(\.\d+)?/g).map(Number).filter((_, i) => i % 2 === 1);
    const lines = all(nodes).filter((n) => n.type === 'text' && n.props.stack === 'q.text');
    const firstTop = lines[0].props.y + lines[0].props.layout.lines[0].y - 0.7 * lines[0].props.font.size;
    assert.ok(Math.max(...ys) <= firstTop + 1e-6, `${format}: mark bottom ${Math.round(Math.max(...ys))} over the first line's top ${Math.round(firstTop)}`);
    for (let k = 1; k < lines.length; k++) {
      const [a, b] = [lines[k - 1].props.font.size, lines[k].props.font.size];
      assert.ok(Math.max(a, b) / Math.min(a, b) <= pop.stack.ratio + 1e-6, `${format}: ${a} then ${b}`);
    }
  }
});

test('ruling 13: a viral hook may use the full safe width and up to 40% of the safe height: a three-word hook is set large', () => {
  const pop = registries.looks.get('pop');
  assert.ok(Number.isFinite(pop.stack.hook) && pop.stack.hook <= 0.4, 'the hook height is look data');
  const shot = { id: 'h', show: 'statement', say: 'Stop *dragging* keyframes.' };
  const sizes = (r) => all(r.nodes).filter((n) => n.type === 'text' && n.props.stack === 'h.text').map((n) => n.props.font.size);
  const hook = expandShot(shot, 'pop', '9:16');
  const later = expandSecond(shot, 'pop', '9:16');
  const area = stackArea(hook.ctx);
  const [, top, , h] = hook.boxes.text;
  assert.ok(Math.min(...sizes(hook)) >= Math.min(...sizes(later)) - 1e-6, `no line smaller: hook ${sizes(hook).map(Math.round)} against ${sizes(later).map(Math.round)}`);
  // look revision 2: every stack now grows to fill its band, so the hook is no smaller than a later statement
  assert.ok(h >= later.boxes.text[3] - 1e-6, `the hook block ${Math.round(h)} at least the later one ${Math.round(later.boxes.text[3])}`);
  // the limit holds the lines' ink; the text box reaches a word's descent past the last baseline
  assert.ok(h <= pop.stack.hook * area.h + 0.15 * Math.max(...sizes(hook)), `the hook block ${Math.round(h)} within ${pop.stack.hook} of ${area.h}`);
  assert.ok(top >= area.top - 1e-6);
});

test('ruling 14: the pop cut-out shadow is the look\'s accent, never a second hue', () => {
  const pop = registries.looks.get('pop');
  assert.ok([pop.palette.accent, pop.palette.ink].includes(pop.shadow.color), `shadow ${pop.shadow.color}`);
});

// ---- desk phone-size minimums (rulings 2, 4, 5) ----
const deskStep = (step) => registries.looks.get('desk').scale[step - 1];

test('ruling 2: the desk end ask is in the label face at the label step or larger, with the mark under it', () => {
  const desk = registries.looks.get('desk');
  for (const format of ['16:9', '9:16']) {
    const { nodes, boxes } = expandShot({ id: 'e', show: 'end', title: 'Write the script. The engine does the rest.', ask: 'Read the plan', mark: 'make-motion', hold: 3 }, 'desk', format);
    const ask = all(nodes).find((n) => n.id === 'e.ask');
    assert.equal(ask.props.font.family, desk.fonts.label.family, `${format}: the label face`);
    assert.ok(ask.props.font.size >= deskStep(2) - 1e-6, `${format}: ${ask.props.font.size}`);
    assert.ok(boxes.mark[1] >= boxes.ask[1] + boxes.ask[3] - 1e-6, `${format}: the mark under the ask`);
  }
});

test('ruling 4: desk list figures are at least the label step, in ink, hung in the margin left of the items', () => {
  const shot = { id: 'l', show: 'list', title: 'How it works', style: 'steps', items: ['Write the shots as JSON', 'Run one command', 'Get an MP4'], say: 'Write the shots as JSON. Run one command. Get an MP4.' };
  for (const format of ['16:9', '9:16']) {
    const { nodes } = expandShot(shot, 'desk', format);
    const figures = all(nodes).filter((n) => /^l\.figure\d$/.test(n.id));
    const item = all(nodes).find((n) => n.id === 'l.item0');
    assert.equal(figures.length, 3);
    for (const f of figures) {
      assert.ok(f.props.font.size >= deskStep(2) - 1e-6, `${format}: figure ${f.props.font.size}`);
      assert.ok([registries.looks.get('desk').palette.ink, registries.looks.get('desk').palette.accent].includes(f.props.fill));
      assert.ok(f.props.x + f.props.layout.width <= item.props.x, 'hung in the margin');
    }
  }
});

test('ruling 5: desk number: no label-face text at headline size (step 4 or more); the delta reads at the label step or larger', () => {
  const shot = { id: 'n', show: 'number', value: 9, label: 'shot kinds', delta: 'two looks', kicker: 'So far', say: 'Nine shot kinds so far.' };
  for (const format of ['16:9', '9:16']) {
    const { nodes } = expandShot(shot, 'desk', format);
    const desk = registries.looks.get('desk');
    const loud = all(nodes).filter((n) => n.type === 'text' && n.props.font.family === desk.fonts.label.family && n.props.font.size >= deskStep(4) - 1e-6);
    assert.deepEqual(loud.map((n) => n.id), [], `${format}: mono at headline size`);
    const delta = all(nodes).find((n) => n.id === 'n.delta.text');
    assert.ok(delta.props.font.size >= deskStep(2) - 1e-6);
  }
});

test('ruling 3: desk compare: both cards on the paper from frame 0 (the unspoken one dimmed), points at the label step or larger, the vs and arrow in ink or the accent at marker weight', async () => {
  const { sample } = await import('../../engine/time/track.mjs');
  const desk = registries.looks.get('desk');
  for (const mode of ['versus', 'before-after']) {
    const shot = { id: 's', show: 'compare', mode, say: 'Before, you placed every keyframe. Now, you write what is said.', left: { title: 'Keyframes', points: ['Durations', 'Positions', 'Easing'] }, right: { title: 'A script', points: ['Words set the timing'] } };
    for (const format of ['16:9', '9:16']) {
      const { nodes, ctx } = expandShot(shot, 'desk', format);
      const end = ctx.timing.duration - 0.01;
      const rightScrim = all(nodes).find((n) => n.id === 's.right.scrim');
      const leftScrim = all(nodes).find((n) => n.id === 's.left.scrim');
      assert.ok(rightScrim, `${mode} ${format}: the right card is dimmed before the turn`);
      assert.ok(sample(rightScrim.tracks.opacity, 0.05) > 0.3, 'dimmed at frame 0');
      assert.equal(sample(rightScrim.tracks.opacity, end), 0, 'lit once spoken');
      assert.ok(sample(leftScrim.tracks.opacity, end) > 0.3);
      const right = all(nodes).find((n) => n.id === 's.right');
      const opacity = right.tracks?.opacity;
      assert.ok(opacity === undefined || sample(opacity, 0.05) > 0.5, 'the right card is on the paper from the start');
      for (const k of ['left', 'right']) {
        const points = all(nodes).find((n) => n.id === `s.${k}.points`);
        assert.ok(points.props.font.size >= desk.scale[1] - 1e-6, `${k} points ${points.props.font.size}`);
      }
      const strokes = all(nodes).filter((n) => /^s\.(vs|arrow)/.test(n.id) && n.props.stroke !== undefined);
      assert.ok(strokes.length > 0);
      for (const st of strokes) {
        assert.ok([desk.palette.ink, desk.palette.accent].includes(st.props.stroke), `${st.id}: ${st.props.stroke}`);
        assert.ok(st.props.strokeWidth >= 10 * ctx.unit - 1e-6, `${st.id}: marker weight, ${st.props.strokeWidth}`);
      }
    }
  }
});

test('ruling 7: a desk clipping opens close: the picture 70% of a wide frame, or as wide as a slug card leaves, and clear of it', async () => {
  const { slugBox } = await import('../../engine/kinds/slug.mjs');
  const bare = { id: 'p', show: 'clipping', src: 'shot.png', say: 'A screenshot becomes a clipping. The camera can push into any region.', regions: { query: [0.58, 0.14, 0.37, 0.24] }, on: [{ at: 'word:push', do: 'highlight', target: 'region:query' }] };
  const alone = expandShot(bare, 'desk', '16:9');
  assert.ok(alone.boxes.image[2] >= 0.7 * alone.canvas.w - 1e-6, `no slug: picture ${Math.round(alone.boxes.image[2])} of ${alone.canvas.w}`);
  const shot = { ...bare, kicker: 'A clipping' };
  const { boxes, ctx } = expandShot(shot, 'desk', '16:9');
  const slug = slugBox(shot, ctx).inked;
  const room = slug[0] - 24 - 96;
  assert.ok(boxes.image[2] >= Math.min(0.7 * 1920, room) - 40, `with a slug: picture ${Math.round(boxes.image[2])}, room ${Math.round(room)}`);
  const [x, y, w, h] = boxes.image;
  const clear = x + w <= slug[0] || slug[0] + slug[2] <= x || y + h <= slug[1] || slug[1] + slug[3] <= y;
  assert.ok(clear, `picture ${boxes.image.map(Math.round)} clear of the slug ${slug.map(Math.round)}`);
});

test('ruling 11: the two sides of a tall pop compare share one title size and one points size (at most 3 sizes on the frame)', () => {
  const shot = { id: 'v', show: 'compare', mode: 'before-after', say: 'Keyframes, by hand. A script, words set the timing.', left: { title: 'Keyframes', points: ['By hand'] }, right: { title: 'A script', points: ['Words set the timing'] } };
  const { nodes } = expandShot(shot, 'pop', '9:16');
  const largest = (key) => Math.max(...all(nodes).filter((n) => n.type === 'text' && n.props.stack === `v.${key}.title`).map((n) => n.props.font.size));
  assert.ok(Math.abs(largest('left') - largest('right')) < 1e-6, `${largest('left')} vs ${largest('right')}`);
  const points = ['left', 'right'].map((k) => all(nodes).find((n) => n.id === `v.${k}.points`).props.font.size);
  assert.equal(points[0], points[1]);
});

test('ruling 11: a tall pop compare with a picture on a side keeps one side at a time (a picture and a stack do not share half the frame)', async () => {
  const { sample } = await import('../../engine/time/track.mjs');
  const shot = { id: 'v', show: 'compare', say: 'A server. One file.', left: { title: 'A server', src: 'shot.png' }, right: { title: 'One file' } };
  const { nodes } = expandShot(shot, 'pop', '9:16');
  assert.equal(sample(all(nodes).find((n) => n.id === 'v.right').tracks.opacity, 0.05), 0);
  const title = all(nodes).find((n) => n.id === 'v.left.title.line0');
  assert.ok(title.props.font.size >= registries.looks.get('pop').scale[2] - 1e-6, `title ${title.props.font.size}`);
});
