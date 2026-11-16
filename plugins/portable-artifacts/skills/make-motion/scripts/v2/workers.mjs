// --workers: the frames split into contiguous ranges, one page per range in the run's one browser, each page capturing
// the frames of its range that changed (the first frame of a range always), and the pictures written to ffmpeg in frame
// order. Measured before it was built (v1-gaps Task 6): on kinds-desk.json, 1027 frames, capture alone, 4 pages took
// 28.38 s against 59.72 s for one (2.10x, median of three runs). Later ranges run ahead of the writer up to
// MAX_BUFFERED_BYTES of pictures, then wait for it.
import { availableParallelism } from 'node:os';

export const MAX_WORKERS = 8;
export const MAX_BUFFERED_BYTES = 768 * 1024 * 1024;
const HELD_CHUNK = 150; // frames whose held flags are fetched in one page.evaluate, as render.mjs does

/** The worker count `auto` means: half the CPUs, at least 1, at most MAX_WORKERS. */
export const autoWorkers = (cpus = availableParallelism()) => Math.min(MAX_WORKERS, Math.max(1, Math.floor(cpus / 2)));

/** Contiguous ranges [from, to) covering frames 0..frames-1, as even as can be, never more ranges than frames. */
export function workerRanges(frames, workers) {
  const count = Math.max(1, Math.min(workers, frames));
  const base = Math.floor(frames / count);
  const extra = frames % count;
  const ranges = [];
  let from = 0;
  for (let k = 0; k < count; k++) {
    const to = from + base + (k < extra ? 1 : 0);
    ranges.push({ from, to });
    from = to;
  }
  return ranges;
}

// A queue of one range's pictures: the producer waits while the run holds too many bytes and this is not the range
// being written; the writer waits for the next picture.
function newQueue() {
  return { items: [], wake: null, room: null };
}
const wakeUp = (queue, slot) => {
  const fn = queue[slot];
  queue[slot] = null;
  fn?.();
};

// Captures range `range` on `page` into `queue` (held frames repeat the previous picture of the range).
async function produce({ page, range, queue, capture, state }) {
  let previous = null;
  for (let a = range.from; a < range.to; a += HELD_CHUNK) {
    const b = Math.min(range.to, a + HELD_CHUNK) - 1;
    const held = await page.evaluate(([x, y]) => window.__heldFlags(x, y, true), [a, b]);
    for (let k = 0; k < held.length; k++) {
      if (state.failed) return;
      const fresh = previous === null || !held[k];
      if (fresh) {
        await page.evaluate((i) => window.__seek(i), a + k);
        previous = await capture(page);
        state.captured++;
        state.bytes += previous.length;
      }
      queue.items.push({ buffer: previous, fresh });
      wakeUp(queue, 'wake');
      while (state.bytes > MAX_BUFFERED_BYTES && state.writing !== queue && !state.failed) await new Promise((resolve) => { queue.room = resolve; });
    }
  }
}

// Writes every range's pictures in frame order through `write`.
async function consume({ queues, ranges, write, state, onProgress, frames }) {
  let frame = 0;
  for (const [k, queue] of queues.entries()) {
    state.writing = queue;
    queues.forEach((q) => wakeUp(q, 'room'));
    for (let i = ranges[k].from; i < ranges[k].to; i++) {
      while (queue.items.length === 0) {
        if (state.failed) return;
        await new Promise((resolve) => { queue.wake = resolve; });
      }
      const { buffer, fresh } = queue.items.shift();
      await write(buffer);
      if (fresh) state.bytes -= buffer.length;
      frame++;
      onProgress?.({ frame, frames, captured: state.captured });
      queues.forEach((q) => wakeUp(q, 'room'));
    }
  }
}

/**
 * Captures every frame of `frames` with `pages` (one range each) and writes them in order through `write(buffer)`.
 * `capture(page)` takes the picture. -> the number of pictures taken. A failure on any page stops the others and
 * rejects.
 */
export async function captureParallel({ pages, frames, capture, write, onProgress, signal }) {
  const ranges = workerRanges(frames, pages.length);
  const queues = ranges.map(newQueue);
  const state = { captured: 0, bytes: 0, failed: false, writing: null };
  const fail = (err) => {
    state.failed = true;
    queues.forEach((q) => { wakeUp(q, 'wake'); wakeUp(q, 'room'); });
    throw err;
  };
  const guarded = (promise) => promise.catch(fail);
  const checked = async (buffer) => { signal?.throwIfAborted(); await write(buffer); };
  await Promise.all([
    ...ranges.map((range, k) => guarded(produce({ page: pages[k], range, queue: queues[k], capture, state }))),
    guarded(consume({ queues, ranges, write: checked, state, onProgress, frames })),
  ]);
  return state.captured;
}
