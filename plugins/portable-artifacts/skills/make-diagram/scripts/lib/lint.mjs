// Geometry lint: finds layouts the renderer would draw badly. Pure function of
// a Geometry (layout-graph.mjs) or SeqGeometry (layout-sequence.mjs) and the
// theme's fonts; every error names a path into the spec (the geometry arrays
// run in spec order, so index i is the spec's index i).
import { measure } from '../../shared/text.mjs';
import { LIMITS } from './schema.mjs';
import { fonts, textRoom, MAX_LABEL_LINES, MAX_WIDENED_TEXT_WIDTH } from './sizes.mjs';
import { NOTE_PAD_X } from './layout-sequence.mjs';

const TOLERANCE = 0.5; // px: rounding noise that is not an overlap or an overflow

const right = (b) => b.x + b.width;
const bottom = (b) => b.y + b.height;
const overlaps = (a, b) => a.x < right(b) - TOLERANCE && right(a) > b.x + TOLERANCE && a.y < bottom(b) - TOLERANCE && bottom(a) > b.y + TOLERANCE;
const within = (inner, outer) => inner.x >= outer.x - TOLERANCE && inner.y >= outer.y - TOLERANCE && right(inner) <= right(outer) + TOLERANCE && bottom(inner) <= bottom(outer) + TOLERANCE;
const widest = (lines, font) => Math.max(0, ...lines.map((l) => measure(l, font)));
const q = (v) => JSON.stringify(v);

// ---- text ---------------------------------------------------------------------

// Too many lines, or a line wider than the room the box leaves for text.
function labelErrors(path, lines, room, font) {
  const errors = [];
  if (lines.length > MAX_LABEL_LINES) {
    errors.push({
      path,
      message: `wraps to ${lines.length} lines in a ${MAX_WIDENED_TEXT_WIDTH} px box; shorten it (${LIMITS.label} characters of ordinary text fit)`,
    });
  }
  const w = widest(lines, font);
  if (w > room + TOLERANCE) {
    errors.push({ path, message: `text is ${Math.ceil(w)} px wide; the box fits ${Math.floor(room)} px — shorten the label` });
  }
  return errors;
}

function noteErrors(path, line, room, font) {
  const w = line === null ? 0 : measure(line, font);
  if (w <= room + TOLERANCE) return [];
  return [{ path, message: `text is ${Math.ceil(w)} px wide; the box fits ${Math.floor(room)} px — shorten the note` }];
}

// ---- graphs -------------------------------------------------------------------

// A node's drawn extent: its box, and for dots and choices the label beside it.
const extents = (n) => (n.labelBox ? [n, n.labelBox] : [n]);

function nodeTextErrors(g, f) {
  return g.nodes.flatMap((n, i) => {
    const room = n.labelBox ? n.labelBox.width : textRoom(n.shape, n.width, n.icon !== null || n.emoji !== null);
    return [...labelErrors(`nodes[${i}].label`, n.lines, room, f.label), ...noteErrors(`nodes[${i}].note`, n.noteLine, room, f.note)];
  });
}

function nodeOverlapErrors(g) {
  const errors = [];
  g.nodes.forEach((b, j) => {
    for (let i = 0; i < j; i++) {
      const a = g.nodes[i];
      if (extents(a).some((ra) => extents(b).some((rb) => overlaps(ra, rb)))) {
        errors.push({ path: `nodes[${j}]`, message: `node ${q(b.id)} overlaps node ${q(a.id)} (nodes[${i}]); split the diagram or shorten the labels` });
        return;
      }
    }
  });
  return errors;
}

function edgeLabelErrors(g) {
  const errors = [];
  g.edges.forEach((e, i) => {
    if (!e.label) return;
    const hit = g.nodes.findIndex((n) => extents(n).some((r) => overlaps(e.label, r)));
    if (hit >= 0) {
      errors.push({ path: `edges[${i}].label`, message: `label ${q(e.label.text)} overlaps node ${q(g.nodes[hit].id)} (nodes[${hit}]); shorten the label or move the nodes apart` });
    }
  });
  return errors;
}

