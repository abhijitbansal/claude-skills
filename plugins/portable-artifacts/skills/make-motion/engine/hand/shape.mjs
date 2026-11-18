// The drawing hand's picture (looks-four Task 2): point lists drawn as path nodes with role 'hand', the marker's tip at
// the origin. look.hand.shape picks 'hand' (a hand in a tripod grip holding a chisel marker) or 'tip' (the fallback the
// kill rule names: the marker's chisel nib and the start of its barrel alone). The hand's outline is the version 1
// hand's (template/sketch/hand.mjs BODY and fingers, original line art) sampled into point lists here; the pencil is
// replaced by a marker. The drawing's units are scaled by HAND_SCALE * look.hand.scale units. Pure and DOM-free.
import { node } from '../graph/node.mjs';
import { colourOf, polyline } from '../devices/shared.mjs';

const HAND_SCALE = 0.4; // drawing units to units at look.hand.scale 1 (version 1's HAND_BASE_SCALE)
const CURVE_STEPS = 10; // points on each cubic of the outlines
const OUTLINE = 9; // drawing units: the hand's outline
const CREASE = 6;
const MARKER_TILT = -4.2; // degrees the marker sits off the drawing's x axis (the version 1 pencil's)
const TIP_SHAPE = 'tip';

// Version 1's drawing, back to front: the hand, the pocket behind the marker, its creases; then the fingers over it.
const BODY = 'M96 -48 C90 -75 105 -110 128 -135 C148 -165 175 -195 205 -215 C235 -238 270 -250 305 -246 C345 -240 385 -238 420 -240 C470 -248 530 -252 565 -215 C590 -185 615 -130 640 -80 C660 -30 700 70 756 118 C767 128 767 137 758 146 C716 186 668 232 628 281 C620 291 610 295 598 289 C560 270 470 225 380 190 C330 170 290 165 250 158 C205 148 150 120 112 78 C92 58 92 40 104 25 L110 -30 Z';
const POCKET = 'M180 -30 C192 -70 225 -120 265 -135 C305 -128 360 -122 398 -138 C412 -100 415 -60 400 -25 Z';
const CREASES = Object.freeze(['M262 -135 C300 -124 360 -120 398 -140', 'M255 -28 C258 -62 285 -92 330 -92 C362 -90 390 -70 402 -40', 'M398 -140 C412 -100 415 -62 402 -30']);
const INDEX = 'M96 -48 C90 -75 105 -110 128 -135 L265 -135 C225 -120 192 -82 178 -62 C160 -44 130 -30 110 -32 C100 -34 97 -40 96 -48 Z';
const INDEX_EDGE = 'M128 -135 C105 -110 90 -75 96 -48 C97 -40 100 -34 110 -32 C130 -30 160 -44 178 -62 C192 -82 225 -120 265 -135 C275 -150 285 -160 300 -172';
const THUMB = 'M104 25 C92 40 92 58 112 78 C150 120 205 148 250 158 L270 60 L262 32 C230 18 190 8 150 10 C128 12 112 16 104 25 Z';
const THUMB_EDGE = 'M250 158 C205 148 150 120 112 78 C92 58 92 40 104 25 C112 16 128 12 150 10 C190 8 230 18 262 32';
const THUMB_CREASE = 'M248 108 C256 85 254 62 240 44';
// the marker, along +x from the tip: a chisel nib (its flat edge at the tip), a grip band, the barrel and the cap end
const NIB = Object.freeze([[-2, -11], [-2, 11], [110, 36], [110, -36]]);
const GRIP = Object.freeze([[110, -40], [110, 40], [190, 40], [190, -40]]);
const BARREL = Object.freeze([[190, -42], [190, 42], [880, 42], [880, -42]]);
const CAP = Object.freeze([[880, -46], [880, 46], [950, 46], [960, 0], [950, -46]]);
const STUB = Object.freeze([[110, -40], [110, 40], [300, 40], [300, -40]]); // the fallback's barrel: short, no hand

const NUMBER = /-?\d*\.?\d+/g;

// The points of an absolute M/L/C/Z path, each cubic sampled at CURVE_STEPS; a Z closes back to the first point.
function sample(d) {
  const points = [];
  for (const [, cmd, args] of d.matchAll(/([MLCZ])([^MLCZ]*)/g)) {
    const n = (args.match(NUMBER) ?? []).map(Number);
    if (cmd === 'Z') points.push([...points[0]]);
    else if (cmd === 'C') {
      const p0 = points.at(-1);
      for (let i = 1; i <= CURVE_STEPS; i++) points.push(cubicAt(p0, [n[0], n[1]], [n[2], n[3]], [n[4], n[5]], i / CURVE_STEPS));
    } else points.push([n[0], n[1]]);
  }
  return points;
}

function cubicAt(p0, c1, c2, p1, t) {
  const m = 1 - t;
  const f = (i) => m * m * m * p0[i] + 3 * m * m * t * c1[i] + 3 * m * t * t * c2[i] + t * t * t * p1[i];
  return [f(0), f(1)];
}

