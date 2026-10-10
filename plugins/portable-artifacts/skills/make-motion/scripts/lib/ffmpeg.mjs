import { spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';

const HINT = 'ffmpeg not found. Install it (macOS: brew install ffmpeg; Debian/Ubuntu: apt install ffmpeg), '
  + 'or set FFMPEG_PATH, or run: npm i ffmpeg-static';

const isExecutable = (p) => {
  try { accessSync(p, constants.X_OK); return true; } catch { return false; }
};

// $FFMPEG_PATH, then PATH, then an optionally installed ffmpeg-static.
export async function findFfmpeg({ skipStatic = false } = {}) {
  const fromEnv = process.env.FFMPEG_PATH;
  if (fromEnv && isExecutable(fromEnv)) return fromEnv;
  if (fromEnv) process.stderr.write(`warning: FFMPEG_PATH is set to "${fromEnv}" but it is not executable; looking elsewhere\n`);
  const probe = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  if (!probe.error && probe.status === 0) {
    const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['ffmpeg'], { encoding: 'utf8' });
    return which.status === 0 ? which.stdout.split('\n')[0].trim() : 'ffmpeg';
  }
  if (!skipStatic) {
    try {
      const mod = await import('ffmpeg-static');
      const p = mod.default ?? mod;
      if (typeof p === 'string' && isExecutable(p)) return p;
    } catch { /* optional dependency not installed */ }
  }
  throw new Error(HINT);
}

export function encodeArgs({ fps, out }) {
  return ['-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out];
}
