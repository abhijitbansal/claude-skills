// Hover / tap tooltip: the exact label and value under the pointer. Text only (textContent).
import { h } from './dom.js';

const OFFSET = 14; // px from the pointer
const TAP_SLOP = 8; // px a touch may move and still be a tap
const TAP_MS = 500; // longest touch that is still a tap

/** What the tooltip says for a pick result { item, tube }: { label, display } or null. Items win over the link they sit on. */
export function describeHit(graph, hit) {
  const item = graph.items?.[hit.item];
  if (item) return { label: item.label, display: item.display };
  const tube = graph.tubes?.[hit.tube];
  if (tube && (tube.label !== undefined || tube.display !== undefined)) return { label: tube.label ?? '', display: tube.display ?? '' };
  return null;
}

/** createTooltip({ host, graph }) -> { el, bind(api), destroy() } */
export function createTooltip({ host, graph }) {
  const label = h('strong', { class: 'sc-tip-label' });
  const value = h('span', { class: 'sc-tip-value' });
  const el = h('div', { class: 'sc-tip', role: 'tooltip', hidden: true }, [label, value]);
  host.append(el);

  let frame = 0;
  let pending = null;
  let touch = null;
  const off = [];

  const hide = () => {
    el.hidden = true;
  };
  function show(text, clientX, clientY) {
    label.textContent = text.label;
    value.textContent = text.display;
    label.hidden = text.label === '';
    value.hidden = text.display === '';
    el.hidden = false;
    const box = host.getBoundingClientRect();
    const x = clientX - box.left;
    const y = clientY - box.top;
    const left = x + OFFSET + el.offsetWidth > box.width ? x - OFFSET - el.offsetWidth : x + OFFSET;
    const top = y + OFFSET + el.offsetHeight > box.height ? y - OFFSET - el.offsetHeight : y + OFFSET;
    el.style.transform = `translate(${Math.max(0, Math.round(left))}px, ${Math.max(0, Math.round(top))}px)`;
  }

  return {
    el,
    bind(api) {
      const { canvas } = api;
      const look = (clientX, clientY) => {
        const text = describeHit(graph, api.pickHit(clientX, clientY));
        if (text) show(text, clientX, clientY);
        else hide();
      };
      const on = (type, fn) => {
        canvas.addEventListener(type, fn);
        off.push(() => canvas.removeEventListener(type, fn));
      };
      on('pointermove', (event) => {
        if (event.pointerType === 'touch') {
          if (touch && Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > TAP_SLOP) touch = null;
          return;
        }
        if (event.buttons) return hide(); // dragging the camera
        pending = { x: event.clientX, y: event.clientY };
        frame ||= requestAnimationFrame(() => {
          frame = 0;
          if (pending) look(pending.x, pending.y);
        });
      });
      on('pointerleave', (event) => {
        if (event.pointerType === 'touch') return; // a touch fires this right after pointerup: the tap's tooltip stays
        pending = null;
        hide();
      });
      on('pointerdown', (event) => {
        hide();
        touch = event.pointerType === 'touch' ? { x: event.clientX, y: event.clientY, at: performance.now() } : null;
      });
      on('pointerup', (event) => {
        if (touch && performance.now() - touch.at <= TAP_MS) look(event.clientX, event.clientY);
        touch = null;
      });
      on('pointercancel', () => {
        touch = null;
      });
    },
    hide,
    destroy() {
      cancelAnimationFrame(frame);
      for (const undo of off) undo();
      el.remove();
    },
  };
}
