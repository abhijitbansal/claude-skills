// The `cube` shader cut. Written in this repository for make-motion version 1 (template/gl-transitions.mjs, `gl-cube`)
// and moved here onto the gl-transitions contract (engine/cuts/shaders/index.mjs): a box turning about its centre, seen
// in perspective; the outgoing shot is its front face and the incoming one the face that swings round to replace it,
// moving the way `direction` names (edges.mjs). Same constants and maths as version 1: the uniforms come from derive() in JavaScript, and the
// body turns the contract's bottom-left uv into version 1's top-left pixel place before it starts. Pure and DOM-free.
import { ENTRY_EDGE } from '../edges.mjs';

const CUBE_FOCAL = 2.4; // camera distance from the screen plane, in half widths (half heights when it turns about the other axis)
const CUBE_PULL = 0.5; // how far the cube backs away from the screen at the middle of the turn, in the same unit
const CUBE_SHADE = 0.65; // how much darker a face is as it turns away (0.45 in version 1: the faces read alike, gate-cuts-1 P6)
const QUARTER_TURN = Math.PI / 2;
const DOUBLE = 2;

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// uSwap 1: the cube turns about the horizontal axis; uFlip 1: the incoming face comes from the right or the bottom. The
// edge each direction enters by is edges.mjs's (a cube up turns its new face in from the bottom, a cube left from the
// right). The default, right, turns the new face in from the left edge, the picture the cube always had by default.
const CUBE_ORDER = Object.freeze(['right', 'left', 'up', 'down']);
const DIRECTIONS = Object.freeze(Object.fromEntries(CUBE_ORDER.map((direction) => {
  const edge = ENTRY_EDGE[direction];
  return [direction, Object.freeze({ uSwap: edge === 'top' || edge === 'bottom' ? 1 : 0, uFlip: edge === 'right' || edge === 'bottom' ? 1 : 0 })];
})));

// The uniforms that move with progress, version 1's glUniforms: the turn, the pull, the shade of each face, and the
// face's extent across the turn in units of its extent along it.
function derive({ p, direction, canvas }) {
  const turn = QUARTER_TURN * clamp01(p);
  const vertical = direction === 'up' || direction === 'down';
  return {
    uSin: Math.sin(turn),
    uCos: Math.cos(turn),
    uPull: CUBE_PULL * Math.sin(DOUBLE * turn),
    uRatio: vertical ? canvas.w / canvas.h : canvas.h / canvas.w,
    uShadeFrom: 1 - CUBE_SHADE * Math.sin(turn),
    uShadeTo: 1 - CUBE_SHADE * Math.cos(turn),
  };
}

// Coordinates: s runs along the turn (the incoming face is at negative s), c across it, z toward the camera. The front
// face is at z = 1 when the turn is 0, so the picture is the outgoing shot exactly.
const SOURCE = `uniform float uFocal; // = 2.4
uniform float uSwap; // = 0.0
uniform float uFlip; // = 0.0
uniform float uSin;
uniform float uCos;
uniform float uPull;
uniform float uRatio;
uniform float uShadeFrom;
uniform float uShadeTo;

// A point of a face (hit.x along the turn from -1 to 1, hit.y across it from -uRatio to uRatio) as a top-left place in
// the picture.
vec2 faceUv(vec2 hit) {
  float primary = (hit.x * (uFlip > 0.5 ? -1.0 : 1.0) + 1.0) * 0.5;
  float across = hit.y / uRatio;
  return uSwap > 0.5 ? vec2((across + 1.0) * 0.5, primary) : vec2(primary, (1.0 - across) * 0.5);
}
// a top-left place as the contract's bottom-left uv
vec2 bottomLeft(vec2 f) { return vec2(f.x, 1.0 - f.y); }

vec4 transition(vec2 uv) {
  vec2 n = bottomLeft(uv) * 2.0 - 1.0;
  float s = (uSwap > 0.5 ? n.y : n.x) * (uFlip > 0.5 ? -1.0 : 1.0);
  float c = uSwap > 0.5 ? n.x * uRatio : -n.y * uRatio;
  float depth = uFocal + 1.0 + uPull;
  vec3 origin = vec3(-uSin * depth, 0.0, uCos * depth);
  vec3 dir = vec3(uCos * s + uSin * uFocal, c, uSin * s - uCos * uFocal);
  float best = 1.0e9;
  vec3 colour = uGround; // behind the box: the incoming shot's ground, never a black void (gate-cuts-1 P6)
  if (dir.z < 0.0) {
    float t = (1.0 - origin.z) / dir.z;
    vec2 hit = vec2(origin.x + t * dir.x, t * dir.y);
    if (t > 0.0 && abs(hit.x) <= 1.0 && abs(hit.y) <= uRatio) {
      best = t;
      colour = getFromColor(bottomLeft(faceUv(hit))).rgb * uShadeFrom;
    }
  }
  if (dir.x > 0.0) {
    float t = (-1.0 - origin.x) / dir.x;
    vec2 hit = vec2(origin.z + t * dir.z, t * dir.y);
    if (t > 0.0 && t < best && abs(hit.x) <= 1.0 && abs(hit.y) <= uRatio) {
      colour = getToColor(bottomLeft(faceUv(hit))).rgb * uShadeTo;
    }
  }
  return vec4(colour, 1.0);
}
`;

export const cube = Object.freeze({
  name: 'cube',
  source: SOURCE,
  params: Object.freeze({ uFocal: CUBE_FOCAL }),
  directions: DIRECTIONS,
  derive,
  standIn: 'wipe',
  license: null,
  summary: 'The shot turns away as one face of a box and the next one turns in moving the way the direction names: right (the default) comes in from the left edge, left from the right, up rolls the box up with the new face from below, down from above, over 0.6 s (WebGL2; a wipe without it).',
  example: { type: 'cube', direction: 'up' },
});
