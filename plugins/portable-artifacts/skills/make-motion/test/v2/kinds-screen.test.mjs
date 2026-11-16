// The `screen` kind: a screenshot upright in a device frame drawn from paths, with named regions the camera goes to
// (`zoom`, or the first `on` event aimed at a region) by a push (desk) or a cut to a close-up (pop); on a tall frame a
// wide screen is two panels, the region enlarged under the whole screen. `url` is display text, never fetched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import { sample } from '../../engine/time/track.mjs';
import { resolveAnchor } from '../../engine/script/anchors.mjs';
import { validateFilm } from '../../scripts/v2/spec.mjs';
import { defaultFrame, chromeOf } from '../../engine/kinds/screen-frame.mjs';
import { expandShot, all, canvasOf, IMAGES, pushLanding } from './helpers/kinds.mjs';
import { assertBar } from './helpers/bar.mjs';

const screen = registries.kinds.get('screen');
const REGIONS = { query: [0.55, 0.2, 0.35, 0.2], total: [0.1, 0.6, 0.3, 0.2] };
const SAY2 = 'This page shows every query behind the report. The total sits right down here.';
const SAY1 = 'This page shows every single query behind the report and the total at the very bottom of it.';
const base = (extra = {}) => ({ id: 's', show: 'screen', src: 'shot.png', regions: REGIONS, ...extra });
const LOOKS = ['desk', 'pop'];
const FORMATS = ['16:9', '9:16'];
const mark = (look) => (look === 'pop' ? 'underline' : 'circle');
const zoomTimeOf = (shot, out) => screen.events(shot, out.timing).find((e) => e.device === 'zoom')?.t;
const reviewOf = (shot, look, format) => {
  const out = expandShot(shot, look, format);
  return screen.review(shot, { look: registries.looks.get(look), timing: out.timing, at: (ref) => resolveAnchor(ref, out.timing), canvas: canvasOf(format), asset: (src) => IMAGES.get(src) });
};

// ---- the frame ----

test('the default frame is a browser for a picture wider than tall, a phone otherwise', () => {
  assert.equal(defaultFrame({ width: 1600, height: 1000 }), 'browser');
  assert.equal(defaultFrame({ width: 600, height: 1200 }), 'phone');
  assert.equal(defaultFrame({ width: 800, height: 800 }), 'phone');
});

test('chrome sizes: browser title row 72 and address row 88, corners 20 (from version 1 browser-window.mjs), in units', () => {
  assert.deepEqual(chromeOf('browser', 1), { top: 160, side: 0, bottom: 0, radius: 20, title: 72, address: 88 });
  assert.deepEqual(chromeOf('window', 1), { top: 72, side: 0, bottom: 0, radius: 20, title: 72, address: 0 });
  assert.deepEqual(chromeOf('phone', 1), { top: 56, side: 24, bottom: 56, radius: 64, title: 0, address: 0 });
  assert.deepEqual(chromeOf('none', 1), { top: 0, side: 0, bottom: 0, radius: 0, title: 0, address: 0 });
  assert.deepEqual(chromeOf('browser', 2), { top: 320, side: 0, bottom: 0, radius: 40, title: 144, address: 176 });
});

test('the url is drawn as text once and nowhere else; the title in the title row', () => {
  const out = expandShot(base({ hold: 3, zoom: 'query', title: 'Weekly report', url: 'example.com/report' }), 'desk', '16:9');
  const texts = all(out.nodes).filter((n) => n.type === 'text');
  const words = (n) => n.props.layout.lines.flatMap((l) => l.words.map((w) => w.text)).join(' ');
  assert.deepEqual(texts.filter((n) => words(n).includes('example.com')).map((n) => n.id), ['s.url']);
  assert.equal(words(texts.find((n) => n.id === 's.title')), 'Weekly report');
});

test('a region box is the region fraction of the drawn screenshot (as clipping maps a region)', () => {
  const out = expandShot(base({ hold: 3, zoom: 'query' }), 'desk', '16:9');
  const [x, y, w, h] = out.boxes.image;
  const [fx, fy, fw, fh] = REGIONS.query;
  const want = [x + fx * w, y + fy * h, fw * w, fh * h];
  out.boxes['region:query'].forEach((v, i) => assert.ok(Math.abs(v - want[i]) < 1e-6, `${v} vs ${want[i]}`));
});

// ---- timing ----

