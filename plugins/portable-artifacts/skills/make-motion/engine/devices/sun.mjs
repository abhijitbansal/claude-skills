// The look's light source (look.sun, cosmos): one sun, drawn as light everywhere it appears. A small disc with a hot
// near-white core, a gold body and a gold limb at its edge, and past the limb a bloom that falls smoothly to nothing:
// all stops of one radial gradient (draw.mjs props.radial), no blur filter. The statement, number and end kinds put it
// on one anchored place per format (sunAnchor: frame-left on a wide frame, high and centred on a tall one), so every
// cut shows the same sky; the list puts it at its path's start; the compare's large disc is the same sun at scale
// (sunBody). Not a registered device (no event places it, so it needs no sound). Pure and DOM-free.
//
// look.sun: { base (the accent the light colours are designed against), core, color, limb (#rrggbb: the core, the
// body's gold, the limb), disc (the disc's share of the light's radius), bloom (the bloom's alpha just past the limb),
// lift (seconds to light up), anchor: { wide, tall: { x, y (shares of the frame), r (the light's radius, units) } },
// body: { bloom (the large disc's bloom, a share of its radius) } }.
// The sun lights by growing from a point at full strength (a scale track), never by an opacity fade: a half-faded disc
// of light over the navy read as a grey planet on the sheets (gate review 3). A film's accent override moves every light
// colour by the same OKLab offset (lightColour), so the sun and the glyph glow follow it.
// look.earth (earthNodes): { color, ring (palette keys or #rrggbb), r, gap, width (units: the dot's radius, the ring's
// gap and stroke) }: the one Earth mark, a small blue dot with a ring, wherever Earth is drawn.
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';
import { toOklab, fromOklab } from '../color/oklab.mjs';
import { isWide } from '../kinds/shared.mjs';
import { editorialSpan } from '../kinds/editorial.mjs';
import { colourOf } from './shared.mjs';

const KAPPA = 0.5523; // cubic Bezier circle
const ROUND = 100;
const CORE_HOLD = 0.45; // of the disc: the core held near-white this far out
const BODY_GOLD = 0.85; // of the disc: gold from here to the limb
const LIMB_BLOOM = 0.04; // past the limb (share of the radius): the bloom starts here
const FALL = 0.4; // of the bloom's run: where it has fallen to FALL_ALPHA of its start
const FALL_ALPHA = 0.3;
// The large disc, as shares of the depth of it on screen (`visible`, from its near edge in): the core colour held from
// the far side of what shows, gold from about half way, the deeper limb at the edge.
const LARGE_CORE = 0.9;
const LARGE_GOLD = 0.45;
const LARGE_LIMB = 0.08;
const LIFT_EASE = 'outCubic';
const sameHex = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

/**
 * A light colour (#rrggbb) of the look as the film's accent has it: the colour itself under the look's own accent
 * (look.sun.base), else moved by the same OKLab offset the accent moved. A look without a sun keeps its colours.
 */
export function lightColour(look, hex) {
  const base = look.sun?.base;
  if (base === undefined || sameHex(base, look.palette.accent)) return hex;
  const [from, to, c] = [toOklab(base), toOklab(look.palette.accent), toOklab(hex)];
  return fromOklab(c.map((v, i) => v + to[i] - from[i]));
}

// A circle of radius r about the origin, as a path.
export function circlePath(r) {
  const k = KAPPA * r;
  const p = (x, y) => `${Math.round(x * ROUND) / ROUND} ${Math.round(y * ROUND) / ROUND}`;
  return `M${p(0, -r)}C${p(k, -r)} ${p(r, -k)} ${p(r, 0)}C${p(r, k)} ${p(k, r)} ${p(0, r)}C${p(-k, r)} ${p(-r, k)} ${p(-r, 0)}C${p(-r, -k)} ${p(-k, -r)} ${p(0, -r)}Z`;
}

/** Does the look carry a light source? */
export const hasSun = (look) => look.sun !== undefined;

/**
 * The sun's anchored place for this frame's format: { cx, cy, r } px (r the light's radius, bloom included). On a wide
 * frame x is a share of the frame's width; on a tall one, of the composition's safe width (so a centred sun stands over
 * the content, clear of the platform's right rail). y is a share of the frame's height.
 */
export function sunAnchor(look, ctx) {
  const { canvas, unit } = ctx;
  if (isWide(canvas)) return { cx: look.sun.anchor.wide.x * canvas.w, cy: look.sun.anchor.wide.y * canvas.h, r: look.sun.anchor.wide.r * unit };
  const at = look.sun.anchor.tall, span = editorialSpan(ctx, 1, look.grid.columns);
  return { cx: span.x + at.x * span.w, cy: at.y * canvas.h, r: at.r * unit };
}

