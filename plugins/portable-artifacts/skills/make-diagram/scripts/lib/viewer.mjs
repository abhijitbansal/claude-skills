// Page assembly: one self-contained HTML file around a built diagram. Theme CSS
// and fonts, diagram CSS, the SVG, a hidden text alternative, a JSON data block
// and the inlined runtime (template/*.js in the order scripts/lib/runtime.mjs fixes, then template/toolbar.js chrome).
// No network, no LLM. Every string from the spec goes through esc().
import fs from 'node:fs';
import { themeCss } from '../../shared/theme.mjs';
import { esc } from './svg.mjs';
import { runtimeSource } from './runtime.mjs';
import { legendItems } from './legend.mjs';
import { FAMILIES } from './kinds.mjs';

const TEMPLATE = new URL('../../template/viewer.html', import.meta.url);
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
  const notes = (spec.notes ?? []).map((n) => {
    const over = n.over.map((id) => label.get(id)).join(' and ');
    const after = n.after === undefined ? '' : `, after message ${position.get(n.after)}`;
    return li(`${oneLine(n.text)} (over ${over}${after})`);
  });
  return `<h3>Participants</h3><ul>${people.join('')}</ul>${messages.length ? `<h3>Messages in order</h3><ol>${messages.join('')}</ol>` : ''}${frames.length ? `<h3>Frames</h3><ul>${frames.join('')}</ul>` : ''}${notes.length ? `<h3>Notes</h3><ul>${notes.join('')}</ul>` : ''}`;
}

function textAlternative(spec) {
  const body = spec.type === 'sequence' ? sequenceText(spec) : graphText(spec);
  const subtitle = spec.subtitle ? `<p>${esc(oneLine(spec.subtitle))}</p>` : '';
  return `<section class="sr-only" aria-label="Diagram as text"><h2>${esc(spec.title)}</h2>${subtitle}${body}</section>`;
}

// ---- legend overlay ---------------------------------------------------------------------
// The key as HTML in the stage's corner: the in-SVG legend scales with the camera and
// is unreadable at fit on a wide diagram. Same items as the drawn one (legend.mjs).

const LEGEND_TINT = 10; // % of the kind hue in a swatch: the card tint (css.mjs CARD_TINT)
const WIRE_LOOK = { solid: 'solid', dashed: 'dashed', async: 'dotted' };

const legendWord = (it) => (it.kind === 'kind' ? `${it.count} ${it.name}` : it.label);

function legendMark(it) {
  if (it.kind === 'style') return `<i class="lg-wire lg-wire-${WIRE_LOOK[it.style]}"></i>`;
  return `<i class="lg-sw lg-sw-${esc(it.family)}"></i>`;
}

function legendHtml(spec) {
  const items = legendItems(spec).map((it) => `<span class="lg">${legendMark(it)}${esc(legendWord(it))}</span>`);
  return `<div class="legend" data-pa-legend aria-hidden="true">${items.join('')}</div>`;
}

const legendCss = () => [
  ...FAMILIES.map((f) => `.lg-sw-${f}{background:var(--surface);background:color-mix(in srgb,var(--k-${f}) ${LEGEND_TINT}%,var(--surface));border-color:var(--k-${f})}`),
].join('\n');

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
    LEGEND_CSS: legendCss(),
    LEGEND: legendHtml(spec),
    SVG: built.svg,
    TEXT: textAlternative(spec),
    DATA: jsonForScript(built.data),
    CORE: inlineCode(runtimeSource()),
    CHROME: inlineCode(fs.readFileSync(CHROME, 'utf8')),
  };
  return fs.readFileSync(TEMPLATE, 'utf8').replace(/<!--@(\w+)-->/g, (_, key) => parts[key] ?? '');
}
