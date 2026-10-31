// Shared by tests that need a browser and/or ffmpeg (not a test file). Without PA_REQUIRE_RENDER=1 a
// missing tool skips the test; with it (CI sets it) a missing tool is a failure, so a render test
// can never go quietly green by skipping.
import { findFfmpeg, findFfprobe } from '../../scripts/lib/ffmpeg.mjs';
import { launchBrowser } from '../../scripts/lib/browser.mjs';

const TOOLS = ['ffmpeg', 'ffprobe', 'browser']; // probe order: ffprobe looks beside the ffmpeg that was found
const DEFAULT_NEED = ['browser', 'ffmpeg'];
/** `{ need }` for tests that draw on the page but never call ffmpeg (render-flags uses a fake one on purpose). */
export const BROWSER_ONLY = { need: ['browser'] };

const firstLine = (e) => String(e?.message ?? e).split('\n')[0];

let browserProbe; // one launch per test file; every test there needs the same answer
const PROBES = {
  ffmpeg: ({ skipStatic }) => findFfmpeg({ skipStatic }),
  ffprobe: ({ ffmpeg }) => findFfprobe({ ffmpeg }) ?? Promise.reject(new Error('no ffprobe found')),
  browser: () => (browserProbe ??= launchBrowser({ quiet: true }).then((b) => b.close())),
};

/**
 * `{ ffmpeg, ffprobe }` once every tool in `need` (a subset of browser, ffmpeg, ffprobe; default
 * browser + ffmpeg) is present; a tool not in `need` is null. So `ffprobe` is null only when it is
 * not in `need`. A missing tool calls `t.skip(<reason>)` and returns null, or throws
 * `PA_REQUIRE_RENDER=1 but <tool> is unavailable: <first line of the cause>` when PA_REQUIRE_RENDER=1.
 * `probes` replaces individual probes (each returns the tool or rejects); for tests of this helper.
 */
export async function requireRender(t, { need = DEFAULT_NEED, skipStatic = false, probes = {} } = {}) {
  const unknown = need.filter((tool) => !TOOLS.includes(tool));
  if (unknown.length) throw new Error(`requireRender: unknown tool ${unknown.join(', ')}; accepted: ${TOOLS.join(', ')}`);
  const probe = { ...PROBES, ...probes };
  const found = { ffmpeg: null, ffprobe: null };
  for (const tool of TOOLS.filter((x) => need.includes(x))) {
    try {
      const got = await probe[tool]({ skipStatic, ffmpeg: found.ffmpeg });
      if (tool !== 'browser') found[tool] = got;
    } catch (cause) {
      if (process.env.PA_REQUIRE_RENDER === '1') {
        throw new Error(`PA_REQUIRE_RENDER=1 but ${tool} is unavailable: ${firstLine(cause)}`, { cause });
      }
      t.skip(`${need.join(' or ')} unavailable`);
      return null;
    }
  }
  return found;
}
