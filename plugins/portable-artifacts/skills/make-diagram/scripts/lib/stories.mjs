// stories[]: validation and beat resolution. A story is a chapter of beats; a
// beat is one hop along an edge (or message) or a camera shot on some ids.
// Targets resolve here, at build time, so the page never meets a dangling beat.
// Errors follow spec.mjs: a JSON path, the problem, the fix, a did-you-mean.
import { pathJoin } from '../../shared/errors.mjs';
import { LIMITS } from './schema.mjs';
import { notFound, checkLength, checkRefs, registerIds } from './checks.mjs';
import { edgeIds } from './edge-ids.mjs';

const q = (v) => JSON.stringify(v);
const TARGETS = ['edge', 'from', 'to', 'focus'];
// '"a", "b" and "c"'
const list = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
const linkWord = (spec) => (spec.type === 'sequence' ? 'message' : 'edge');

/** Every edge or message as the viewer knows it: { id, from, to, both }, in spec order. */
export function linksOf(spec) {
  if (spec.type === 'sequence') return (spec.messages ?? []).map((m) => ({ id: m.id, from: m.from, to: m.to, both: false }));
  const ids = edgeIds(spec);
  return (spec.edges ?? []).map((e, i) => ({ id: ids[i], from: e.from, to: e.to, both: e.both === true }));
}

/**
 * The edge a beat's from/to names. The direction given wins: edges from `from`
 * to `to` (plain or two-headed) are tried first and play forward. Failing
 * that, two-headed edges authored the other way, then plain ones, play in
 * reverse (the dot runs to -> from, for replies). More than one edge in the
 * winning tier is ambiguous. Returns { link, reverse } or { error } (the
 * message; the caller adds the path). `what` is "edge" or "message".
 */
export function resolveEnds(from, to, links, what = 'edge') {
  const other = links.filter((l) => l.from === to && l.to === from);
  const tiers = [links.filter((l) => l.from === from && l.to === to), other.filter((l) => l.both), other];
  const found = tiers.find((t) => t.length > 0) ?? [];
  if (found.length === 1) return { link: found[0], reverse: found[0].from !== from };
  if (found.length === 0) return { error: `no ${what} between ${q(from)} and ${q(to)}; add one, or name ${what === 'edge' ? 'an' : 'a'} ${what} with "edge"` };
  return { error: `${found.length} ${what}s connect ${q(from)} and ${q(to)} (${found.map((l) => l.id).join(', ')}); name one with "edge"` };
}

// Exactly one of: edge | from + to | focus. Then the target must exist and resolve.
function checkTarget(errors, beat, p, spec, links, ctx) {
  const set = TARGETS.filter((f) => beat[f] !== undefined);
  const pair = set.filter((f) => f === 'from' || f === 'to');
  const kinds = [...(set.includes('edge') ? ['"edge"'] : []), ...(pair.length ? ['"from and to"'] : []), ...(set.includes('focus') ? ['"focus"'] : [])];
  if (kinds.length === 0) {
    errors.push({ path: p, message: 'a beat needs one target: "edge", "from" and "to", or "focus"' });
    return;
  }
  if (kinds.length > 1) {
    errors.push({ path: p, message: `a beat takes one target; this one has ${list(kinds)} — keep one` });
    return;
  }
  if (beat.edge !== undefined) {
    const ids = links.map((l) => l.id);
    if (!ids.includes(beat.edge)) errors.push({ path: pathJoin(p, 'edge'), message: notFound(beat.edge, ids, `${linkWord(spec)}s`) });
    return;
  }
  if (beat.focus !== undefined) {
    if (beat.focus.length === 0) errors.push({ path: pathJoin(p, 'focus'), message: 'at least one id is required' });
    const focusPath = pathJoin(p, 'focus');
    const word = spec.type === 'sequence' ? 'a message; focus names participants' : 'an edge; focus names nodes and groups';
    beat.focus.forEach((id, k) => {
      if (ctx.focusable.includes(id)) return;
      const isLink = ctx.known.includes(id) || links.some((l) => l.id === id);
      const message = isLink ? `${q(id)} is ${word} — target it with "edge"` : notFound(id, ctx.focusable);
      errors.push({ path: pathJoin(focusPath, k), message });
    });
    return;
  }
  if (pair.length === 1) {
    const missing = pair[0] === 'from' ? 'to' : 'from';
    errors.push({ path: pathJoin(p, missing), message: `required with ${pair[0]} — name the other end, or target the edge with "edge"` });
    return;
  }
  let sound = true;
  for (const field of ['from', 'to']) {
    if (ctx.endpoints.includes(beat[field])) continue;
    sound = false;
    errors.push({ path: pathJoin(p, field), message: notFound(beat[field], ctx.endpoints) });
  }
  if (!sound) return;
  const { error } = resolveEnds(beat.from, beat.to, links, linkWord(spec));
  if (error) errors.push({ path: p, message: error });
}

