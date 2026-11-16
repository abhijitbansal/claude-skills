// The `compare` kind in an editorial composition (desk): two taped paper cards across columns 1 to 12, side by side on a
// wide frame (look.kinds.compare.gap gutters apart) and stacked on a tall one, both the same size so unequal sides still
// balance. On each, `pad` in: the value as a numeral (when both sides have one: one size, one colour, neither styled as
// better), the title in the display face and the points in the text face, all sides at one size each: the largest
// title size from `titleMax` down that sets every title in at most `titleLines` lines and fits the card, with the points
// at `pointScale` times step `pointStep` in the display serif. The left card is on the desk from the first frame, the
// right one lands on the turn; from the turn the left one goes under a paper scrim at the look's focus dim, and a
// hand-drawn vs (versus) or an arrow (before-after) draws on between them. Pure, DOM-free.
import { registries } from '../registry.mjs';
import { node } from '../graph/node.mjs';
import { layoutText } from '../text/layout.mjs';
import { editorialSpan, editorialBounds } from './editorial.mjs';
import { landing, isHand, colourOf, smoothPath, polyline, pathPoints } from '../devices/shared.mjs';
import { CAP_HEIGHT, WORD_DESCENT, sizeAt, fontFor, isWide, setCase, enterTracks, unionBox, fitInBox, numeralLayout, cardOf, cardGroup } from './shared.mjs';
import { MIN_HERO_RATIO } from '../review/frame.mjs';
import { SIDES, valueText, hasValues, pointsText } from './compare-text.mjs';
import { paperScrim } from './shared.mjs';
import { slugBox, slugNodes } from './slug.mjs';

const EPSILON = 1e-6;
const HALF = 2;
const DEGREES_TO_RADIANS = Math.PI / 180;
const VS = Object.freeze({ height: 96, width: 1.5 }); // units, and the mark's width as a share of its height
// the vs strokes as shares of the mark's width (x) and height (y) from its top left: a v, then an s drawn from its top end
const VS_STROKES = Object.freeze({
  v: [[0, 0], [0.22, 1], [0.44, 0]],
  s: [[1, 0.12], [0.8, 0], [0.6, 0.22], [0.8, 0.5], [1, 0.78], [0.8, 1], [0.58, 0.9]],
});
const POINT_TITLE_RATIO = 2; // the title stays at least this many times the points
const DEFAULT_STROKE = 5; // units, when the look's arrow has no width
const DEFAULT_DIM = 0.55; // the scrim's opacity for a look whose devices name no focus dim (desk's own is 0.55)

// The points' size: data.pointScale times scale step data.pointStep (look review 2: they must read on the phone tile),
// never more than the title over POINT_TITLE_RATIO nor a numeral hero over MIN_HERO_RATIO. A side's title and points are
// one size class (props.stack), so the hero rule judges the card, not the points against its title.
function pointSize(look, data, { hero, title }, unit) {
  return Math.min(data.pointScale * sizeAt(look, data.pointStep, unit), title / POINT_TITLE_RATIO, hero > title ? hero / MIN_HERO_RATIO : Infinity);
}

// Both values on one line at one size: the largest up to valueMax that both fit `width`. A value is never set wider
// than its card (it would run onto the other one); under step data.valueFromStep the wider is flagged as overflowing,
// so the review says so. null without values.
function valueSet(shot, ctx, data, width) {
  if (!hasValues(shot)) return null;
  const { look, unit, measure } = ctx;
  const texts = SIDES.map((k) => setCase(look, 'display', valueText(shot[k].value)));
  const at = (size) => texts.map((text) => numeralLayout(text, fontFor(look, 'display', size, unit), measure)); // fixed digit advances
  const ref = at(data.valueMax * unit);
  const widest = Math.max(...ref.map((l) => l.width));
  const size = Math.min(data.valueMax * unit, Math.floor((data.valueMax * unit * width) / widest));
  const small = size < sizeAt(look, data.valueFromStep, unit) - EPSILON;
  const placed = at(size);
  const most = Math.max(...placed.map((l) => l.width));
  const layouts = placed.map((l) => (l.width <= width + EPSILON && !(small && l.width >= most - EPSILON) ? l : { ...l, overflow: true }));
  return { size, font: fontFor(look, 'display', size, unit), layouts };
}

