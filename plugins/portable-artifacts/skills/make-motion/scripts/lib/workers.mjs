// Parallel frame capture for render.mjs: several pages of one browser take frames in turn and write them to PNG files, and
// the consumer feeds them to the encoder in frame order. Every page is opened the way the single page is.
import { readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { UsageError } from './spec.mjs';

export const MAX_WORKERS = 16;
export const AHEAD_PER_PAGE = 2; // PNG files in flight per page: the most that wait on disk
const AUTO_CAP = 8;
const WORKERS_HELP = `--workers must be an integer from 1 to ${MAX_WORKERS} or "auto"`;

/** `--workers` text -> a count: undefined is 1, "auto" is max(1, min(8, cpus - 1)), else an integer 1-16. */
export function parseWorkers(text, cpus = os.availableParallelism()) {
  if (text === undefined) return 1;
  if (text === 'auto') return Math.max(1, Math.min(AUTO_CAP, cpus - 1));
  const n = /^\d+$/.test(text) ? Number(text) : NaN;
  if (!(n >= 1 && n <= MAX_WORKERS)) throw new UsageError(`${WORKERS_HELP} (got ${JSON.stringify(text)})`);
  return n;
}

// Test-only fault injection: PA_WORKER_FAIL_AT=<frame> makes the worker that takes that frame throw. Inert unless the
// value is a plain non-negative integer; anything else is ignored, never coerced.
export function parseFailAt(text) {
  return typeof text === 'string' && /^\d+$/.test(text) ? Number(text) : null;
}

function deferred() {
  const d = {};
  d.promise = new Promise((resolve) => { d.resolve = resolve; });
  return d;
}

/**
 * The pages take the next frame in order, one seek and one screenshot each, and write it to `dir/<index>.png`. The consumer
 * takes frame j, in order, once its file is written: it calls `onFrame(buffer)` (the encoder write), then deletes the file.
 * A page never takes a frame `ahead` or more past the oldest one the consumer has not finished, so at most `ahead` PNG
 * files (default 2 per page) exist at once, however slow the encoder is. That bound is why frames are handed out one at a
 * time rather than as a contiguous range per page: a page that owns the last quarter of the video could only start once
 * the consumer got there. Any page may draw any frame, because a frame's bytes do not depend on what was drawn before it
 * (renderer.mjs renewNodes). A page error or an unreadable file rejects with `worker <k> failed at frame <j>: <message>`
 * (k counts from 0); an `onFrame` error is rethrown as it is. Every worker has stopped by the time this settles, so the
 * caller can remove `dir` and close the browser. An `ahead` under 1 (or not a number) would wait for ever, so it counts as 1.
 */
export async function captureInOrder({ pages, frames, fps, dir, onFrame, ahead: aheadWanted = AHEAD_PER_PAGE * pages.length }) {
  const ahead = Math.max(1, Math.floor(aheadWanted) || 1);
  const failAt = parseFailAt(process.env.PA_WORKER_FAIL_AT);
  const file = (i) => path.join(dir, `${i}.png`);
  const ready = Array.from({ length: frames }, deferred);
  const owner = [];
  let next = 0; // the next frame no page has taken
  let consumed = 0; // frames the consumer has finished: written to the encoder, file deleted
  let stopped = false;
  let moved = deferred(); // resolved (and replaced) whenever `consumed` advances or the run stops
  const wake = () => { const previous = moved; moved = deferred(); previous.resolve(); };

  const take = async () => {
    while (!stopped && next < frames && next - consumed >= ahead) await moved.promise;
    return stopped || next >= frames ? null : next++;
  };

  const runWorker = async (k) => {
    let i = null;
    try {
      for (i = await take(); i !== null; i = await take()) {
        owner[i] = k;
        if (i === failAt) throw new Error('injected failure (PA_WORKER_FAIL_AT)');
        await pages[k].evaluate((s) => window.__motion.seek(s), i / fps);
        await writeFile(file(i), await pages[k].screenshot({ type: 'png' }));
        ready[i].resolve();
      }
    } catch (cause) {
      throw new Error(`worker ${k} failed at frame ${i}: ${cause.message}`, { cause });
    }
  };

  const running = pages.map((_, k) => runWorker(k));
  const crashed = new Promise((_, reject) => { running.forEach((run) => run.catch(reject)); });
  crashed.catch(() => {}); // the loop below sees it through the race
  try {
    for (let j = 0; j < frames; j++) {
      await Promise.race([ready[j].promise, crashed]);
      const png = await readFile(file(j)).catch((cause) => {
        throw new Error(`worker ${owner[j]} failed at frame ${j}: ${cause.message}`, { cause });
      });
      await onFrame(png);
      await rm(file(j), { force: true });
      consumed = j + 1;
      wake();
    }
  } finally {
    stopped = true;
    wake();
    await Promise.allSettled(running);
  }
}