/**
 * Validate `stories`: counts and lengths, story ids (their own id space), and
 * every beat's target. `ctx.endpoints` are the ids from/to may name (nodes, plus
 * groups in architecture; participants in a sequence); `ctx.focusable` the ids
 * focus may name (groups and nodes; participants in a sequence). `ctx.known`
 * (every id a step may name) (ids registered so far; edge ids are added from the links) tells an edge or message id from a stranger.
 */
export function checkStories(errors, spec, ctx) {
  const stories = spec.stories;
  if (stories === undefined) return;
  if (stories.length === 0) {
    errors.push({ path: 'stories', message: 'at least one story is required — or remove stories' });
    return;
  }
  if (stories.length > LIMITS.stories) errors.push({ path: 'stories', message: `stories has ${stories.length} entries; the limit is ${LIMITS.stories} — merge chapters` });
  const total = stories.reduce((n, s) => n + s.beats.length, 0);
  if (total > LIMITS.beats) errors.push({ path: 'stories', message: `the stories hold ${total} beats in all; the limit is ${LIMITS.beats} — drop or merge beats` });
  registerIds(errors, [['stories', stories]]);
  const links = linksOf(spec);
  stories.forEach((story, i) => {
    const p = pathJoin('stories', i);
    checkLength(errors, story, 'title', p, LIMITS.storyTitle);
    if (story.beats.length === 0) errors.push({ path: pathJoin(p, 'beats'), message: 'at least one beat is required' });
    story.beats.forEach((beat, j) => {
      const bp = pathJoin(pathJoin(p, 'beats'), j);
      checkLength(errors, beat, 'title', bp, LIMITS.beatTitle);
      checkLength(errors, beat, 'caption', bp, LIMITS.caption);
      checkTarget(errors, beat, bp, spec, links, ctx);
    });
  });
}

// ---- the timeline -------------------------------------------------------------

const copy = (list) => (list ? [...list] : []);

// A step as a beat. It keeps today's semantics (reveal what it shows, emphasise
// what it highlights, hide the rest), so kind 'step' tells the player apart.
function stepBeat(step) {
  const beat = { kind: 'step', chapter: 0, title: step.title, edge: null, reverse: false, ids: copy(step.focus), reveal: copy(step.show), highlight: copy(step.highlight) };
  if (step.note !== undefined) beat.caption = step.note;
  return beat;
}

// A story beat: a hop (its edge, direction and both ends) or a focus shot. The
// spec passed validation, so the target resolves.
function storyBeat(beat, chapter, links) {
  const out = { kind: 'focus', chapter, title: beat.title, edge: null, reverse: false, ids: [], reveal: [], highlight: [] };
  if (beat.caption !== undefined) out.caption = beat.caption;
  if (beat.focus !== undefined) return { ...out, ids: [...beat.focus] };
  const hop = beat.edge !== undefined ? { link: links.find((l) => l.id === beat.edge), reverse: false } : resolveEnds(beat.from, beat.to, links);
  const ends = hop.link.from === hop.link.to ? [hop.link.from] : [hop.link.from, hop.link.to];
  return { ...out, kind: 'hop', edge: hop.link.id, reverse: hop.reverse, ids: ends };
}

/**
 * The timeline the player runs: { beats, chapters }. With `stories`, their
 * beats in array order and one chapter per story (`end` exclusive). Without,
 * `steps` (buildDiagram's, "Everything" included) become one chapter titled
 * Walkthrough, so Play always has something to run.
 */
export function beatsOf(spec, steps) {
  if (!spec.stories?.length) {
    const beats = steps.map(stepBeat);
    return { beats, chapters: [{ id: 'walkthrough', title: 'Walkthrough', start: 0, end: beats.length }] };
  }
  const links = linksOf(spec);
  const beats = [];
  const chapters = spec.stories.map((story, c) => {
    const start = beats.length;
    for (const b of story.beats) beats.push(storyBeat(b, c, links));
    return { id: story.id, title: story.title, start, end: beats.length };
  });
  return { beats, chapters };
}