// Each side's title and points laid out at title size `size`, and its content height (first cap line to last descent).
function sidesAt(shot, ctx, data, { size, width, values }) {
  const { look, unit, measure } = ctx;
  const titleFont = fontFor(look, 'display', size, unit);
  const hero = Math.max(size, values ? values.size : 0);
  // the points in the display serif (look review 2: the grotesque was a face used nowhere else)
  const pointFont = fontFor(look, 'display', pointSize(look, data, { hero, title: size }, unit), unit);
  return SIDES.map((k, i) => {
    const title = layoutText({ text: setCase(look, 'display', shot[k].title), font: titleFont, maxWidth: width, measure });
    const text = pointsText(shot[k]);
    const points = text === null ? null : layoutText({ text, font: pointFont, maxWidth: width, measure });
    const valueH = values ? CAP_HEIGHT * values.size + data.valueGap * values.size : 0;
    const titleH = CAP_HEIGHT * size + title.lines.at(-1).y - title.lines[0].y;
    const pointsH = points === null ? 0 : data.titleGap * size + CAP_HEIGHT * pointFont.size + points.lines.at(-1).y - points.lines[0].y;
    const descent = WORD_DESCENT * (points === null ? size : pointFont.size);
    return { key: k, title, points, titleFont, pointFont, value: values ? values.layouts[i] : null, height: valueH + titleH + pointsH + descent };
  });
}

// The largest title size that sets every title in data.titleLines lines and fits `height`; else the floor, flagged on
// the side with the most title lines.
function fitSides(shot, ctx, data, width, height) {
  const { look, unit } = ctx;
  const values = valueSet(shot, ctx, data, width);
  const hasPoints = SIDES.some((k) => pointsText(shot[k]) !== null);
  const floor = Math.max(sizeAt(look, data.titleFromStep, unit), hasPoints ? POINT_TITLE_RATIO * data.pointScale * sizeAt(look, data.pointStep, unit) : 0);
  const fits = (set) => set.every((s) => s.title.lines.length <= data.titleLines && s.title.width <= width + EPSILON && s.height <= height + EPSILON);
  // breaks by sense: the largest size with no title line of one word, else the largest that fits at all
  const noLone = (set) => set.every((s) => s.title.lines.length < HALF || s.title.lines.every((line) => line.words.length > 1));
  // under a numeral the title is the second voice: at most data.valueTitle of the numeral
  // never under its floor: a long value shrinks the numeral, not the title (so a title that fits is never flagged)
  const top = values === null ? data.titleMax * unit : Math.max(floor, Math.min(data.titleMax * unit, data.valueTitle * values.size));
  for (const accept of [(set) => fits(set) && noLone(set), fits]) {
    for (let size = Math.floor(top); size >= Math.ceil(floor); size--) {
      const set = sidesAt(shot, ctx, data, { size, width, values });
      if (accept(set)) return { values, sides: set };
    }
  }
  const set = sidesAt(shot, ctx, data, { size: Math.ceil(floor), width, values });
  const worst = set[0].title.lines.length >= set[1].title.lines.length ? 0 : 1;
  return { values, sides: set.map((s, i) => (i === worst ? { ...s, title: { ...s.title, overflow: true } } : s)) };
}

// The pictures' room at the top of each card: both sides share one height, `data.picture` of the content height, so
// their titles line up; each picture is fitted into the content width and that height. null when no side has one.
function pictureRoom(shot, ctx, data, width, height) {
  const sides = SIDES.filter((k) => shot[k].src !== undefined);
  if (sides.length === 0) return null;
  const fitted = Object.fromEntries(sides.map((k) => {
    return [k, fitInBox(ctx.asset(shot[k].src), width, data.picture * height)];
  }));
  return { fitted, h: Math.max(...Object.values(fitted).map((f) => f.h)), gap: data.pictureGap * ctx.unit };
}

// A side's picture at the top left of its card's content, in the card's centred space; none without one.
function sidePicture(shot, ctx, data, key, room, { w, h }) {
  const fit = room?.fitted[key];
  if (fit === undefined) return [];
  const pad = data.pad * ctx.unit;
  return [node('image', `${shot.id}.${key}.src`, { src: shot[key].src, w: fit.w, h: fit.h, x: -w / HALF + pad, y: -h / HALF + pad })];
}

