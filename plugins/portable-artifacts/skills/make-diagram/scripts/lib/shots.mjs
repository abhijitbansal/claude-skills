// The screenshot half of scripts/check.mjs (--shots <dir>): one PNG per viewport and colour scheme through
// shared/shot.mjs in its own process (its own browser, started after the check's closed). It lives here, with
// no browser import, so a test can drive it with a stubbed `run`.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const SHOT_SCRIPT = fileURLToPath(new URL('../../shared/shot.mjs', import.meta.url));
export const SHOT_WIDTHS = '390,1280';
const SHOT_TIMEOUT_MS = 120000;
const firstLine = (e) => String(e?.message ?? e).split('\n')[0];

/**
 * One PNG per viewport (390, 1280) and colour scheme into `dir`. Returns { status, paths, message? }: status is
 * shot.mjs's exit code, 0 only when it reported ok (an exit 0 without ok:true is a failure, status 1).
 */
export function takeShots(file, dir, { run = spawnSync, script = SHOT_SCRIPT } = {}) {
  const r = run(process.execPath, [script, file, '--widths', SHOT_WIDTHS, '--out', dir, '--json'], { encoding: 'utf8', timeout: SHOT_TIMEOUT_MS });
  let body = null;
  try {
    body = JSON.parse(String(r.stdout ?? '').trim().split('\n').at(-1));
  } catch {
    body = null;
  }
  const paths = (body?.shots ?? []).map((s) => s.path);
  if (r.status === 0 && body?.ok) return { status: 0, paths };
  const message = body?.errors?.[0]?.message ?? body?.problems?.[0] ?? firstLine(r.stderr || r.error?.message || 'the screenshot run failed');
  return { status: r.status || 1, paths, message };
}
