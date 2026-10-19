// Legend: one swatch per group, in the group's colour, re-resolved whenever the theme flips.
import { resolveColour } from '../colour.js';
import { h } from './dom.js';

/** createLegend({ parent, graph }) -> { el, retint(palette), destroy() } */
export function createLegend({ parent, graph }) {
  const swatches = (graph.groups ?? []).map((group) => ({ group, sw: h('i', { class: 'sc-sw' }) }));
  const items = swatches.map(({ group, sw }) => h('span', { class: 'sc-lg' }, [sw, h('span', { text: group.name })]));
  // The names are all in Explore and the table: the legend is a visual key only.
  const el = h('div', { class: 'sc-legend', 'aria-hidden': 'true' }, items);
  if (items.length === 0) el.hidden = true;
  parent.append(el);

  return {
    el,
    retint(palette) {
      for (const { group, sw } of swatches) {
        try {
          sw.style.background = resolveColour(group.colour, (name) => palette.readVar(name));
        } catch {
          sw.style.background = '';
        }
      }
    },
    destroy() {
      el.remove();
    },
  };
}
