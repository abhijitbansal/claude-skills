// The number kind composed on the look's sky (look.kinds.number.sky with look.sun, cosmos): a measured line from the
// Sun to Earth. The sun stands on its anchored place for the format (sun.mjs sunAnchor); a straight lavender line runs
// from its disc to the Earth mark (sun.mjs earthNodes) on the sun's axis; while the figure counts, a small light drawn as
// the sun is travels the line from the sun to Earth and goes out there. On a wide frame the line runs across the frame
// at the sun's height, the figure centred over it and the label under it (a dimension line); on a tall one it falls
// from the sun high in the frame to Earth at the band's bottom, broken round the figure and its label, centred on it.
// Gate review 3: the orbit this replaces had the Sun on its rim, which reads as Earth circling an empty point.
// Pure, DOM-free; number.mjs hands in its figure parts (`parts`: figureAt, figureGroup, glowingFigure, plainDelta).
//
// sky data (look.kinds.number.sky): { labelStep (scale step of the label), labelGap (units between the line or the
// figure and the label), above (units between the figure's baseline and a wide line), line: { width, gap (units: the
// line's stroke and its gap to the sun's disc, Earth's ring and a tall line's break) }, light (units: the travelling
// light's radius), fit (share of a wide line the figure may take; a tall one takes the safe width), out (seconds the light takes to go
// out at Earth) }.
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';
import { layoutText } from '../text/layout.mjs';
import { editorialSpan, editorialBounds } from './editorial.mjs';
import { CAP_HEIGHT, WORD_DESCENT, sizeAt, fontFor, setCase, enterTracks, isWide } from './shared.mjs';
import { sunNodes, sunAnchor, earthNodes, earthReach } from '../devices/sun.mjs';
import { MIN_HERO_RATIO } from '../review/frame.mjs';

const HALF = 2;
const HERO_MARGIN = 1.03;
const DELTA_GAP = 24; // units: the delta's cap line under the label's baseline
const DELTA_LAG = 0.15;
const LINEAR = 'linear';

// A label laid out to `maxWidth` with `align`.
function labelSet(shot, ctx, size, maxWidth, align) {
  const { look, unit, measure } = ctx;
  const font = fontFor(look, 'display', size, unit);
  return { font, layout: layoutText({ text: setCase(look, 'display', shot.label), font, maxWidth, measure, align }) };
}

// The label's text node with its first cap line at `top`, its layout box starting at `left`.
function labelNode(shot, ctx, set, left, top, at) {
  const { look, unit } = ctx;
  const y = top + CAP_HEIGHT * set.font.size - set.layout.lines[0].y;
  return { node: node('text', `${shot.id}.label`, { x: left, y, layout: set.layout, font: set.font, fill: look.palette.ink, role: 'label' }, { tracks: enterTracks(look, unit, at, { y }) }), bottom: y + set.layout.lines.at(-1).y + WORD_DESCENT * set.font.size };
}

// A straight segment of the line from (x0, y0) to (x1, y1).
const segment = (id, ctx, [x0, y0], [x1, y1]) => node('path', id, { d: `M${x0} ${y0}L${x1} ${y1}`, stroke: ctx.look.palette.ink2, strokeWidth: ctx.look.kinds.number.sky.line.width * ctx.unit, lineCap: 'round' });

// The travelling light: the look's sun drawn small, carried along `axis` from `from` to `to` over the count, hidden
// (scaled to nothing) across each of `gaps` ([enter, leave] positions along the axis) and going out at the end.
function lightNodes(id, ctx, { axis, across, from, to, gaps }, times) {
  const { look, unit } = ctx;
  const data = look.kinds.number.sky;
  const [t0, t1] = [times.start, Math.max(times.start + 1 / ctx.fps, times.land)];
  const when = (p) => t0 + ((p - from) / (to - from)) * (t1 - t0);
  const blink = 1 / ctx.fps;
  const scaleKeys = [{ t: 0, v: 0 }, { t: t0, v: 0 }, { t: t0 + blink, v: 1 }];
  for (const [enter, leave] of gaps) scaleKeys.push({ t: when(enter), v: 1 }, { t: when(enter) + blink, v: 0 }, { t: when(leave), v: 0 }, { t: when(leave) + blink, v: 1 });
  scaleKeys.push({ t: t1, v: 1 }, { t: t1 + data.out, v: 0, ease: look.moves.exit.ease });
  // keys in time order (a count that starts on frame 0 puts two keys at 0)
  const ordered = scaleKeys.filter((k, i) => i === 0 || k.t >= scaleKeys[i - 1].t);
  const move = track([{ t: 0, v: from }, { t: t0, v: from }, { t: t1, v: to, ease: LINEAR }]);
  const disc = sunNodes(`${id}.disc`, look, { cx: 0, cy: 0, r: data.light * unit });
  const at = axis === 'x' ? { y: across } : { x: across };
  return [node('group', id, at, { tracks: { [axis]: move, scale: track(ordered) }, children: disc })];
}

