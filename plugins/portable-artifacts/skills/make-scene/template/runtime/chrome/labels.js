// Graph labels[] (3D text) as an HTML overlay: each is projected from its world point after every draw,
// positioned with a transform, and hidden when it is behind the camera, off the frame, or overlaps a nearer
// label. A long label is cut with an ellipsis (Explore lists group and item names only, so a long axis or group label is only ever shown cut). Text only (textContent).
import { h } from './dom.js';
import { hiddenByOverlap } from './overlap.js';
import { EDGE_MARGIN, fontPx, keepInside, labelClasses } from './label-class.js';

const PX_PER_SIZE_UNIT = 1.1; // world label size -> font size, at the depth's pixels per unit
const MOVE_EPSILON = 0.5; // px: smaller moves do not touch the DOM
const MAX_WIDTH_VW = 0.4; // a label is at most this share of the viewport wide (and of its host)...
const MAX_WIDTH_HOST = 0.9;
const PAD_X = 6; // ...padding included: it keeps the text glow from being clipped
const LINE_HEIGHT = 1.2; // of the font size, plus padding
const PAD_Y = 1;
const MEASURE_PX = 100; // text is measured once at this size and scaled
const GLYPH_EM = 0.6; // average glyph width when there is no canvas to measure with
const CAPS_TRACK_EM = 0.07; // the shared --track-caps, used only if the page's value cannot be read
const FALLBACK_WEIGHT = '600'; // used for measuring only if the page's --strong-weight cannot be read
const ELLIPSIS = '…';

/** createLabels({ host, graph }) -> { el, bind(api), drawTo(ctx, ratio), destroy() } */
export function createLabels({ host, graph }) {
  const space = graph.env?.sky === 'space';
  const labels = graph.labels ?? [];
  const classes = labelClasses(labels);
  const entries = labels.map((label, i) => ({
    label,
    caps: classes[i].includes('pa-caps'), // shown upper-cased and tracked by the shared .pa-caps rule
    centred: classes[i].includes('pa-num'), // a number sits centred on its point (a tick on its gridline), a word sits above it
    el: h('span', { class: classes[i], text: label.text, hidden: true }),
    shown: null, // { x, y, px } as last written; null while hidden
    width100: null, // the text's width at MEASURE_PX
  }));
  const el = h('div', { class: `sc-labels${space ? ' sc-space' : ''}`, 'aria-hidden': 'true', 'data-scene-controls': true }, entries.map((e) => e.el));
  host.append(el);
  let unsubscribe = null;
  let api = null;
  let measure = null; // a 2D context for measuring text, else null (then a glyph average is used)

  function measurer() {
    if (measure === null) {
      try {
        measure = host.ownerDocument.createElement('canvas').getContext('2d') ?? false;
      } catch {
        measure = false;
      }
      if (measure) measure.font = `${strongWeight()} ${MEASURE_PX}px ${getComputedStyle(el).fontFamily || 'sans-serif'}`;
    }
    return measure || null;
  }

  // The page's own weight and caps tracking (theme and type tokens), read once from the element.
  const strongWeight = () => getComputedStyle(el).getPropertyValue('--strong-weight').trim() || FALLBACK_WEIGHT;
  const capsTrackEm = () => Number.parseFloat(getComputedStyle(el).getPropertyValue('--track-caps')) || CAPS_TRACK_EM;
  const shownText = (entry) => (entry.caps ? entry.label.text.toUpperCase() : entry.label.text);

  const maxWidth = () => Math.max(40, Math.min(MAX_WIDTH_VW * (host.ownerDocument.defaultView?.innerWidth ?? Infinity), MAX_WIDTH_HOST * (el.clientWidth || Infinity)));

  /** The box a label takes on screen at `px`: its text (cut at the cap) plus padding. */
  function widthAt(entry, px) {
    if (entry.width100 === null) {
      const text = shownText(entry);
      const tracking = entry.caps ? text.length * capsTrackEm() * MEASURE_PX : 0; // letter-spacing adds to every glyph
      entry.width100 = (measurer()?.measureText(text).width ?? text.length * GLYPH_EM * MEASURE_PX) + tracking;
    }
    return Math.min(maxWidth(), (entry.width100 * px) / MEASURE_PX + 2 * PAD_X);
  }

  function update() {
    const boxes = [];
    const places = new Map(); // entry index -> { x, y, px }: the box's bottom-centre point
    const frame = el.clientWidth;
    entries.forEach((entry, index) => {
      const [x, y, z] = entry.label.at;
      const p = api.project(x, y, z);
      if (!p.visible) return;
      const px = Math.round(fontPx(entry.label.size * p.scale * PX_PER_SIZE_UNIT, entry.caps));
      const w = widthAt(entry, px);
      const h = px * LINE_HEIGHT + 2 * PAD_Y;
      const at = { x: keepInside(p.x, w, frame, EDGE_MARGIN - PAD_X), y: entry.centred ? p.y + h / 2 : p.y, px };
      places.set(index, at);
      boxes.push({ id: index, x: at.x, y: at.y, w, h, scale: p.scale });
    });
    const hidden = hiddenByOverlap(boxes);
    entries.forEach((entry, index) => {
      const place = hidden.has(index) ? undefined : places.get(index);
      const last = entry.shown;
      if (!place) {
        if (last) entry.el.hidden = true;
        entry.shown = null;
        return;
      }
      if (last && Math.abs(last.x - place.x) < MOVE_EPSILON && Math.abs(last.y - place.y) < MOVE_EPSILON && last.px === place.px) return;
      if (!last) entry.el.hidden = false;
      if (!last || last.px !== place.px) entry.el.style.fontSize = `${place.px}px`;
      entry.el.style.transform = `translate(${place.x.toFixed(1)}px, ${place.y.toFixed(1)}px) translate(-50%, -100%)`;
      entry.shown = place;
    });
  }

  // `text` cut to `limit` px with an ellipsis, measured in the context's current font.
  function cut(ctx, text, limit) {
    if (ctx.measureText(text).width <= limit) return text;
    let end = text.length;
    while (end > 1 && ctx.measureText(`${text.slice(0, end)}${ELLIPSIS}`).width > limit) end--;
    return `${text.slice(0, end)}${ELLIPSIS}`;
  }

  return {
    el,
    bind(scene) {
      api = scene;
      unsubscribe = scene.onFrame(update);
      update();
    },
    /** Paint the visible labels onto a 2D context the size of the canvas (`ratio` = canvas pixels per CSS pixel). */
    drawTo(ctx, ratio) {
      const hostStyle = getComputedStyle(el);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      for (const entry of entries) {
        if (!entry.shown) continue;
        const style = getComputedStyle(entry.el); // weight, colour and case as the page draws this label
        const trackPx = Number.parseFloat(style.letterSpacing) || 0;
        ctx.font = `${style.fontWeight} ${entry.shown.px * ratio}px ${style.fontFamily}`;
        if ('letterSpacing' in ctx) ctx.letterSpacing = `${trackPx * ratio}px`;
        ctx.lineWidth = 3 * ratio;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = space ? '#04050c' : hostStyle.getPropertyValue('--page') || '#000';
        ctx.fillStyle = style.color;
        const text = cut(ctx, shownText(entry), (maxWidth() - 2 * PAD_X) * ratio);
        ctx.strokeText(text, entry.shown.x * ratio, entry.shown.y * ratio);
        ctx.fillText(text, entry.shown.x * ratio, entry.shown.y * ratio);
      }
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    },
    destroy() {
      unsubscribe?.();
      el.remove();
    },
  };
}
