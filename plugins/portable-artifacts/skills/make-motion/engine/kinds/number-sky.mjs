// The number kind composed round the look's sun (look.kinds.number.orbit with look.sun, cosmos): the sun stands on its
// anchored place for the format (sun.mjs sunAnchor) and the orbit is set so the sun is at a focus. On a wide frame the
// orbit is tilted, the figure at its centre, the label (and delta) under the orbit. On a tall frame it is recomposed,
// not shrunk: a tall ellipse falls from the sun high in the frame to the band's bottom, its upper focus the sun, the
// figure large in its lower middle and the label under the figure inside it, all inside the safe zone. Pure, DOM-free;
// number.mjs hands in its figure parts (`parts`: figureAt, figureGroup, glowingFigure, plainDelta).
//
// sky data (look.kinds.number.sky): { labelStep, labelGap (units), wide: { top, bottom } (shares of the frame the
// orbit keeps clear), tall: { across (share of the safe half width the ellipse takes), low (how far below its centre
// the figure may sit, a share of the tall half axis), fit (share of the chord a text may take) } }.
import { node } from '../graph/node.mjs';
import { layoutText } from '../text/layout.mjs';
import { editorialSpan, editorialBounds } from './editorial.mjs';
import { CAP_HEIGHT, WORD_DESCENT, sizeAt, fontFor, setCase, enterTracks, isWide } from './shared.mjs';
import { sunNodes, sunAnchor } from '../devices/sun.mjs';
import { orbitGeometry, orbitNodes } from './number-orbit.mjs';
import { MIN_HERO_RATIO } from '../review/frame.mjs';

const HALF = 2;
const RAD = Math.PI / 180;
const TRIES = 8;
const SHRINK = 0.92;
const HERO_MARGIN = 1.03;
const DELTA_GAP = 24; // units: the delta's cap line under the label's baseline
const DELTA_LAG = 0.15;
const LABEL_LINES = 1.2; // the label's room under a wide orbit, in label sizes (one line and its descent)

// A label laid out centred or flush left at `size` to `maxWidth`.
function labelSet(shot, ctx, size, maxWidth, align) {
  const { look, unit, measure } = ctx;
  const font = fontFor(look, 'display', size, unit);
  return { font, layout: layoutText({ text: setCase(look, 'display', shot.label), font, maxWidth, measure, align }) };
}

// The label's text node with its first cap line at `top`, its layout box starting at `left`.
function labelNode(shot, ctx, set, left, top, at) {
  const { look, unit } = ctx;
  const y = top + CAP_HEIGHT * set.font.size - set.layout.lines[0].y;
  return { node: node('text', `${shot.id}.label`, { x: left, y, layout: set.layout, font: set.font, fill: look.palette.ink, role: 'label' }, { tracks: enterTracks(look, unit, at, { y }) }), bottom: y + set.layout.lines.at(-1).y + WORD_DESCENT * set.font.size, y };
}

// Wide: the figure fitted, then shrunk until its tilted orbit, set with its focus on the sun, keeps the frame's top and
// bottom margins and the grid's right edge with room for the label under it.
function wideSky(shot, ctx, fit, data) {
  const { canvas, unit } = ctx;
  const sun = sunAnchor(ctx.look, ctx), span = editorialSpan(ctx, 1, ctx.look.grid.columns);
  const t = data.tilt * RAD;
  let fig = fit(span.w), geo = null, centre = null;
  for (let i = 0; i < TRIES; i++) {
    geo = orbitGeometry({ width: fig.total, height: CAP_HEIGHT * fig.size }, data);
    const c = Math.sqrt(Math.max(0, geo.a * geo.a - geo.b * geo.b));
    centre = { x: sun.cx + c * Math.cos(t), y: sun.cy + c * Math.sin(t) };
    const fits = centre.x + geo.hx <= span.x + span.w && centre.y - geo.hy >= data.sky.wide.top * canvas.h
      && centre.y + geo.hy + data.sky.labelGap * unit + LABEL_LINES * sizeAt(ctx.look, data.sky.labelStep, unit) <= data.sky.wide.bottom * canvas.h;
    if (fits) break;
    fig = fit(fig.total * SHRINK);
  }
  return { fig, geometry: { a: geo.a, b: geo.b, tilt: data.tilt }, centre, below: centre.y + geo.hy, sun, align: 'left', labelLeft: centre.x - fig.total / HALF };
}