// Wide: the line across at the sun's height from its disc to Earth at the grid's right edge, the figure centred over it,
// the label under it.
function wideSky(shot, ctx, fit) {
  const { look, unit } = ctx;
  const data = look.kinds.number.sky, gap = data.line.gap * unit;
  const sun = sunAnchor(look, ctx), span = editorialSpan(ctx, 1, look.grid.columns);
  const reach = earthReach(look, unit);
  const earth = { x: span.x + span.w - reach, y: sun.cy };
  const x0 = sun.cx + look.sun.disc * sun.r + gap, x1 = earth.x - reach - gap;
  const fig = fit(data.fit * (x1 - x0));
  const mid = (x0 + x1) / HALF;
  return {
    fig, earth, sun, align: 'center', figLeft: mid - fig.total / HALF, baseline: sun.cy - data.above * unit,
    labelTop: sun.cy + data.labelGap * unit, labelLeft: x0, labelWidth: x1 - x0,
    segments: [[[x0, sun.cy], [x1, sun.cy]]], light: { axis: 'x', across: sun.cy, from: x0, to: x1, gaps: [] },
  };
}

// Tall: the line down from the sun to Earth at the band's bottom, broken round the figure, its label and its delta
// (`deltaH` px with its gap), centred on it.
function tallSky(shot, ctx, fit, labelSize, deltaH) {
  const { look, unit } = ctx;
  const data = look.kinds.number.sky, gap = data.line.gap * unit;
  const sun = sunAnchor(look, ctx), span = editorialSpan(ctx, 1, look.grid.columns), bounds = editorialBounds(ctx);
  const reach = earthReach(look, unit);
  const earth = { x: sun.cx, y: bounds.bottom - reach };
  const y0 = sun.cy + look.sun.disc * sun.r + gap, y1 = earth.y - reach - gap;
  // the whole safe width: nothing stands beside a tall figure (a three-digit figure needs it at its floor)
  const fig = fit(span.w);
  const cap = CAP_HEIGHT * fig.size;
  const set = labelSet(shot, ctx, labelSize, span.w, 'center');
  const labelH = set.layout.lines.at(-1).y - set.layout.lines[0].y + (CAP_HEIGHT + WORD_DESCENT) * labelSize;
  const blockH = cap + (shot.label === undefined ? 0 : data.labelGap * unit + labelH) + deltaH;
  const top = (y0 + y1) / HALF - blockH / HALF;
  return {
    fig, earth, sun, align: 'center', figLeft: sun.cx - fig.total / HALF, baseline: top + cap,
    labelTop: top + cap + data.labelGap * unit, labelLeft: span.x, labelWidth: span.w,
    segments: [[[sun.cx, y0], [sun.cx, top - gap]], [[sun.cx, top + blockH + gap], [sun.cx, y1]]],
    light: { axis: 'y', across: sun.cx, from: y0, to: y1, gaps: [[top - gap, top + blockH + gap]] },
  };
}

/** The sky composition: { nodes, boxes, hero }. */
export function skyParts(shot, ctx, steps, times, parts, { minSize, maxSize }) {
  const { look, unit } = ctx;
  const data = look.kinds.number.sky;
  const labelSize = sizeAt(look, data.labelStep, unit);
  const floor = Math.max(minSize, HERO_MARGIN * MIN_HERO_RATIO * labelSize);
  const fit = (maxWidth) => parts.figureAt(shot, ctx, { maxWidth, minSize: floor, maxSize, steps });
  const probe = shot.delta === undefined ? null : parts.plainDelta(ctx, `${shot.id}.delta`, shot.delta, { left: 0, top: 0, maxWidth: editorialSpan(ctx, 1, look.grid.columns).w, at: 0 });
  const deltaH = probe === null ? 0 : DELTA_GAP * unit + probe.box[3];
  const sky = isWide(ctx.canvas) ? wideSky(shot, ctx, fit) : tallSky(shot, ctx, fit, labelSize, deltaH);
  const figure = parts.figureGroup(shot, ctx, look.kinds.number.glow ? parts.glowingFigure(sky.fig, ctx, times) : sky.fig, { left: sky.figLeft, baseline: sky.baseline, tracks: {} });
  const labelAt = times.land + look.moves.enter.dur;
  const set = labelSet(shot, ctx, labelSize, sky.labelWidth, 'center');
  const label = shot.label === undefined ? null : labelNode(shot, ctx, set, sky.labelLeft, sky.labelTop, labelAt);
  const line = sky.segments.map((s, i) => segment(`${shot.id}.line${i}`, ctx, ...s));
  const nodes = [
    ...sunNodes(`${shot.id}.sun`, look, { ...sky.sun, at: undefined }), ...line,
    ...earthNodes(`${shot.id}.earth`, look, { cx: sky.earth.x, cy: sky.earth.y, unit }),
    ...lightNodes(`${shot.id}.light`, ctx, sky.light, times), figure.group, ...(label ? [label.node] : []),
  ];
  const boxes = { value: figure.box, ...(label ? { label: [sky.labelLeft, sky.labelTop, sky.labelWidth, label.bottom - sky.labelTop] } : {}) };
  if (shot.delta === undefined) return { nodes, boxes, hero: figure.hero };
  const deltaTop = (label ? label.bottom : sky.baseline) + DELTA_GAP * unit;
  const delta = parts.plainDelta(ctx, `${shot.id}.delta`, shot.delta, { left: sky.labelLeft, top: deltaTop, maxWidth: sky.labelWidth, at: labelAt + DELTA_LAG });
  return { nodes: [...nodes, ...delta.nodes], boxes: { ...boxes, delta: delta.box }, hero: figure.hero };
}