// One side's text nodes in its card's centred space, all arriving at `at`, starting `top` under the content's top.
function sideTexts(shot, ctx, data, side, { w, h, at, top }) {
  const { look, unit } = ctx;
  const pad = data.pad * unit, ox = -w / HALF + pad;
  let cursor = -h / HALF + pad + top; // the next cap line
  const out = [];
  const copy = `${shot.id}.${side.key}.copy`; // the size class of a side's title and points
  const place = (id, layout, font, fill, role, stack) => {
    const y = cursor + CAP_HEIGHT * font.size - layout.lines[0].y;
    out.push(node('text', id, { x: ox, y, layout, font, fill, role, ...(stack ? { stack } : {}) }, { tracks: enterTracks(look, unit, at, { y }) }));
    return y + layout.lines.at(-1).y; // the last baseline
  };
  const id = `${shot.id}.${side.key}`;
  if (side.value !== null) cursor = place(`${id}.value`, side.value, fontFor(look, 'display', side.value.size, unit), look.palette.ink, 'hero') + data.valueGap * side.value.size;
  const grouped = side.points !== null && side.value === null ? copy : undefined;
  const last = place(`${id}.title`, side.title, side.titleFont, look.palette.ink, 'hero', grouped);
  if (side.points !== null) {
    cursor = last + data.titleGap * side.titleFont.size;
    place(`${id}.points`, side.points, side.pointFont, look.palette.ink, 'body', grouped);
  }
  return out;
}

// What the scrim covers: the card's paper and tape strips, each through its own place and turn, in the card's space.
function coverOf(card) {
  return card.children.filter((n) => n.id.endsWith('.paper') || n.props.tape === true).map((n) => pathPoints(n.props.d).map(([x, y]) => {
    const a = (n.props.rotate ?? 0) * DEGREES_TO_RADIANS, cos = Math.cos(a), sin = Math.sin(a);
    return [x * cos - y * sin + (n.props.x ?? 0), x * sin + y * cos + (n.props.y ?? 0)];
  }));
}

// The unspoken side's dim: a scrim of the look's paper over the whole card, its paper and tape as one path (one outline
// each, nonzero, so the tape over the paper is not dimmed twice), rising to the look's focus dim over the look's draw
// move from `at`. The clipping's paper scrim (region-mark.mjs paperScrim) but whole and at the look's own strength: the
// clipping's 0.8 left the dimmed side unreadable on the phone tile (viewed on the rendered sheets).
// The left card goes under it from the turn; the right card is under it from frame 0 and comes out at the turn (look
// review 1: an empty half for two seconds left the frame unbalanced; the unspoken side is already the dimmed state).
function dimScrim(id, card, look, at, { lifts = false } = {}) {
  const { dur, ease } = look.moves.draw;
  const dim = look.devices.focus?.dim ?? DEFAULT_DIM;
  const [from, opacity] = lifts ? [dim, 0] : [0, dim];
  return paperScrim({ id: `${id}.scrim`, cover: coverOf(card), at: at + dur, dur, ease, from, opacity, look });
}

// The cards' boxes: side by side on a wide frame, stacked on a tall one, centred.
function cardBoxes(ctx, data, height, below = 0) {
  const { look, canvas, unit } = ctx;
  const span = editorialSpan(ctx, 1, look.grid.columns);
  const gap = data.gap * look.grid.gutter * unit, margin = Math.max(look.grid.margin * unit, below);
  if (isWide(canvas)) {
    const w = (span.w - gap) / HALF;
    const top = Math.max(margin, Math.min(data.centre * canvas.h - height / HALF, canvas.h - margin - height));
    return [[span.x, top, w, height], [span.x + w + gap, top, w, height]];
  }
  // on a tall frame in the platform safe zone: centred in the composition band (editorial.mjs)
  const bounds = editorialBounds(ctx);
  const top = bounds.safe
    ? Math.max(bounds.top, below, bounds.at(data.centre) - (HALF * height + gap) / HALF)
    : Math.max(margin, (canvas.h - (HALF * height + gap)) / HALF);
  return [[span.x, top, span.w, height], [span.x, top + height + gap, span.w, height]];
}