const turned = (points, degrees) => {
  const r = (degrees * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return points.map(([x, y]) => [x * c - y * s, x * s + y * c]);
};
const closed = (points) => [...points, [...points[0]]];

// Every part as { id, points, fill?, stroke?, width } in drawing units, back to front.
function parts(shape) {
  const marker = (list) => closed(turned(list, MARKER_TILT));
  const tip = [
    { id: 'nib', points: marker(NIB), fill: 'nib', stroke: 'outline', width: CREASE },
    { id: 'grip', points: marker(GRIP), fill: 'cap', stroke: 'outline', width: OUTLINE },
  ];
  if (shape === TIP_SHAPE) return [...tip, { id: 'stub', points: marker(STUB), fill: 'barrel', stroke: 'outline', width: OUTLINE }];
  return [
    { id: 'body', points: sample(BODY), fill: 'skin', stroke: 'outline', width: OUTLINE },
    { id: 'pocket', points: sample(POCKET), fill: 'shade' },
    ...CREASES.map((d, i) => ({ id: `crease${i}`, points: sample(d), stroke: 'outline', width: CREASE })),
    { id: 'barrel', points: marker(BARREL), fill: 'barrel', stroke: 'outline', width: OUTLINE },
    { id: 'cap', points: marker(CAP), fill: 'cap', stroke: 'outline', width: OUTLINE },
    ...tip,
    { id: 'index', points: sample(INDEX), fill: 'skin' },
    { id: 'indexEdge', points: sample(INDEX_EDGE), stroke: 'outline', width: OUTLINE },
    { id: 'thumb', points: sample(THUMB), fill: 'skin' },
    { id: 'thumbEdge', points: sample(THUMB_EDGE), stroke: 'outline', width: OUTLINE },
    { id: 'thumbCrease', points: sample(THUMB_CREASE), stroke: 'outline', width: CREASE },
  ];
}

/** The hand's outline in px about the tip (the body's, or the fallback's barrel), for the cover and edge findings. */
export function handOutline(look, unit) {
  const k = HAND_SCALE * (look.hand.scale ?? 1) * unit;
  const outer = look.hand.shape === TIP_SHAPE ? parts(TIP_SHAPE).flatMap((p) => p.points) : [...sample(BODY), ...closed(turned(CAP, MARKER_TILT))];
  return outer.map(([x, y]) => [x * k, y * k]);
}

// ---- the eraser (m5, gate-marker-2 ruling 1): the same hand holding a felt board eraser instead of the marker ----
const ERASER_HAND = 1; // the hand is drawn at the marker hand's own size over the eraser (m6, gate-marker-3: at 1.25 it read as a second, larger hand)
const ERASER_CORNER = 0.16; // of the short side: the eraser's rounded corners
const FELT_SHARE = 0.2; // of the short side: the felt strip along its lower edge
const ERASER_HAND_AT = Object.freeze([0.08, -0.22]); // the body's centre, as shares of the eraser's [long, short] sides from its centre
const BODY_CENTRE = Object.freeze([430, 20]); // the body's centre in drawing units
const HAND_PART_IDS = Object.freeze(['body', 'pocket', 'crease0', 'crease1', 'crease2', 'index', 'indexEdge', 'thumb', 'thumbEdge', 'thumbCrease']);
const CORNER_STEPS = 6;

// A rounded rectangle about the origin as a closed point list.
function roundedBox(w, h, r) {
  const corners = [[w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, 90], [-w / 2 + r, -h / 2 + r, 180], [w / 2 - r, -h / 2 + r, 270]];
  const points = corners.flatMap(([cx, cy, from]) => Array.from({ length: CORNER_STEPS + 1 }, (_, i) => {
    const a = ((from + (90 * i) / CORNER_STEPS) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  }));
  return [...points, [...points[0]]];
}

function eraserNodes(look, unit, [long, short]) {
  const colours = look.hand.colours;
  const k = HAND_SCALE * (look.hand.scale ?? 1) * unit * ERASER_HAND;
  const [ax, ay] = [ERASER_HAND_AT[0] * long, ERASER_HAND_AT[1] * short];
  const r = ERASER_CORNER * short;
  const stroke = (width) => ({ stroke: colourOf(look, colours.outline), strokeWidth: width, lineCap: 'round' });
  const felt = roundedBox(long, short * FELT_SHARE, r * 0.5).map(([x, y]) => [x, y + short * (0.5 - FELT_SHARE / 2)]);
  const eraser = [
    node('path', 'hand.eraser', { d: polyline(roundedBox(long, short, r)), role: 'hand', fill: colourOf(look, colours.eraser ?? colours.barrel), ...stroke(OUTLINE * k) }),
    node('path', 'hand.felt', { d: polyline(felt), role: 'hand', fill: colourOf(look, colours.felt ?? colours.outline), ...stroke(CREASE * k) }),
  ];
  const hand = parts('hand').filter((p) => HAND_PART_IDS.includes(p.id)).map((p) => node('path', `hand.${p.id}`, {
    d: polyline(p.points.map(([x, y]) => [(x - BODY_CENTRE[0]) * k + ax, (y - BODY_CENTRE[1]) * k + ay])),
    role: 'hand',
    ...(p.fill ? { fill: colourOf(look, colours[p.fill]) } : {}),
    ...(p.stroke ? { ...stroke(p.width * k) } : {}),
  }));
  return [...eraser, ...hand];
}

/**
 * The hand's path nodes, the marker's tip at the origin, in px for `unit`; each with role 'hand'. `tool` { tool: 'eraser',
 * size: [long, short] px }: the hand holds a board eraser of that size, centred on the origin, instead of the marker.
 */
export function handNodes(look, unit, tool = null) {
  if (tool?.tool === 'eraser') return eraserNodes(look, unit, tool.size);
  const k = HAND_SCALE * (look.hand.scale ?? 1) * unit;
  const colours = look.hand.colours;
  return parts(look.hand.shape).map((p) => node('path', `hand.${p.id}`, {
    d: polyline(p.points.map(([x, y]) => [x * k, y * k])),
    role: 'hand',
    ...(p.fill ? { fill: colourOf(look, colours[p.fill]) } : {}),
    ...(p.stroke ? { stroke: colourOf(look, colours[p.stroke]), strokeWidth: p.width * k, lineCap: 'round' } : {}),
  }));
}
