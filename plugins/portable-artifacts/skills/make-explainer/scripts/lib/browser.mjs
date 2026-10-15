// Runtime-optional browser launch for check.mjs and the browser tests.
// playwright is a devDependency, so it is imported lazily: without it (npm ci
// --omit=dev) or without a browser the callers skip instead of failing.

export class BrowserUnavailable extends Error {
  constructor(message) {
    super(message);
    this.name = 'BrowserUnavailable';
  }
}

/** A launched Chromium (bundled, else system Chrome). Throws BrowserUnavailable when none starts. */
export async function launchBrowser(env = process.env) {
  if (env.PA_NO_BROWSER === '1') throw new BrowserUnavailable('PA_NO_BROWSER=1');
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (e) {
    throw new BrowserUnavailable(`playwright is not installed (${e.code ?? e.message})`);
  }
  try {
    return await chromium.launch();
  } catch (first) {
    if (!/Executable doesn't exist/i.test(first.message)) throw new BrowserUnavailable(String(first.message).split('\n')[0]);
    try {
      return await chromium.launch({ channel: 'chrome' });
    } catch (second) {
      throw new BrowserUnavailable(String(second.message).split('\n')[0]);
    }
  }
}
