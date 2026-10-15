import { chromium } from 'playwright';

const INSTALL_HINT = 'No browser available. Run: npx playwright install chromium (doctor: node <skill-dir>/scripts/doctor.mjs, id chromium)';
const firstLine = (e) => String(e?.message ?? e).split('\n')[0];

// Bundled Chromium first; falls back to system Chrome with a warning.
export async function launchBrowser({ quiet = false } = {}) {
  try {
    return await chromium.launch();
  } catch (first) {
    if (!/Executable doesn't exist/i.test(first.message)) throw first;
    try {
      const browser = await chromium.launch({ channel: 'chrome' });
      if (!quiet) {
        process.stderr.write('warning: Playwright Chromium not installed; using system Chrome. '
          + 'Output may differ between machines. Fix: npx playwright install chromium\n');
      }
      return browser;
    } catch (second) {
      throw new Error(`${INSTALL_HINT}\n(bundled Chromium: ${firstLine(first)}; system Chrome: ${firstLine(second)})`);
    }
  }
}

// Abort every request that is not to the local server; report each blocked URL.
// data: and blob: URLs never reach the network and are not routed.
export async function guardNetwork(page, origin, onBlock) {
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(`${origin}/`) || url === origin) return route.continue();
    onBlock(url);
    return route.abort('blockedbyclient');
  });
}
