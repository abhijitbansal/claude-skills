// Camera controls: OrbitControls with damping, auto-orbit until the first input, arrow-key orbit,
// and an eased fly-to. update() reports what is still moving so the loop can go idle.
import { Spherical, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const AUTO_ROTATE_SPEED = 0.8;
const DAMPING = 0.08;
const KEY_STEP = 0.12; // radians per arrow press
const FLY_MS = 900;
const MAX_DT = 0.05; // seconds; a frame after a long pause must not jump the camera
const POLAR_MARGIN = 0.05;
const MIN_DISTANCE_SHARE = 0.15; // zoom in this far, in overview distances...
const FOCUS_CLEARANCE = 0.9; // ...but never nearer than this share of the closest authored view, so every focus view can land
const MIN_DISTANCE_FLOOR = 0.2; // world units: a scene is never zoomed into its own camera plane
const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - ((-2 * k + 2) ** 3) / 2);

/** How close the camera may come: a share of the overview distance, kept clear of the nearest authored focus view. */
export function minDistanceFor(overview, nearestFocus = Infinity) {
  return Math.max(MIN_DISTANCE_FLOOR, Math.min(overview * MIN_DISTANCE_SHARE, nearestFocus * FOCUS_CLEARANCE));
}

/**
 * createControls({ camera, dom, target, polarMax, polarMin, distance, nearestFocus, reducedMotion, onInput })
 * `nearestFocus` is the distance of the closest authored focus view (Infinity for none): zooming stops short of it, not of the overview.
 * `reducedMotion()` is read live: no auto-rotate, and fly-to cuts instead of easing.
 * `onInput(reason)` fires for anything that should wake the loop.
 */
export function createControls({ camera, dom, target, polarMax, polarMin = 0, distance, nearestFocus = Infinity, reducedMotion, onInput }) {
  const controls = new OrbitControls(camera, dom);
  controls.enableDamping = true;
  controls.dampingFactor = DAMPING;
  controls.autoRotateSpeed = AUTO_ROTATE_SPEED;
  controls.minDistance = minDistanceFor(distance, nearestFocus);
  controls.maxDistance = distance * 4;
  controls.maxPolarAngle = polarMax;
  controls.minPolarAngle = polarMin;
  controls.target.copy(target);
  let sawInput = false;
  let moved = false; // the camera has been taken from its first framing (input or a fly-to)
  let tween = null;
  controls.autoRotate = !reducedMotion();
  controls.update();

  const settle = (reason) => {
    sawInput = true;
    moved = true;
    controls.autoRotate = false;
    tween = null;
    onInput(reason);
  };
  const onPointer = () => settle('pointer');
  const onWheel = () => {
    if (controls.enableZoom) settle('wheel'); // a wheel the page keeps (embedded) is not the viewer taking the camera
  };
  const onKey = (event) => {
    // Only the arrows are ours: the tour listens for Space and the arrows on the document, so other keys
    // must neither stop the drift nor be swallowed. Arrows are consumed here (the tour's use them off-canvas).
    const step = ARROWS[event.key];
    if (!step || event.altKey || event.ctrlKey || event.metaKey) return;
    settle('key');
    event.preventDefault();
    event.stopPropagation();
    const offset = new Vector3().subVectors(camera.position, controls.target);
    const spherical = new Spherical().setFromVector3(offset);
    spherical.theta += step[0] * KEY_STEP;
    spherical.phi = Math.min(polarMax, Math.max(Math.max(POLAR_MARGIN, polarMin), spherical.phi + step[1] * KEY_STEP));
    camera.position.copy(controls.target).add(offset.setFromSpherical(spherical));
    camera.lookAt(controls.target);
  };
  const onChange = () => onInput('change');

  dom.addEventListener('pointerdown', onPointer);
  dom.addEventListener('wheel', onWheel, { passive: true });
  dom.addEventListener('keydown', onKey);
  controls.addEventListener('change', onChange);

  return {
    controls,
    /** Ease the camera to a view (or cut, when instant or reduced motion). */
    flyTo(view, { instant = false } = {}) {
      controls.autoRotate = false;
      moved = true;
      const to = { position: new Vector3(...view.position), target: new Vector3(...view.target) };
      if (instant || reducedMotion()) {
        tween = null;
        camera.position.copy(to.position);
        controls.target.copy(to.target);
        controls.update();
      } else {
        tween = { from: { position: camera.position.clone(), target: controls.target.clone() }, to, start: null };
      }
      onInput('fly');
    },
    /**
     * Whether the scene owns the wheel and touch. Off (an embedded scene in a page that scrolls): the wheel scrolls the page, there
     * is no wheel or pinch zoom, and a vertical swipe on the canvas scrolls the page while a horizontal drag still orbits.
     */
    setCapture(on) {
      controls.enableZoom = on;
      dom.style.touchAction = on ? 'none' : 'pan-y pinch-zoom'; // OrbitControls sets 'none' itself; this runs after it
    },
    /** True until the viewer (or a tour) first moves the camera. */
    untouched: () => !moved,
    /** The overview is now `distance` away: zoom limits follow it. */
    setRange(distanceNow) {
      controls.minDistance = minDistanceFor(distanceNow, nearestFocus);
      controls.maxDistance = distanceNow * 4;
    },
    /** Advance one frame. Returns { damping, tween, autoRotate } for isBusy(). */
    update(nowMs, dtSeconds) {
      if (tween) {
        tween.start ??= nowMs;
        const k = Math.min(1, (nowMs - tween.start) / FLY_MS);
        const e = ease(k);
        camera.position.lerpVectors(tween.from.position, tween.to.position, e);
        controls.target.lerpVectors(tween.from.target, tween.to.target, e);
        if (k >= 1) tween = null;
      }
      const damping = controls.update(Math.min(MAX_DT, dtSeconds));
      return { damping, tween: tween !== null, autoRotate: controls.autoRotate };
    },
    /** The viewer switched reduced motion on: stop drifting. (Switching off does not restart it.) */
    applyReducedMotion() {
      if (reducedMotion()) controls.autoRotate = false;
      else if (!sawInput) controls.autoRotate = true;
    },
    dispose() {
      dom.removeEventListener('pointerdown', onPointer);
      dom.removeEventListener('wheel', onWheel);
      dom.removeEventListener('keydown', onKey);
      controls.removeEventListener('change', onChange);
      controls.dispose();
    },
  };
}
