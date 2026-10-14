// *.diagram.json: loading and the layered validation (schema, then ids,
// references, kinds, icons, limits).
import fs from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import { formatAjvErrors, pathJoin } from '../../shared/errors.mjs';
import { UsageError } from '../../shared/cli.mjs';
import { listThemes } from '../../shared/theme.mjs';
import { themeFor } from './theme.mjs';
import { KINDS, canHoldIcon } from './kinds.mjs';
import { hasIcon, iconSvg, IconError } from './icons.mjs';
import { SCHEMA, LIMITS, NON_SPACE } from './schema.mjs';
import { suggestion, notFound, checkLength, checkCount, checkRefs, registerIds } from './checks.mjs';
import { isOneEmoji, graphemeCount } from './emoji.mjs';
import { checkStories } from './stories.mjs';
import { lintGeometry } from './lint.mjs';

export { UsageError };

const ajv = new Ajv({ allErrors: true, strict: true, verbose: true });
const validateSchema = ajv.compile(SCHEMA);

const q = (v) => JSON.stringify(v);

export function loadSpec(file) {
  const abs = path.resolve(file);
  let text;
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch (e) {
    throw new UsageError(`cannot read ${file}: ${e.code ?? e.message}`);
  }
  try {
    return { spec: JSON.parse(text), dir: path.dirname(abs) };
  } catch (e) {
    throw new UsageError(`${file} is not valid JSON: ${e.message}`);
  }
}

// ---- ids --------------------------------------------------------------

// Edge ids share the flat id space of nodes and groups (the viewer finds an
// element by bare id), so one may not reuse another's. Edge-to-edge duplicates
// are reported as for any other list.
function registerEdgeIds(errors, edges, taken) {
  registerIds(errors, [['edges', edges]]);
  edges.forEach((e, i) => {
    if (e.id === undefined || !taken.has(e.id)) return;
    const what = taken.get(e.id).startsWith('groups') ? 'group' : 'node';
    errors.push({ path: pathJoin(pathJoin('edges', i), 'id'), message: `${q(e.id)} is also a ${what} id; rename one` });
  });
}

// ---- kinds, icons, theme ----------------------------------------------

function checkKind(errors, item, p, type) {
  if (item.kind === undefined) return;
  const allowed = Object.keys(KINDS[type].kinds);
  if (allowed.includes(item.kind)) return;
  errors.push({
    path: pathJoin(p, 'kind'),
    message: `kind ${q(item.kind)} is not valid for ${type} diagrams; ${suggestion(item.kind, allowed, 'allowed')}`,
  });
}

function checkIcon(errors, item, p, type) {
  if (item.icon === undefined) return;
  if (item.kind !== undefined && Object.hasOwn(KINDS[type].kinds, item.kind) && !canHoldIcon(type, item.kind)) {
    errors.push({
      path: pathJoin(p, 'icon'),
      message: `kind ${q(item.kind)} is drawn as a shape without an icon; remove icon or use kind ${q(KINDS[type].default)}`,
    });
    return;
  }
  if (hasIcon(item.icon)) return;
  try {
    iconSvg(item.icon);
  } catch (e) {
    if (!(e instanceof IconError)) throw e;
    errors.push({ path: pathJoin(p, 'icon'), message: e.message });
  }
}

function checkTheme(errors, spec) {
  if (spec.theme === undefined) return;
  const themes = listThemes();
  if (!themes.includes(spec.theme)) {
    errors.push({ path: 'theme', message: `unknown theme ${q(spec.theme)}; ${suggestion(spec.theme, themes)}` });
  }
}

// One emoji in the icon tile. The grapheme rule lives in emoji.mjs; here the
// kind must have a tile at all (the same rule as checkIcon).
function checkEmoji(errors, item, p, type) {
  if (item.emoji === undefined) return;
  const at = pathJoin(p, 'emoji');
  if (item.kind !== undefined && Object.hasOwn(KINDS[type].kinds, item.kind) && !canHoldIcon(type, item.kind)) {
    errors.push({ path: at, message: `kind ${q(item.kind)} is drawn as a shape without an icon; remove emoji or use kind ${q(KINDS[type].default)}` });
    return;
  }
  if (isOneEmoji(item.emoji)) return;
  const n = graphemeCount(item.emoji);
  const problem = n === 1 ? `${q(item.emoji)} is not an emoji` : `${q(item.emoji)} is ${n} characters`;
  errors.push({ path: at, message: `${problem}; use exactly one emoji, like "🛒"` });
}

