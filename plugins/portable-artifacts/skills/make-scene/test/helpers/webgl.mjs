// A browser test may skip for one reason only: this Chromium cannot create a WebGL2 context. Anything else (a mount
// that fell back to the table, a throw during mount) must fail the test, so a runtime regression is never a green skip.

/** True when the page can create a WebGL2 context at all. */
export const hasWebgl2 = (page) => page.evaluate(() => document.createElement('canvas').getContext('webgl2') !== null);

/** Skips the test and returns true when the page has no WebGL2; false when the test should go on. */
export async function skipWithoutWebgl2(t, page) {
  if (await hasWebgl2(page)) return false;
  t.skip('WebGL2 unavailable in this Chromium');
  return true;
}

/**
 * Called once the scene has settled: skips (true) without WebGL2, else asserts the host reached 'ready'
 * (false = go on). `hostSelector` is the element carrying data-scene-state.
 */
export async function skipUnlessReady(t, page, assert, hostSelector = '[data-pa-scene]') {
  if (await skipWithoutWebgl2(t, page)) return true;
  const state = await page.evaluate((s) => document.querySelector(s).dataset.sceneState, hostSelector);
  assert.equal(state, 'ready', `WebGL2 is available, so the scene must mount (state: ${state})`);
  return false;
}

/**
 * What a console message means for a test that expects a quiet page: its text for an error, "warning: <text>" for a
 * warning (a mount that falls back to the table warns), null for anything else. The driver's own performance notes
 * ("GPU stall due to ReadPixels", from canvas screenshots) are not the page's.
 */
export function consoleProblem(message) {
  const text = message.text();
  if (message.type() === 'error') return text;
  if (message.type() === 'warning' && !text.includes('GL Driver Message')) return `warning: ${text}`;
  return null;
}
