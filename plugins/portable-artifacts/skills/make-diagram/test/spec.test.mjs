import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSpec, validateSpec } from '../scripts/lib/spec.mjs';
import { UsageError } from '../shared/cli.mjs';

const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}.diagram.json`, import.meta.url));
const load = (name) => structuredClone(loadSpec(fixture(name)).spec);
const run = (spec) => validateSpec(spec);
const errorsOf = async (spec) => (await run(spec)).errors;
// Mutate a fresh copy of a fixture, then validate it.
const mutated = async (name, fn) => {
  const spec = load(name);
  fn(spec);
  return errorsOf(spec);
};

test('every type has one valid fixture', async () => {
  for (const name of ['architecture', 'flow', 'state', 'sequence']) {
    const r = await run(load(name));
    assert.deepEqual(r.errors, [], name);
    assert.equal(r.ok, true, name);
  }
});

test('layout option is accepted and ignored', async () => {
  assert.equal((await validateSpec(load('flow'), { layout: false })).ok, true);
  assert.equal((await validateSpec(load('flow'), { layout: true })).ok, true);
});

test('loadSpec reports unreadable and malformed files as UsageError', () => {
  assert.throws(() => loadSpec('/nonexistent/x.diagram.json'), UsageError);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diagram-spec-'));
  const bad = path.join(dir, 'bad.diagram.json');
  fs.writeFileSync(bad, '{ not json');
  try {
    assert.throws(() => loadSpec(bad), /is not valid JSON/);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

// ---- schema -----------------------------------------------------------

test('unknown top-level property gets did-you-mean', async () => {
  const e = await mutated('flow', (s) => { s.titel = 'x'; });
  assert.deepEqual(e, [{ path: 'titel', message: 'unknown property; did you mean "title"?' }]);
});

test('unknown property inside a node is rejected', async () => {
  const e = await mutated('flow', (s) => { s.nodes[0].pos = { x: 1, y: 2 }; });
  assert.equal(e.length, 1);
  assert.equal(e[0].path, 'nodes[0].pos');
  assert.match(e[0].message, /^unknown property; allowed: id, label, kind, icon, group, note, tone$/);
});

test('unknown property inside an edge, step, frame and note is rejected', async () => {
  const arch = await mutated('architecture', (s) => { s.edges[0].color = 'red'; s.steps[0].zoom = 2; });
  assert.deepEqual(arch.map((x) => x.path), ['edges[0].color', 'steps[0].zoom']);
  const seq = await mutated('sequence', (s) => { s.frames[0].color = 'red'; s.notes[0].side = 'left'; });
  assert.deepEqual(seq.map((x) => x.path), ['frames[0].color', 'notes[0].side']);
});

test('type is required and checked against the closed set', async () => {
  const missing = await mutated('flow', (s) => { delete s.type; });
  assert.deepEqual(missing, [{ path: 'type', message: 'required' }]);
  const typo = await mutated('flow', (s) => { s.type = 'sequance'; });
  assert.deepEqual(typo, [{
    path: 'type',
    message: 'must be one of "architecture", "flow", "sequence", "state"; did you mean "sequence"?',
  }]);
});

test('enum fields report their closed sets', async () => {
  const e = await mutated('architecture', (s) => {
    s.direction = 'left';
    s.nodes[0].tone = 'red';
    s.edges[0].style = 'dotted';
  });
  assert.deepEqual(e.map((x) => x.path), ['direction', 'nodes[0].tone', 'edges[0].style']);
  assert.equal(e[0].message, 'must be one of "right", "down"');
  assert.match(e[1].message, /^must be one of "neutral", "accent", "good", "warn", "bad"/);
});

test('wrong value types are reported with the path', async () => {
  const e = await mutated('flow', (s) => { s.nodes[1].label = 7; s.animate = 'yes'; });
  assert.deepEqual(e, [
    { path: 'animate', message: 'must be boolean' },
    { path: 'nodes[1].label', message: 'must be string' },
  ]);
});

// ---- ids ----------------------------------------------------------------

test('invalid id spelling is explained', async () => {
  const e = await mutated('flow', (s) => { s.nodes[0].id = 'Start Here'; });
  assert.deepEqual(e.filter((x) => x.path === 'nodes[0].id'), [{
    path: 'nodes[0].id',
    message: 'id "Start Here" is invalid; use lowercase letters, digits, - and _, starting with a letter',
  }]);
});

test('duplicate ids across nodes and groups point to the first use', async () => {
  const e = await mutated('architecture', (s) => { s.nodes[1].id = 'web'; s.nodes[3].id = 'aws'; });
  assert.deepEqual(e.filter((x) => x.message.startsWith('duplicate')), [
    { path: 'nodes[1].id', message: 'duplicate id "web"; first used at nodes[0].id; rename one' },
    { path: 'nodes[3].id', message: 'duplicate id "aws"; first used at groups[0].id; rename one' },
  ]);
});

test('duplicate ids across participants and messages', async () => {
  const e = await mutated('sequence', (s) => { s.messages[0].id = 'app'; });
  assert.ok(e.some((x) => x.path === 'messages[0].id'
    && x.message === 'duplicate id "app"; first used at participants[1].id; rename one'));
});

test('duplicate edge ids are rejected', async () => {
  const e = await mutated('flow', (s) => { s.edges[0].id = 'same'; s.edges[1].id = 'same'; });
  assert.deepEqual(e, [{ path: 'edges[1].id', message: 'duplicate id "same"; first used at edges[0].id; rename one' }]);
});

// ---- references ---------------------------------------------------------

test('edge endpoint typo suggests the real id', async () => {
  const e = await mutated('architecture', (s) => { s.edges[0].to = 'apii'; });
  assert.deepEqual(e, [{ path: 'edges[0].to', message: '"apii" not found; did you mean "api"?' }]);
});

test('edge endpoint with nothing close lists the ids', async () => {
  const e = await mutated('state', (s) => { s.edges[0].from = 'zzzzzzzz'; });
  assert.deepEqual(e, [{
    path: 'edges[0].from',
    message: '"zzzzzzzz" not found; available: begin, placed, paid, ok, shipped, cancelled, finish',
  }]);
});

test('architecture edges may target a group', async () => {
  assert.equal((await run(load('architecture'))).ok, true); // web -> vpc in the fixture
});

test('flow edges may not target a group', async () => {
  const e = await mutated('flow', (s) => { s.edges[0].to = 'email'; });
  assert.deepEqual(e, [{
    path: 'edges[0].to',
    message: '"email" is a group; edges may target a group only in architecture diagrams',
  }]);
});

test('node group must be a group id', async () => {
  const typo = await mutated('architecture', (s) => { s.nodes[1].group = 'vcp'; });
  assert.deepEqual(typo, [{ path: 'nodes[1].group', message: '"vcp" not found; did you mean "vpc"?' }]);
  const isNode = await mutated('architecture', (s) => { s.nodes[1].group = 'web'; });
  assert.deepEqual(isNode, [{ path: 'nodes[1].group', message: '"web" is a node, not a group; use a group id or remove group' }]);
  const noGroups = await mutated('state', (s) => { s.nodes[1].group = 'g'; });
  assert.deepEqual(noGroups, [{ path: 'nodes[1].group', message: '"g" not found; no groups are defined' }]);
});

test('step show, focus and highlight ids must exist', async () => {
  const e = await mutated('architecture', (s) => {
    s.steps[0].show = ['web', 'apii'];
    s.steps[1].focus = ['dbb'];
    s.steps[1].highlight = ['nope_nope'];
  });
  assert.deepEqual(e, [
    { path: 'steps[0].show[1]', message: '"apii" not found; did you mean "api"?' },
    { path: 'steps[1].focus[0]', message: '"dbb" not found; did you mean "db"?' },
    { path: 'steps[1].highlight[0]', message: '"nope_nope" not found; available: aws, vpc, web, api, db, pay' },
  ]);
});

test('sequence steps reference participants and messages', async () => {
  assert.equal((await run(load('sequence'))).ok, true);
  const e = await mutated('sequence', (s) => { s.steps[0].show = ['m9']; });
  assert.deepEqual(e, [{ path: 'steps[0].show[0]', message: '"m9" not found; did you mean "m1"?' }]);
});

// ---- groups -------------------------------------------------------------

test('group parent must exist', async () => {
  const e = await mutated('architecture', (s) => { s.groups[1].parent = 'awss'; });
  assert.deepEqual(e, [{ path: 'groups[1].parent', message: '"awss" not found; did you mean "aws"?' }]);
});

test('group parent cycle is reported once with its path', async () => {
  const e = await mutated('architecture', (s) => { s.groups[0].parent = 'vpc'; });
  assert.deepEqual(e, [{ path: 'groups[0].parent', message: 'group parents form a cycle: aws -> vpc -> aws; remove parent from one of them' }]);
  const self = await mutated('architecture', (s) => { s.groups[0].parent = 'aws'; });
  assert.deepEqual(self, [{ path: 'groups[0].parent', message: 'group parents form a cycle: aws -> aws; remove parent from one of them' }]);
});

test('group nesting deeper than 3 is rejected', async () => {
  const e = await mutated('architecture', (s) => {
    s.groups.push({ id: 'g3', label: 'Third', parent: 'vpc' }, { id: 'g4', label: 'Fourth', parent: 'g3' });
  });
  assert.deepEqual(e, [{ path: 'groups[3].parent', message: 'group "g4" nests 4 deep; the limit is 3 — move it up a level' }]);
  const ok = await mutated('architecture', (s) => { s.groups.push({ id: 'g3', label: 'Third', parent: 'vpc' }); });
  assert.deepEqual(ok, []);
});

// ---- kinds and icons ----------------------------------------------------

test('kind must be valid for the type, with did-you-mean', async () => {
  const typo = await mutated('architecture', (s) => { s.nodes[0].kind = 'servce'; });
  assert.deepEqual(typo, [{
    path: 'nodes[0].kind',
    message: 'kind "servce" is not valid for architecture diagrams; did you mean "service"?',
  }]);
  const wrongType = await mutated('flow', (s) => { s.nodes[1].kind = 'database'; });
  assert.deepEqual(wrongType, [{
    path: 'nodes[1].kind',
    message: 'kind "database" is not valid for flow diagrams; allowed: step, start, end, decision, io, subprocess, wait',
  }]);
  const seq = await mutated('sequence', (s) => { s.participants[0].kind = 'person'; });
  assert.equal(seq[0].path, 'participants[0].kind');
  assert.match(seq[0].message, /^kind "person" is not valid for sequence diagrams; allowed: /);
});

test('unknown icon reuses the icon catalog did-you-mean', async () => {
  const e = await mutated('architecture', (s) => { s.nodes[1].icon = 'brand:postgrsql'; });
  assert.deepEqual(e, [{
    path: 'nodes[1].icon',
    message: 'unknown icon "brand:postgrsql"; did you mean "brand:postgresql"?',
  }]);
  const noPrefix = await mutated('architecture', (s) => { s.nodes[1].icon = 'server'; });
  assert.match(noPrefix[0].message, /needs a "lucide:" or "brand:" prefix/);
  const seq = await mutated('sequence', (s) => { s.participants[2].icon = 'lucide:lokc'; });
  assert.equal(seq[0].path, 'participants[2].icon');
  assert.match(seq[0].message, /did you mean "lucide:lock"\?/);
});

test('unknown theme gets did-you-mean over the shipped themes', async () => {
  const e = await mutated('flow', (s) => { s.theme = 'papr'; });
  assert.deepEqual(e, [{ path: 'theme', message: 'unknown theme "papr"; did you mean "paper"?' }]);
  const far = await mutated('flow', (s) => { s.theme = 'qqqqqqqq'; });
  assert.match(far[0].message, /^unknown theme "qqqqqqqq"; available: .*paper/);
});

// ---- length and count limits -------------------------------------------

test('label length limit states the length and the limit', async () => {
  const label = 'x'.repeat(53);
  const e = await mutated('flow', (s) => { s.nodes[1].label = label; });
  assert.deepEqual(e, [{ path: 'nodes[1].label', message: 'label is 53 characters; the limit is 48 — shorten it' }]);
  assert.deepEqual(await mutated('flow', (s) => { s.nodes[1].label = 'x'.repeat(48); }), []);
});

test('length counts characters, not UTF-16 units', async () => {
  const e = await mutated('flow', (s) => { s.nodes[1].label = '😀'.repeat(48); });
  assert.deepEqual(e, []);
});

test('other text limits are pinned', async () => {
  const e = await mutated('architecture', (s) => {
    s.groups[0].label = 'g'.repeat(49);
    s.nodes[2].note = 'n'.repeat(61);
    s.edges[0].label = 'e'.repeat(41);
    s.steps[0].title = 't'.repeat(61);
    s.steps[0].note = 'c'.repeat(201);
  });
  assert.deepEqual(e, [
    { path: 'groups[0].label', message: 'label is 49 characters; the limit is 48 — shorten it' },
    { path: 'nodes[2].note', message: 'note is 61 characters; the limit is 60 — shorten it' },
    { path: 'edges[0].label', message: 'label is 41 characters; the limit is 40 — shorten it' },
    { path: 'steps[0].title', message: 'title is 61 characters; the limit is 60 — shorten it' },
    { path: 'steps[0].note', message: 'note is 201 characters; the limit is 200 — shorten it' },
  ]);
});

test('sequence text limits are pinned', async () => {
  const e = await mutated('sequence', (s) => {
    s.participants[0].label = 'p'.repeat(49);
    s.messages[0].label = 'm'.repeat(41);
    s.frames[0].label = 'f'.repeat(41);
    s.notes[0].text = 'n'.repeat(61);
  });
  assert.deepEqual(e, [
    { path: 'participants[0].label', message: 'label is 49 characters; the limit is 48 — shorten it' },
    { path: 'messages[0].label', message: 'label is 41 characters; the limit is 40 — shorten it' },
    { path: 'frames[0].label', message: 'label is 41 characters; the limit is 40 — shorten it' },
    { path: 'notes[0].text', message: 'text is 61 characters; the limit is 60 — shorten it' },
  ]);
});

const manyNodes = (n) => Array.from({ length: n }, (_, i) => ({ id: `n${i}`, label: `Node ${i}` }));

test('count limits state the count and the limit', async () => {
  const nodes = await errorsOf({ title: 'T', type: 'state', nodes: manyNodes(61) });
  assert.deepEqual(nodes, [{ path: 'nodes', message: 'nodes has 61 entries; the limit is 60 — split the diagram' }]);
  assert.deepEqual(await errorsOf({ title: 'T', type: 'state', nodes: manyNodes(60) }), []);

  const edges = Array.from({ length: 121 }, () => ({ from: 'n0', to: 'n1' }));
  assert.deepEqual(await errorsOf({ title: 'T', type: 'flow', nodes: manyNodes(2), edges }), [
    { path: 'edges', message: 'edges has 121 entries; the limit is 120 — split the diagram' },
  ]);

  const steps = Array.from({ length: 26 }, (_, i) => ({ title: `S${i}`, show: ['n0'] }));
  assert.deepEqual(await errorsOf({ title: 'T', type: 'flow', nodes: manyNodes(2), steps }), [
    { path: 'steps', message: 'steps has 26 entries; the limit is 25 — split the diagram' },
  ]);
});

test('sequence participant and message count limits', async () => {
  const participants = Array.from({ length: 13 }, (_, i) => ({ id: `p${i}`, label: `P${i}` }));
  const p = await errorsOf({ title: 'T', type: 'sequence', participants });
  assert.deepEqual(p, [{ path: 'participants', message: 'participants has 13 entries; the limit is 12 — split the diagram' }]);
  const messages = Array.from({ length: 61 }, (_, i) => ({ id: `m${i}`, from: 'p0', to: 'p1' }));
  const m = await errorsOf({ title: 'T', type: 'sequence', participants: participants.slice(0, 2), messages });
  assert.deepEqual(m, [{ path: 'messages', message: 'messages has 61 entries; the limit is 60 — split the diagram' }]);
});

// ---- per-type shape ------------------------------------------------------

test('direction is not allowed for sequence', async () => {
  const e = await mutated('sequence', (s) => { s.direction = 'right'; });
  assert.deepEqual(e, [{ path: 'direction', message: 'not allowed for sequence diagrams; remove it' }]);
});

test('sequence rejects nodes, edges and groups', async () => {
  const e = await mutated('sequence', (s) => { s.nodes = []; s.edges = []; s.groups = []; });
  assert.deepEqual(e, [
    { path: 'groups', message: 'not allowed for sequence diagrams; remove it' },
    { path: 'nodes', message: 'not allowed for sequence diagrams; use participants and messages' },
    { path: 'edges', message: 'not allowed for sequence diagrams; use participants and messages' },
  ]);
});

test('non-sequence types reject participants, messages, frames and notes', async () => {
  const e = await mutated('flow', (s) => { s.participants = []; s.messages = []; s.frames = []; s.notes = []; });
  assert.deepEqual(e, [
    { path: 'participants', message: 'only allowed for sequence diagrams; use nodes and edges' },
    { path: 'messages', message: 'only allowed for sequence diagrams; use nodes and edges' },
    { path: 'frames', message: 'only allowed for sequence diagrams; remove it' },
    { path: 'notes', message: 'only allowed for sequence diagrams; remove it' },
  ]);
});

test('a diagram needs at least one node or participant', async () => {
  assert.deepEqual(await errorsOf({ title: 'T', type: 'flow' }), [{ path: 'nodes', message: 'at least one node is required' }]);
  assert.deepEqual(await errorsOf({ title: 'T', type: 'flow', nodes: [] }), [{ path: 'nodes', message: 'at least one node is required' }]);
  assert.deepEqual(await errorsOf({ title: 'T', type: 'sequence' }), [{ path: 'participants', message: 'at least one participant is required' }]);
});

test('a single node and zero edges is valid', async () => {
  const r = await run({ title: 'T', type: 'architecture', nodes: [{ id: 'a', label: 'A' }] });
  assert.equal(r.ok, true);
});

// ---- sequence ------------------------------------------------------------

test('message endpoints must be participants', async () => {
  const e = await mutated('sequence', (s) => { s.messages[1].to = 'auht'; });
  assert.deepEqual(e, [{ path: 'messages[1].to', message: '"auht" not found; did you mean "auth"?' }]);
});

test('self messages need matching endpoints, and vice versa', async () => {
  const e = await mutated('sequence', (s) => { s.messages[3].to = 'auth'; s.messages[0].to = 'u'; });
  assert.deepEqual(e, [
    { path: 'messages[0].kind', message: 'from and to are both "u"; set kind to "self"' },
    { path: 'messages[3].kind', message: 'kind "self" needs from and to to be the same participant; set to equal from or use kind "sync"' },
  ]);
});

test('frame message ids must exist', async () => {
  const e = await mutated('sequence', (s) => { s.frames[0].messages = ['m2', 'm9'] ; });
  assert.deepEqual(e, [{ path: 'frames[0].messages[1]', message: '"m9" not found; did you mean "m1"?' }]);
});

test('frame messages must be consecutive', async () => {
  const e = await mutated('sequence', (s) => {
    s.messages.push({ id: 'm5', from: 'u', to: 'app' });
    s.frames[0].messages = ['m2', 'm5'];
  });
  assert.deepEqual(e, [{ path: 'frames[0].messages', message: 'm2 and m5 are not consecutive; a frame covers one unbroken run of messages' }]);
  const ok = await mutated('sequence', (s) => { s.frames[0].messages = ['m3', 'm2', 'm4']; });
  assert.deepEqual(ok, []);
});

test('frame messages may not repeat', async () => {
  const e = await mutated('sequence', (s) => { s.frames[0].messages = ['m2', 'm2']; });
  assert.deepEqual(e, [{ path: 'frames[0].messages[1]', message: 'm2 is listed twice; list it once' }]);
});

test('note references must exist', async () => {
  const e = await mutated('sequence', (s) => { s.notes[0].over = ['appp']; s.notes[0].after = 'm44'; });
  assert.deepEqual(e, [
    { path: 'notes[0].over[0]', message: '"appp" not found; did you mean "app"?' },
    { path: 'notes[0].after', message: '"m44" not found; did you mean "m4"?' },
  ]);
});

test('message and frame kinds are closed sets', async () => {
  const e = await mutated('sequence', (s) => { s.messages[0].kind = 'call'; s.frames[0].kind = 'maybe'; });
  assert.deepEqual(e.map((x) => x.path), ['messages[0].kind', 'frames[0].kind']);
  assert.equal(e[0].message, 'must be one of "sync", "async", "reply", "self"');
  assert.equal(e[1].message, 'must be one of "loop", "alt", "opt", "par"');
});

test('schema errors stop before cross-reference checks', async () => {
  const e = await mutated('architecture', (s) => { s.titel = 'x'; s.edges[0].to = 'apii'; });
  assert.deepEqual(e.map((x) => x.path), ['titel']);
});

// ---- icons on shape-only kinds ---------------------------------------------

test('an icon on a shape-only kind is rejected, not dropped', async () => {
  const flow = (kind) => mutated('flow', (s) => { s.nodes[1].kind = kind; s.nodes[1].icon = 'lucide:lock'; });
  for (const kind of ['start', 'end', 'decision']) {
    assert.deepEqual(await flow(kind), [{
      path: 'nodes[1].icon',
      message: `kind "${kind}" is drawn as a shape without an icon; remove icon or use kind "step"`,
    }], `flow ${kind}`);
  }
  const state = (kind) => mutated('state', (s) => { s.nodes[1].kind = kind; s.nodes[1].icon = 'lucide:lock'; });
  for (const kind of ['start', 'end', 'choice']) {
    assert.deepEqual(await state(kind), [{
      path: 'nodes[1].icon',
      message: `kind "${kind}" is drawn as a shape without an icon; remove icon or use kind "state"`,
    }], `state ${kind}`);
  }
});

test('box kinds still accept icons', async () => {
  const flow = ['step', 'io', 'subprocess', 'wait'];
  for (const kind of flow) {
    assert.deepEqual(await mutated('flow', (s) => { s.nodes[1].kind = kind; s.nodes[1].icon = 'lucide:lock'; }), [], kind);
  }
  assert.deepEqual(await mutated('flow', (s) => { s.nodes[1].icon = 'lucide:lock'; }), [], 'default kind');
  assert.deepEqual(await mutated('state', (s) => { s.nodes[1].kind = 'state'; s.nodes[1].icon = 'lucide:lock'; }), []);
  const arch = ['service', 'client', 'user', 'database', 'storage', 'queue', 'cache', 'function', 'gateway', 'external', 'other'];
  for (const kind of arch) {
    assert.deepEqual(await mutated('architecture', (s) => { s.nodes[0].kind = kind; s.nodes[0].icon = 'lucide:lock'; }), [], kind);
  }
  for (const kind of ['actor', 'service', 'database', 'queue', 'external']) {
    assert.deepEqual(await mutated('sequence', (s) => { s.participants[0].kind = kind; s.participants[0].icon = 'lucide:lock'; }), [], kind);
  }
});

test('an unknown icon on a shape-only kind reports the shape problem once', async () => {
  const e = await mutated('flow', (s) => { s.nodes[1].kind = 'decision'; s.nodes[1].icon = 'lucide:nope'; });
  assert.equal(e.length, 1);
  assert.match(e[0].message, /^kind "decision" is drawn as a shape without an icon/);
});

// ---- blank text ---------------------------------------------------------------

test('whitespace-only and empty text fields are rejected', async () => {
  const msg = 'must contain at least one non-space character';
  const e = await mutated('architecture', (s) => {
    s.title = '   ';
    s.nodes[0].label = '';
    s.nodes[2].note = ' \t';
    s.edges[0].label = '  ';
    s.steps[0].title = '\n';
  });
  assert.deepEqual(e, [
    { path: 'title', message: msg },
    { path: 'nodes[0].label', message: msg },
    { path: 'nodes[2].note', message: msg },
    { path: 'edges[0].label', message: msg },
    { path: 'steps[0].title', message: msg },
  ]);
  const seq = await mutated('sequence', (s) => { s.notes[0].text = ' '; s.messages[0].label = ' '; });
  assert.deepEqual(seq.map((x) => x.path), ['messages[0].label', 'notes[0].text']);
});