// Kind, icon, emoji and the text limits shared by nodes and participants.
function checkEntity(errors, item, p, type, noteField) {
  checkKind(errors, item, p, type);
  checkIcon(errors, item, p, type);
  checkEmoji(errors, item, p, type);
  checkLength(errors, item, 'label', p, LIMITS.label);
  if (noteField) checkLength(errors, item, noteField, p, LIMITS.note);
  checkLength(errors, item, 'detail', p, LIMITS.detail);
}

// ---- groups -----------------------------------------------------------

// A reference that must name a group: say so when it names a node instead.
function checkGroupRef(errors, id, p, groupIds, nodeIds) {
  if (groupIds.includes(id)) return;
  const message = nodeIds.includes(id) ? `${q(id)} is a node, not a group; use a group id or remove group` : notFound(id, groupIds, 'groups');
  errors.push({ path: p, message });
}

function parentOf(groups) {
  return new Map(groups.filter((g) => g.parent !== undefined).map((g) => [g.id, g.parent]));
}

// Walks up from `id`; returns the cycle (ids, in order) if one is reached, else
// the number of groups on the chain.
function climb(id, parents) {
  const chain = [];
  for (let cur = id; cur !== undefined; cur = parents.get(cur)) {
    const at = chain.indexOf(cur);
    if (at >= 0) return { cycle: chain.slice(at) };
    chain.push(cur);
  }
  return { depth: chain.length };
}

function checkGroupTree(errors, groups, groupIds, nodeIds) {
  groups.forEach((g, i) => {
    if (g.parent !== undefined) checkGroupRef(errors, g.parent, pathJoin(pathJoin('groups', i), 'parent'), groupIds, nodeIds);
  });
  const parents = parentOf(groups.filter((g) => g.parent === undefined || groupIds.includes(g.parent)));
  const reported = new Set();
  groups.forEach((g, i) => {
    const p = pathJoin(pathJoin('groups', i), 'parent');
    const { cycle, depth } = climb(g.id, parents);
    if (cycle) {
      if (cycle.some((id) => reported.has(id))) return;
      cycle.forEach((id) => reported.add(id));
      const first = groups.findIndex((x) => x.id === cycle[0]);
      errors.push({
        path: pathJoin(pathJoin('groups', first), 'parent'),
        message: `group parents form a cycle: ${[...cycle, cycle[0]].join(' -> ')}; remove parent from one of them`,
      });
    } else if (depth === LIMITS.groupDepth + 1) {
      errors.push({ path: p, message: `group ${q(g.id)} nests ${depth} deep; the limit is ${LIMITS.groupDepth} — move it up a level` });
    }
  });
}

// ---- steps ------------------------------------------------------------

function checkSteps(errors, spec, knownIds) {
  checkCount(errors, spec, 'steps', LIMITS.steps);
  (spec.steps ?? []).forEach((step, i) => {
    const p = pathJoin('steps', i);
    checkLength(errors, step, 'title', p, LIMITS.stepTitle);
    checkLength(errors, step, 'note', p, LIMITS.stepNote);
    for (const field of ['show', 'focus', 'highlight']) checkRefs(errors, step[field], pathJoin(p, field), knownIds);
  });
}

// ---- architecture / flow / state --------------------------------------

function checkEdgeEnd(errors, edge, p, field, ctx) {
  const id = edge[field];
  const at = pathJoin(p, field);
  if (ctx.nodeIds.includes(id)) return;
  if (ctx.groupIds.includes(id)) {
    if (ctx.type !== 'architecture') {
      errors.push({ path: at, message: `${q(id)} is a group; edges may target a group only in architecture diagrams` });
    }
    return;
  }
  errors.push({ path: at, message: notFound(id, ctx.endpoints) });
}

// Groups that enclose `id` (a node or a group), nearest first. Stops at a cycle
// (reported separately by checkGroupTree).
function enclosingGroups(id, ctx) {
  const chain = [];
  for (let cur = ctx.container.get(id); cur !== undefined && !chain.includes(cur); cur = ctx.container.get(cur)) chain.push(cur);
  return chain;
}

// An edge between a group and something inside it (or the group and itself)
// has no sensible route: it would cross the group's own contents.
function checkEnclosedEdge(errors, edge, p, ctx) {
  if (ctx.type !== 'architecture' || !ctx.endpoints.includes(edge.from) || !ctx.endpoints.includes(edge.to)) return;
  if (edge.from === edge.to && ctx.groupIds.includes(edge.from)) {
    errors.push({ path: p, message: `group ${q(edge.from)} cannot connect to itself; connect a node inside it or a different group` });
    return;
  }
  const [inner, outer] = enclosingGroups(edge.from, ctx).includes(edge.to) ? [edge.from, edge.to]
    : enclosingGroups(edge.to, ctx).includes(edge.from) ? [edge.to, edge.from] : [];
  if (inner === undefined) return;
  errors.push({ path: p, message: `${q(inner)} is inside group ${q(outer)}; connect to a node outside it or to the group's sibling` });
}

