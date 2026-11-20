// What this skill needs, per doctor target. Side-effect free: imports only built-ins and ../../shared/.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ALL, nodeVersion, nodeModules, ffmpeg, browser, kokoro, cutout, builderAgent, render } from '../../shared/doctor.mjs';

export const CACHE_LIMIT_BYTES = 2 * 1024 ** 3;
const GB = 1024 ** 3;
// The frame caches: `.cache/video` is version 1's (decoded frames of video elements; nothing kept writes it, an old install may
// still hold one) and `.cache/cutout` is the cut-out tool's alpha frames of a clip, up to 900 RGBA PNGs (scripts/lib/cutout.mjs).
// Never .cache/models: the downloaded models are not a cache to throw away.
const cacheDirs = (ctx) => ['video', 'cutout'].map((name) => path.join(ctx.skillDir, '.cache', name));
const cacheBytes = (ctx) => cacheDirs(ctx).reduce((sum, dir) => sum + folderBytes(dir), 0);

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

// Optional: the cutout mattes (and any frames an older install left) are kept for the next run. Past CACHE_LIMIT_BYTES
// (both together) doctor lists them; `--fix cache` deletes both folders (any time, not only past the limit), and the next run
// cuts out what it needs again.
export function videoCache() {
  return {
    id: 'cache',
    why: (ctx) => `frame caches are ${(cacheBytes(ctx) / GB).toFixed(1)} GB (decoded video frames and cutout mattes); --fix cache clears them`,
    required: false,
    size: '—',
    check: (ctx) => cacheBytes(ctx) < CACHE_LIMIT_BYTES,
    // This process's own Node deletes them, so the step is the same on every platform.
    fix: (ctx) => {
      const step = [ctx.execPath ?? process.execPath, '-e', 'for (const dir of process.argv.slice(1)) require("node:fs").rmSync(dir, { recursive: true, force: true })', ...cacheDirs(ctx)];
      const line = render([step], ctx.platform);
      return { auto: [step], manual: { darwin: line, linux: line, win32: line } };
    },
    needsSudo: () => false,
  };
}

// Information only, never a failure (check is always true): the loudness limiter stage (version 1's `--loudness` render flag,
// deleted at cut-over; version 2 masters with `alimiter` too, scripts/v2/voice/master.mjs) needs ffmpeg 5.1 or later; whether
// 5.1 is the right floor for version 2's options was not re-checked. Shown as a doctor note with the installed version, when
// ffmpeg answers `-version`.
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

// Rendering always needs ffmpeg and a browser; kokoro only for a voiceover, onnxruntime-node (cutout) only for cutout.mjs (both
// or --fix, which may install any). beats.mjs needs ffmpeg alone, so every target covers it.
export const targets = ['voiceover', 'cutout'];

// A version 2 film whose narration the synthesiser speaks (`voice: { name }`) cannot render without the voice package,
// so `--for <film.json>` asks for it as required. A film read here is data: only these two fields are looked at.
function synthesisedVoice(specPath) {
  let film;
  try {
    film = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  } catch (err) {
    throw new Error(`cannot read ${specPath} as a film: ${String(err.message).split('\n')[0]}`, { cause: err });
  }
  return film?.version === 2 && typeof film.voice?.name === 'string';
}
const isSpecPath = (target) => typeof target === 'string' && target.endsWith('.json') && !targets.includes(target);

// Optional in every target: the cheap-model agent file the SKILL.md may hand the build to.
export const requirementsFor = (target) => (isSpecPath(target) && synthesisedVoice(target)
  ? [...baseRequirementsFor(target), { ...kokoro(), required: true }]
  : baseRequirementsFor(target));

const baseRequirementsFor = (target) => [
  nodeVersion(20),
  nodeModules({ omitDev: false }),
  ffmpeg(),
  browser({ required: true }),
  ...(target === 'voiceover' || target === ALL ? [kokoro()] : []),
  ...(target === 'cutout' || target === ALL ? [cutout()] : []),
  builderAgent(),
];

// What doctor.mjs checks and fixes: the requirements of `target`, plus the frame cache in every target. The cache is
// housekeeping, not something the skill needs, so requirementsFor leaves it out.
export const doctorRequirementsFor = (target) => [...requirementsFor(target), videoCache(), loudnessLimiter()];
