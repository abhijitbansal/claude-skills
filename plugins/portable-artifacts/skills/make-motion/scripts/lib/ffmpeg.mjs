import { spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import path from 'node:path';
import { doctorCommand } from './doctor-hint.mjs';

const HINT = 'ffmpeg not found. Install it (macOS: brew install ffmpeg; Windows: winget install Gyan.FFmpeg; Debian/Ubuntu: sudo apt-get install ffmpeg), '
  + 'or set FFMPEG_PATH to an ffmpeg you trust '
  + `(doctor: ${doctorCommand()}, id ffmpeg)`;

const isExecutable = (p) => {
  try { accessSync(p, constants.X_OK); return true; } catch { return false; }
};

// $FFMPEG_PATH, then PATH. No ffmpeg is bundled or fetched: an npm package's binary download would be unpinned and unhashed.
export async function findFfmpeg() {
  const fromEnv = process.env.FFMPEG_PATH;
  if (fromEnv && isExecutable(fromEnv)) return fromEnv;
  if (fromEnv) process.stderr.write(`warning: FFMPEG_PATH is set to "${fromEnv}" but it is not executable; looking elsewhere\n`);
  const probe = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  if (!probe.error && probe.status === 0) {
    const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['ffmpeg'], { encoding: 'utf8' });
    return which.status === 0 ? which.stdout.split('\n')[0].trim() : 'ffmpeg';
  }
  throw new Error(HINT);
}

// $FFPROBE_PATH, then the ffprobe beside ffmpeg (`ffmpeg`, else $FFMPEG_PATH: the pair that belongs
// together), then ffprobe on PATH; null when none.
export function findFfprobe({ ffmpeg } = {}) {
  const fromEnv = process.env.FFPROBE_PATH;
  if (fromEnv && isExecutable(fromEnv)) return fromEnv;
  if (fromEnv) process.stderr.write(`warning: FFPROBE_PATH is set to "${fromEnv}" but it is not executable; looking elsewhere\n`);
  const beside = ffmpeg ?? process.env.FFMPEG_PATH;
  if (beside && /[\\/]/.test(beside)) { // a bare `ffmpeg` has no folder to look in
    const sibling = path.join(path.dirname(beside), 'ffprobe');
    if (isExecutable(sibling)) return sibling;
  }
  return spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0 ? 'ffprobe' : null;
}

// A user file (audio track, video clip) as an ffmpeg input that may only be read through the file or pipe protocol:
// ffmpeg sniffs content, so a playlist renamed to .mp3 or .mp4 must not make it fetch a URL. The offline guarantee.
export const PROTOCOL_WHITELIST = ['-protocol_whitelist', 'file,pipe'];
export const fileInput = (file) => [...PROTOCOL_WHITELIST, '-i', file];

const dbValue = (text) => (text === '-inf' ? -Infinity : Number(text));

/** { lufs, truePeak } from an ffmpeg `ebur128` summary on stderr (-Infinity for silence), or null when it has none. */
export function parseLoudness(stderr) {
  const lufs = [...stderr.matchAll(/\bI:\s+(-?[\d.]+|-inf) LUFS/g)].at(-1);
  const peak = [...stderr.matchAll(/True peak:\s+Peak:\s+(-?[\d.]+|-inf) dBFS/g)].at(-1);
  return lufs && peak ? { lufs: dbValue(lufs[1]), truePeak: dbValue(peak[1]) } : null;
}
