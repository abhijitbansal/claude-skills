// Runtime-optional browser launch for check.mjs and the browser tests.
// playwright is a devDependency, so it is imported lazily: without it (npm ci
// --omit=dev) or without a browser the callers skip instead of failing.

// Software WebGL (SwiftShader) so headless Chromium can draw the 3D view without a GPU.
export const WEBGL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

export class BrowserUnavailable extends Error {
  constructor(message) {
    super(message);
    this.name = 'BrowserUnavailable';
  }
}

/** A launched Chromium (bundled, else system Chrome). Throws BrowserUnavailable when none starts. `args` replaces the software-WebGL launch args. */
export async function launchBrowser(env = process.env, { args = WEBGL_ARGS } = {}) {
  if (env.PA_NO_BROWSER === '1') throw new BrowserUnavailable('PA_NO_BROWSER=1');
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (e) {
    throw new BrowserUnavailable(`playwright is not installed (${e.code ?? e.message})`);
  }
  try {
    return await chromium.launch({ args });
  } catch (first) {
    if (!/Executable doesn't exist/i.test(first.message)) throw new BrowserUnavailable(String(first.message).split('\n')[0]);
    try {
      return await chromium.launch({ channel: 'chrome', args });
    } catch (second) {
      throw new BrowserUnavailable(String(second.message).split('\n')[0]);
    }
  }
}
