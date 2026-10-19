// Render-loop policy. Pure (no three, no DOM): the clock and frame scheduler are injected.

export const IDLE_MS = 1500; // stop rendering this long after the last input, tween or animation
const PIXEL_RATIO_CAP = 2;
const PIXEL_RATIO_CAP_COARSE = 1.5;

/** Device pixel ratio capped for the render target: 2, or 1.5 on touch devices. */
export function pixelRatio(devicePixelRatio, isCoarsePointer) {
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(ratio, isCoarsePointer ? PIXEL_RATIO_CAP_COARSE : PIXEL_RATIO_CAP);
}

/**
 * Does this frame keep the loop alive? Damping, tweens and auto-rotate do; scene animation (sway,
 * orbits) does unless the viewer prefers reduced motion, when it is frozen and so never keeps frames coming.
 */
export function isBusy({ animated = false, reducedMotion = false, damping = false, tween = false, autoRotate = false } = {}) {
  return Boolean(damping || tween || autoRotate || (animated && !reducedMotion));
}

/**
 * render(nowMs) draws one frame and returns whether something is still moving (see isBusy).
 * The loop runs only while visible (IntersectionObserver) and active (document not hidden), and stops
 * IDLE_MS after the last busy frame or wake(). wake() starts it again.
 * `visible` / `active` are the starting states (an observer that has not reported yet is `visible: false`).
 * viewable() is whether the scene can be seen right now (visible and active); onViewable(fn) calls fn(viewable)
 * whenever that changes and returns the unsubscribe: what the tour waits on, so it does not run unseen.
 */
export function createLoop({ render, now, raf, caf, visible: startVisible = true, active: startActive = true }) {
  let frameId = null;
  let visible = Boolean(startVisible);
  let active = Boolean(startActive);
  let lastBusy = 0;
  let announced = visible && active;
  const listeners = new Set();

  const canRun = () => visible && active;
  function announce() {
    const now_ = canRun();
    if (now_ === announced) return;
    announced = now_;
    for (const fn of [...listeners]) fn(now_);
  }

  function frame() {
    frameId = null;
    if (!canRun()) return;
    const t = now();
    if (render(t)) lastBusy = t;
    // render() may wake us (OrbitControls fires "change" from update()), which already queued a frame.
    if (frameId === null && t - lastBusy < IDLE_MS) frameId = raf(frame);
  }

  function start() {
    if (frameId === null && canRun()) frameId = raf(frame);
  }

  function sleep() {
    if (frameId === null) return;
    caf(frameId);
    frameId = null;
  }

  function wake() {
    lastBusy = now();
    start();
  }

  return {
    wake,
    sleep,
    setVisible(isVisible) {
      visible = Boolean(isVisible);
      if (visible) wake();
      else sleep();
      announce();
    },
    setActive(isActive) {
      active = Boolean(isActive);
      if (active) wake();
      else sleep();
      announce();
    },
    viewable: canRun,
    onViewable(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
