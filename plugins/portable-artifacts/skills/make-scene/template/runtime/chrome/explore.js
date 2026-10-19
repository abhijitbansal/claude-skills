// Explore: every group and its items as a list; clicking one flies the camera to it.
// Group rows expand lazily, so a 2000-row scene costs only the group buttons until one is opened.
import { resolveColour } from '../colour.js';
import { h } from './dom.js';

/** The focus key an item flies to: its own (a row label) or else its group's. null when the graph has neither. */
export function focusKeyFor(graph, item) {
  const own = String(item.label).toLowerCase();
  if (Object.hasOwn(graph.focus ?? {}, own)) return own;
  const group = String(graph.groups?.[item.group]?.name ?? '').toLowerCase();
  return Object.hasOwn(graph.focus ?? {}, group) ? group : null;
}

/** [{ index, name, key, items: [{ index, label, display, key }] }]: the list Explore shows, groups in graph order. */
export function exploreModel(graph) {
  const groups = (graph.groups ?? []).map((group, index) => ({
    index,
    name: group.name,
    key: Object.hasOwn(graph.focus ?? {}, group.name.toLowerCase()) ? group.name.toLowerCase() : null,
    items: [],
  }));
  (graph.items ?? []).forEach((item, index) => {
    groups[item.group]?.items.push({ index, label: item.label, display: item.display, key: focusKeyFor(graph, item) });
  });
  return groups;
}

/** Links that carry a label, as plain rows: their exact values are readable here as well as on hover. */
export function linkRows(graph) {
  return (graph.tubes ?? []).filter((t) => t.label !== undefined || t.display !== undefined).map((t) => ({ label: t.label ?? '', display: t.display ?? '' }));
}

/**
 * createExplore({ host, graph, onFly, onToggle }) -> { el, isOpen, open(), close(), toggle(), retint(palette), destroy() }
 * onToggle(open, { hadFocus }) follows every change; hadFocus is true when focus was inside the panel as it closed.
 */
export function createExplore({ host, graph, onFly, onToggle }) {
  const model = exploreModel(graph);
  const links = linkRows(graph);
  const closeButton = h('button', { type: 'button', class: 'sc-btn sc-close', 'aria-label': 'Close Explore (E)', text: 'Close' });
  const list = h('div', { class: 'sc-explore-list' });
  const el = h('aside', { class: 'sc-explore', 'aria-label': 'Explore', hidden: true, 'data-scene-controls': true }, [
    h('div', { class: 'sc-explore-head' }, [h('p', { class: 'sc-explore-title', text: 'Explore' }), closeButton]),
    list,
  ]);
  const swatches = [];

  const row = (entry, className) => {
    const text = [h('span', { class: 'sc-row-label', text: entry.label }), h('span', { class: 'sc-row-value', text: entry.display })];
    if (entry.key === null || entry.key === undefined) return h('div', { class: `${className} sc-row-plain` }, text);
    const button = h('button', { type: 'button', class: className }, text);
    button.addEventListener('click', () => onFly(entry.key));
    return button;
  };

  function section(group) {
    const body = h('div', { class: 'sc-items', hidden: true });
    const sw = h('i', { class: 'sc-sw' });
    swatches.push({ colour: graph.groups[group.index].colour, sw });
    const toggle = h('button', { type: 'button', class: 'sc-group-toggle', 'aria-expanded': 'false' }, [
      sw,
      h('span', { class: 'sc-row-label', text: group.name }),
      h('span', { class: 'sc-row-value', text: String(group.items.length) }),
    ]);
    let filled = false;
    toggle.addEventListener('click', () => {
      const open = body.hidden;
      if (open && !filled) {
        filled = true;
        body.append(...group.items.map((item) => row(item, 'sc-row')));
      }
      body.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
    });
    const head = h('div', { class: 'sc-group-head' }, [toggle]);
    if (group.key !== null) {
      const view = h('button', { type: 'button', class: 'sc-btn sc-view', 'aria-label': `View ${group.name}`, text: 'View' });
      view.addEventListener('click', () => onFly(group.key));
      head.append(view);
    }
    return h('section', { class: 'sc-group' }, [head, body]);
  }

  list.append(...model.map(section));
  if (links.length > 0) {
    const body = h('div', { class: 'sc-items', hidden: true }, links.map((link) => row(link, 'sc-row')));
    const toggle = h('button', { type: 'button', class: 'sc-group-toggle', 'aria-expanded': 'false' }, [
      h('span', { class: 'sc-row-label', text: 'Links' }),
      h('span', { class: 'sc-row-value', text: String(links.length) }),
    ]);
    toggle.addEventListener('click', () => {
      body.hidden = !body.hidden;
      toggle.setAttribute('aria-expanded', String(!body.hidden));
    });
    list.append(h('section', { class: 'sc-group' }, [h('div', { class: 'sc-group-head' }, [toggle]), body]));
  }
  host.append(el);

  const setOpen = (open) => {
    if (el.hidden !== open) return;
    const hadFocus = !open && el.contains(el.ownerDocument.activeElement);
    el.hidden = !open;
    onToggle(open, { hadFocus });
  };
  closeButton.addEventListener('click', () => setOpen(false));

  return {
    el,
    isOpen: () => !el.hidden,
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(el.hidden),
    retint(palette) {
      for (const { colour, sw } of swatches) {
        try {
          sw.style.background = resolveColour(colour, (name) => palette.readVar(name));
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
