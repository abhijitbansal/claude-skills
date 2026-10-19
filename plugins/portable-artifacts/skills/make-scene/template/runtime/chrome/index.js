// The chrome around a scene: toolbar (Explore, Tour, Full screen, PNG), tooltip, legend, Explore panel,
// tour transport, text labels and the keyboard shortcuts. createChrome() builds the DOM before the 3D view
// mounts (the view needs to find the [data-scene-controls] elements); bind(api) wires it to the view.
import { readPalette, watchTheme } from '../theme.js';
import { h, isActivatable, isTypingTarget } from './dom.js';
import { createExplore } from './explore.js';
import { savePng } from './export.js';
import { createFullscreen } from './fullscreen.js';
import { createLabels } from './labels.js';
import { createLegend } from './legend.js';
import { createTooltip } from './tooltip.js';
import { createTour } from './tour.js';
import { createTransport } from './transport.js';

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';
const FALLBACK_STATE = 'fallback';

const button = (text, props) => h('button', { type: 'button', class: 'sc-btn', 'aria-pressed': 'false', ...props, text });

/** createChrome(host, graph, opts) -> { bind(api), destroy() }. opts: { globalKeys, reducedMotion }. */
export function createChrome(host, graph, opts = {}) {
  const win = host.ownerDocument.defaultView;
  const doc = host.ownerDocument;
  host.classList.add('pa-scene', 'sc-js');
  if (graph.env?.sky === 'space') host.classList.add('sc-space');
  const reduced = () => opts.reducedMotion ?? win.matchMedia(REDUCED_QUERY).matches;
  const beats = graph.tour ?? [];
  let api = null;
  let unwatch = null;

  const status = h('p', { class: 'sc-status', role: 'status', hidden: true });
  const exploreButton = button('Explore', { 'aria-keyshortcuts': 'E', title: 'Explore every group and item (E)' });
  const tourButton = beats.length > 0 ? button('Tour', { 'aria-keyshortcuts': 'P', title: 'Play the guided tour (P)' }) : null;
  const fullButton = button('Full screen', { 'aria-keyshortcuts': 'F', title: 'Full screen (F)' });
  const pngButton = button('PNG', { 'aria-label': 'Save a PNG of this view', title: 'Save a PNG of this view' });
  pngButton.removeAttribute('aria-pressed');
  const toolbar = h('div', { class: 'sc-toolbar', role: 'toolbar', 'aria-label': 'Scene controls', 'data-scene-controls': true },
    [exploreButton, tourButton, fullButton, pngButton].filter(Boolean));
  const bottom = h('div', { class: 'sc-bottom', 'data-scene-controls': true });
  host.append(toolbar, bottom, status);

  const tooltip = createTooltip({ host, graph });
  const legend = createLegend({ parent: bottom, graph });
  const labels = createLabels({ host, graph });
  const fly = (key, instant = false) => api?.flyTo(key, { instant: instant || reduced() });
  const explore = createExplore({
    host,
    graph,
    onFly: (key) => fly(key),
    onToggle: (open) => {
      tooltip.hide();
      exploreButton.setAttribute('aria-pressed', String(open));
      api?.wake('chrome');
    },
  });
  let transport = null;
  const tour = createTour(beats, {
    reducedMotion: reduced,
    onBeat: (beat, { instant }) => {
      fly(beat.focus, instant);
      api?.travel(beat.path ?? null, { reverse: beat.reverse === true, instant });
    },
    onChange: (state) => transport?.render(state),
  });
  if (tourButton) {
    transport = createTransport({ parent: bottom, beats, tour });
    transport.render(tour.state);
    transport.closeButton.addEventListener('click', () => closeTour());
  }
  const fullscreen = createFullscreen(host, () => {
    fullButton.setAttribute('aria-pressed', String(fullscreen.isOn()));
    api?.wake('resize');
  });

  function openTour(play = false) {
    if (!transport) return;
    tooltip.hide();
    transport.show();
    host.classList.add('sc-touring');
    tourButton.setAttribute('aria-pressed', 'true');
    if (play) tour.play();
    else tour.go(0);
  }
  function closeTour() {
    tour.pause();
    api?.travel(null);
    transport.hide();
    host.classList.remove('sc-touring');
    tourButton.setAttribute('aria-pressed', 'false');
  }
  const say = (text) => {
    status.textContent = text;
    status.hidden = text === '';
  };

  exploreButton.addEventListener('click', () => explore.toggle());
  tourButton?.addEventListener('click', () => (transport.isShown() ? closeTour() : openTour()));
  fullButton.addEventListener('click', () => fullscreen.toggle());
  pngButton.addEventListener('click', () => {
    say('');
    if (api) savePng({ api, title: graph.title, labels: graph.labels?.length ? labels : null, onError: say });
  });

  function onKey(event) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (host.dataset.sceneState === FALLBACK_STATE || isTypingTarget(event.target)) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const touring = transport?.isShown() === true;
    if (key === 'e') explore.toggle();
    else if (key === 'f') fullscreen.toggle();
    else if (key === 'p' && transport) openTour();
    else if (key === ' ' && transport && !isActivatable(event.target)) {
      if (touring) tour.toggle();
      else openTour(true);
    } else if (key === 'ArrowRight' && touring) tour.next();
    else if (key === 'ArrowLeft' && touring) tour.prev();
    else if (key === 'Escape' && (explore.isOpen() || fullscreen.isOn())) {
      explore.close();
      fullscreen.exit();
    } else return;
    event.preventDefault();
  }
  const keyTarget = opts.globalKeys ? doc : host;
  keyTarget.addEventListener('keydown', onKey);

  function retint(palette) {
    legend.retint(palette);
    explore.retint(palette);
  }
  retint(readPalette(doc.documentElement, win));
  unwatch = watchTheme(retint, doc.documentElement, win);

  return {
    bind(scene) {
      api = scene;
      tooltip.bind(scene);
      labels.bind(scene);
      const wantsAutoplay = host.hasAttribute('data-autoplay') && transport && !reduced();
      if (wantsAutoplay && host.dataset.sceneState !== FALLBACK_STATE) openTour(true);
    },
    destroy() {
      keyTarget.removeEventListener('keydown', onKey);
      unwatch?.();
      tour.pause();
      fullscreen.destroy();
      tooltip.destroy();
      legend.destroy();
      labels.destroy();
      explore.destroy();
      transport?.destroy();
      toolbar.remove();
      bottom.remove();
      status.remove();
      host.classList.remove('sc-touring');
    },
  };
}
