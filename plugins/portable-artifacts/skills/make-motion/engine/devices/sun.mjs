// The look's light source (look.sun, cosmos): one sun, drawn as light everywhere it appears. A small disc with a hot
// near-white core, a gold body and a gold limb at its edge, and past the limb a bloom that falls smoothly to nothing:
// all stops of one radial gradient (draw.mjs props.radial), no blur filter. The statement, number and end kinds put it
// on one anchored place per format (sunAnchor: frame-left on a wide frame, high and centred on a tall one), so every
// cut shows the same sky; the list puts it at its path's start; the compare's large disc is the same sun at scale
// (sunBody). Not a registered device (no event places it, so it needs no sound). Pure and DOM-free.
//
// look.sun: { core, color, limb (#rrggbb: the core, the body's gold, the limb), disc (the disc's share of the light's
// radius), bloom (the bloom's alpha just past the limb), lift (seconds to light up), anchor: { wide, tall: { x, y
// (shares of the frame), r (the light's radius, units) } }, body: { bloom (the large disc's bloom, a share of its
// radius) } }.
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';
import { isWide } from '../kinds/shared.mjs';
import { editorialSpan } from '../kinds/editorial.mjs';

const KAPPA = 0.5523; // cubic Bezier circle
const ROUND = 100;
const CORE_HOLD = 0.45; // of the disc: the core held near-white this far out
const BODY_GOLD = 0.85; // of the disc: gold from here to the limb
const LIMB_BLOOM = 0.04; // past the limb (share of the radius): the bloom starts here
const FALL = 0.4; // of the bloom's run: where it has fallen to FALL_ALPHA of its start
const FALL_ALPHA = 0.3;
const BODY_CORE = 0.6; // the large disc: the core colour fades to gold by this share of its radius
const BODY_LIMB = 0.97;

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

// The light's stops: the disc at full strength (core, gold body, gold limb), then the bloom times `strength`.
function lightStops(sun, strength) {
  const { core, color, limb, disc, bloom } = sun;
  const b = bloom * strength;
  return [
    [0, 1, core], [CORE_HOLD * disc, 1, core], [BODY_GOLD * disc, 1, color], [disc, 1, limb],
    [disc + LIMB_BLOOM, b, color], [disc + LIMB_BLOOM + FALL * (1 - disc - LIMB_BLOOM), b * FALL_ALPHA, color], [1, 0, color],
  ];
}

/**
 * The sun at (cx, cy), its light reaching r px (the disc look.sun.disc of that), its bloom times `strength`, lighting up
 * from `at` over the look's lift (absent `at`: lit from frame 0). [] for a look without one.
 */
export function sunNodes(id, look, { cx, cy, r, strength = 1, at }) {
  if (!hasSun(look)) return [];
  const radial = { r, color: look.sun.color, stops: lightStops(look.sun, strength) };
  const tracks = at === undefined ? {} : { opacity: track([{ t: 0, v: 0 }, { t: at, v: 0 }, { t: at + look.sun.lift, v: 1, ease: 'outCubic' }]) };
  return [node('path', id, { d: circlePath(r), x: cx, y: cy, radial, furniture: true }, { tracks })];
}

/**
 * The same sun as a large body of radius r px at (cx, cy) (the compare's star at scale): gold from its first frame, a
 * soft inner gradient toward the core colour, the gold limb at its edge and a bloom past it. [bloom, body].
 */
export function sunBody(id, look, { cx, cy, r }) {
  const { core, color, limb, bloom } = look.sun;
  const reach = r * (1 + look.sun.body.bloom);
  const glow = { r: reach, color, stops: [[0, bloom, color], [r / reach, bloom, color], [r / reach + FALL * (1 - r / reach), bloom * FALL_ALPHA, color], [1, 0, color]] };
  const body = { r, color, stops: [[0, 1, core], [BODY_CORE, 1, color], [BODY_LIMB, 1, color], [1, 1, limb]] };
  return [
    node('path', `${id}.bloom`, { d: circlePath(reach), x: cx, y: cy, radial: glow, furniture: true }),
    node('path', id, { d: circlePath(r), x: cx, y: cy, radial: body, furniture: true }),
  ];
}
