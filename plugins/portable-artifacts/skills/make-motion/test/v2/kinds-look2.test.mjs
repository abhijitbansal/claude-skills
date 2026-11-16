// Look revision round 2: the pop layout band and stack sizing (rulings 1 to 3), and the per-kind rules that can be
// asserted on the scene graph with the fake measure. Coverage figures with the real fonts are measured on the renders.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import { stackLines } from '../../engine/text/breaks.mjs';
import { compositionRect } from '../../engine/kinds/shared.mjs';
import { composeStack, stackArea } from '../../engine/kinds/stack.mjs';
import { expandShot, all } from './helpers/kinds.mjs';

const pop = () => registries.looks.get('pop');
const rows = (text) => { const w = text.split(' '); return stackLines(w).map((r) => r.map((i) => w[i]).join(' ')); };

test('ruling 1: on 9:16 the pop composition band runs from 15% to 75% of the height (look data), inside the platform sides', () => {
  const { ctx } = expandShot({ id: 's', show: 'statement', say: 'One.' }, 'pop', '9:16');
  const band = pop().band;
  assert.deepEqual({ ...band }, { top: 0.15, bottom: 0.75 });
  const rect = compositionRect(ctx);
  assert.ok(Math.abs(rect.top + rect.h - 0.75 * 1920) < 1e-6, `bottom ${rect.top + rect.h}`);
  assert.ok(rect.top >= 0.15 * 1920 - 1e-6 && rect.left >= ctx.viralInsets.left - 1e-6);
});

test('ruling 1: a pop stack grows (finer breaks) until its block reaches look.stack.grow of the band, or a word a line', () => {
  const { ctx } = expandShot({ id: 's', show: 'statement', say: 'x' }, 'pop', '9:16');
  const area = stackArea(ctx);
  const height = (lines) => lines.at(-1).baseline + lines.at(-1).ink.down - (lines[0].baseline - lines[0].ink.up);
  const grown = composeStack('KEYFRAMES BECOME WORDS ON SCREEN', { id: 's' }, ctx).lines;
  // 4 lines: "WORDS ON / SCREEN" stops it ("ON" may not end a line, nor stand alone)
  assert.ok(height(grown) >= pop().stack.grow * area.h - 1e-6 || grown.length >= 4, `${Math.round(height(grown))} of ${area.h}, ${grown.length} lines`);
  assert.ok(grown.length > rows('KEYFRAMES BECOME WORDS ON SCREEN').length, 'broken finer than its sense breaks');
  // a stack never grows by leaving a short word alone or a line on a weak word: this one keeps its sense breaks
  assert.deepEqual(composeStack('YOUR CHARTS ARE HIDING SOMETHING.', { id: 's' }, ctx).lines.length, 3);
});

test('ruling 3: one stack uses at most two sizes, the larger the look ratio times the smaller', () => {
  const { ctx } = expandShot({ id: 's', show: 'statement', say: 'x' }, 'pop', '9:16');
  for (const text of ['WRITE THE SCRIPT. SHIP THE FILM.', 'A LOOK THAT FALLS SHORT OF THE BAR IS CUT, NOT SHIPPED WEAK.', 'RUN ONE COMMAND', 'STOP DRAGGING KEYFRAMES.']) {
    const sizes = [...new Set(composeStack(text, { id: 's' }, ctx).lines.map((l) => Math.round(l.font.size * 1000) / 1000))].sort((a, b) => a - b);
    assert.ok(sizes.length <= 2, `${text}: ${sizes}`);
    if (sizes.length === 2) assert.ok(Math.abs(sizes[1] / sizes[0] - pop().stack.ratio) < 1e-3, `${text}: ${sizes}`);
  }
});

test('ruling 3: phrase-aware stack breaks: a comma ends its line, and no one-word first line in a longer sentence', () => {
  for (const text of ['A LOOK THAT FALLS SHORT OF THE BAR IS CUT, NOT SHIPPED WEAK.', 'GET PORTABLE-ARTIFACTS NOW TODAY', 'WRITE THE SCRIPT. SHIP THE FILM.']) {
    const r = rows(text);
    assert.ok(r.every((line) => !/,\s/.test(line)), `${text}: ${JSON.stringify(r)}`);
    assert.ok(r[0].split(' ').length > 1, `${text}: ${JSON.stringify(r)}`);
  }
});

