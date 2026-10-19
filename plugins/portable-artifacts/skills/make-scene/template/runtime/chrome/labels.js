// Graph labels[] (3D text) as an HTML overlay: each is projected from its world point after every draw,
// positioned with a transform, and hidden when it is behind the camera, off the frame, or overlaps a nearer
// label. A long label is cut with an ellipsis (Explore lists group and item names only, so a long axis or group label is only ever shown cut). Text only (textContent).
import { h } from './dom.js';
import { hiddenByOverlap } from './overlap.js';

const MIN_PX = 10;
const MAX_PX = 22;
const PX_PER_SIZE_UNIT = 1.1; // world label size -> font size, at the depth's pixels per unit
const MOVE_EPSILON = 0.5; // px: smaller moves do not touch the DOM
const MAX_WIDTH_VW = 0.4; // a label is at most this share of the viewport wide (and of its host)...
const MAX_WIDTH_HOST = 0.9;
const PAD_X = 6; // ...padding included: it keeps the text glow from being clipped
const LINE_HEIGHT = 1.2; // of the font size, plus padding
const PAD_Y = 1;
const MEASURE_PX = 100; // text is measured once at this size and scaled
const GLYPH_EM = 0.6; // average glyph width when there is no canvas to measure with
const ELLIPSIS = '…';

const clampPx = (n) => Math.max(MIN_PX, Math.min(MAX_PX, n));

/** createLabels({ host, graph }) -> { el, bind(api), drawTo(ctx, ratio), destroy() } */
export function createLabels({ host, graph }) {
  const space = graph.env?.sky === 'space';
  const entries = (graph.labels ?? []).map((label) => ({
    label,
    el: h('span', { class: 'sc-label', text: label.text, hidden: true }),
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
      if (measure) measure.font = `600 ${MEASURE_PX}px ${getComputedStyle(el).fontFamily || 'sans-serif'}`;
    }
    return measure || null;
  }

  const maxWidth = () => Math.max(40, Math.min(MAX_WIDTH_VW * (host.ownerDocument.defaultView?.innerWidth ?? Infinity), MAX_WIDTH_HOST * (el.clientWidth || Infinity)));

  /** The box a label takes on screen at `px`: its text (cut at the cap) plus padding. */
  function widthAt(entry, px) {
    if (entry.width100 === null) entry.width100 = measurer()?.measureText(entry.label.text).width ?? entry.label.text.length * GLYPH_EM * MEASURE_PX;
    return Math.min(maxWidth(), (entry.width100 * px) / MEASURE_PX + 2 * PAD_X);
  }

  function update() {
    const boxes = [];
    const places = new Map(); // entry index -> { x, y, px }
    entries.forEach((entry, index) => {
      const [x, y, z] = entry.label.at;
      const p = api.project(x, y, z);
      if (!p.visible) return;
      const px = Math.round(clampPx(entry.label.size * p.scale * PX_PER_SIZE_UNIT));
      places.set(index, { x: p.x, y: p.y, px });
      boxes.push({ id: index, x: p.x, y: p.y, w: widthAt(entry, px), h: px * LINE_HEIGHT + 2 * PAD_Y, scale: p.scale });
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
      const style = getComputedStyle(entries[0]?.el ?? el);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      for (const entry of entries) {
        if (!entry.shown) continue;
        ctx.font = `600 ${entry.shown.px * ratio}px ${style.fontFamily}`;
        ctx.lineWidth = 3 * ratio;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = space ? '#04050c' : getComputedStyle(el).getPropertyValue('--page') || '#000';
        ctx.fillStyle = style.color;
        const text = cut(ctx, entry.label.text, (maxWidth() - 2 * PAD_X) * ratio);
        ctx.strokeText(text, entry.shown.x * ratio, entry.shown.y * ratio);
        ctx.fillText(text, entry.shown.x * ratio, entry.shown.y * ratio);
      }
    },
    destroy() {
      unsubscribe?.();
      el.remove();
    },
  };
}
