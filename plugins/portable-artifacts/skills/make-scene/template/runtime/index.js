// Scene runtime entry. Bundled by scripts/dev/bundle.mjs into one classic inline script that
// defines window.PAScene.mount. Nothing here touches the DOM at load time.
import { PerspectiveCamera, Raycaster, Scene, Vector2, Vector3, WebGLRenderer } from 'three';
import { createControls } from './controls.js';
import { createLoop, isBusy, pixelRatio } from './loop.js';
import { buildObjects } from './render.js';
import { readPalette, watchTheme } from './theme.js';

const FOV = 45;
const NEAR = 0.1;
const FIT_MARGIN = 1.15; // breathing room around the scene's bounding sphere
const MAX_DT = 0.1; // seconds of animation time per frame
const CANVAS_ATTRS = { antialias: true, alpha: false, powerPreference: 'high-performance' };
const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';
const COARSE_QUERY = '(pointer: coarse)';
// Visually hidden, still read by screen readers: the table is the accessible view of the scene.
const SR_ONLY = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap';

const noop = () => {};

/** Dolly the camera straight back from the scene's centre until its bounding sphere fits the view (never moves it closer). */
function fitCamera(camera, extent, aspect) {
  const half = (FOV * Math.PI) / 360;
  const limit = Math.min(half, Math.atan(Math.tan(half) * aspect));
  const need = ((extent.diag / 2) / Math.sin(limit)) * FIT_MARGIN;
  const offset = camera.position.clone().sub(extent.center);
  const have = offset.length();
  if (have > 0 && have < need) camera.position.copy(extent.center).add(offset.multiplyScalar(need / have));
}

function inert(canvas) {
  return { destroy: noop, flyTo: () => false, pick: () => -1, renderNow: noop, wake: noop, canvas };
}

/**
 * mount(host, graph, opts?) -> { destroy(), flyTo(focusKey, { instant }), pick(clientX, clientY), renderNow(), wake(), canvas }
 *
 * host contains an optional [data-scene-canvas] (where the canvas goes; the host itself if absent), a
 * [data-scene-fallback] element (the semantic table/svg: fully visible until the first good frame and again
 * whenever WebGL is unavailable or lost; visually hidden but still in the accessibility tree while the 3D
 * view works) and any [data-scene-controls] elements (hidden with the canvas).
 * host.dataset.sceneState is "loading", "ready" or "fallback". opts.reducedMotion overrides the media query.
 */
