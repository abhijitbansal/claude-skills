// Tour state machine: which beat is showing, whether the tour is playing, and when to move on.
// Pure (no three, no DOM): the timer is injected, like the render loop's frame scheduler.

export const BASE_DWELL_MS = 4000; // every beat stays at least this long
export const MS_PER_CAPTION_CHAR = 35; // ...plus time to read its caption

const noop = () => {};

/** How long a beat stays up while playing. */
export function dwellFor(beat) {
  return BASE_DWELL_MS + String(beat?.caption ?? '').length * MS_PER_CAPTION_CHAR;
}

/**
 * createTour(beats, hooks?) -> { play(), pause(), toggle(), next(), prev(), go(i), state }
 *
 * `state` is { index, playing, count } read fresh each time; index is -1 until a beat has been shown.
 * hooks.onBeat(beat, { index, instant }) runs whenever a beat is entered: `instant` is true when
 * reducedMotion() is, so the camera cuts to the beat instead of flying. hooks.onChange(state) follows every change.
 * Reaching the last beat while playing stops the tour there; play() at the end starts over.
 */
export function createTour(beats, {
  reducedMotion = () => false,
  onBeat = noop,
  onChange = noop,
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (id) => clearTimeout(id),
} = {}) {
  const count = beats.length;
  let index = -1;
  let playing = false;
  let timer = null;

  const snapshot = () => ({ index, playing, count });
  const disarm = () => {
    if (timer !== null) cancel(timer);
    timer = null;
  };
  const arm = () => {
    disarm();
    if (playing && index >= 0) timer = schedule(advance, dwellFor(beats[index]));
  };
  function enter(i) {
    index = i;
    onBeat(beats[i], { index: i, instant: Boolean(reducedMotion()) });
    arm();
    onChange(snapshot());
  }
  function advance() {
    timer = null;
    if (index < count - 1) enter(index + 1);
    else pause();
  }
  function pause() {
    const was = playing;
    playing = false;
    disarm();
    if (was) onChange(snapshot());
  }

  return {
    get state() {
      return snapshot();
    },
    /** Show beat i (clamped to the first and last); a non-integer does nothing. */
    go(i) {
      if (count === 0 || !Number.isInteger(i)) return;
      enter(Math.min(count - 1, Math.max(0, i)));
    },
    play() {
      if (count === 0) return;
      playing = true;
      if (index < 0 || index === count - 1) enter(0);
      else {
        arm();
        onChange(snapshot());
      }
    },
    pause,
    toggle() {
      if (playing) pause();
      else this.play();
    },
    next() {
      if (count === 0) return;
      if (index < count - 1) enter(index + 1);
      else pause();
    },
    prev() {
      if (count === 0) return;
      enter(Math.max(0, index - 1));
    },
  };
}