function groupErrors(g) {
  const byId = new Map(g.groups.map((x) => [x.id, x]));
  const errors = [];
  g.nodes.forEach((n, i) => {
    for (let id = n.group; id !== null; id = byId.get(id).parent) {
      if (!within(n, byId.get(id))) {
        errors.push({ path: `nodes[${i}].group`, message: `node ${q(n.id)} lies outside its group ${q(id)}; shorten the label or give the group more room` });
        break;
      }
    }
    const members = new Set();
    for (let id = n.group; id !== null; id = byId.get(id).parent) members.add(id);
    const intruded = g.groups.find((grp) => !members.has(grp.id) && overlaps(n, grp));
    if (intruded) {
      errors.push({ path: `nodes[${i}]`, message: `node ${q(n.id)} lies inside group ${q(intruded.id)} but is not in group ${q(intruded.id)}; give it that group or move the groups apart` });
    }
  });
  g.groups.forEach((grp, i) => {
    if (grp.parent !== null && !within(grp, byId.get(grp.parent))) {
      errors.push({ path: `groups[${i}].parent`, message: `group ${q(grp.id)} lies outside its parent ${q(grp.parent)}; shorten the labels or split the diagram` });
    }
  });
  return errors;
}

function lintGraph(g, f) {
  return [...nodeOverlapErrors(g), ...edgeLabelErrors(g), ...nodeTextErrors(g, f), ...groupErrors(g)];
}

// ---- sequences ----------------------------------------------------------------

function lintSequence(g, f) {
  const errors = [];
  g.participants.forEach((p, i) => {
    errors.push(...labelErrors(`participants[${i}].label`, p.lines, textRoom(p.shape, p.width, p.icon !== null || p.emoji !== null), f.label));
    for (let k = 0; k < i; k++) {
      if (overlaps(g.participants[k], p)) {
        errors.push({ path: `participants[${i}]`, message: `participant ${q(p.id)} overlaps ${q(g.participants[k].id)} (participants[${k}]); shorten the labels` });
        break;
      }
    }
  });
  g.messages.forEach((m, i) => {
    if (!m.label) return;
    const xs = m.points.map((p) => p.x);
    const roomLeft = m.kind === 'self' ? m.points[0].x : Math.min(...xs);
    const roomRight = m.kind === 'self' ? g.width : Math.max(...xs);
    if (m.label.x < roomLeft - TOLERANCE || right(m.label) > roomRight + TOLERANCE) {
      errors.push({ path: `messages[${i}].label`, message: `label ${q(m.label.text)} does not fit between its lifelines; shorten the label` });
    }
  });
  g.notes.forEach((n, i) => {
    const w = widest(n.lines, f.note);
    const room = n.width - 2 * NOTE_PAD_X;
    if (w > room + TOLERANCE) errors.push({ path: `notes[${i}].text`, message: `text is ${Math.ceil(w)} px wide; the box fits ${Math.floor(room)} px — shorten the note` });
    g.notes.slice(0, i).forEach((other, k) => {
      if (overlaps(other, n)) errors.push({ path: `notes[${i}]`, message: `note overlaps notes[${k}]; move one with "after" or shorten the text` });
    });
  });
  g.frames.forEach((fr, i) => {
    if (fr.labelBox && right(fr.labelBox) > right(fr) + TOLERANCE) {
      errors.push({ path: `frames[${i}].label`, message: `label ${q(fr.label)} is wider than its frame; shorten the label` });
    }
  });
  return errors;
}

/**
 * Layout problems in a geometry, as { path, message } errors (empty = fine).
 * `theme` supplies the fonts the text was measured with.
 */
export function lintGeometry(geometry, { theme } = {}) {
  if (!theme) throw new TypeError('lintGeometry needs { theme }: text is measured with the theme fonts');
  const f = fonts(theme);
  return geometry.participants ? lintSequence(geometry, f) : lintGraph(geometry, f);
}
