// Easing for the v2 engine: ease(name) -> (p) => number, p in [0, 1].
// Names: linear; in|out|inOut + Quad|Cubic|Quart|Expo|Back; spring(<stiffness>,<damping>).
// Pure functions, no clock, no randomness: the same name always gives the same curve.
import { createRegistry } from '../registry.mjs';

const BACK_OVERSHOOT = 1.70158; // Penner's constant: about a 10% overshoot
const BACK_INOUT_SCALE = 1.525; // Penner's inOutBack widening of the overshoot
const EXPO_RATE = 10;

// The "in" curve of each family; "out" and "inOut" are derived from it by mirroring.
const IN_CURVES = {
  Quad: (p) => p ** 2,
  Cubic: (p) => p ** 3,
  Quart: (p) => p ** 4,
  Expo: (p) => (p === 0 ? 0 : 2 ** (EXPO_RATE * p - EXPO_RATE)),
  Back: (p) => (BACK_OVERSHOOT + 1) * p ** 3 - BACK_OVERSHOOT * p ** 2,
};

const mirrorOut = (easeIn) => (p) => 1 - easeIn(1 - p);
const mirrorInOut = (easeIn) => (p) => (p < 0.5 ? easeIn(2 * p) / 2 : 1 - easeIn(2 - 2 * p) / 2);

// inOutBack is not the plain mirror: its overshoot constant is scaled up.
function inOutBack(p) {
  const c2 = BACK_OVERSHOOT * BACK_INOUT_SCALE;
  if (p < 0.5) return ((2 * p) ** 2 * ((c2 + 1) * 2 * p - c2)) / 2;
  return ((2 * p - 2) ** 2 * ((c2 + 1) * (2 * p - 2) + c2) + 2) / 2;
}

const curves = createRegistry('ease');
curves.add('linear', (p) => p);
for (const [family, easeIn] of Object.entries(IN_CURVES)) {
  curves.add(`in${family}`, easeIn);
  curves.add(`out${family}`, mirrorOut(easeIn));
  curves.add(`inOut${family}`, family === 'Back' ? inOutBack : mirrorInOut(easeIn));
}

// ---- spring ----

const SPRING_FORM = 'spring(<stiffness>,<damping>)';
const SPRING_PATTERN = /^spring\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*\)$/;
const SETTLE_EPSILON = 1e-3; // the decay envelope the curve is stretched to reach at p = 1
const CRITICAL_BAND = 1e-6; // |damping ratio - 1| below this uses the critically damped form

// Unit step response of x'' = k(1 - x) - c x' (mass 1) at time t, from rest: 0 at t = 0, tends to 1.
function springStep(stiffness, damping) {
  const omega = Math.sqrt(stiffness);
  const zeta = damping / (2 * omega);
  if (Math.abs(zeta - 1) < CRITICAL_BAND) return (t) => 1 - Math.exp(-omega * t) * (1 + omega * t);
  if (zeta < 1) {
    const wd = omega * Math.sqrt(1 - zeta * zeta);
    const k = (zeta * omega) / wd;
    return (t) => 1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + k * Math.sin(wd * t));
  }
  // Overdamped: cosh/sinh written as two exponentials so a heavy damping ratio cannot overflow.
  const wd = omega * Math.sqrt(zeta * zeta - 1);
  const a = (zeta * omega) / wd;
  return (t) => 1 - ((1 + a) / 2) * Math.exp((wd - zeta * omega) * t) - ((1 - a) / 2) * Math.exp(-(wd + zeta * omega) * t);
}

// Slowest decay rate of the envelope: zeta*omega when underdamped, the slow root when overdamped.
function springDecayRate(stiffness, damping) {
  const omega = Math.sqrt(stiffness);
  const zeta = damping / (2 * omega);
  return zeta <= 1 ? zeta * omega : omega * (zeta - Math.sqrt(zeta * zeta - 1));
}

// Closed-form damped spring, stretched so its envelope has decayed to SETTLE_EPSILON at p = 1, then a
// linear correction of the remaining gap makes p = 1 land on exactly 1. p = 0 is already exactly 0.
function spring(stiffness, damping) {
  if (!(stiffness > 0) || !(damping > 0)) throw new Error(`spring stiffness and damping must be > 0, got ${stiffness},${damping}`);
  const step = springStep(stiffness, damping);
  const settleTime = Math.log(1 / SETTLE_EPSILON) / springDecayRate(stiffness, damping);
  const gap = 1 - step(settleTime);
  return (p) => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    return step(p * settleTime) + gap * p;
  };
}

function parseSpring(name) {
  const m = SPRING_PATTERN.exec(name);
  if (!m) throw new Error(`bad ease "${name}"; expected ${SPRING_FORM}`);
  return spring(Number(m[1]), Number(m[2]));
}

export function ease(name) {
  if (typeof name === 'string' && name.startsWith('spring(')) return parseSpring(name);
  return curves.get(name);
}
