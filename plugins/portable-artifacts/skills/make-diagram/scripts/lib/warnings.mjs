// Advice the validator gives without failing a spec: things the documentation asks for that no error enforces, and
// data the drawing drops quietly. Each warning is { path, message } like an error; validate prints it as
// "path: warning: message" and still exits 0 (shared/errors.mjs makeResult / printResult).
import { pathJoin } from '../../shared/errors.mjs';
import { KINDS } from './kinds.mjs';
import { noteIsClipped, MAX_NOTE_WIDTH } from './sizes.mjs';
import { estimateFitScale, isLegible, legibilityMessage } from './legibility.mjs';

const q = (v) => JSON.stringify(v);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const squash = (text) => String(text).replace(/\s+/g, ' ').trim();

// ---- graphs -----------------------------------------------------------------------------------------

// Nodes no edge touches. A node inside a group an edge ends at (architecture edges may end at a group) counts as connected through it.
function orphanNodes(spec) {
  const nodes = spec.nodes ?? [];
  if (nodes.length < 2) return [];
  const parent = new Map((spec.groups ?? []).map((g) => [g.id, g.parent]));
  const ends = new Set((spec.edges ?? []).flatMap((e) => [e.from, e.to]));
  const viaGroup = (group) => {
    for (let at = group, hops = 0; at !== undefined && hops < 16; at = parent.get(at), hops++) if (ends.has(at)) return true;
    return false;
  };
  return nodes.flatMap((n, i) => (ends.has(n.id) || viaGroup(n.group) ? [] : [{
    path: pathJoin('nodes', i),
    message: `node ${q(n.id)} has no edges, so nothing connects it to the rest; add an edge to or from it, or remove it`,
  }]));
}

// kinds.md: "A decision has two or more outgoing edges, each labelled with its answer".
function decisionWarnings(spec) {
  if (spec.type !== 'flow') return [];
  const edges = spec.edges ?? [];
  return (spec.nodes ?? []).flatMap((n, i) => {
    if ((n.kind ?? KINDS.flow.default) !== 'decision') return [];
    const out = edges.map((e, k) => ({ e, k })).filter(({ e }) => e.from === n.id);
    const warnings = [];
    if (out.length < 2) {
      warnings.push({ path: pathJoin('nodes', i), message: `decision ${q(n.id)} has ${plural(out.length, 'outgoing edge')}; a decision branches two or more ways ("yes" and "no")` });
    }
    for (const { e, k } of out) {
      if (e.label === undefined) warnings.push({ path: pathJoin('edges', k), message: `this edge leaves decision ${q(n.id)} with no label; label each branch with its answer ("yes", "no")` });
    }
    return warnings;
  });
}

// Two groups (or two nodes) whose labels differ only in capital letters or spacing read as the same thing on the page.
function caseCollisions(items, name) {
  const seen = new Map();
  return items.flatMap((item, i) => {
    const key = squash(item.label).toLowerCase();
    const first = seen.get(key);
    if (first === undefined) { seen.set(key, i); return []; }
    if (squash(items[first].label) === squash(item.label)) return [];
    return [{ path: pathJoin(pathJoin(name, i), 'label'), message: `${name === 'groups' ? 'group' : 'node'} label ${q(item.label)} differs from ${name}[${first}] ${q(items[first].label)} only by case; give them different names` }];
  });
}

function noteWarnings(spec, theme) {
  return (spec.nodes ?? []).flatMap((n, i) => (n.note !== undefined && noteIsClipped(n.note, theme) ? [{
    path: pathJoin(pathJoin('nodes', i), 'note'),
    message: `the note is clipped on the card at ${MAX_NOTE_WIDTH} px; the Explore panel shows it whole, but shorten it or move the rest to detail`,
  }] : []));
}

// ---- sequences --------------------------------------------------------------------------------------

function idleParticipants(spec) {
  const messages = spec.messages ?? [];
  if ((spec.participants ?? []).length < 2 || messages.length === 0) return [];
  const used = new Set(messages.flatMap((m) => [m.from, m.to]));
  return spec.participants.flatMap((p, i) => (used.has(p.id) ? [] : [{
    path: pathJoin('participants', i),
    message: `participant ${q(p.id)} sends and receives no message; add one or remove it`,
  }]));
}

/** Warnings from the spec alone (it has passed validation). `theme` measures the notes. */
export function semanticWarnings(spec, theme) {
  if (spec.type === 'sequence') return [...idleParticipants(spec), ...caseCollisions(spec.participants ?? [], 'participants')];
  return [
    ...orphanNodes(spec), ...decisionWarnings(spec),
    ...caseCollisions(spec.groups ?? [], 'groups'), ...caseCollisions(spec.nodes ?? [], 'nodes'),
    ...noteWarnings(spec, theme),
  ];
}

/** Warnings from the laid-out drawing: its labels cannot be read at the size the page fits it to. */
export function layoutWarnings(geometry) {
  const size = geometry.drawing ?? geometry;
  const scale = estimateFitScale(size.width, size.height);
  return isLegible(scale) ? [] : [{ path: '', message: `the diagram ${legibilityMessage(scale, undefined, { direction: !geometry.participants })}` }];
}
