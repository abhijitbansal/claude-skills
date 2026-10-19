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
const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - ((-2 * k + 2) ** 3) / 2);

/**
 * createControls({ camera, dom, target, polarMax, polarMin, distance, reducedMotion, onInput })
 * `reducedMotion()` is read live: no auto-rotate, and fly-to cuts instead of easing.
 * `onInput(reason)` fires for anything that should wake the loop.
 */
export function createControls({ camera, dom, target, polarMax, polarMin = 0, distance, reducedMotion, onInput }) {
  const controls = new OrbitControls(camera, dom);
  controls.enableDamping = true;
  controls.dampingFactor = DAMPING;
  controls.autoRotateSpeed = AUTO_ROTATE_SPEED;
  controls.minDistance = distance * 0.15;
  controls.maxDistance = distance * 4;
  controls.maxPolarAngle = polarMax;
  controls.minPolarAngle = polarMin;
  controls.target.copy(target);
  let sawInput = false;
  let tween = null;
  controls.autoRotate = !reducedMotion();
  controls.update();

  const settle = (reason) => {
    sawInput = true;
    controls.autoRotate = false;
    tween = null;
    onInput(reason);
  };
  const onPointer = () => settle('pointer');
  const onWheel = () => settle('wheel');
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
      const moved = controls.update(Math.min(MAX_DT, dtSeconds));
      return { damping: moved, tween: tween !== null, autoRotate: controls.autoRotate };
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
