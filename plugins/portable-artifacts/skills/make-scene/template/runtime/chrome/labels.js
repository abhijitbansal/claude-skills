// Graph labels[] (3D text) as an HTML overlay: each is projected from its world point after every draw,
// positioned with a transform, and hidden when it is behind the camera or off the frame. Text only (textContent).
import { h } from './dom.js';

const MIN_PX = 10;
const MAX_PX = 22;
const PX_PER_SIZE_UNIT = 1.1; // world label size -> font size, at the depth's pixels per unit
const MOVE_EPSILON = 0.5; // px: smaller moves do not touch the DOM

const clampPx = (n) => Math.max(MIN_PX, Math.min(MAX_PX, n));

/** createLabels({ host, graph }) -> { el, bind(api), drawTo(ctx, ratio), destroy() } */
export function createLabels({ host, graph }) {
  const space = graph.env?.sky === 'space';
  const entries = (graph.labels ?? []).map((label) => ({
    label,
    el: h('span', { class: 'sc-label', text: label.text, hidden: true }),
    shown: null, // { x, y, px } as last written
  }));
  const el = h('div', { class: `sc-labels${space ? ' sc-space' : ''}`, 'aria-hidden': 'true', 'data-scene-controls': true }, entries.map((e) => e.el));
  host.append(el);
  let unsubscribe = null;
  let api = null;

  function update() {
    for (const entry of entries) {
      const [x, y, z] = entry.label.at;
      const p = api.project(x, y, z);
      if (!p.visible) {
        if (entry.shown) entry.el.hidden = true;
        entry.shown = null;
        continue;
      }
      const px = Math.round(clampPx(entry.label.size * p.scale * PX_PER_SIZE_UNIT));
      const last = entry.shown;
      if (last && Math.abs(last.x - p.x) < MOVE_EPSILON && Math.abs(last.y - p.y) < MOVE_EPSILON && last.px === px) continue;
      if (!last) entry.el.hidden = false;
      if (!last || last.px !== px) entry.el.style.fontSize = `${px}px`;
      entry.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
      entry.shown = { x: p.x, y: p.y, px };
    }
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
        ctx.strokeText(entry.label.text, entry.shown.x * ratio, entry.shown.y * ratio);
        ctx.fillText(entry.label.text, entry.shown.x * ratio, entry.shown.y * ratio);
      }
    },
    destroy() {
      unsubscribe?.();
      el.remove();
    },
  };
}
