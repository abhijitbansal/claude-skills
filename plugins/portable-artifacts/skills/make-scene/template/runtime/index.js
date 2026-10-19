// Scene runtime entry. Bundled by scripts/dev/bundle.mjs into one classic inline script that
// defines window.PAScene.mount. Nothing here touches the DOM at load time.
import { PerspectiveCamera, Raycaster, Scene, Vector2, Vector3, WebGLRenderer } from 'three';
import { createControls } from './controls.js';
import { createLoop, isBusy, pixelRatio } from './loop.js';
import { createChrome } from './chrome/index.js';
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
const NO_HIT = Object.freeze({ item: -1, tube: -1 });
const OUT_OF_VIEW = Object.freeze({ x: 0, y: 0, scale: 0, visible: false });
const OFF_SCREEN_MARGIN = 1.05; // NDC: labels just outside the frame still project, so they slide in

// What the author wrote on an element, captured the first time we touch it. A destroyed mount leaves
// the element hidden or sr-only, so a later mount on the same host must not read that as the original.
const originals = new WeakMap();
function original(el) {
  if (!originals.has(el)) originals.set(el, { display: el.style.display, cssText: el.style.cssText });
  return originals.get(el);
}

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
  return {
    destroy: noop, flyTo: () => false, pick: () => -1, pickHit: () => NO_HIT, project: () => OUT_OF_VIEW,
    travel: noop, traveller: () => null, onFrame: () => noop, renderNow: noop, wake: noop, canvas,
  };
}

/**
 * mount(host, graph, opts?) -> { destroy(), flyTo(focusKey, { instant }), travel(tubeId, { reverse, instant }), traveller(),
 *   pick(clientX, clientY), pickHit(clientX, clientY), project(x, y, z), onFrame(fn), renderNow(), wake(), canvas }
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
  // Showing puts back what the author wrote (original), never a blank that would hand control to the stylesheet.
  const setDisplay = (el, on, shown) => {
    el.style.display = on ? shown ?? original(el).display : 'none';
  };
  for (const el of [fallback, container !== host ? container : null, ...controlEls]) if (el) original(el);
  const show = (state) => {
    host.dataset.sceneState = state;
    const broken = state === 'fallback';
    if (fallback) {
      const { cssText } = original(fallback);
      fallback.hidden = false;
      fallback.style.cssText = state === 'ready' ? `${cssText};${SR_ONLY}` : cssText;
    }
    setDisplay(canvas, !broken, 'block');
    if (container !== host) setDisplay(container, !broken);
    for (const el of controlEls) setDisplay(el, !broken);
  };
  show('loading');
  container.appendChild(canvas);

  const failed = (why, expected = false) => {
    show('fallback');
    // No WebGL is an expected state on a headless or GPU-less machine: info, so a console-clean check is not failed by it.
    // Anything else is unexpected: warn.
    if (why) (expected ? console.info : console.warn)(`make-scene: showing the table instead of the 3D view (${why})`);
    return inert(canvas);
  };

  // Probe WebGL ourselves: three logs an error when it cannot get a context, and this must stay quiet.
  let gl = null;
  try {
    gl = canvas.getContext('webgl2', CANVAS_ATTRS);
  } catch {
    gl = null;
  }
  if (!gl) return failed('WebGL is not available', true);

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
    const projected = new Vector3();
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

    const frameHooks = new Set();
    function draw() {
      renderer.render(scene, camera);
      if (!ready && !lost && !gl.isContextLost()) {
        ready = true;
        show('ready');
      }
      for (const hook of frameHooks) {
        try {
          hook();
        } catch (err) {
          // A broken overlay must not take the scene down: drop it and say so once.
          frameHooks.delete(hook);
          console.warn(`make-scene: a frame hook failed and was removed (${err?.message ?? err})`);
        }
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
      if (isReduced()) {
        built.settle(); // a light mid-journey rests at its destination
        if (built.animated) {
          animClock = 0;
          built.animate(0);
        }
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
      /**
       * Send the travelling light along graph.tubes[].id `tubeId` (against its direction when `reverse`); under reduced
       * motion, or with `instant`, it appears at its destination. null (or an unknown id) hides it.
       */
      travel(tubeId, { reverse = false, instant = false } = {}) {
        built.travel(tubeId, { reverse, instant: instant || isReduced() });
        wake('travel');
      },
      /** { id, at, done, position } of the light while it is shown, else null. */
      traveller: () => built.traveller(),
      /** { item, tube } under a viewport point: graph.items / graph.tubes indices, -1 for none (nothing, decoration, a cell with no row). */
      pickHit(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return NO_HIT;
        ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1));
        if (Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) return NO_HIT;
        camera.updateMatrixWorld();
        raycaster.setFromCamera(ndc, camera);
        // A link's hit tube is fat and invisible, so it must not hide the data it encloses; but decoration (a trunk,
        // a star, a terrain cell without a row) still hides what is behind it. The nearest non-link hit decides:
        // data wins over a link even when the link's tube is nearer; decoration wins over everything behind it.
        const hits = raycaster.intersectObjects(built.pickables, false);
        const solid = hits.find((h) => built.tubeAt(h) < 0);
        if (solid && built.itemAt(solid) >= 0) return { item: built.itemAt(solid), tube: -1 };
        const link = hits.find((h) => built.tubeAt(h) >= 0);
        if (link && (!solid || link.distance < solid.distance)) return { item: built.itemAt(link), tube: built.tubeAt(link) };
        return NO_HIT;
      },
      /** Item index under a viewport point, or -1. */
      pick(clientX, clientY) {
        return api.pickHit(clientX, clientY).item;
      },
      /**
       * World point -> { x, y, scale, visible } in CSS pixels from the canvas's top-left, as of the last draw.
       * `scale` is pixels per world unit at that depth; `visible` is false behind the camera or far outside the frame.
       */
      project(x, y, z) {
        projected.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
        const depth = -projected.z;
        if (depth <= camera.near) return OUT_OF_VIEW;
        projected.applyMatrix4(camera.projectionMatrix);
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        const visible = Math.abs(projected.x) <= OFF_SCREEN_MARGIN && Math.abs(projected.y) <= OFF_SCREEN_MARGIN;
        const scale = h / 2 / (Math.tan((camera.fov * Math.PI) / 360) * depth);
        return { x: (projected.x + 1) * 0.5 * w, y: (1 - projected.y) * 0.5 * h, scale, visible };
      },
      /** Run fn after every draw (the loop's frames and renderNow). Returns the unsubscribe. */
      onFrame(fn) {
        frameHooks.add(fn);
        return () => frameHooks.delete(fn);
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
        show('fallback'); // the host goes back to what it was before mount: table visible, controls hidden
      },
    };
    api.renderNow();
    wake('mount');
    return api;
  } catch (err) {
    return fail(err);
  }
}

