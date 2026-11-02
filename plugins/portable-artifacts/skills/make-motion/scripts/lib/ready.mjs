// The time limits on the page, shared by render.mjs (the video, every --workers page and the contact sheet) and
// check.mjs: the bounded wait for the page to build its stage (window.__motion.ready), then a limit on every seek and
// screenshot (boundPage). A page can stop for good: lottie-web drawing a file that asks for too much blocks the page's
// main thread, where no timer of the page's own can fire, so both limits run in Node and their errors name the lottie
// elements, the likeliest cause. preview.mjs opens the page in the user's own browser and waits for nothing.
import { flattenElements } from '../../template/groups.mjs';

export const READY_BASE_MS = 30000;
export const READY_PER_LOAD_MS = 5000; // each element that loads a file or a library before the stage is ready
export const READY_MAX_MS = 300000;
export const FRAME_MS = 10000; // one seek or one screenshot: a heavy frame takes well under a second
const LOADS = new Set(['image', 'video', 'chart', 'code', 'lottie']);

// Test-only: PA_READY_MS=<ms> and PA_FRAME_MS=<ms> replace the ready budget and the frame limit (a test forces the
// timeouts with them). Inert unless the value is a plain positive integer; anything else is ignored, never coerced.
function msOverride(text) {
  return typeof text === 'string' && /^[1-9]\d*$/.test(text) ? Number(text) : null;
}
const readyOverride = (env) => msOverride(env.PA_READY_MS);

/** The time one seek or one screenshot may take: FRAME_MS, or PA_FRAME_MS in a test. `env`: process.env. */
export const frameLimit = (env = process.env) => msOverride(env.PA_FRAME_MS) ?? FRAME_MS;

const SEEKS = '.seek('; // the page functions that seek: their argument (a number, or an array starting with one) is the time
const secondsOf = (arg) => (typeof arg === 'number' ? arg : Array.isArray(arg) && typeof arg[0] === 'number' ? arg[0] : null);

/**
 * `page` with every evaluate and screenshot time-limited to `ms`: one that does not settle in time rejects with
 * `the frame at <t> s (frame <n>) did not finish drawing within <ms / 1000> s<hint>`, where <t> is the time of the last
 * seek (the page function that calls window.__motion.seek, its argument the time) and <n> that time at `fps` (left out
 * without fps). Everything else on the page passes through. A page whose main thread is blocked (a lottie that slipped
 * past the budget) makes the render fail this way; the caller closes the browser, which rejects the abandoned call.
 */
export function boundPage(page, { ms, hint = '', fps } = {}) {
  let at = 0;
  const limited = (run) => {
    const work = run();
    work.catch(() => {}); // abandoned after a timeout: closing the browser rejects it
    let timer;
    const frame = fps ? ` (frame ${Math.round(at * fps)})` : '';
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`the frame at ${at} s${frame} did not finish drawing within ${ms / 1000} s${hint}`)), ms);
    });
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
  };
  return new Proxy(page, {
    get(target, key) {
      if (key === 'evaluate') {
        return (fn, arg) => {
          const sec = String(fn).includes(SEEKS) ? secondsOf(arg) : null;
          if (sec !== null) at = sec;
          return limited(() => target.evaluate(fn, arg));
        };
      }
      if (key === 'screenshot') return (options) => limited(() => target.screenshot(options));
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/**
 * `{ ms, hint }` for `spec` (its scenes; a block is expanded already or counts as nothing): READY_BASE_MS plus
 * READY_PER_LOAD_MS per element that loads something, at most READY_MAX_MS; `hint` names every lottie element (and its
 * file), '' when there is none. `env`: process.env.
 */
export function readyBudget(spec, env = process.env) {
  const elements = (spec.scenes ?? []).flatMap((s) => flattenElements(s.elements ?? [])).map(({ el }) => el);
  const loads = elements.filter((el) => LOADS.has(el.type)).length;
  const lotties = elements.filter((el) => el.type === 'lottie').map((el) => `${JSON.stringify(el.id)} (${el.src})`);
  return {
    ms: readyOverride(env) ?? Math.min(READY_MAX_MS, READY_BASE_MS + READY_PER_LOAD_MS * loads),
    hint: lotties.length ? `; a lottie file too heavy to draw stops the page: ${lotties.join(', ')}` : '',
  };
}

/**
 * Waits until the page has built its stage, at most `ms`: a page that never gets there rejects with a message that says
 * how long it waited, then `hint`. A failed build rejects `ready` and surfaces its own message. The caller closes the
 * browser either way; whatever was still in flight then rejects unobserved.
 */
export async function waitReady(page, ms = READY_BASE_MS, hint = '') {
  const work = (async () => {
    await page.waitForFunction(() => window.__motion, null, { timeout: 0 });
    await page.evaluate(() => window.__motion.ready);
  })();
  work.catch(() => {}); // after a timeout, closing the browser rejects whatever was in flight
  let timer;
  const seconds = Number((ms / 1000).toFixed(2));
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`the page did not become ready within ${seconds} s (any page error is printed above)${hint}`)), ms);
  });
  try {
    await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