function checkGraph(spec, errors) {
  const nodes = spec.nodes ?? [];
  const groups = spec.groups ?? [];
  const edges = spec.edges ?? [];
  if (nodes.length === 0) errors.push({ path: 'nodes', message: 'at least one node is required' });
  checkCount(errors, spec, 'nodes', LIMITS.nodes);
  checkCount(errors, spec, 'edges', LIMITS.edges);

  const seen = registerIds(errors, [['groups', groups], ['nodes', nodes]]);
  registerEdgeIds(errors, edges, seen);
  const groupIds = groups.map((g) => g.id);
  const nodeIds = nodes.map((n) => n.id);
  const container = new Map([...groups, ...nodes].map((x) => [x.id, x.parent ?? x.group]).filter(([, c]) => groupIds.includes(c)));
  const ctx = { type: spec.type, groupIds, nodeIds, container, endpoints: spec.type === 'architecture' ? [...groupIds, ...nodeIds] : nodeIds };

  checkGroupTree(errors, groups, groupIds, nodeIds);
  groups.forEach((g, i) => checkLength(errors, g, 'label', pathJoin('groups', i), LIMITS.label));
  nodes.forEach((n, i) => {
    const p = pathJoin('nodes', i);
    checkEntity(errors, n, p, spec.type, 'note');
    if (n.group !== undefined) checkGroupRef(errors, n.group, pathJoin(p, 'group'), groupIds, nodeIds);
  });
  edges.forEach((e, i) => {
    const p = pathJoin('edges', i);
    checkEdgeEnd(errors, e, p, 'from', ctx);
    checkEdgeEnd(errors, e, p, 'to', ctx);
    checkEnclosedEdge(errors, e, p, ctx);
    checkLength(errors, e, 'label', p, LIMITS.edgeLabel);
  });
  checkSteps(errors, spec, [...seen.keys()]);
  checkStories(errors, spec, { endpoints: ctx.endpoints, known: [...seen.keys()] });
}

// ---- sequence ---------------------------------------------------------

function checkMessage(errors, m, p, participantIds) {
  for (const field of ['from', 'to']) {
    if (!participantIds.includes(m[field])) errors.push({ path: pathJoin(p, field), message: notFound(m[field], participantIds) });
  }
  checkLength(errors, m, 'label', p, LIMITS.edgeLabel);
  if (m.kind === 'self' && m.from !== m.to) {
    errors.push({ path: pathJoin(p, 'kind'), message: 'kind "self" needs from and to to be the same participant; set to equal from or use kind "sync"' });
  } else if (m.kind !== 'self' && m.from === m.to) {
    errors.push({ path: pathJoin(p, 'kind'), message: `from and to are both ${q(m.from)}; set kind to "self"` });
  }
}

function checkFrame(errors, frame, p, messageIds) {
  checkLength(errors, frame, 'label', p, LIMITS.edgeLabel);
  const at = pathJoin(p, 'messages');
  const valid = [];
  let sound = true;
  frame.messages.forEach((id, i) => {
    if (!messageIds.includes(id)) {
      sound = false;
      errors.push({ path: pathJoin(at, i), message: notFound(id, messageIds) });
    } else if (valid.includes(id)) {
      sound = false;
      errors.push({ path: pathJoin(at, i), message: `${id} is listed twice; list it once` });
    } else {
      valid.push(id);
    }
  });
  if (!sound) return null;
  const sorted = [...valid].sort((a, b) => messageIds.indexOf(a) - messageIds.indexOf(b));
  for (let i = 1; i < sorted.length; i++) {
    if (messageIds.indexOf(sorted[i]) - messageIds.indexOf(sorted[i - 1]) > 1) {
      errors.push({ path: at, message: `${sorted[i - 1]} and ${sorted[i]} are not consecutive; a frame covers one unbroken run of messages` });
      return null;
    }
  }
  return { start: messageIds.indexOf(sorted[0]), end: messageIds.indexOf(sorted.at(-1)) };
}