test('zoom timing: on the first on event aimed at a region; else the second sentence; else the narration midpoint', () => {
  const onShot = base({ say: SAY2, on: [{ at: 'word:total', do: 'circle', target: 'region:total' }] });
  const onOut = expandShot(onShot, 'desk', '16:9');
  assert.ok(Math.abs(zoomTimeOf(onShot, onOut) - onOut.timing.words.find((w) => w.text.startsWith('total')).start) < 1e-6);
  const two = base({ say: SAY2, zoom: 'total' });
  const twoOut = expandShot(two, 'desk', '16:9');
  assert.equal(zoomTimeOf(two, twoOut), twoOut.timing.sentences[1].start);
  const one = base({ say: SAY1, zoom: 'total' });
  const oneOut = expandShot(one, 'desk', '16:9');
  const { words } = oneOut.timing;
  assert.ok(Math.abs(zoomTimeOf(one, oneOut) - (words[0].start + words.at(-1).end) / 2) < 1e-9);
  const held = base({ hold: 4, zoom: 'total' });
  assert.equal(zoomTimeOf(held, expandShot(held, 'desk', '16:9')), 2, 'a held shot: its middle');
});

test('the framed screen is whole on frame 0 and the zoom lands in time to be seen', () => {
  for (const look of LOOKS) {
    const out = expandShot(base({ say: SAY2, zoom: 'query' }), look, '16:9');
    const group = out.nodes.find((n) => n.id === 's.screen');
    assert.equal(group.tracks.opacity === undefined || sample(group.tracks.opacity, 0) === 1, true, `${look}: whole at 0`);
    assert.ok(zoomTimeOf(base({ say: SAY2, zoom: 'query' }), out) <= out.timing.duration - 0.6);
  }
});

test('desk pushes in on the zoomed region and dims the rest; pop cuts to a close-up of it', () => {
  const shot = base({ say: SAY2, zoom: 'query' });
  const desk = expandShot(shot, 'desk', '16:9');
  const at = zoomTimeOf(shot, desk);
  assert.ok(Math.abs(pushLanding(desk.camera).t - at) < 1e-9, 'the push lands on the zoom');
  const scrim = all(desk.nodes).find((n) => n.id === 's.focus');
  assert.ok(scrim && sample(scrim.tracks.opacity, at) > 0 && sample(scrim.tracks.opacity, 0) === 0, 'the rest dims on the zoom');
  const pop = expandShot(shot, 'pop', '16:9');
  const cut = zoomTimeOf(shot, pop); // viral's own pace
  const close = all(pop.nodes).find((n) => n.id === 's.close0');
  assert.ok(close, 'a close-up');
  assert.equal(sample(close.tracks.opacity, cut - 0.05), 0);
  assert.equal(sample(close.tracks.opacity, cut), 1);
  assert.equal(sample(pop.nodes.find((n) => n.id === 's.screen').tracks.opacity, cut), 0, 'the whole screen goes on the cut');
});

test('pop on a tall frame keeps a phone screen whole and goes to the region with a dim and a sweep of light', () => {
  const shot = { ...base({ say: SAY2, zoom: 'query' }), src: 'phone.png' };
  const out = expandShot(shot, 'pop', '9:16');
  const at = zoomTimeOf(shot, out);
  assert.equal(all(out.nodes).some((n) => n.id.startsWith('s.close')), false, 'no cut to a strip');
  assert.ok(all(out.nodes).some((n) => n.id === 's.focus') && all(out.nodes).some((n) => n.id === 's.sweep'));
  assert.equal(out.nodes.find((n) => n.id === 's.screen').tracks.opacity, undefined, 'the phone stays');
  assert.ok(at > 0);
});

test('desk: the chrome text leaves as the push begins, so nothing is cut at the frame edge', () => {
  const shot = base({ say: SAY2, zoom: 'query', title: 'Weekly report', url: 'example.com/report' });
  const out = expandShot(shot, 'desk', '16:9');
  const start = pushLanding(out.camera) && out.camera.find((layer) => layer.some((k) => k.zoom > 1))[0].t;
  for (const id of ['s.title', 's.url']) {
    const n = all(out.nodes).find((x) => x.id === id);
    assert.equal(sample(n.tracks.opacity, 0), 1, `${id} whole at 0`);
    assert.equal(sample(n.tracks.opacity, start + 0.3), 0, `${id} gone early in the push`);
  }
});