/**
 * mountScene(host, graph, opts?) -> the mount() api. Mounts the 3D view and the chrome around it (tooltip, legend,
 * Explore, tour, full screen, PNG export, text labels). opts.globalKeys listens for E, F, P, Space and the
 * arrows on the whole document (a single-scene page); by default only while focus is inside `host`.
 */
function mountScene(host, graph, opts = {}) {
  const chrome = createChrome(host, graph, opts);
  const api = mount(host, graph, opts);
  chrome.bind(api);
  return {
    ...api,
    destroy() {
      chrome.destroy();
      api.destroy();
    },
  };
}

/**
 * Test hook, only when the page URL has ?test: window.PAScene.__project(itemIndex) -> { x, y } viewport point on top of
 * the first drawn instance of that item (the first scene on the page), or null. The browser tests hover it.
 * window.PAScene.__scene is that scene's api (the tests read its travelling light).
 */
function exposeProjection(graph, api) {
  window.PAScene.__scene = api;
  window.PAScene.__project = (itemIndex) => {
    const inst = graph.batches.flatMap((b) => b.instances).find((i) => i[6] === itemIndex);
    if (!inst) return null;
    const at = api.project(inst[0], inst[1] + inst[4] / 2, inst[2]);
    const rect = api.canvas.getBoundingClientRect();
    return at.visible ? { x: rect.left + at.x, y: rect.top + at.y } : null;
  };
}

/** Mount every [data-pa-scene] host that carries its graph in a <script type="application/json"> child. */
function initAll(opts = {}) {
  const mounted = [];
  const hooked = new URLSearchParams(window.location.search).has('test');
  for (const host of document.querySelectorAll('[data-pa-scene]')) {
    const data = host.querySelector('script[type="application/json"]');
    if (!data || host.dataset.sceneInit) continue;
    host.dataset.sceneInit = '1';
    try {
      const graph = JSON.parse(data.textContent);
      const api = mountScene(host, graph, opts);
      mounted.push(api);
      if (hooked && mounted.length === 1) exposeProjection(graph, api);
    } catch (err) {
      console.warn(`make-scene: showing the table instead of the 3D view (${err?.message ?? err})`);
    }
  }
  return mounted;
}

window.PAScene = { mount, mountScene, initAll };