test('ruling 6 (as review B I10 sizes it): the pop end ask is an action: the look\'s tag in the accent, one line, the largest scale step the title stays three times', () => {
  const { nodes, boxes, ctx } = expandShot({ id: 'close', show: 'end', say: 'Write the script. Ship the film.', ask: 'Try it now', mark: 'make-motion' }, 'pop', '9:16');
  const plate = all(nodes).find((n) => n.id === 'close.ask.plate');
  const text = all(nodes).find((n) => n.id === 'close.ask.text');
  assert.ok(plate && text, 'a tag: plate and text');
  assert.equal(plate.props.fill, pop().palette.accent);
  assert.equal(text.props.layout.lines.length, 1);
  const largest = Math.max(...all(nodes).filter((n) => n.props?.stack === 'close.title').map((n) => n.props.font.size));
  const steps = pop().kinds.end.askSteps.map((s) => pop().scale[s - 1] * ctx.unit);
  const fits = steps.filter((s) => 1.03 * 3 * s <= largest + 1e-6); // with the hero margin (kinds/secondary.mjs)
  assert.equal(text.props.font.size, fits.length > 0 ? Math.max(...fits) : Math.min(...steps), `ask ${text.props.font.size} under a ${largest} title`);
  assert.ok(boxes.ask, 'its box');
  assert.equal(registries.kinds.get('end').nodeField({ id: 'close', ask: 'x' }, 'close.ask.text'), 'ask');
});

test('ruling 4: a tall pop compare labels its sides OPTION A / OPTION B (BEFORE / AFTER) on a line of their own, and marks the turn with an accent device between the blocks', async () => {
  const { sample } = await import('../../engine/time/track.mjs');
  const shot = { id: 'v', show: 'compare', say: 'Keyframes, by hand. A script, words set the timing.', left: { title: 'Keyframes' }, right: { title: 'A script' } };
  const { nodes, boxes, ctx } = expandShot(shot, 'pop', '9:16');
  const words = (id) => all(nodes).find((n) => n.id === id).props.layout.lines.flatMap((l) => l.words.map((w) => w.text)).join(' ');
  assert.equal(words('v.left.kicker.text'), 'OPTION A');
  assert.equal(words('v.right.kicker.text'), 'OPTION B');
  const turn = all(nodes).find((n) => n.id === 'v.turn');
  assert.ok(turn, 'a turn device');
  assert.equal(turn.props.fill ?? turn.props.stroke, pop().palette.accent);
  assert.equal(turn.type, 'path', 'a filled bar');
  assert.equal(turn.props.y, undefined, 'drawn where its path says, not offset');
  const box = boxes.turn;
  assert.ok(box[1] >= boxes.left[1] + boxes.left[3] - 1e-6 && box[1] + box[3] <= boxes.right[1] + 1e-6, 'between the two blocks');
  assert.equal(sample(turn.tracks.opacity, ctx.timing.duration - 0.01), 1, 'on screen once the turn has come');
});

test('ruling 5: a tall pop clipping: the picture at least 90% of the safe width, at full opacity from frame 0; the region close-up at least 80%', async () => {
  const { sample } = await import('../../engine/time/track.mjs');
  const shot = { id: 'c', show: 'clipping', src: 'shot.png', say: 'This one shows the query behind every chart.', regions: { query: [0.6, 0.2, 0.3, 0.2] }, on: [{ at: 'word:query', do: 'highlight', target: 'region:query' }] };
  for (const index of [0, 1]) {
    const film = (await import('./helpers/kinds.mjs')).filmOf(index === 0 ? [shot] : [{ id: 'f', show: 'statement', hold: 1, text: 'Hi' }, shot], 'pop', '9:16');
    const r = (await import('./helpers/kinds.mjs')).expandIn(film, index);
    const area = stackArea(r.ctx);
    const pic = r.nodes.find((n) => n.id === 'c.image');
    const image = all([pic]).find((n) => n.type === 'image');
    assert.ok(image.props.w >= 0.9 * area.w - 1e-6, `picture ${Math.round(image.props.w)} of ${area.w}`);
    assert.equal(sample(pic.tracks.opacity, 0), 1, `shot ${index}: full opacity on its first frame`);
    const close = all(r.nodes).find((n) => n.id === 'c.close0');
    const closeImage = all([close]).find((n) => n.type === 'image');
    assert.ok(closeImage.props.w >= 0.8 * area.w - 1e-6, `close-up ${Math.round(closeImage.props.w)} of ${area.w}`);
  }
});