/**
 * The columns a text beside the sun takes on a wide frame: from the first column that starts look.sun.clear of the
 * light's radius right of the sun's centre to the last ({ x, w, from } px and the first column), so the sun keeps a
 * column of its own (gate review 3: a statement set from column 2 ran into its glow).
 */
export function besideSun(look, ctx) {
  const sun = sunAnchor(look, ctx);
  const edge = sun.cx + look.sun.clear * sun.r;
  const { columns } = look.grid;
  const from = Array.from({ length: columns }, (_, i) => i + 1).find((c) => editorialSpan(ctx, c, columns).x >= edge) ?? columns;
  return { ...editorialSpan(ctx, from, columns), from };
}

/**
 * The highest a text may start under the sun on a tall frame (px): look.sun.clear of the light's radius under its
 * centre, past the disc and the bright bloom (a hook set into the bloom fell under 3:1 once its words lit).
 */
export function belowSun(look, ctx) {
  const sun = sunAnchor(look, ctx);
  return sun.cy + look.sun.clear * sun.r;
}

// The light's stops: the disc at full strength (core, gold body, gold limb), then the bloom times `strength`.
// The look's light colours under the film's accent.
const lightsOf = (look) => {
  const { core, color, limb } = look.sun;
  return { core: lightColour(look, core), color: lightColour(look, color), limb: lightColour(look, limb) };
};

function lightStops(look, strength) {
  const { core, color, limb } = lightsOf(look);
  const { disc, bloom } = look.sun;
  const b = bloom * strength;
  return [
    [0, 1, core], [CORE_HOLD * disc, 1, core], [BODY_GOLD * disc, 1, color], [disc, 1, limb],
    [disc + LIMB_BLOOM, b, color], [disc + LIMB_BLOOM + FALL * (1 - disc - LIMB_BLOOM), b * FALL_ALPHA, color], [1, 0, color],
  ];
}

/**
 * The sun at (cx, cy), its light reaching r px (the disc look.sun.disc of that), its bloom times `strength`, lighting up
 * from `at` by growing from a point over the look's lift (absent `at`: lit from frame 0). [] for a look without one.
 */
export function sunNodes(id, look, { cx, cy, r, strength = 1, at }) {
  if (!hasSun(look)) return [];
  const radial = { r, color: lightColour(look, look.sun.color), stops: lightStops(look, strength) };
  const tracks = at === undefined ? {} : { scale: track([{ t: 0, v: 0 }, { t: at, v: 0 }, { t: at + look.sun.lift, v: 1, ease: LIFT_EASE }]) };
  return [node('path', id, { d: circlePath(r), x: cx, y: cy, radial, furniture: true }, { tracks })];
}

/**
 * The same sun as a large body of radius r px at (cx, cy) (the compare's star at scale), `visible` px of it on screen
 * from its near edge in: across that depth it runs from the core colour through the gold to the deeper limb at its edge
 * (the light model of the small sun, scaled up), with a bloom past it. [bloom, body].
 */
export function sunBody(id, look, { cx, cy, r, visible = r }) {
  const { core, color, limb } = lightsOf(look);
  const { bloom } = look.sun;
  const reach = r * (1 + look.sun.body.bloom);
  const depth = Math.min(1, Math.max(0, visible / r));
  const glow = { r: reach, color, stops: [[0, bloom, color], [r / reach, bloom, color], [r / reach + FALL * (1 - r / reach), bloom * FALL_ALPHA, color], [1, 0, color]] };
  const body = { r, color, stops: [[0, 1, core], [1 - LARGE_CORE * depth, 1, core], [1 - LARGE_GOLD * depth, 1, color], [1 - LARGE_LIMB * depth, 1, color], [1, 1, limb]] };
  return [
    node('path', `${id}.bloom`, { d: circlePath(reach), x: cx, y: cy, radial: glow, furniture: true }),
    node('path', id, { d: circlePath(r), x: cx, y: cy, radial: body, furniture: true }),
  ];
}

/** How far the Earth mark reaches from its centre, px (the dot, its ring's gap and stroke). */
export const earthReach = (look, unit) => (look.earth.r + look.earth.gap + look.earth.width) * unit;

/**
 * The Earth mark at (cx, cy): a group holding its ring and its blue dot (look.earth), with `tracks` on the group. [] for
 * a look without one.
 */
export function earthNodes(id, look, { cx, cy, unit, tracks = {} }) {
  if (look.earth === undefined) return [];
  const { r, gap, width } = look.earth;
  return [node('group', id, { x: cx, y: cy }, {
    tracks,
    children: [
      node('path', `${id}.ring`, { d: circlePath((r + gap) * unit), stroke: colourOf(look, look.earth.ring), strokeWidth: width * unit }),
      node('path', `${id}.dot`, { d: circlePath(r * unit), fill: colourOf(look, look.earth.color) }),
    ],
  })];
}
