// Page assembly: one self-contained HTML file around a built diagram. Theme CSS
// and fonts, diagram CSS, the SVG, a hidden text alternative, a JSON data block
// and the inlined runtime (template/viewer.js core + template/toolbar.js chrome).
// No network, no LLM. Every string from the spec goes through esc().
import fs from 'node:fs';
import { themeCss } from '../../shared/theme.mjs';
import { esc } from './svg.mjs';
import { parentMap } from './steps.mjs';

const TEMPLATE = new URL('../../template/viewer.html', import.meta.url);
const CORE = new URL('../../template/viewer.js', import.meta.url);
const CHROME = new URL('../../template/toolbar.js', import.meta.url);

export const MAX_PAGE_BYTES = 400 * 1024;

// JSON that is safe inside <script type="application/json">.
export function jsonForScript(obj) {
  return JSON.stringify(obj)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll(' ', '\\u2028')
    .replaceAll(' ', '\\u2029');
}

// Inline script text must not close its tag or open an HTML comment.
const inlineCode = (code) => code.replace(/<\/(script)/gi, '<\\/$1').replaceAll('<!--', '<\\!--');
const oneLine = (text) => String(text).replace(/\s+/g, ' ').trim();
const round = (v) => Math.round(v * 10) / 10;
const box = (x, y, w, h) => [round(x), round(y), round(w), round(h)];

function union(a, b) {
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  return { x: x0, y: y0, width: Math.max(a.x + a.width, b.x + b.width) - x0, height: Math.max(a.y + a.height, b.y + b.height) - y0 };
}

// ---- data block -----------------------------------------------------------------

// Who is next to whom: id -> { nodes: neighbour ids, edges: incident edge ids }.
function adjacencyOf(links) {
  const adjacency = {};
  const at = (id) => (adjacency[id] ??= { nodes: [], edges: [] });
  for (const { id, from, to } of links) {
    for (const [self, other] of [[from, to], [to, from]]) {
      const a = at(self);
      if (!a.edges.includes(id)) a.edges.push(id);
      if (other !== self && !a.nodes.includes(other)) a.nodes.push(other);
    }
  }
  return adjacency;
}

// id -> [x, y, w, h]: what the camera fits when a step focuses the id.
function boxesOf(geometry) {
  const boxes = {};
  for (const g of geometry.groups ?? []) boxes[g.id] = box(g.x, g.y, g.width, g.height);
  for (const n of [...(geometry.nodes ?? []), ...(geometry.participants ?? [])]) {
    const whole = n.labelBox ? union(n, n.labelBox) : n; // a dot's label sits beside it
    boxes[n.id] = box(whole.x, whole.y, whole.width, whole.height);
  }
  for (const m of geometry.messages ?? []) {
    const xs = m.points.map((p) => p.x);
    const ys = m.points.map((p) => p.y);
    let shape = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    if (m.label) shape = union(shape, m.label);
    boxes[m.id] = box(shape.x, shape.y, shape.width, shape.height);
  }
  return boxes;
}

function dataOf(spec, built) {
  const links = spec.type === 'sequence' ? built.geometry.messages : built.geometry.edges;
  return {
    type: spec.type,
    title: spec.title,
    animate: spec.animate === true,
    width: built.width,
    height: built.height,
    steps: built.steps,
    ids: built.ids,
    adjacency: adjacencyOf(links),
    edges: Object.fromEntries(links.map((l) => [l.id, [l.from, l.to]])),
    parents: Object.fromEntries(parentMap(spec)),
    boxes: boxesOf(built.geometry),
  };
}

// ---- hidden text alternative --------------------------------------------------------

const li = (text) => `<li>${esc(text)}</li>`;

function graphText(spec) {
  const label = new Map([...(spec.groups ?? []), ...spec.nodes].map((x) => [x.id, oneLine(x.label)]));
  const nodeLine = (n) => `${oneLine(n.label)}${n.kind ? ` (${n.kind})` : ''}${n.note ? `: ${oneLine(n.note)}` : ''}`;
  const level = (parent) => {
    const groups = (spec.groups ?? []).filter((g) => (g.parent ?? null) === parent);
    const members = spec.nodes.filter((n) => (n.group ?? null) === parent);
    return [
      ...members.map((n) => li(nodeLine(n))),
      ...groups.map((g) => `<li>${esc(`Group ${oneLine(g.label)}`)}<ul>${level(g.id)}</ul></li>`),
    ].join('');
  };
  const edges = (spec.edges ?? []).map((e) => {
    const arrow = e.both ? '↔' : '→';
    return li(`${label.get(e.from)} ${arrow} ${label.get(e.to)}${e.label ? `: ${oneLine(e.label)}` : ''}`);
  });
  return `<h3>Nodes</h3><ul>${level(null)}</ul>${edges.length ? `<h3>Connections</h3><ul>${edges.join('')}</ul>` : ''}`;
}

function sequenceText(spec) {
  const label = new Map(spec.participants.map((p) => [p.id, oneLine(p.label)]));
  const position = new Map((spec.messages ?? []).map((m, i) => [m.id, i + 1]));
  const people = spec.participants.map((p) => li(`${oneLine(p.label)}${p.kind ? ` (${p.kind})` : ''}`));
  const messages = (spec.messages ?? []).map((m) => li(`${label.get(m.from)} → ${label.get(m.to)}${m.label ? `: ${oneLine(m.label)}` : ''}${m.kind && m.kind !== 'sync' ? ` (${m.kind})` : ''}`));
  const frames = (spec.frames ?? []).map((f) => {
    const nums = f.messages.map((id) => position.get(id));
    return li(`${f.kind}${f.label ? ` ${oneLine(f.label)}` : ''}: messages ${Math.min(...nums)} to ${Math.max(...nums)}`);
  });
  return `<h3>Participants</h3><ul>${people.join('')}</ul>${messages.length ? `<h3>Messages in order</h3><ol>${messages.join('')}</ol>` : ''}${frames.length ? `<h3>Frames</h3><ul>${frames.join('')}</ul>` : ''}`;
}

function textAlternative(spec) {
  const body = spec.type === 'sequence' ? sequenceText(spec) : graphText(spec);
  const subtitle = spec.subtitle ? `<p>${esc(oneLine(spec.subtitle))}</p>` : '';
  return `<section class="sr-only" aria-label="Diagram as text"><h2>${esc(spec.title)}</h2>${subtitle}${body}</section>`;
}

// ---- page ---------------------------------------------------------------------------------

/**
 * The finished page for `spec`. `built` is buildDiagram's result and `theme`
 * the loaded theme it was built with.
 */
export function renderViewer(spec, built, { theme }) {
  const parts = {
    TITLE: esc(spec.title),
    SUBTITLE: spec.subtitle ? `<p class="sub">${esc(spec.subtitle)}</p>` : '',
    THEME: themeCss(theme),
    DIAGRAM_CSS: built.css,
    SVG: built.svg,
    TEXT: textAlternative(spec),
    DATA: jsonForScript(dataOf(spec, built)),
    CORE: inlineCode(fs.readFileSync(CORE, 'utf8')),
    CHROME: inlineCode(fs.readFileSync(CHROME, 'utf8')),
  };
  return fs.readFileSync(TEMPLATE, 'utf8').replace(/<!--@(\w+)-->/g, (_, key) => parts[key] ?? '');
}