test('ruling 13: a small whole number counts up by ones, visibly, landing within the first second; the delta at least 1.25 times the label step', () => {
  for (const look of ['desk', 'pop']) {
    const { nodes } = expandShot({ id: 'n', show: 'number', value: 9, label: 'shot kinds', delta: 'two looks', say: 'Nine shot kinds. Two looks.' }, look, look === 'pop' ? '9:16' : '16:9');
    const digits = all(nodes).find((n) => n.id === 'n.value.digits');
    const texts = digits.props.layout.lines.flatMap((l) => l.words.map((w) => w.text));
    for (const d of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) assert.ok(texts.includes(d), `${look}: ${d} shown on the way (${texts})`);
    const lands = digits.wordTracks.map((tr) => tr.opacity.points.find((p) => p.v === 1)?.t ?? 0);
    assert.ok(Math.max(...lands) <= 1 + 1e-6 && Math.max(...lands) >= 0.5, `${look}: lands at ${Math.max(...lands)}`);
    const delta = all(nodes).find((n) => n.id === 'n.delta.text');
    assert.ok(delta.props.font.size >= 1.25 * registries.looks.get(look).scale[1] - 1e-6, `${look}: delta ${delta.props.font.size}`);
  }
});

test('ruling 8 (as review B I6 sizes it): desk compare points in the display serif at 1.25 times the label step, or a third of the title when that is less (never under step 1); a kicker gives the compare a slug clear of its cards', async () => {
  const { validateFilm } = await import('../../scripts/v2/spec.mjs');
  const desk = registries.looks.get('desk');
  const shot = { id: 's', show: 'compare', kicker: 'The swap', mode: 'before-after', say: 'Before, you placed every keyframe. Now, you write what is said.', left: { title: 'Keyframes', points: ['Durations', 'Positions'] }, right: { title: 'A script', points: ['Words set the timing'] } };
  const checked = validateFilm({ version: 2, mode: 'pro', look: 'desk', format: '16:9', shots: [shot] }, { specDir: process.cwd() });
  assert.deepEqual(checked.errors, [], 'the kicker field validates');
  for (const format of ['16:9', '9:16']) {
    const { nodes, boxes } = expandShot(shot, 'desk', format);
    const points = all(nodes).find((n) => n.id === 's.left.points');
    const title = all(nodes).find((n) => n.id === 's.left.title');
    assert.equal(points.props.font.family, desk.fonts.display.family, 'the serif');
    const unit = expandShot(shot, 'desk', format).ctx.unit;
    const want = Math.max(desk.scale[0] * unit, Math.min(1.25 * desk.scale[1] * unit, title.props.font.size / 3));
    assert.ok(Math.abs(points.props.font.size - want) < 1e-6, `${format}: ${points.props.font.size} vs ${want}`);
    const slug = all(nodes).find((n) => n.id === 's.slug');
    assert.ok(slug, `${format}: a slug`);
    const { slugBox } = await import('../../engine/kinds/slug.mjs');
    const card = slugBox(shot, expandShot(shot, 'desk', format).ctx).inked;
    for (const k of ['left', 'right']) {
      const [x, y, w, h] = boxes[k];
      assert.ok(x + w <= card[0] || card[0] + card[2] <= x || y + h <= card[1] || card[1] + card[3] <= y, `${format}: ${k} card clear of the slug`);
    }
  }
  assert.equal(registries.kinds.get('compare').numbered(shot), true);
  assert.equal(registries.kinds.get('compare').numbered({ ...shot, kicker: undefined }), false);
});

test('ruling 7: desk list figures are at least 45% of the item size, hung left of the item', () => {
  const shot = { id: 'l', show: 'list', title: 'How it works', style: 'steps', items: ['Write the shots as JSON', 'Run one command', 'Get an MP4'], say: 'Write the shots as JSON. Run one command. Get an MP4.' };
  for (const format of ['16:9', '9:16']) {
    const { nodes } = expandShot(shot, 'desk', format);
    const item = all(nodes).find((n) => n.id === 'l.item0');
    const fig = all(nodes).find((n) => n.id === 'l.figure0');
    assert.ok(fig.props.font.size >= 0.45 * item.props.font.size - 1e-6, `${format}: ${fig.props.font.size} vs ${item.props.font.size}`);
    assert.ok(fig.props.x + fig.props.layout.width <= item.props.x, 'hung left');
  }
});