function mount(host, graph, opts = {}) {
  const doc = host.ownerDocument;
  const win = doc.defaultView;
  const container = host.querySelector('[data-scene-canvas]') ?? host;
  const fallback = host.querySelector('[data-scene-fallback]');
  const controlEls = [...host.querySelectorAll('[data-scene-controls]')];
  const canvas = doc.createElement('canvas');
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', String(graph.title ?? ''));
  Object.assign(canvas.style, { display: 'block', width: '100%', height: '100%', touchAction: 'none' });

  // Hiding goes through inline display: an author `display` on these elements would beat the [hidden] attribute.
  const fallbackStyle = fallback?.style.cssText ?? '';
  const setDisplay = (el, on, shown) => {
    el.style.display = on ? shown : 'none';
  };
  const show = (state) => {
    host.dataset.sceneState = state;
    const broken = state === 'fallback';
    if (fallback) {
      fallback.hidden = false;
      fallback.style.cssText = state === 'ready' ? `${fallbackStyle};${SR_ONLY}` : fallbackStyle;
    }
    setDisplay(canvas, !broken, 'block');
    if (container !== host) setDisplay(container, !broken, '');
    for (const el of controlEls) setDisplay(el, !broken, '');
  };
  show('loading');
  container.appendChild(canvas);

  const failed = (why) => {
    show('fallback');
    if (why) console.warn(`make-scene: showing the table instead of the 3D view (${why})`);
    return inert(canvas);
  };

  // Probe WebGL ourselves: three logs an error when it cannot get a context, and this must stay quiet.
  let gl = null;
  try {
    gl = canvas.getContext('webgl2', CANVAS_ATTRS);
  } catch {
    gl = null;
  }
  if (!gl) return failed('WebGL is not available');

  // One idempotent teardown for destroy(), a failed mount and a failed frame: each setup step registers
  // its own undo, so a throw part-way through still releases everything created so far.
  const undo = [];
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    for (const step of undo.reverse()) {
      try {
        step();
      } catch {
        // already gone
      }
    }
  };
  const fail = (err) => {
    cleanup();
    return failed(err?.message ?? String(err));
  };

  try {
    const renderer = new WebGLRenderer({ canvas, context: gl });
    undo.push(() => {
      renderer.forceContextLoss();
      renderer.dispose();
    });
    const scene = new Scene();
    const camera = new PerspectiveCamera(FOV, 1, NEAR, 1000);
    const built = buildObjects(graph, readPalette(doc.documentElement, win));
    undo.push(() => built.dispose());
    camera.far = built.extent.far;
    camera.position.set(...graph.camera.position);
    fitCamera(camera, built.extent, Math.max(1, container.clientWidth || host.clientWidth) / Math.max(1, container.clientHeight || host.clientHeight));
    scene.add(built.root);
    scene.background = built.background;
    scene.fog = built.fog;

    const reducedQuery = win.matchMedia(REDUCED_QUERY);
    const isReduced = () => opts.reducedMotion ?? reducedQuery.matches;
    const target = new Vector3(...graph.camera.target);
    const distance = Math.max(1, camera.position.distanceTo(target));
    const raycaster = new Raycaster();
    const ndc = new Vector2();
    let animClock = 0;
    let lastTs = null;
    let ready = false;
    let size = '';
    let lost = false;
    let controlsApi;

    function resize() {
      const w = Math.max(1, container.clientWidth || host.clientWidth);
      const h = Math.max(1, container.clientHeight || host.clientHeight);
      const ratio = pixelRatio(win.devicePixelRatio, win.matchMedia(COARSE_QUERY).matches);
      const key = `${w}x${h}@${ratio}`;
      if (key === size) return;
      size = key;
      renderer.setPixelRatio(ratio);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    function draw() {
      renderer.render(scene, camera);
      if (!ready && !lost && !gl.isContextLost()) {
        ready = true;
        show('ready');
      }
    }

    function renderFrame(ts) {
      const dt = lastTs === null ? 1 / 60 : Math.max(0, (ts - lastTs) / 1000);
      lastTs = ts;
      resize();
      const reduced = isReduced();
      if (built.animated && !reduced) {
        animClock += Math.min(dt, MAX_DT);
        built.animate(animClock);
      }
      const moving = controlsApi.update(ts, dt);
      draw();
      return isBusy({ animated: built.animated, reducedMotion: reduced, ...moving });
    }

    const loop = createLoop({
      now: () => win.performance.now(),
      raf: (cb) => win.requestAnimationFrame(cb),
      caf: (id) => win.cancelAnimationFrame(id),
      render: (ts) => {
        try {
          return renderFrame(ts);
        } catch (err) {
          fail(err);
          return false;
        }
      },
    });
    undo.push(() => loop.setActive(false)); // a deactivated loop cannot be woken again
    const wake = (reason) => loop.wake(reason);

    controlsApi = createControls({
      camera, dom: canvas, target, distance, reducedMotion: isReduced, onInput: wake,
      polarMax: graph.env?.sky === 'space' ? Math.PI - 0.05 : Math.PI * 0.495,
    });
    undo.push(() => controlsApi.dispose());

    const onLost = (event) => {
      event.preventDefault();
      lost = true;
      ready = false;
      loop.sleep();
      show('fallback');
    };
    const onRestored = () => {
      lost = false;
      size = '';
      show('loading');
      draw();
      wake('restored');
    };
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    undo.push(() => {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
    });

    undo.push(watchTheme((palette) => {
      built.retint(palette);
      wake('theme');
    }, doc.documentElement, win));
    const onReduced = () => {
      controlsApi.applyReducedMotion();
      if (isReduced() && built.animated) {
        animClock = 0;
        built.animate(0);
      }
      wake('motion');
    };
    reducedQuery.addEventListener('change', onReduced);
    undo.push(() => reducedQuery.removeEventListener('change', onReduced));
    const onVisibility = () => loop.setActive(!doc.hidden);
    doc.addEventListener('visibilitychange', onVisibility);
    undo.push(() => doc.removeEventListener('visibilitychange', onVisibility));
    if (typeof win.ResizeObserver === 'function') {
      const resizeObserver = new win.ResizeObserver(() => wake('resize'));
      resizeObserver.observe(container);
      undo.push(() => resizeObserver.disconnect());
    }
    if (typeof win.IntersectionObserver === 'function') {
      const intersection = new win.IntersectionObserver((entries) => loop.setVisible(entries[entries.length - 1].isIntersecting));
      intersection.observe(host);
      undo.push(() => intersection.disconnect());
    }

    const api = {
      canvas,
      wake,
      /** Fly to graph.focus[key] (keys are lowercased). Returns false for an unknown key. */
      flyTo(focusKey, { instant = false } = {}) {
        const key = String(focusKey).toLowerCase();
        if (!graph.focus || !Object.hasOwn(graph.focus, key)) return false;
        controlsApi.flyTo(graph.focus[key], { instant });
        return true;
      },
      /** Item index under a viewport point, or -1 (nothing, decoration, or a cell with no row). */
      pick(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return -1;
        ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1));
        if (Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) return -1;
        camera.updateMatrixWorld();
        raycaster.setFromCamera(ndc, camera);
        const [hit] = raycaster.intersectObjects(built.pickables, false);
        return hit ? built.itemAt(hit) : -1;
      },
      /** Draw synchronously (e.g. before canvas.toDataURL for a PNG export). */
      renderNow() {
        if (cleaned) return;
        resize();
        controlsApi.controls.update();
        draw();
      },
      destroy() {
        cleanup();
        canvas.remove();
      },
    };
    api.renderNow();
    wake('mount');
    return api;
  } catch (err) {
    return fail(err);
  }
}

window.PAScene = { mount };
