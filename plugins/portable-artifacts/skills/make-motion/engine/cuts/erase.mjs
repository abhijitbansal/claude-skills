// The `erase` cut (looks-four Task 2): a board wiped clean by the hand. The outgoing board is wiped in PASSES overlapping
// horizontal passes, left to right, each a little after the one above; a wiped strip shows the paper with a faint
// seeded smear in the look's `rule` colour mixed into it (opaque, never a translucent ink), and the incoming board,
// already holding its first element, shows through where it is wiped. The hand rides the front of the pass in hand.
// A node cut: it composes two sampled frames (engine/cuts/index.mjs registers it). Pure and DOM-free.
//
// Not yet: the smear stays only inside the cut's window (SMEAR_SHARE of it), not for a time after it into the incoming
// shot; and the hand carries its marker, not an eraser.
// (OKLab, not shared/contrast.mjs mixHex: the page is served engine/ and only shared/errors.mjs, and every colour change
// here mixes in OKLab)
import { mixOklab } from '../color/oklab.mjs';
import { mulberry32 } from '../seeded.mjs';
import { pathPoints } from '../devices/shared.mjs';

export const ERASE = Object.freeze({ dur: 0.8, passes: 3, overlap: 0.25, lag: 0.25, sweep: 0.5, smear: 0.35, streaks: 5 });
const HAND_ID = 'hand';
const OVERSHOOT = 1.08; // a pass runs a little past the right edge, so nothing is left at its end

const clamp01 = (v) => Math.min(1, Math.max(0, v));
// How far pass k (0 at the top) has wiped at progress p, 0 to 1 of the canvas width.
export const passAt = (k, p) => clamp01((p - k * ERASE.lag) / ERASE.sweep) * OVERSHOOT;
// Pass k's band: [top, bottom] px, overlapping its neighbours by ERASE.overlap of a band.
const bandOf = (k, canvas) => {
  const h = canvas.h / ERASE.passes;
  return [k * h - ERASE.overlap * h, (k + 1) * h + ERASE.overlap * h];
};

const plainNode = (id, d, fill) => Object.freeze({
  type: 'path', id, depth: 0, props: Object.freeze({ d, fill }),
  x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, draw: 1, reveal: 1, blur: 0, visible: true, children: Object.freeze([]),
});

// The wiped strips and their smear at p: paper rectangles, and a few thin streaks of paper mixed with `rule`.
function wiped(p, canvas, look, seed) {
  const paper = look.palette.paper;
  const smear = mixOklab(paper, look.palette.rule, ERASE.smear);
  return Array.from({ length: ERASE.passes }, (_, k) => {
    const w = passAt(k, p) * canvas.w;
    if (w <= 0) return [];
    const [top, bottom] = bandOf(k, canvas);
    const rng = mulberry32(seed + k);
    const streaks = Array.from({ length: ERASE.streaks }, (_, i) => {
      const y = top + (bottom - top) * (0.15 + 0.7 * rng());
      const h = 2 + 4 * rng();
      return plainNode(`erase.smear${k}.${i}`, `M0 ${y}H${w}V${y + h}H0Z`, smear);
    });
    return [plainNode(`erase.wipe${k}`, `M0 ${top}H${w}V${bottom}H0Z`, paper), ...streaks];
  }).flat();
}

// A node's left edge and width in px (a text's first line, a polyline's points), or null when it cannot be read.
function spanOf(n) {
  if (n.type === 'text' && n.props.layout?.lines?.length) {
    const line = n.props.layout.lines[0];
    return [n.x + line.x, n.props.layout.width, n.y + line.y];
  }
  if (typeof n.props.d !== 'string' || !/\d/.test(n.props.d)) return null;
  const points = pathPoints(n.props.d);
  const xs = points.map((q) => q[0] + n.x), ys = points.map((q) => q[1] + n.y);
  return [Math.min(...xs), Math.max(...xs) - Math.min(...xs), (Math.min(...ys) + Math.max(...ys)) / 2];
}

// An incoming node shown only as far as its band's pass has wiped (its reveal).
function revealed(n, p, canvas) {
  const span = spanOf(n);
  if (!span) return passAt(ERASE.passes - 1, p) >= 1 ? n : null;
  const [left, width, mid] = span;
  const k = Math.min(ERASE.passes - 1, Math.max(0, Math.floor(mid / (canvas.h / ERASE.passes))));
  const share = width > 0 ? clamp01((passAt(k, p) * canvas.w - left) / width) : passAt(k, p) > 0 ? 1 : 0;
  return share <= 0 ? null : Object.freeze({ ...n, reveal: Math.min(n.reveal, share) });
}

// The hand on the front of the pass that leads at p, at the middle of its band.
function handOn(hand, p, canvas) {
  if (!hand) return [];
  const k = Array.from({ length: ERASE.passes }, (_, i) => i).findLast((i) => passAt(i, p) > 0 && passAt(i, p) < OVERSHOOT) ?? 0;
  const [top, bottom] = bandOf(k, canvas);
  return [Object.freeze({ ...hand, x: Math.min(canvas.w, passAt(k, p) * canvas.w), y: (top + bottom) / 2 })];
}

function eraseBlend({ from, to, p, canvas, look }) {
  const back = to.filter((n) => n.depth > 0);
  const ahead = to.filter((n) => !(n.depth > 0) && n.id !== HAND_ID);
  const seed = look?.seed ?? 0;
  return [
    ...back,
    ...from.filter((n) => !(n.depth > 0) && n.id !== HAND_ID),
    ...wiped(p, canvas, look, seed),
    ...ahead.map((n) => revealed(n, p, canvas)).filter(Boolean),
    ...handOn(to.find((n) => n.id === HAND_ID), p, canvas),
  ];
}

export const erase = Object.freeze({
  family: 'node',
  dur: ERASE.dur,
  summary: 'The board is wiped clean by the hand in three overlapping passes, left to right, over 0.8 s, and the next board, already holding its first element, shows through: the marker look\'s cut.',
  example: 'erase',
  directions: null,
  smearable: false,
  incomingOnly: false,
  apply(args) {
    const { from, to, p } = args;
    if (!Array.isArray(from) || !Array.isArray(to)) throw new Error('cut.apply needs from and to sampled frames');
    if (!Number.isFinite(p)) throw new Error(`cut.apply: p must be a finite number, got ${p}`);
    if (p <= 0) return from;
    if (p >= 1) return to;
    return eraseBlend(args);
  },
});
