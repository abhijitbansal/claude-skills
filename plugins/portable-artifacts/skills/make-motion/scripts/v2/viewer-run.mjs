// make.mjs <film> --preview [--open]: validate, voice, timeline and sound as a render would (run.mjs previewStages), the
// sound mastered once (render.mjs masterSoundFile), the clips decoded (clips.mjs), then the preview server (viewer.mjs)
// until the run is stopped (SIGINT or SIGTERM through `signal`), which is a clean exit (0). The film file is watched:
// every change builds the film again; a valid one replaces the page's film, an invalid one shows its lines in the page.
// `--open` starts the platform's opener on the URL, the URL passed as one argument; nothing is opened without it.
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, unwatchFile, watchFile } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { previewStages } from './run.mjs';
import { masterSoundFile } from './render.mjs';
import { stampTags } from './stamp.mjs';
import { startViewer } from './viewer.mjs';

const WATCH_MS = 500;
const LOOPBACK = 'http://127.0.0.1:';
const OPENERS = Object.freeze({ darwin: 'open', win32: 'explorer.exe' });
const EXIT_OK = 0;
const EXIT_NOT_OK = 1;
const EXIT_MACHINE = 2;

/** Starts the platform's default browser on `url` (a loopback preview URL only), detached, the URL one argument. */
export function openUrl(url) {
  if (!url.startsWith(LOOPBACK)) throw new Error(`refusing to open ${JSON.stringify(url)}: the preview opens its own loopback URL only`);
  const child = execFile(OPENERS[process.platform] ?? 'xdg-open', [url], { stdio: 'ignore', detached: true });
  child.on('error', () => {}); // no opener on this machine: the URL is printed, which is enough
  child.unref();
}

const findingLine = (f) => (f.path ? `${f.path}: ${f.message}` : f.message);

// One version of the film, built into its own folder under `work`: { built } for a valid film, { errors } for one that
// is not. Machine trouble throws.
async function buildOnce(options, work, io) {
  const dir = mkdtempSync(path.join(work, 'v-'));
  const stages = await previewStages(options, { work: dir, signal: io.signal, log: io.log, synthesise: io.synthesise });
  if (stages.loaded === null) return { errors: stages.findings.map(findingLine), dir };
  const { film, timeline } = stages.loaded;
  const audio = await masterSoundFile({ film, timeline, voice: stages.made ?? undefined, sound: stages.sound ?? undefined, work: dir, signal: io.signal });
  const { clips } = stages.loaded; // decoded by previewStages into `dir`
  const tags = stampTags({ generatedBy: film.generatedBy, flags: options.provenance ?? {}, provenance: film.provenance });
  return { built: { loaded: stages.loaded, audio, clips, notice: stages.notice, provenance: tags.comment ?? '' }, dir };
}

const stopped = (signal) => new Promise((resolve) => {
  if (!signal || signal.aborted) return resolve();
  return signal.addEventListener('abort', resolve, { once: true });
});

// Rebuild on every change of the film file, one build at a time; the folder of the version before is removed once the
// page has the new one.
function watchFilm(options, work, viewer, io, first) {
  let current = first;
  let queue = Promise.resolve();
  const rebuild = () => {
    queue = queue.then(async () => {
      try {
        const next = await buildOnce(options, work, io);
        if (next.errors) {
          viewer.fail(next.errors);
          rmSync(next.dir, { recursive: true, force: true });
          return;
        }
        viewer.update(next.built);
        rmSync(current, { recursive: true, force: true });
        current = next.dir;
      } catch (err) {
        if (!io.signal?.aborted) viewer.fail([`the film could not be built: ${err.message}`]);
      }
    });
  };
  watchFile(options.specPath, { interval: io.watchMs ?? WATCH_MS }, (now, before) => { if (now.mtimeMs !== before.mtimeMs || now.size !== before.size) rebuild(); });
  return () => {
    unwatchFile(options.specPath);
    return queue;
  };
}

/**
 * @param {object} options parseMakeArgs's result with `preview` (and `open`)
 * @param {{ signal?: AbortSignal, log?: Function, say?: (line: string) => void, opener?: (url: string) => void,
 *   synthesise?: Function, watchMs?: number }} io say prints the URL line (or `{ ok, preview: { url } }` with --json)
 * @returns {Promise<{ exitCode: number, findings?: string[], error?: string }>}
 */
export async function runPreview(options, io = {}) {
  const { say = () => {}, opener = openUrl, log = () => {} } = io;
  const work = mkdtempSync(path.join(tmpdir(), 'mm-preview-'));
  try {
    let first;
    try {
      first = await buildOnce(options, work, { ...io, log });
    } catch (err) {
      return { exitCode: EXIT_MACHINE, error: err.message };
    }
    if (first.errors) return { exitCode: EXIT_NOT_OK, findings: first.errors };
    const viewer = await startViewer(first.built);
    try {
      say(options.json ? JSON.stringify({ ok: true, preview: { url: viewer.url } }) : `preview: ${viewer.url}`);
      if (options.open) opener(viewer.url);
      const unwatch = watchFilm(options, work, viewer, { ...io, log }, first.dir);
      await stopped(io.signal);
      await unwatch();
    } finally {
      await viewer.close();
    }
    return { exitCode: EXIT_OK };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
