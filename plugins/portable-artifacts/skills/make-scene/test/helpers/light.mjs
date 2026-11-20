// Waiting for the tour light by what it does. Its clock advances at most 0.1 s per frame (runtime/index.js MAX_DT) and it
// needs 1.8 s (runtime/travel.js TRAVEL_SECONDS), so it arrives after frames x frame time: about 2 s on a laptop, longer on
// a CI runner whose software WebGL (SwiftShader) shares four CPUs with other browsers. A fixed wall-clock budget turned
// that into a coin toss (lift-browser:62, run 44480211485: 5000 ms exceeded). What a broken light does is stop, so the
// wait fails when the light has not moved for `stallMs`, and, as a last guard against one that creeps for ever, at `capMs`.
const STALL_MS = 5000; // no movement for this long: stopped (a frame at CI's worst is well under it)
const CAP_MS = 90_000; // the whole run, whatever it did
const POLL_MS = 50;

const light = (page) => page.evaluate(() => window.PAScene.__scene.traveller());
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The light's final frame once it has arrived. Throws when there is no light, when it stops moving, or at the cap. */
export async function lightArrives(page, { stallMs = STALL_MS, capMs = CAP_MS, pollMs = POLL_MS } = {}) {
  const started = Date.now();
  let seen = null;
  let movedAt = started;
  for (;;) {
    const frame = await light(page);
    if (frame === null || frame === undefined) throw new Error('no light: the tour has not sent one');
    if (frame.done === true) return frame;
    const now = Date.now();
    if (frame.at !== seen) {
      seen = frame.at;
      movedAt = now;
    } else if (now - movedAt >= stallMs) {
      throw new Error(`the light stopped at ${frame.at} (id ${frame.id}) and did not move for ${stallMs} ms`);
    }
    if (now - started >= capMs) throw new Error(`the light did not arrive within ${capMs} ms (it was at ${frame.at})`);
    await sleep(pollMs);
  }
}
