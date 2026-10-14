// Sequence diagram drawing. Paint order, back to front: frames, lifelines,
// participant headers, notes, message lines, message label plates (plates sit
// above lifelines, so a label between two far-apart lifelines hides any
// lifeline it crosses).
import { lineHeight } from '../../shared/text.mjs';
import { fonts } from './sizes.mjs';
import { family } from './kinds.mjs';
import { legendSvg } from './legend.mjs';
import { roundedPath } from './edges.mjs';
import { esc, num, textLines } from './svg.mjs';
import { shapeSvg, boxContent, plateSvg, edgeSvg, nodeOpen } from './parts.mjs';

const TAB_CHAMFER = 5; // cut off the tab's lower right corner
const NOTE_RADIUS = 3;
const FRAME_RADIUS = 4;

// message kind -> line style class, arrow head
const MESSAGE = {
  sync: { style: 'solid', heads: 'solid' },
  async: { style: 'async', heads: 'open' },
  reply: { style: 'dashed', heads: 'open' },
  self: { style: 'solid', heads: 'solid' },
};

function frameSvg(fr, f) {
  const { x, y, width, height, tab } = fr;
  const tabPath = `M${num(x)} ${num(y)}H${num(x + tab.width)}V${num(y + tab.height - TAB_CHAMFER)}L${num(x + tab.width - TAB_CHAMFER)} ${num(y + tab.height)}H${num(x)}Z`;
  const kindLh = lineHeight(f.group);
  const kind = textLines('pa-frame-kind', [fr.kind], { x: x + tab.width / 2 - TAB_CHAMFER / 4, top: y + (tab.height - kindLh) / 2, lh: kindLh, size: f.group.size });
  let label = '';
  if (fr.labelBox) {
    const lh = lineHeight(f.edge);
    label = textLines('pa-frame-label', [fr.label], { x: fr.labelBox.x, top: fr.labelBox.y + (fr.labelBox.height - lh) / 2, lh, size: f.edge.size, anchor: 'start' });
  }
  return `<g class="pa-frame pa-frame-${esc(fr.kind)}" data-messages="${esc(fr.messages.join(' '))}"><rect class="pa-frame-box" x="${num(x)}" y="${num(y)}" width="${num(width)}" height="${num(height)}" rx="${FRAME_RADIUS}"/><path class="pa-frame-tab" d="${tabPath}"/>${kind}${label}</g>`;
}

function noteSvg(n, f) {
  const lh = lineHeight(f.note);
  const text = textLines('pa-seq-note-text', n.lines, { x: n.x + n.width / 2, top: n.y + (n.height - n.lines.length * lh) / 2, lh, size: f.note.size });
  const after = n.after == null ? '' : ` data-after="${esc(n.after)}"`;
  return `<g class="pa-seq-note" data-over="${esc(n.over.join(' '))}"${after}><rect class="pa-seq-note-box" x="${num(n.x)}" y="${num(n.y)}" width="${num(n.width)}" height="${num(n.height)}" rx="${NOTE_RADIUS}"/>${text}</g>`;
}

function participantSvg(p, label, f) {
  const box = { ...p, noteLine: null };
  return `${nodeOpen({ id: p.id, tone: 'neutral' }, p.kind, label, family('sequence', p.kind))}${shapeSvg(p.shape, p)}${boxContent(box, f)}</g>`;
}

const lifelineSvg = (p) => `<line class="pa-lifeline" data-for="${esc(p.id)}" x1="${num(p.lifeline.x)}" y1="${num(p.lifeline.y1)}" x2="${num(p.lifeline.x)}" y2="${num(p.lifeline.y2)}"/>`;

/** Draw a SeqGeometry: returns { width, height, body, counts } for renderSvg to wrap. */
export function renderSequence(g, spec, theme, prefix) {
  const f = fonts(theme);
  const frames = [...g.frames].sort((a, b) => b.width * b.height - a.width * a.height).map((fr) => frameSvg(fr, f));
  const famOf = new Map(spec.participants.map((p) => [p.id, family('sequence', p.kind)]));
  const messages = g.messages.map((m) => {
    const { style, heads } = MESSAGE[m.kind];
    return edgeSvg({ id: m.id, from: m.from, to: m.to, style, both: false, d: roundedPath(m.points), heads, extra: ` pa-msg-${m.kind}`, family: famOf.get(m.from) }, prefix);
  });
  const plates = g.messages.filter((m) => m.label).map((m) => plateSvg(m.id, m.label, f));
  const body = [
    ...frames,
    ...g.participants.map(lifelineSvg),
    ...g.participants.map((p, i) => participantSvg(p, spec.participants[i].label, f)),
    ...g.notes.map((n) => noteSvg(n, f)),
    ...messages,
    ...plates,
    legendSvg(g.legend, f),
  ].join('');
  return { width: g.width, height: g.height, body, counts: `${g.participants.length} participants and ${g.messages.length} messages` };
}