// The hand-drawn vs centred on (cx, cy), drawing on from `at` at the look's hand rate.
function versusMark(id, ctx, [cx, cy], at) {
  const { look, unit } = ctx;
  const style = look.devices.arrow ?? {};
  const h = VS.height * unit, w = h * VS.width, top = cy - h / HALF, left = cx - w / HALF;
  const [v, s] = [VS_STROKES.v, VS_STROKES.s].map((points) => points.map(([x, y]) => [left + w * x, top + h * y]));
  const step = isHand(look) ? look.moves.draw.step : undefined;
  const props = { stroke: colourOf(look, style.color ?? 'accent2'), strokeWidth: (style.width ?? DEFAULT_STROKE) * unit, lineCap: isHand(look) ? 'round' : 'butt' };
  const draw = landing(at + look.moves.draw.dur, look.moves.draw, 0, 1, step);
  return [
    node('path', `${id}.vs.v`, { ...props, d: isHand(look) ? smoothPath(v) : polyline(v) }, { tracks: { draw }, step }),
    node('path', `${id}.vs.s`, { ...props, d: isHand(look) ? smoothPath(s) : polyline(s) }, { tracks: { draw }, step }),
  ];
}

// Between the cards: the vs or the arrow, from the turn.
function betweenMarks(shot, ctx, [a, b], turn) {
  const { look, unit, seed, canvas } = ctx;
  const wide = isWide(canvas);
  if (shot.mode !== 'before-after') {
    const centre = wide ? [(a[0] + a[2] + b[0]) / HALF, a[1] + a[3] / HALF] : [a[0] + a[2] / HALF, (a[1] + a[3] + b[1]) / HALF];
    return versusMark(shot.id, ctx, centre, turn);
  }
  const inset = look.grid.gutter * unit;
  const from = wide ? [a[0] + a[2] - inset, a[1] + a[3] / HALF] : [a[0] + a[2] / HALF, a[1] + a[3] - inset];
  return registries.devices.get('arrow').build({ id: `${shot.id}.arrow`, box: b, at: turn + look.moves.draw.dur, look, unit, seed, from }).nodes;
}

/** The desk compare: { nodes, boxes, group } with the group (both cards) carrying the hero id. */
export function expandDeskCompare(shot, ctx, data, turn, hero) {
  const { look, canvas, unit, seed } = ctx;
  const wide = isWide(canvas);
  const margin = look.grid.margin * unit, gap = data.gap * look.grid.gutter * unit, pad = data.pad * unit;
  const span = editorialSpan(ctx, 1, look.grid.columns);
  const cardW = wide ? (span.w - gap) / HALF : span.w;
  // a slug (the shot's kicker) takes the top: the cards start a gutter under it
  const slug = slugBox(shot, ctx);
  const below = slug === null ? 0 : slug.inked[1] + slug.inked[3] + look.grid.gutter * unit;
  const bounds = editorialBounds(ctx);
  const lost = Math.max(0, below - margin);
  // the height the cards share: the frame less its margins, or, in the platform safe zone, the composition band
  const band = bounds.bottom - Math.max(bounds.top, below);
  const avail = bounds.safe
    ? (wide ? band : (band - gap) / HALF) - HALF * pad
    : (wide ? canvas.h - HALF * margin - lost : (canvas.h - HALF * margin - gap - lost) / HALF) - HALF * pad;
  const room = pictureRoom(shot, ctx, data, cardW - HALF * pad, avail);
  const top = room === null ? 0 : room.h + room.gap;
  const set = fitSides(shot, ctx, data, cardW - HALF * pad, avail - top);
  const boxes = cardBoxes(ctx, data, Math.max(...set.sides.map((s) => s.height)) + top + HALF * pad, below);
  const cards = set.sides.map((side, i) => {
    const id = `${shot.id}.${side.key}`, at = 0; // both cards from frame 0, the unspoken one dimmed
    const card = cardOf(ctx, id, boxes[i], at);
    const size = { w: boxes[i][2], h: boxes[i][3] };
    const texts = sideTexts(shot, ctx, data, side, { ...size, at, top });
    const picture = sidePicture(shot, ctx, data, side.key, room, size);
    const scrim = [dimScrim(id, card, look, turn, { lifts: i === 1 })];
    return cardGroup(card, id, [...picture, ...texts, ...scrim]);
  });
  const group = node('group', hero, {}, { children: cards });
  return { nodes: [...slugNodes(shot, ctx), group, ...betweenMarks(shot, ctx, boxes, turn)], boxes: { left: boxes[0], right: boxes[1], sides: unionBox(boxes) } };
}
