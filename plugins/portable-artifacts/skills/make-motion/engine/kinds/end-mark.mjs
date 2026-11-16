// The end kind as a real end card (look.kinds.end.wordmark, cosmos): the closing line centred across the grid, the ask
// under it, and the shot's mark set as a wordmark in the display weight, the look's sun behind it and a ring centred on
// it that draws on and is complete `hold` seconds before the shot ends, so the last frames hold the finished card. The
// whole block sits on the composition band's optical centre. Pure and DOM-free.
//
// wordmark data: { titleHeight (share of the band), markShare (of the title size), askGap and gap (em of the title),
// pad (em of the mark: the ring's room round the mark's ink, doubled across), ring: { width units, hold s }, sun: {
// share of the ring's width, strength }, centre (share of the band) }.
import { node } from '../graph/node.mjs';
import { layoutText } from '../text/layout.mjs';
import { roundedRect } from '../devices/shared.mjs';
import { track } from '../time/track.mjs';
import { sunNodes } from '../devices/sun.mjs';
import { editorialSpan, editorialBounds } from './editorial.mjs';
import { CAP_HEIGHT, sizeAt, fontFor, setCase, fitDisplay, enterTracks, runInk, unionBox, wordBoxes, heroId } from './shared.mjs';
import { MIN_HERO_RATIO } from '../review/frame.mjs';

const HALF = 2;
const ASK_MARGIN = 1.03; // the ask a hair under a third of the title, so rounding never takes it over the hero ratio
const MIN_DRAW = 0.3; // seconds: the shortest the ring may take to draw on

// The block's three texts laid out (title, ask or null, mark), centred on the span.
function layouts(shot, ctx, data, title, span) {
  const { look, unit, measure } = ctx;
  const wm = data.wordmark;
  const max = data.max * unit;
  const opts = { text: setCase(look, 'display', title), font: fontFor(look, 'display', max, unit), maxWidth: span.w, align: 'center', measure, optical: true };
  const fit = fitDisplay(opts, { min: sizeAt(look, data.fromStep, unit), max, maxHeight: editorialBounds(ctx).height(wm.titleHeight), maxLines: look.maxLines.display }, look, unit);
  const askFont = fontFor(look, 'label', fit.font.size / (MIN_HERO_RATIO * ASK_MARGIN), unit);
  const ask = shot.ask === undefined ? null : { font: askFont, layout: layoutText({ text: setCase(look, 'label', shot.ask), font: askFont, maxWidth: span.w, align: 'center', measure }) };
  const markFont = fontFor(look, 'display', fit.font.size * wm.markShare, unit);
  const mark = { font: markFont, layout: layoutText({ text: shot.mark, font: markFont, maxWidth: span.w, align: 'center', measure }) };
  return { title: fit, ask, mark };
}

// Each text's baseline offset from the title's first cap line, and the ring's box (relative), stacked down.
function stack(set, data, ctx) {
  const wm = data.wordmark;
  const size = set.title.font.size, t = set.title.layout;
  const titleY = CAP_HEIGHT * size - t.lines[0].y;
  let bottom = titleY + t.lines.at(-1).y;
  const askY = set.ask === null ? null : bottom + wm.askGap * size + CAP_HEIGHT * set.ask.font.size - set.ask.layout.lines[0].y;
  if (askY !== null) bottom = askY + set.ask.layout.lines.at(-1).y;
  const m = set.mark, ink = runInk(m.layout.lines[0], m.font, ctx.measure);
  const pad = wm.pad * m.font.size;
  const ringTop = bottom + wm.gap * size;
  const markY = ringTop + pad + ink.up - m.layout.lines[0].y;
  // runInk is in the layout's space (the centred line's offset included)
  const ring = { left: ink.left - HALF * pad, top: ringTop, w: ink.right - ink.left + HALF * HALF * pad, h: ink.up + ink.down + HALF * pad };
  return { titleY, askY, markY, ring, height: ringTop + ring.h };
}

/** The wordmark end card: { nodes, boxes, hero }. */
export function expandWordmark(shot, ctx, data, times, title) {
  const { look, unit, timing, fps } = ctx;
  const wm = data.wordmark;
  const span = editorialSpan(ctx, 1, look.grid.columns);
  const bounds = editorialBounds(ctx);
  const set = layouts(shot, ctx, data, title, span);
  const at = stack(set, data, ctx);
  const top = Math.max(bounds.top, bounds.at(wm.centre) - at.height / HALF);
  const x = span.x, hero = heroId(shot, 'title');
  const titleNode = node('text', hero, { x, y: top + at.titleY, layout: set.title.layout, font: set.title.font, fill: look.palette.ink, role: 'hero' }, {
    wordTracks: times.title.map((w) => enterTracks(look, unit, w.at)),
  });
  const markAt = times.ask ?? times.title.at(-1)?.at ?? 0;
  const nodes = [titleNode];
  const words = wordBoxes(set.title.layout, x, top + at.titleY);
  const boxes = { title: unionBox(words), ...Object.fromEntries(words.map((box, i) => [`word:${i}`, box])) };
  if (set.ask !== null) {
    const y = top + at.askY;
    nodes.push(node('text', `${shot.id}.ask`, { x, y, layout: set.ask.layout, font: set.ask.font, fill: look.palette.ink2, role: 'ask' }, { tracks: enterTracks(look, unit, times.ask, { y }) }));
    boxes.ask = unionBox(wordBoxes(set.ask.layout, x, y));
  }
  const markY = top + at.markY;
  nodes.push(node('text', `${shot.id}.mark.text`, { x, y: markY, layout: set.mark.layout, font: set.mark.font, fill: look.palette.ink, role: 'mark' }, { tracks: enterTracks(look, unit, markAt, { y: markY }) }));
  const r = at.ring, ringBox = [x + r.left, top + r.top, r.w, r.h];
  const start = markAt + look.moves.enter.dur;
  const done = Math.min(timing.duration - 1 / fps, Math.max(start + MIN_DRAW, timing.duration - wm.ring.hold));
  const draw = track([{ t: 0, v: 0 }, { t: start, v: 0 }, { t: done, v: 1, ease: look.moves.draw.ease }]);
  const ring = node('path', `${shot.id}.mark.ring`, { d: roundedRect(...ringBox, r.h / HALF), stroke: look.palette.accent, strokeWidth: wm.ring.width * unit, lineCap: 'round' }, { tracks: { draw } });
  const sun = sunNodes(`${shot.id}.mark.sun`, look, { cx: ringBox[0] + r.w / HALF, cy: ringBox[1] + r.h / HALF, r: wm.sun.share * r.w, strength: wm.sun.strength, at: markAt });
  boxes.mark = ringBox;
  return { nodes: [...sun, ...nodes, ring], boxes, hero };
}