test('on a tall frame a wide screen is two panels: the region enlarged under it, arriving with the zoom, joined by a route', () => {
  for (const look of LOOKS) {
    const shot = base({ say: SAY2, zoom: 'query' });
    const out = expandShot(shot, look, '9:16');
    const at = zoomTimeOf(shot, out);
    const panel = out.nodes.find((n) => n.id === 's.panel');
    assert.ok(panel, `${look}: a second panel`);
    assert.equal(sample(panel.tracks.opacity, Math.max(0, at - 0.3)), 0);
    assert.equal(sample(panel.tracks.opacity, at), 1);
    assert.ok(out.boxes.panel[1] > out.boxes.screen[1] + out.boxes.screen[3], 'under the screen');
    assert.ok(all(out.nodes).some((n) => n.id === 's.link.line'), 'joined by a route line');
  }
});

test('before the panel comes, the screen waits centred in the room, then settles up as the panel arrives', () => {
  for (const look of LOOKS) {
    const shot = base({ say: SAY2, zoom: 'query' });
    const out = expandShot(shot, look, '9:16');
    const at = zoomTimeOf(shot, out);
    const group = out.nodes.find((n) => n.id === 's.screen');
    assert.ok(sample(group.tracks.y, 0) > 100, `${look}: lowered toward the middle at first`);
    assert.equal(sample(group.tracks.y, at + 1), 0, `${look}: at the top once the panel is there`);
  }
});

// ---- findings ----

test('a wide screen on a tall frame with no region to enlarge is a creative finding at regions', () => {
  for (const look of LOOKS) {
    const found = reviewOf({ id: 's', show: 'screen', src: 'shot.png', hold: 3 }, look, '9:16');
    assert.ok(found.some((f) => f.path === 'regions' && f.message === 'name a region to enlarge: a wide screen on a tall frame leaves half of it empty'), JSON.stringify(found));
    assert.ok(!reviewOf({ id: 's', show: 'screen', src: 'phone.png', hold: 3 }, look, '9:16').some((f) => f.path === 'regions'), 'not for a phone screen');
  }
});

test('a screen with nothing to point at is a creative finding at zoom', () => {
  const found = reviewOf({ id: 's', show: 'screen', src: 'shot.png', hold: 3 }, 'desk', '16:9');
  assert.deepEqual(found.filter((f) => f.path === 'zoom').map((f) => f.message), ['name a region to go to, or mark one with an on event: a screen that only sits there is a still']);
  assert.deepEqual(reviewOf(base({ hold: 3, zoom: 'query' }), 'desk', '16:9'), []);
});

test('zoom must name a region, with did-you-mean', () => {
  const { errors } = validateFilm({ version: 2, shots: [base({ hold: 3, zoom: 'qeury' })] }, { specDir: '.' });
  assert.ok(errors.some((e) => e.path === 'shots[0].zoom' && e.message === 'no region "qeury"; did you mean "query"? (regions: query, total)'), JSON.stringify(errors));
});

test('screen declares its sound event, targets, src field and steering fields', () => {
  assert.deepEqual(screen.eventDevices, ['zoom']);
  assert.deepEqual(screen.targets(base()), ['screen', 'region:query', 'region:total']);
  assert.deepEqual(screen.srcFields, ['src']);
  assert.deepEqual(screen.steeringFields, ['frame', 'regions', 'zoom']);
  assert.equal(screen.showsWords, false);
  assert.deepEqual(screen.events({ id: 's', show: 'screen', src: 'shot.png', hold: 3 }, { duration: 3, words: [], sentences: [], index: 0 }), [], 'no zoom, no event');
});

// ---- the bar ----

const example = () => ({ ...screen.example, src: 'shot.png' });
const full = (look, src = 'shot.png') => base({
  src, say: SAY2, title: 'Weekly report', url: 'example.com/report', zoom: 'query',
  on: [{ at: 'word:total', do: mark(look), target: 'region:query' }],
});

for (const look of LOOKS) {
  for (const format of FORMATS) {
    test(`screen bar: the example in ${look} at ${format}`, () => assertBar('screen', example(), { look, format }));
    test(`screen bar: the full browser fixture in ${look} at ${format}`, () => assertBar('screen', full(look), { look, format }));
    test(`screen bar: a phone screen in ${look} at ${format}`, () => assertBar('screen', { ...full(look, 'phone.png'), regions: { query: [0.1, 0.3, 0.8, 0.15], total: [0.1, 0.7, 0.8, 0.12] } }, { look, format }));
  }
}
