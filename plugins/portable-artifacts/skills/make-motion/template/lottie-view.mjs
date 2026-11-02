// Browser: the DOM of a `lottie` element. lottie-web's light SVG build (no expression engine, no eval; the importmap maps
// `lottie-web` to it and the server serves no other build) is imported only when a spec has a lottie element. Each file
// is fetched from /assets, capped in bytes, parsed and run through lottieProblems (lottie-guard.mjs) before lottie-web
// sees it; the player draws one <svg> into a holder inside the element node and is seeked with goToAndStop(frame, true).
import { lottieProblems, lottieFrame, stripDomNames, MAX_LOTTIE_BYTES } from './lottie-guard.mjs';

const MISSING = 'lottie elements need lottie-web, which did not load; reinstall the skill\'s packages (npm ci in the make-motion folder, or node scripts/doctor.mjs --fix node_modules)';
const MIB = 1024 * 1024;
const LOAD_TIMEOUT_MS = 10000; // a player that never reports loaded is an error, not a render that hangs

let player = null;
function loadPlayer() {
  player ??= import('lottie-web').then((m) => m.default, (e) => {
    player = null;
    throw new Error(`${MISSING} (${e.message})`);
  });
  return player;
}

const tooBig = (src, bytes) => new Error(`lottie ${src} is ${bytes} bytes; a Lottie file may be at most ${MAX_LOTTIE_BYTES} bytes (${MAX_LOTTIE_BYTES / MIB} MiB)`);

// The parsed file at `url`, refused (with the first problem) unless lottieProblems finds none.
async function fetchLottie(url, src) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`lottie failed to load: ${src} (HTTP ${response.status})`);
  const declared = Number(response.headers.get('content-length'));
  if (declared > MAX_LOTTIE_BYTES) throw tooBig(src, declared);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_LOTTIE_BYTES) throw tooBig(src, bytes.byteLength);
  let json;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) {
    throw new Error(`lottie ${src} is not valid JSON: ${e.message}`);
  }
  const [first] = lottieProblems(json);
  if (first) throw new Error(`lottie ${src}: ${first.path}: ${first.message}`);
  return stripDomNames(json); // no id or class from the file reaches the page

}

const STACK_OVERFLOW = /call stack/i;

// What lottie-web reported (its error event wraps the native error; a synchronous throw is the error itself), as the
// element's error. Running out of stack means the file asks for more than lottie-web can draw: said so, with what to cut.
function drawError(src, native) {
  const text = String(native?.message ?? native ?? 'unknown error');
  if (native instanceof RangeError || STACK_OVERFLOW.test(text)) {
    return new Error(`lottie ${src} is too complex for lottie-web to draw (it ran out of stack: ${text}); simplify it: fewer characters, points, copies or nested groups`);
  }
  return new Error(`lottie ${src} failed to draw: ${text}`);
}

// Resolves once the player has built its DOM and every embedded <image> in it is decoded (the SVG renderer reports loaded
// without waiting for images, which would leave the first frames to a race; lottie-web also swallows an image that fails
// to decode, so this is what refuses one). -> { loaded, stop }: `stop` clears the load timer when the load is abandoned.
function whenLoaded(anim, holder, src, state) {
  let timer;
  const loaded = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`lottie ${src} did not finish loading`)), LOAD_TIMEOUT_MS);
    anim.addEventListener('DOMLoaded', () => { clearTimeout(timer); resolve(); });
    anim.addEventListener('error', (event) => {
      clearTimeout(timer);
      state.error = drawError(src, event?.nativeError);
      reject(state.error);
    });
  }).then(() => Promise.all([...holder.querySelectorAll('image')].map((img) => img.decode().catch(() => {
    throw new Error(`lottie ${src}: an embedded image failed to load`);
  }))));
  return { loaded, stop: () => clearTimeout(timer) };
}

/**
 * Plays `el`'s file (served at `url`) into `holder`. -> the state seekLottie and destroyLotties take. The listeners are
 * attached before the file is handed over, so an error lottie-web reports while it sets up is never missed. The state
 * joins `players` (the stage's list) as soon as its player exists, so a stage that fails later still destroys it.
 */
export async function mountLottie(holder, el, url, players) {
  const [lottie, data] = await Promise.all([loadPlayer(), fetchLottie(url, el.src)]);
  const state = { anim: null, timing: { fr: data.fr, ip: data.ip, op: data.op }, shown: null, error: null };
  // No animationData here: setParams then loads nothing, and setupAnimation below starts the load once we listen.
  // viewBoxOnly: no width, height or translate3d on the <svg> (a compositor layer would break byte-identical renders).
  state.anim = lottie.loadAnimation({
    container: holder, renderer: 'svg', loop: false, autoplay: false, autoloadSegments: false,
    rendererSettings: { viewBoxOnly: true, preserveAspectRatio: 'xMidYMid meet' },
  });
  players.push(state);
  const { loaded, stop } = whenLoaded(state.anim, holder, el.src, state);
  try {
    state.anim.setupAnimation(data);
  } catch (e) {
    stop();
    loaded.catch(() => {}); // abandoned: it must not surface later as an unhandled rejection
    throw drawError(el.src, e);
  }
  await loaded;
  const svg = holder.querySelector(':scope > svg');
  if (svg) svg.style.cssText = 'display:block;width:100%;height:100%';
  return state;
}

/**
 * Shows the frame of `el` (offset, speed) at scene time `sceneT`. -> the frame drawn. Throws an error lottie-web reported
 * while drawing, here or in an earlier seek.
 */
export function seekLottie(state, sceneT, el) {
  const frame = lottieFrame(sceneT, el, state.timing);
  if (frame !== state.shown) {
    state.anim.goToAndStop(frame, true);
    state.shown = frame;
  }
  if (state.error) throw state.error;
  return frame;
}

/** Stops and removes the players of a stage that is being replaced. */
export function destroyLotties(states) {
  for (const state of states ?? []) state.anim?.destroy();
}
