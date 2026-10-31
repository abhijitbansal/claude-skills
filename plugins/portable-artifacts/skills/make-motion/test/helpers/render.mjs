// Shared by render tests (not a test file): the browser + ffmpeg gate. Without PA_REQUIRE_RENDER=1 a
// missing tool skips the test; with it (CI sets it) a missing tool is a failure, so a render test
// can never go quietly green by skipping.
import { findFfmpeg, findFfprobe } from '../../scripts/lib/ffmpeg.mjs';
import { launchBrowser } from '../../scripts/lib/browser.mjs';

const SKIP_REASON = 'browser or ffmpeg unavailable';

async function haveBrowser() {
  try { await (await launchBrowser({ quiet: true })).close(); return true; } catch { return false; }
}

/** { ffmpeg, ffprobe } (ffprobe is null when not installed), or null after t.skip(); throws instead of skipping when PA_REQUIRE_RENDER=1. */
export async function requireRender(t, { skipStatic = false } = {}) {
  const required = process.env.PA_REQUIRE_RENDER === '1';
  const missing = (what) => {
    if (required) throw new Error(`PA_REQUIRE_RENDER=1 but ${what} is unavailable`);
    t.skip(SKIP_REASON);
    return null;
  };
  const ffmpeg = await findFfmpeg({ skipStatic }).catch(() => null);
  if (!ffmpeg) return missing('ffmpeg');
  if (!(await haveBrowser())) return missing('the browser');
  return { ffmpeg, ffprobe: findFfprobe({ ffmpeg }) };
}
