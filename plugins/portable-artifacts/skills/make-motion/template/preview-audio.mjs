// Preview audio: keeps the <audio> elements built by the renderer in step with the
// playhead. Sync is approximate (browser media clock vs. rAF); the rendered MP4 is exact.
export const DRIFT_SECONDS = 0.15;

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// Element volume at `time`: track volume times linear fade-in and fade-out ramps in [0, 1].
// The fade-out window is [end - fadeOut, end].
export function gainAt(track, time) {
  const rampIn = track.fadeIn > 0 ? clamp01((time - track.start) / track.fadeIn) : 1;
  const rampOut = track.fadeOut > 0 ? clamp01((track.end - time) / track.fadeOut) : 1;
  return clamp01(track.volume * rampIn * rampOut);
}

const HAVE_FUTURE_DATA = 3; // HTMLMediaElement.HAVE_FUTURE_DATA

const isInRange = (track, time) => time >= track.start && time < track.end;

// A seek that has not landed yet, or an unbuffered region: the media clock is stalled, not drifting.
const isSettling = (el) => el.seeking || el.readyState < HAVE_FUTURE_DATA;

// Elements whose play() was rejected for good (unsupported codec, decode error): never retried
// every frame. AbortError (interrupted by pause() or a seek) and NotAllowedError (no user gesture
// yet; the next real Play fixes it) are transient and retried.
const failed = new WeakSet();
const TRANSIENT = new Set(['AbortError', 'NotAllowedError']);

// Offset at which an element reported `ended`. The browser may over-report `duration`, so
// `ended` alone decides; a rewind below that offset (scrub, Play from earlier) clears it.
const endedAt = new WeakMap();

function isFinished(el, offset) {
  if (!el.ended) { endedAt.delete(el); return false; }
  if (!endedAt.has(el)) endedAt.set(el, offset);
  if (offset < endedAt.get(el)) { endedAt.delete(el); return false; }
  return true;
}

function startTrack(track, offset) {
  if (failed.has(track.el)) return;
  track.el.currentTime = offset;
  track.el.play().catch((e) => { if (!TRANSIENT.has(e?.name)) failed.add(track.el); });
}

function driveTrack(track, time, playing) {
  const { el } = track;
  const offset = time - track.start;
  if (!playing || !isInRange(track, time)) {
    if (!el.paused) el.pause();
    return;
  }
  if (el.paused) {
    if (!isFinished(el, offset)) startTrack(track, offset);
  } else if (!isSettling(el) && Math.abs(el.currentTime - offset) > DRIFT_SECONDS) {
    el.currentTime = offset;
  }
}

// `getTracks` is read on every call so a spec reload (new elements) is picked up.
export function audioController(getTracks) {
  let muted = false;
  return {
    get muted() { return muted; },
    setMuted(on) {
      muted = on;
      for (const { el } of getTracks()) el.muted = on;
    },
    // Play, pause or re-sync every track for the playhead at `time`.
    update(time, playing) {
      for (const track of getTracks()) {
        track.el.muted = muted;
        track.el.volume = gainAt(track, time);
        driveTrack(track, time, playing);
      }
    },
  };
}
