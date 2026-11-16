// Shared fixtures for the kinds tests (kinds-*.test.mjs): a fake text measure with ink, films of one or two shots
// expanded exactly as buildFilm does, and small readers for the nodes the kinds build. Split out of kinds.test.mjs.
import assert from 'node:assert/strict';
import { registries } from '../../../engine/registry.mjs';
import { node } from '../../../engine/graph/node.mjs';
import { sampleGraph } from '../../../engine/graph/sample.mjs';
import { sample } from '../../../engine/time/track.mjs';
import { buildTimeline } from '../../../engine/script/timing.mjs';
import { buildFilm, shotContext } from '../../../engine/graph/film.mjs';
import { FORMATS, safeInsets, VIRAL_SAFE_ZONE } from '../../../template/formats.mjs';
import '../../../engine/looks/index.mjs';
import '../../../engine/modes/index.mjs';
import '../../../engine/devices/index.mjs';
import '../../../engine/kinds/index.mjs';
import '../../../engine/cuts/index.mjs';

export const FPS = 30;
export const EPS = 1e-6;
// A fake measure with ink, as the page's canvas reports it: capitals and b d f h k l t reach 0.74 em, other letters
// 0.5 em; g j p q y descend 0.22 em; the ink starts 0.02 em in and ends 0.02 em before the advance.
// a quotation mark's ink floats above the baseline, as the browser measures it (a negative descent): about a third of
// an em tall from a cap-high top
const QUOTES = /^[\u201c\u201d"]+$/;
const QUOTE_FLOAT = 0.42;
export const inkUp = (text) => (/[A-Z0-9bdfhklt]/.test(text) ? 0.74 : 0.5);
export const measure = (text, font) => {
  const width = [...text].length * font.size * 0.55;
  return {
    width, ascent: font.size * 0.8, descent: font.size * 0.2,
    inkAscent: inkUp(text) * font.size, inkDescent: (QUOTES.test(text) ? -QUOTE_FLOAT : /[gjpqy]/.test(text) ? 0.22 : 0) * font.size, inkLeft: 0.02 * font.size, inkRight: width - 0.02 * font.size,
  };
};
// shot.png: a wide screenshot; phone.png: a tall one (a phone screen), for the screen kind's phone frame
export const IMAGES = new Map([['shot.png', { width: 1600, height: 1000 }], ['phone.png', { width: 600, height: 1200 }]]);
export const canvasOf = (format) => ({ w: FORMATS[format].size[0], h: FORMATS[format].size[1] });
// The platform safe zone as the stage passes it (template/formats.mjs safeInsets with the viral zone)...
export const platformOf = (canvas) => safeInsets([canvas.w, canvas.h], VIRAL_SAFE_ZONE);
// ...and the area pop composes in on 9:16: its sides, with pop's band (look revision 2) for the top and bottom. Passed
// as the stage's insets it gives the same composition (compositionRect applies the band), and tests judge against it.
export const viralOf = (canvas) => {
  const zone = platformOf(canvas);
  const band = registries.looks.get('pop').band;
  if (!band || canvas.h <= canvas.w) return zone;
  return { ...zone, top: Math.max(zone.top, band.top * canvas.h), bottom: canvas.h - band.bottom * canvas.h };
};
export const modeOf = (look) => (look === 'pop' ? 'viral' : 'pro');

export const filmOf = (shots, look = 'desk', format = '16:9', extra = {}) => ({ version: 2, mode: modeOf(look), look, format, fps: FPS, seed: 1, shots, ...extra });

// Expand shot `index` of a film (default: a one-shot film) exactly as buildFilm does; `prepared` is the film's prepared
// data by shot id (scripts/v2/prepare), for a kind that declares `prepared: true`.
export function expandIn(film, index = 0, { prepared = {} } = {}) {
  const timeline = buildTimeline(film, { fps: FPS });
  const canvas = canvasOf(film.format);
  const ctx = shotContext({ film, index, timeline, canvas, measure, assets: IMAGES, viralInsets: viralOf(canvas), prepared });
  const shot = film.shots[index];
  return { ...registries.kinds.get(shot.show).expand(shot, ctx), timing: timeline.shots[index], ctx, canvas };
}
export const expandShot = (shot, look = 'desk', format = '16:9') => expandIn(filmOf([shot], look, format));
// The shot as the second of a film: in viral mode the first shot reads from frame 0 (see the hook tests), later shots arrive word by word.
export const FILLER = { id: 'filler', show: 'statement', hold: 1, text: 'Hi' };
export const expandSecond = (shot, look = 'desk', format = '16:9') => expandIn(filmOf([FILLER, shot], look, format), 1);
export const filmFor = (shots, look = 'desk', format = '16:9', extra = {}, { prepared = {} } = {}) => {
  const film = filmOf(shots, look, format, extra);
  return buildFilm({ film, timeline: buildTimeline(film, { fps: FPS }), measure, assets: IMAGES, canvas: canvasOf(format), viralInsets: viralOf(canvasOf(format)), prepared });
};

export const all = (nodes) => nodes.flatMap((n) => [n, ...all(n.children)]);
export const textNode = (nodes, id) => all(nodes).find((n) => n.type === 'text' && (id === undefined || n.id === id));
export const lastKey = (tr) => tr.points.at(-1);
export const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ''} ${a} vs ${b}`);
export const inside = (box, insets, canvas, msg) => {
  const [x, y, w, h] = box;
  assert.ok(x >= insets.left - EPS && y >= insets.top - EPS && x + w <= canvas.w - insets.right + EPS && y + h <= canvas.h - insets.bottom + EPS,
    `${msg}: ${JSON.stringify(box.map((v) => Math.round(v)))} outside the safe area of ${canvas.w}x${canvas.h}`);
};
// A device lands on `at`: full at `at`, and not full before it, except that a stepped (12 fps) desk mark settles on the
// last step at or before `at`, up to 1/12 s early.
export function landsOn(n, name, at, msg) {
  const tr = n.tracks[name];
  near(sample(tr, at, n.step), 1, `${msg}: full at the anchor`);
  const early = n.step === undefined ? EPS : 1 / n.step + EPS;
  assert.ok(sample(tr, at - early, n.step) < 1, `${msg}: not full more than ${early} s before`);
}
// The width of a rectangle path written as M0 0H<w>V<h>H0Z.
export const ruleWidth = (n) => Number(/H([\d.]+)/.exec(n.props.d)[1]);
export const overlaps = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
// A sampled node whose whole subtree is text or groups: its box can be computed without the page.
export const isTextOnly = (n) => (n.type === 'text' || n.type === 'group') && n.children.every(isTextOnly);
// The first time a stepped 0/1 opacity track reads 1 (the time of its first key with v 1).
export const shownAt = (tr) => tr.points.find((p) => p.v === 1).t;

// Every word track of a statement's hero: its text node's, or each line's of a stack, in word order.
export const heroWords = (nodes, hero) => {
  const n = nodes.find((x) => x.id === hero);
  return n.type === 'group' ? n.children.flatMap((line) => line.wordTracks) : n.wordTracks;
};

// The slug's card as built: its group (the card's entrance) and the box it would have unturned, in canvas pixels.
export function slugOf(nodes, id) {
  const group = all(nodes).find((n) => n.id === `${id}.slug`);
  if (!group) return null;
  const paper = group.children.find((n) => n.id === `${id}.slug.paper`);
  const xs = paper.props.d.match(/-?\d+(?:\.\d+)?/g).map(Number).filter((_, i) => i % 2 === 0);
  const ys = paper.props.d.match(/-?\d+(?:\.\d+)?/g).map(Number).filter((_, i) => i % 2 === 1);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  return { group, w, h, right: group.props.x + Math.max(...xs), top: group.props.y + Math.min(...ys) };
}

// A centred look with the pulse emphasis (pop before revision 1), kept to cover the centred composition and recolor-scale.
export function centredPop() {
  const pop = registries.looks.get('pop');
  if (!registries.looks.has('pop-centred-test')) registries.looks.add('pop-centred-test', Object.freeze({ ...pop, name: 'pop-centred-test', composition: 'centred', emphasis: 'recolor-scale' }));
  return 'pop-centred-test';
}

// The lines of a stack: the text nodes inside the hero group, in order, each with its ink in canvas pixels (the fake
// measure's ink: 0.02 em in from each end, capitals 0.74 em tall, no descenders in caps).
export function stackLinesOf(nodes, hero) {
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

// A tag group's plate as a canvas box (the plate path is about the group's centre).
export function plateBox(tag) {
  const plate = tag.children.find((n) => n.type === 'path');
  const nums = plate.props.d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
  return [tag.props.x + Math.min(...xs), tag.props.y + Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
}

export const POP_SHOT = { id: 'c', show: 'clipping', src: 'shot.png', say: 'This one shows the query and then the chart below it.',
  regions: { query: [0.6, 0.2, 0.3, 0.2], chart: [0.1, 0.3, 0.4, 0.3] },
  on: [{ at: 'word:query', do: 'underline', target: 'region:query' }, { at: 'word:chart', do: 'highlight', target: 'region:chart' }] };

export const opacityAt = (n, t) => sample(n.tracks.opacity, t, n.step);

export const fakeSampled = (id, x, extra = {}) => sampleGraph([node('path', id, { d: 'M0 0H10V10H0Z', fill: '#ff0000', x, y: 100, ...extra })], 0)[0];

export const THREE = [
  { id: 'a', show: 'statement', say: 'Most dashboards cannot tell you *where a number came from*.', kicker: 'The problem', hero: 'h' },
  { id: 'n', show: 'number', say: 'Four hundred fifty nine rows. One file.', value: 459, suffix: 'rows', label: 'in one file', delta: '+12%', cut: 'slide' },
  { id: 'c', show: 'clipping', src: 'shot.png', say: 'This one shows the query behind every chart.', regions: { query: [0.6, 0.2, 0.3, 0.2] }, cut: 'cut',
    on: [{ at: 'word:query', do: 'highlight', target: 'region:query' }] },
];

export const visibleSteps = (digits, t) => digits.props.steps.filter((step) => step.words.every((i) => sample(digits.wordTracks[i].opacity, t) === 1)).length;

// The boxes the words of a sampled text node occupy at one frame: each word's layout box scaled about its own centre.
export function wordSpans(node) {
  return node.props.layout.lines.map((line) => line.words.map((word) => {
    const track = node.words?.[word.index] ?? { x: 0, scale: 1, opacity: 1 };
    const half = (word.width * Math.abs(track.scale)) / 2;
    const centre = node.x + line.x + word.x + word.width / 2 + track.x;
    return { index: word.index, left: centre - half, right: centre + half, opacity: track.opacity };
  }));
}

export const CLIP = (extra = {}) => ({ id: 'c', show: 'clipping', src: 'shot.png', say: 'This one shows the query behind every chart on the page today.', regions: { r: [0.1, 0.1, 0.3, 0.3] }, on: [{ at: 'word:one', do: 'circle', target: 'region:r' }], ...extra });

export const pushLanding = (camera) => camera.find((layer) => layer.some((k) => k.zoom !== undefined && k.zoom > 1))?.findLast((k) => k.zoom > 1);