// Tall: the ellipse through the band's bottom with its upper focus on the sun (b = (d^2 + a^2) / 2d for d from the sun
// to the bottom), the figure as low in it as its width allows.
function tallSky(shot, ctx, fit, data) {
  const sun = sunAnchor(ctx.look, ctx), span = editorialSpan(ctx, 1, ctx.look.grid.columns), bounds = editorialBounds(ctx);
  const sky = data.sky.tall;
  const a = sky.across * span.w / HALF, d = bounds.bottom - sun.cy;
  const b = (d * d + a * a) / (HALF * d), cy = bounds.bottom - b, cx = span.x + span.w / HALF;
  const chord = (y) => HALF * a * Math.sqrt(Math.max(0, 1 - ((y - cy) / b) ** 2));
  // fitted to the chord where the figure would sit, low in the ellipse (its cap box's lower edge), then set as low as
  // that width allows: a figure too wide for there at its floor rises toward the centre
  const low = cy + sky.low * b;
  const first = fit(sky.fit * chord(low));
  const lowFig = fit(sky.fit * chord(low + (CAP_HEIGHT * first.size) / HALF));
  const fig = lowFig.digits.layout.overflow ? fit(sky.fit * chord(cy)) : lowFig;
  const cap = CAP_HEIGHT * fig.size;
  // the lowest cap-box centre whose lower corners stay inside the chord's fitting share
  const room = b * Math.sqrt(Math.max(0, 1 - (fig.total / (sky.fit * HALF * a)) ** 2)) - cap / HALF;
  const figY = cy + Math.max(0, Math.min(sky.low * b, room));
  return { fig, geometry: { a, b, tilt: 0 }, centre: { x: cx, y: cy }, figY, chord, below: figY + cap / HALF, sun, align: 'center' };
}

/** The sky composition: { nodes, boxes, hero }. */
export function skyParts(shot, ctx, steps, times, parts, { minSize, maxSize }) {
  const { look, unit } = ctx;
  const data = look.kinds.number.orbit;
  const labelSize = sizeAt(look, data.sky.labelStep, unit);
  const floor = Math.max(minSize, HERO_MARGIN * MIN_HERO_RATIO * labelSize);
  const fit = (maxWidth) => parts.figureAt(shot, ctx, { maxWidth, minSize: floor, maxSize, steps });
  const sky = isWide(ctx.canvas) ? wideSky(shot, ctx, fit, data) : tallSky(shot, ctx, fit, data);
  const { fig } = sky;
  const cap = CAP_HEIGHT * fig.size;
  const capMid = sky.figY ?? sky.centre.y;
  const figure = parts.figureGroup(shot, ctx, look.kinds.number.glow ? parts.glowingFigure(fig, ctx, times) : fig, { left: sky.centre.x - fig.total / HALF, baseline: capMid + cap / HALF, tracks: {} });
  const labelAt = times.land + look.moves.enter.dur;
  const top = sky.below + data.sky.labelGap * unit;
  const width = sky.align === 'center' ? data.sky.tall.fit * sky.chord(top + labelSize) : editorialSpan(ctx, 1, look.grid.columns).w;
  const set = labelSet(shot, ctx, labelSize, width, sky.align);
  const label = shot.label === undefined ? null : labelNode(shot, ctx, set, sky.align === 'center' ? sky.centre.x - width / HALF : sky.labelLeft, top, labelAt);
  const sun = sunNodes(`${shot.id}.sun`, look, { ...sky.sun, at: undefined });
  const nodes = [...sun, ...orbitNodes(shot.id, ctx, sky.centre, times, data, sky.geometry), figure.group, ...(label ? [label.node] : [])];
  const boxes = { value: figure.box, ...(label ? { label: [sky.centre.x - width / HALF, top, width, label.bottom - top] } : {}) };
  if (shot.delta === undefined) return { nodes, boxes, hero: figure.hero };
  const deltaTop = (label ? label.bottom : sky.below) + DELTA_GAP * unit;
  const left = sky.align === 'center' ? sky.centre.x - width / HALF : sky.labelLeft;
  const delta = parts.plainDelta(ctx, `${shot.id}.delta`, shot.delta, { left, top: deltaTop, maxWidth: width, at: labelAt + DELTA_LAG });
  return { nodes: [...nodes, ...delta.nodes], boxes: { ...boxes, delta: delta.box }, hero: figure.hero };
}