test('ruling 9: desk chart: equal outer margins, labels at 1.25 times the label step, the source set apart (smaller, ink2, "Source: ", as written)', () => {
  const desk = registries.looks.get('desk');
  const shot = { id: 'g', show: 'chart', type: 'column', title: 'Tests grew with every plan', say: 'Each plan added tests.', source: 'test runs on this branch', data: [{ label: 'Engine', value: 844 }, { label: 'Kinds', value: 1636 }], highlight: 'Kinds' };
  const { nodes, boxes, canvas } = expandShot(shot, 'desk', '16:9');
  const [x, , w] = boxes.chart;
  assert.ok(Math.abs(x - (canvas.w - x - w)) < 1, `margins ${Math.round(x)} and ${Math.round(canvas.w - x - w)}`);
  const source = all(nodes).find((n) => n.id === 'g.source');
  const words = source.props.layout.lines.flatMap((l) => l.words.map((v) => v.text)).join(' ');
  assert.equal(words, 'Source: test runs on this branch');
  assert.equal(source.props.fill, desk.palette.ink2);
  const labels = all(nodes).filter((n) => n.type === 'text' && n.id.startsWith('g.') && n.id !== 'g.title' && n.id !== 'g.source');
  assert.ok(labels.length > 0 && labels.every((n) => n.props.font.size >= 1.25 * desk.scale[1] - 1e-6), `labels ${[...new Set(labels.map((n) => n.props.font.size))]}`);
  assert.ok(source.props.font.size < labels[0].props.font.size, 'the source smaller than the labels');
});

test('ruling 10: a desk push-in ends with the region at 70% of the frame width or more (no caption card to keep room for)', () => {
  const shot = { id: 'p', show: 'clipping', src: 'shot.png', say: 'A screenshot becomes a clipping. The camera can push into any region.', regions: { query: [0.58, 0.14, 0.37, 0.24] }, on: [{ at: 'word:push', do: 'highlight', target: 'region:query' }] };
  const { camera, boxes, canvas } = expandShot(shot, 'desk', '16:9');
  const push = camera.find((layer) => layer.some((k) => k.zoom !== undefined && k.zoom > 1));
  assert.ok(push.at(-1).zoom * boxes['region:query'][2] >= 0.7 * canvas.w - 1e-6, `${Math.round(push.at(-1).zoom * boxes['region:query'][2])} of ${canvas.w}`);
});

test('polish 1: desk list figures in the display serif at the item size, dimming with their item', () => {
  const desk = registries.looks.get('desk');
  const shot = { id: 'l', show: 'list', title: 'How it works', style: 'steps', items: ['Write the shots as JSON', 'Run one command', 'Get an MP4'], say: 'Write the shots as JSON. Run one command. Get an MP4.' };
  for (const format of ['16:9', '9:16']) {
    const { nodes } = expandShot(shot, 'desk', format);
    const item = all(nodes).find((n) => n.id === 'l.item0');
    const fig = all(nodes).find((n) => n.id === 'l.figure0');
    assert.equal(fig.props.font.family, desk.fonts.display.family);
    assert.equal(fig.props.font.size, item.props.font.size, `${format}: same size`);
    assert.ok(fig.props.x + fig.props.layout.width <= item.props.x, 'hung left');
    assert.ok(fig.props.x >= 0, 'on the frame');
  }
});

test('polish 2: the desk end ask is one third of the title, in the label face, clear of the mark card', () => {
  const desk = registries.looks.get('desk');
  for (const format of ['16:9', '9:16']) {
    const { nodes, boxes } = expandShot({ id: 'e', show: 'end', say: 'Write the script. The engine does the rest.', ask: 'Write your first film', mark: 'make-motion' }, 'desk', format);
    const title = all(nodes).find((n) => n.id === 'e.title');
    const ask = all(nodes).find((n) => n.id === 'e.ask');
    assert.equal(ask.props.font.family, desk.fonts.label.family);
    assert.ok(Math.abs(ask.props.font.size - title.props.font.size / 3) <= 1, `${format}: ${ask.props.font.size} vs ${title.props.font.size}`);
    const [ax, ay, aw, ah] = boxes.ask, [mx, my, mw, mh] = boxes.mark;
    assert.ok(ax + aw <= mx || mx + mw <= ax || ay + ah <= my || my + mh <= ay, `${format}: ask ${boxes.ask.map(Math.round)} clear of the mark ${boxes.mark.map(Math.round)}`);
    const [tx, ty, tw, th] = boxes.title;
    assert.ok(tx + tw <= mx || mx + mw <= tx || ty + th <= my || my + mh <= ty, `${format}: title clear of the mark`);
  }
});
