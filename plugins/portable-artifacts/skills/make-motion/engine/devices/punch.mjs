// The `punch` device: an instant scale-up on a word or a cut. It draws nothing; it returns camera keys to merge
// into the shot camera: zoom 1 a millisecond before `at` (so it jumps instead of ramping from an earlier key), the
// peak zoom on `at`, and back to 1 with an exponential ease-out. The peak and the return time come from the look's
// `devices.punch` entry (`scale`, `dur`) and are 1.12 and 0.12 s when the look has none. A look supports it when it
// is supported by the usual rule (a `devices.punch` entry), or when its cuts include `punch`, or when its emphasis
// move is a spring. Pure and DOM-free.
import { checkParams, styleOf, styledBy } from './shared.mjs';

const DEFAULT_ZOOM = 1.12;
const DEFAULT_RETURN = 0.12; // seconds
const LEAD_IN = 0.001; // seconds: the zoom-1 key sits this far before `at`
const TIME_DECIMALS = 1e6; // key times are rounded to a microsecond, so float noise cannot move them
const SPRING_EASE = /^spring\(/;

const roundTime = (t) => Math.round(t * TIME_DECIMALS) / TIME_DECIMALS;

function buildPunch(params) {
  const { at, look } = checkParams('punch', params);
  const { scale = DEFAULT_ZOOM, dur = DEFAULT_RETURN } = styleOf(look, 'punch');
  return {
    nodes: [],
    camera: [
      { t: Math.max(0, roundTime(at - LEAD_IN)), zoom: 1 },
      { t: at, zoom: scale, ease: 'linear' },
      { t: roundTime(at + dur), zoom: 1, ease: 'outExpo' },
    ],
  };
}

export const punch = Object.freeze({
  name: 'punch',
  supports: (look) => styledBy('punch')(look) || look.cuts.includes('punch') || SPRING_EASE.test(look.moves.emphasize.ease),
  build: buildPunch,
});
