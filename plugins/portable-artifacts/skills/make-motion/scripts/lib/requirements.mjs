// What this skill needs, per doctor target. Side-effect free: imports only built-ins and ../../shared/.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ALL, nodeVersion, nodeModules, ffmpeg, browser, kokoro, builderAgent, render } from '../../shared/doctor.mjs';

export const CACHE_LIMIT_BYTES = 2 * 1024 ** 3;
const GB = 1024 ** 3;
const cacheDir = (ctx) => path.join(ctx.skillDir, '.cache', 'video'); // the frame cache of video elements (scripts/lib/video.mjs)

// Bytes under `dir`, 0 when it does not exist.
function folderBytes(dir) {
  let total = 0;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) total += folderBytes(file);
    else if (entry.isFile()) total += fs.statSync(file).size;
  }
  return total;
}

// Optional: the decoded frames of video elements are kept for the next render. Past CACHE_LIMIT_BYTES doctor lists it;
// `--fix cache` deletes the folder (any time, not only past the limit), and the next render decodes what it needs again.
export function videoCache() {
  return {
    id: 'cache',
    why: (ctx) => `video frame cache is ${(folderBytes(cacheDir(ctx)) / GB).toFixed(1)} GB; --fix cache clears it`,
    required: false,
    size: '—',
    check: (ctx) => folderBytes(cacheDir(ctx)) < CACHE_LIMIT_BYTES,
    // This process's own Node deletes it, so the step is the same on every platform.
    fix: (ctx) => {
      const step = [ctx.execPath ?? process.execPath, '-e', 'require("node:fs").rmSync(process.argv[1], { recursive: true, force: true })', cacheDir(ctx)];
      const line = render([step], ctx.platform);
      return { auto: [step], manual: { darwin: line, linux: line, win32: line } };
    },
    needsSudo: () => false,
  };
}

// Information only, never a failure (check is always true): the loudness limiter stage of `render.mjs --loudness` (viral
// clips of cues alone use it) needs ffmpeg 5.1 or later; an older one still renders, with a plain gain and a stderr note.
// Shown as a doctor note with the installed version, when ffmpeg answers `-version`.
export function loudnessLimiter() {
  return {
    id: 'loudness-limiter',
    why: 'the loudness limiter stage needs ffmpeg 5.1 or later',
    required: false,
    size: '—',
    check: () => true,
    fix: () => ({ auto: null, manual: { darwin: 'install a newer ffmpeg', linux: 'install a newer ffmpeg', win32: 'install a newer ffmpeg' } }),
    needsSudo: () => false,
    presentInfo: (ctx) => {
      const r = spawnSync(ctx.env?.FFMPEG_PATH || 'ffmpeg', ['-version'], { encoding: 'utf8' });
      const version = r.status === 0 ? /ffmpeg version (\S+)/.exec(r.stdout ?? '')?.[1] : undefined;
      return version ? { note: `the loudness limiter stage needs ffmpeg 5.1 or later; this is ${version}` } : null;
    },
  };
}

// Rendering always needs ffmpeg and a browser; kokoro only for a voiceover (or --fix, which may install any). beats.mjs
// needs ffmpeg alone, so every target but `check` covers it (a spec that names a beats file needs nothing extra to check).
// check.mjs needs only the browser (it captures no video), so `check` leaves ffmpeg and kokoro out. A spec with a video
// element is the exception (check decodes its frames with ffmpeg); `--for <spec.json>` asks for ffmpeg.
export const targets = ['check', 'voiceover'];
// Optional in every target: the cheap-model agent file the SKILL.md may hand the build to.
export const requirementsFor = (target) => (target === 'check'
  ? [nodeVersion(20), nodeModules({ omitDev: false, restore: ['kokoro'] }), browser({ required: true }), builderAgent()]
  : [
    nodeVersion(20),
    nodeModules({ omitDev: false, restore: ['kokoro'] }),
    ffmpeg(),
    browser({ required: true }),
    ...(target === 'voiceover' || target === ALL ? [kokoro()] : []),
    builderAgent(),
  ]);

// What doctor.mjs checks and fixes: the requirements of `target`, plus the video frame cache in every target (check.mjs
// fills it too). The cache is housekeeping, not something the skill needs, so requirementsFor leaves it out.
export const doctorRequirementsFor = (target) => [...requirementsFor(target), videoCache(), ...(target === 'check' ? [] : [loudnessLimiter()])];