// Two frames may nest (one run inside the other, equal runs included) or be
// disjoint; sharing some messages without containing one another has no sane drawing.
function checkFrameOverlap(errors, frames, runs) {
  const name = (i) => `frames[${i}] (${frames[i].kind}${frames[i].label === undefined ? '' : ` ${q(frames[i].label)}`})`;
  runs.forEach((b, j) => {
    for (let i = 0; i < j; i++) {
      const a = runs[i];
      if (!a || !b) continue;
      const apart = a.end < b.start || b.end < a.start;
      const nested = (a.start <= b.start && a.end >= b.end) || (b.start <= a.start && b.end >= a.end);
      if (apart || nested) continue;
      errors.push({
        path: pathJoin(pathJoin('frames', j), 'messages'),
        message: `${name(j)} and ${name(i)} overlap partly: they share messages but neither contains the other; nest one inside the other or make them disjoint`,
      });
      return;
    }
  });
}

function checkNote(errors, note, p, participantIds, messageIds) {
  checkLength(errors, note, 'text', p, LIMITS.note);
  checkRefs(errors, note.over, pathJoin(p, 'over'), participantIds);
  if (note.after !== undefined && !messageIds.includes(note.after)) {
    errors.push({ path: pathJoin(p, 'after'), message: notFound(note.after, messageIds) });
  }
}

function checkSequence(spec, errors) {
  const participants = spec.participants ?? [];
  const messages = spec.messages ?? [];
  if (participants.length === 0) errors.push({ path: 'participants', message: 'at least one participant is required' });
  checkCount(errors, spec, 'participants', LIMITS.participants);
  checkCount(errors, spec, 'messages', LIMITS.messages);

  const seen = registerIds(errors, [['participants', participants], ['messages', messages]]);
  const participantIds = participants.map((x) => x.id);
  const messageIds = messages.map((x) => x.id);

  participants.forEach((x, i) => checkEntity(errors, x, pathJoin('participants', i), 'sequence'));
  messages.forEach((m, i) => checkMessage(errors, m, pathJoin('messages', i), participantIds));
  const runs = (spec.frames ?? []).map((f, i) => checkFrame(errors, f, pathJoin('frames', i), messageIds));
  checkFrameOverlap(errors, spec.frames ?? [], runs);
  (spec.notes ?? []).forEach((n, i) => checkNote(errors, n, pathJoin('notes', i), participantIds, messageIds));
  checkSteps(errors, spec, [...seen.keys()]);
  checkStories(errors, spec, { endpoints: participantIds, known: [...seen.keys()] });
}

// ---- fields that belong to the other family of types -------------------

const SEQUENCE_ONLY = {
  participants: 'use nodes and edges',
  messages: 'use nodes and edges',
  frames: 'remove it',
  notes: 'remove it',
};
const GRAPH_ONLY = {
  direction: 'remove it',
  groups: 'remove it',
  nodes: 'use participants and messages',
  edges: 'use participants and messages',
};

function wrongFamilyFields(spec) {
  const sequence = spec.type === 'sequence';
  const table = sequence ? GRAPH_ONLY : SEQUENCE_ONLY;
  const where = sequence ? 'not allowed for sequence diagrams' : 'only allowed for sequence diagrams';
  return Object.entries(table)
    .filter(([field]) => spec[field] !== undefined)
    .map(([field, fix]) => ({ path: field, message: `${where}; ${fix}` }));
}

// stories replaced steps: a spec with both would describe two timelines.
function olderSteps(spec) {
  return spec.stories !== undefined && spec.steps !== undefined ? [{ path: 'steps', message: 'use stories; steps is the older form' }] : [];
}

// Ajv's pattern message would print the raw regex; ours says what to fix.
function wordSchemaError(e) {
  if (e.keyword === 'pattern' && e.params.pattern === NON_SPACE) {
    return { ...e, message: 'must contain at least one non-space character' };
  }
  return e;
}

// Lay the diagram out and lint the geometry: a spec that passes is buildable.
async function lintLayout(spec) {
  const { layoutDiagram } = await import('./layout.mjs');
  const theme = themeFor(spec);
  return lintGeometry(await layoutDiagram(spec, theme), { theme });
}

/**
 * Validate a parsed spec: schema, then semantic checks, then (when
 * `layout` is true and those pass) layout and geometry lint. A failure inside
 * the layout itself is a bug, not a spec error, and is thrown.
 */
export async function validateSpec(spec, { layout = true } = {}) {
  if (!validateSchema(spec)) {
    return { ok: false, errors: formatAjvErrors(validateSchema.errors.map(wordSchemaError)) };
  }
  const errors = [...wrongFamilyFields(spec), ...olderSteps(spec)];
  checkTheme(errors, spec);
  checkLength(errors, spec, 'title', '', LIMITS.title);
  checkLength(errors, spec, 'subtitle', '', LIMITS.subtitle);
  if (spec.type === 'sequence') checkSequence(spec, errors);
  else checkGraph(spec, errors);
  if (layout && errors.length === 0) errors.push(...await lintLayout(spec));
  return { ok: errors.length === 0, errors };
}
