import { chromium } from 'playwright';
import { doctorCommand, npxInstallChromium } from './doctor-hint.mjs';

const INSTALL_HINT = `No browser available. Run: ${npxInstallChromium()} `
  + `(doctor: ${doctorCommand()}, id chromium)`;
const firstLine = (e) => String(e?.message ?? e).split('\n')[0];

// Render mode paints every element into the stage layer (styles.css), so each seek re-rasters the tiles a moving element
// touched. With partial raster, Chromium re-rasters only the changed part of a reused tile, and an image or art under
// that part came out one of two ways per browser launch. Whole-tile raster gives the same bytes every launch.
// `--font-render-hinting=none`: on Linux, Chromium's headless shell rounds each glyph advance to a whole pixel (hinted
// metrics), where macOS keeps fractions. A word then measures differently from one machine to the next and a fit that
// clears by a hair on one overflows on the other (CI, ubuntu: Archivo "Rag" at 24 px x8 was 344, at 192 px 350; macOS 349.0
// for both). No hinting gives the unrounded advances every machine agrees on; macOS ignores the flag.
const ARGS = ['--disable-partial-raster', '--font-render-hinting=none'];

// Bundled Chromium first; falls back to system Chrome with a warning.
// Playwright closes the browser and exits 130 or 143 itself on Ctrl+C or SIGTERM, which pre-empts a caller's own handler
// (a render removes its partial MP4 and temp frames there). `ownSignals: true` leaves SIGINT and SIGTERM to the caller.
// `args`: more launch arguments after the fixed ones (version 1's GL compositor used them; every caller launches with ARGS alone).
export async function launchBrowser({ quiet = false, ownSignals = false, args = [] } = {}) {
  const options = { args: [...ARGS, ...args], ...(ownSignals ? { handleSIGINT: false, handleSIGTERM: false } : {}) };
  try {
    return await chromium.launch(options);
  } catch (first) {
    if (!/Executable doesn't exist/i.test(first.message)) throw first;
    try {
      const browser = await chromium.launch({ channel: 'chrome', ...options });
      if (!quiet) {
        process.stderr.write('warning: Playwright Chromium not installed; using system Chrome. '
          + 'Output may differ between machines. Fix: ' + npxInstallChromium() + '\n');
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
