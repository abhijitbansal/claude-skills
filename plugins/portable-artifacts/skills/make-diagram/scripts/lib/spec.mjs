// *.diagram.json: loading and the layered validation (schema, then ids,
// references, kinds, icons, limits).
import fs from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import { formatAjvErrors, didYouMean, pathJoin } from '../../shared/errors.mjs';
import { UsageError } from '../../shared/cli.mjs';
import { listThemes } from '../../shared/theme.mjs';
import { KINDS } from './kinds.mjs';
import { hasIcon, iconSvg, IconError } from './icons.mjs';
import { SCHEMA, ID_PATTERN, LIMITS } from './schema.mjs';

export { UsageError };

const ajv = new Ajv({ allErrors: true, strict: true, verbose: true });
const validateSchema = ajv.compile(SCHEMA);

const MAX_LISTED = 12;
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

// ---- small helpers ----------------------------------------------------

function suggestion(value, candidates, label = 'available') {
  const hint = didYouMean(value, candidates);
  if (hint) return `did you mean ${q(hint)}?`;
  const shown = candidates.slice(0, MAX_LISTED).join(', ');
  return `${label}: ${shown}${candidates.length > MAX_LISTED ? `, … (${candidates.length - MAX_LISTED} more)` : ''}`;
}

function notFound(id, candidates, what = 'ids') {
  if (candidates.length === 0) return `${q(id)} not found; no ${what} are defined`;
  return `${q(id)} not found; ${suggestion(id, candidates)}`;
}

function checkLength(errors, item, field, base, limit) {
  const value = item[field];
  if (typeof value !== 'string') return;
  const n = [...value].length;
  if (n > limit) errors.push({ path: pathJoin(base, field), message: `${field} is ${n} characters; the limit is ${limit} — shorten it` });
}

function checkCount(errors, spec, field, limit) {
  const n = spec[field]?.length ?? 0;
  if (n > limit) errors.push({ path: field, message: `${field} has ${n} entries; the limit is ${limit} — split the diagram` });
}

function checkRefs(errors, ids, base, candidates) {
  (ids ?? []).forEach((id, i) => {
    if (!candidates.includes(id)) errors.push({ path: pathJoin(base, i), message: notFound(id, candidates) });
  });
}

// ---- ids --------------------------------------------------------------

// Registers ids from [listName, items] pairs into `seen` (id -> path of first
// use) and reports bad spelling and duplicates. Items without an id are skipped.
function registerIds(errors, lists, seen = new Map()) {
  for (const [list, items] of lists) {
    (items ?? []).forEach((item, i) => {
      if (item.id === undefined) return;
      const p = pathJoin(pathJoin(list, i), 'id');
      if (!ID_PATTERN.test(item.id)) {
        errors.push({ path: p, message: `id ${q(item.id)} is invalid; use lowercase letters, digits, - and _, starting with a letter` });
      }
      if (seen.has(item.id)) errors.push({ path: p, message: `duplicate id ${q(item.id)}; first used at ${seen.get(item.id)}` });
      else seen.set(item.id, p);
    });
  }
  return seen;
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

function checkIcon(errors, item, p) {
  if (item.icon === undefined || hasIcon(item.icon)) return;
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

// Kind + icon + the label/note limits shared by nodes and participants.
function checkEntity(errors, item, p, type, noteField) {
  checkKind(errors, item, p, type);
  checkIcon(errors, item, p);
  checkLength(errors, item, 'label', p, LIMITS.label);
  if (noteField) checkLength(errors, item, noteField, p, LIMITS.note);
}

// ---- groups -----------------------------------------------------------

// A reference that must name a group: say so when it names a node instead.
function checkGroupRef(errors, id, p, groupIds, nodeIds) {
  if (groupIds.includes(id)) return;
  const message = nodeIds.includes(id) ? `${q(id)} is a node, not a group` : notFound(id, groupIds, 'groups');
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
        message: `group parents form a cycle: ${[...cycle, cycle[0]].join(' -> ')}`,
      });
    } else if (depth === LIMITS.groupDepth + 1) {
      errors.push({ path: p, message: `group ${q(g.id)} nests ${depth} deep; the limit is ${LIMITS.groupDepth}` });
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

function checkGraph(spec, errors) {
  const nodes = spec.nodes ?? [];
  const groups = spec.groups ?? [];
  const edges = spec.edges ?? [];
  if (nodes.length === 0) errors.push({ path: 'nodes', message: 'at least one node is required' });
  checkCount(errors, spec, 'nodes', LIMITS.nodes);
  checkCount(errors, spec, 'edges', LIMITS.edges);

  const seen = registerIds(errors, [['groups', groups], ['nodes', nodes]]);
  registerIds(errors, [['edges', edges]]);
  const groupIds = groups.map((g) => g.id);
  const nodeIds = nodes.map((n) => n.id);
  const ctx = { type: spec.type, groupIds, nodeIds, endpoints: spec.type === 'architecture' ? [...groupIds, ...nodeIds] : nodeIds };

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
    checkLength(errors, e, 'label', p, LIMITS.edgeLabel);
  });
  checkSteps(errors, spec, [...seen.keys()]);
}

// ---- sequence ---------------------------------------------------------

function checkMessage(errors, m, p, participantIds) {
  for (const field of ['from', 'to']) {
    if (!participantIds.includes(m[field])) errors.push({ path: pathJoin(p, field), message: notFound(m[field], participantIds) });
  }
  checkLength(errors, m, 'label', p, LIMITS.edgeLabel);
  if (m.kind === 'self' && m.from !== m.to) {
    errors.push({ path: pathJoin(p, 'kind'), message: 'kind "self" needs from and to to be the same participant' });
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
      errors.push({ path: pathJoin(at, i), message: `${id} is listed twice` });
    } else {
      valid.push(id);
    }
  });
  if (!sound) return;
  const sorted = [...valid].sort((a, b) => messageIds.indexOf(a) - messageIds.indexOf(b));
  for (let i = 1; i < sorted.length; i++) {
    if (messageIds.indexOf(sorted[i]) - messageIds.indexOf(sorted[i - 1]) > 1) {
      errors.push({ path: at, message: `${sorted[i - 1]} and ${sorted[i]} are not consecutive` });
      return;
    }
  }
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
  (spec.frames ?? []).forEach((f, i) => checkFrame(errors, f, pathJoin('frames', i), messageIds));
  (spec.notes ?? []).forEach((n, i) => checkNote(errors, n, pathJoin('notes', i), participantIds, messageIds));
  checkSteps(errors, spec, [...seen.keys()]);
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

export async function validateSpec(spec, { layout = true } = {}) {
  if (!validateSchema(spec)) {
    return { ok: false, errors: formatAjvErrors(validateSchema.errors ?? []) };
  }
  const errors = [...wrongFamilyFields(spec)];
  checkTheme(errors, spec);
  if (spec.type === 'sequence') checkSequence(spec, errors);
  else checkGraph(spec, errors);
  return { ok: errors.length === 0, errors };
}
