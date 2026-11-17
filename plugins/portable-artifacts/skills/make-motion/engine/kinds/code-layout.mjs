// The `code` kind's three modes laid out (plan 2026-11-16-pa2-shot-kinds-b, Task 8): which rows a shot shows, the size
// they are set at (code-fit.mjs), the panel round them, and each row's runs on their times (code-time.mjs). On a wide
// frame the title is the panel's first row, at the code's size, and the panel hugs its rows. On a tall frame (lead's
// ruling, run 2) the title, or a run's command, is the hero in the display face over the panel, as large as the room's
// width allows and at least three times the code (the code is set down to a third of it if it must), and the panel takes
// the room's full width; the block is centred in the room. The panel is never taller than its rows. Pure and DOM-free.
import { colourOf } from '../devices/shared.mjs';
import { diffLines } from './code-diff.mjs';
import { innerOf, fitCode } from './code-fit.mjs';
import { codeFont, rowNodes, signNode, strikeNode, highlightNode, movingRow, panelNodes, titleRule, widthOf, runsOf, SIGN_COLUMNS } from './code-draw.mjs';
import { typeTimes, changeTime, opensAt, runTimes, CLOSE } from './code-time.mjs';
import { landBy, arrivalTrack } from './arrivals.mjs';
import { node } from '../graph/node.mjs';
import { layoutText } from '../text/layout.mjs';
import { shownFrom, isWide, fontFor, setCase, inkExtent } from './shared.mjs';
import { MIN_HERO_RATIO } from '../review/frame.mjs';

const HALF = 2;
const PROMPT = '$';
const PROMPT_COLUMNS = 2; // the prompt sign and its space
const ADVANCE_PROBE = '0';
const PROBE_SIZE = 100;
const NO_WRAP = 1e6;

const textOf = (tokens) => tokens.map((t) => t.text).join('');
const titleTokens = (shot) => (shot.title === undefined ? null : [{ text: shot.title, role: 'comment' }]);
// A group of `children` shown from frame 0 until `until` (a removed diff row closing).
const shownUntil = (id, until, children) => node('group', id, {}, { tracks: { opacity: shownFrom(0, until) }, children });

/** The lines of `highlight` (1-based numbers and [from, to] ranges) as a sorted set of 0-based line indices. */
export const highlightedLines = (highlight = []) => [...new Set(highlight.flatMap((h) => (Array.isArray(h)
  ? Array.from({ length: h[1] - h[0] + 1 }, (_, k) => h[0] - 1 + k) : [h - 1])))].sort((a, b) => a - b);

/** On a tall frame, what the hero says and which field it shows: the title, else a run's command; null on a wide frame. */
export function heroOf(shot, canvas) {
  if (isWide(canvas)) return null;
  if (shot.title !== undefined) return { text: shot.title, field: 'title' };
  return (shot.mode ?? 'type') === 'run' && shot.command !== undefined ? { text: shot.command, field: 'command' } : null;
}

/** What a shot shows in its panel, to size it: { chars, rows }. `hero` (heroOf) takes the title, or the command, out. */
export function measureOf(shot, prepared, hero = null) {
  const titled = shot.title !== undefined && hero?.field !== 'title';
  const title = titled ? 1 : 0;
  const titleChars = titled ? shot.title.length : 0;
  const mode = shot.mode ?? 'type';
  if (mode === 'diff') {
    const lines = [...prepared.before, ...prepared.after];
    return { chars: Math.max(titleChars, SIGN_COLUMNS + Math.max(0, ...lines.map(widthOf))), rows: title + Math.max(prepared.before.length, prepared.after.length) };
  }
  if (mode === 'run') {
    const out = prepared.output;
    const command = hero?.field === 'command' ? 0 : 1;
    return { chars: Math.max(titleChars, command * (PROMPT_COLUMNS + widthOf(prepared.command[0] ?? [])), ...out.map(widthOf)), rows: title + command + out.length };
  }
  return { chars: Math.max(titleChars, ...prepared.code.map(widthOf)), rows: title + prepared.code.length };
}

// The hero's extent across at `font`: its advance or its ink, whichever reaches further (a capital's ink can overhang
// its advance; sized by the advance alone the pop hero "PRICE.PY" ran past the safe edge), and how far its ink starts
// left of its origin.
function heroExtent(text, font, ctx) {
  const set = layoutText({ text, font, maxWidth: NO_WRAP, measure: ctx.measure });
  const ink = inkExtent(text, font, ctx.measure);
  const left = Math.max(0, -ink.left);
  return { layout: set, wide: Math.max(set.width, ink.right) + left, left };
}

/** The hero's size on a tall frame: as large as `width` holds on one line, ink included, at most the look's largest step. */
export function heroSize(text, ctx, width) {
  const { look, unit } = ctx;
  const font = fontFor(look, 'display', PROBE_SIZE * unit, unit);
  const wide = heroExtent(setCase(look, 'display', text), font, ctx).wide / (PROBE_SIZE * unit);
  return Math.floor(Math.min(Math.max(...look.scale) * unit, width / wide));
}

// The hero laid out at `size`: { layout, font, h, left (px its ink starts left of its origin) }.
function heroSet(hero, ctx, size) {
  const { look, unit } = ctx;
  const font = fontFor(look, 'display', size, unit);
  const { layout, left } = heroExtent(setCase(look, 'display', hero.text), font, ctx);
  return { ...hero, font, layout, left, h: layout.height };
}

/** The geometry shared by every mode: { size, font, advance, inner, panel, rowH, top(k), titleRow, hero }. */
export function geometryOf(shot, ctx, data, room) {
  const { unit, measure, canvas } = ctx;
  const heroed = heroOf(shot, canvas);
  const need = measureOf(shot, ctx.prepared, heroed);
  const gap = data.pad * unit;
  const maxHero = heroed ? heroSize(heroed.text, ctx, room.w) : 0;
  const probe = heroed ? heroSet(heroed, ctx, maxHero) : null;
  const cardRoom = probe ? { ...room, y: room.y + probe.h + gap, h: room.h - probe.h - gap } : room;
  const fit = fitCode(need, { look: ctx.look, data, unit, inner: innerOf(cardRoom, data, unit) });
  const size = probe ? Math.max(Math.min(fit.size, Math.floor(maxHero / MIN_HERO_RATIO)), Math.min(...data.steps.map((s) => ctx.look.scale[s - 1])) * unit) : fit.size;
  const font = codeFont(data, size);
  const advance = measure(ADVANCE_PROBE, font).width;
  const rowH = data.lineHeight * size;
  const pad = data.pad * unit;
  const w = probe ? room.w : Math.min(room.w, need.chars * advance + HALF * pad), h = need.rows * rowH + HALF * pad;
  const block = (probe ? probe.h + gap : 0) + h;
  const top = room.y + (room.h - block) / HALF; // the block centred in the room
  const panel = [room.x + (room.w - w) / HALF, top + (probe ? probe.h + gap : 0), w, h];
  const inner = { x: panel[0] + pad, y: panel[1] + pad, w: w - HALF * pad, h: h - HALF * pad };
  const hero = probe ? { ...probe, x: room.x + probe.left, y: top } : null;
  return { fit: { ...fit, size }, font, advance, rowH, inner, panel, measure, x: inner.x, top: (k) => inner.y + k * rowH, titleRow: shot.title !== undefined && hero?.field !== 'title', hero };
}

// The title row (row 0 when the panel has one) with desk's rule under it.
function titleNodes(shot, geo, ctx, data) {
  const tokens = titleTokens(shot);
  if (tokens === null || !geo.titleRow) return [];
  const row = rowNodes({ id: `${shot.id}.title`, tokens, top: geo.top(0) }, geo, { look: ctx.look, data });
  return data.card ? [...row, titleRule(`${shot.id}.title.rule`, geo, { inner: geo.inner, top: geo.top(1), look: ctx.look, data, unit: ctx.unit })] : row;
}

// The hero over the panel on a tall frame: the title (whole on frame 0) or a run's command, its words typing on at `times`.
function heroNodes(shot, geo, ctx, times = []) {
  if (!geo.hero) return [];
  const { look } = ctx;
  const words = geo.hero.layout.lines.flatMap((l) => l.words).sort((a, b) => a.index - b.index);
  const wordTracks = times.length > 0 ? words.map((_, k) => ({ opacity: arrivalTrack(times[Math.min(k, times.length - 1)]) })) : [];
  return [node('text', `${shot.id}.hero`, { x: geo.hero.x, y: geo.hero.y, layout: geo.hero.layout, font: geo.hero.font, fill: look.palette.ink, role: 'hero' }, { wordTracks })];
}

// type: every line's runs; the first line on frame 0, the rest on typeTimes; highlighted lines marked once typed.
function typeMode(shot, ctx, data, geo) {
  const lines = ctx.prepared.code;
  const first = geo.titleRow ? 1 : 0;
  const counts = lines.map((tokens) => runsOf(tokens).length);
  const whole = lines.length > 1 ? 1 : 0; // lines shown whole on frame 0
  const typed = counts.slice(whole).reduce((a, b) => a + b, 0) - (whole === 0 ? Math.min(1, counts[0] ?? 0) : 0);
  const times = typeTimes(Math.max(0, typed), ctx.timing);
  let k = 0;
  const lineTimes = lines.map((tokens, i) => runsOf(tokens).map((_, j) => ((i < whole || (whole === 0 && i === 0 && j === 0)) ? 0 : times[k++])));
  const landed = Math.max(0, ...lineTimes.flat());
  const lastSentence = ctx.timing.sentences?.at(-1)?.start ?? landed;
  const hl = new Set(highlightedLines(shot.highlight));
  const at = (i) => landBy(Math.max(Math.max(0, ...lineTimes[i]), lastSentence), ctx.timing);
  const nodes = lines.flatMap((tokens, i) => {
    const row = { id: `${shot.id}.l${i + 1}`, tokens, top: geo.top(first + i) };
    const lit = hl.has(i) && data.highlight.text ? { lit: colourOf(ctx.look, data.highlight.text), litAt: at(i) } : {};
    const mark = hl.has(i) ? [highlightNode(`${row.id}.mark`, geo, { top: row.top, chars: widthOf(tokens), data, look: ctx.look, at: at(i) })] : [];
    return [...mark, ...rowNodes(row, geo, { look: ctx.look, data, times: lineTimes[i], ...lit })];
  });
  return { nodes: [...heroNodes(shot, geo, ctx), ...nodes], landed: Math.max(landed, ...[...hl].map(at)), events: [] };
}

// diff: before's rows whole on frame 0; at the change removed rows are struck and signed, then close; same rows settle
// to their places after; added rows open, signed, once the settle has landed.
function diffMode(shot, ctx, data, geo) {
  const { look } = ctx;
  const first = geo.titleRow ? 1 : 0;
  const rows = diffLines(ctx.prepared.before.map(textOf), ctx.prepared.after.map(textOf));
  const change = changeTime(ctx.timing);
  const closes = change + CLOSE, opens = opensAt(ctx.timing);
  const tokensOf = (r) => (r.from !== null ? ctx.prepared.before[r.from] : ctx.prepared.after[r.to]);
  const nodes = rows.flatMap((r, k) => {
    const id = `${shot.id}.d${k}`;
    const tokens = tokensOf(r);
    if (r.type === 'removed') {
      const top = geo.top(first + r.from);
      return [shownUntil(id, closes, [...rowNodes({ id, tokens, top }, geo, { look, data, from: SIGN_COLUMNS }), signNode(`${id}.sign`, '-', geo, top, colourOf(look, data.removed), change),
        strikeNode(`${id}.strike`, geo, { top, from: SIGN_COLUMNS, chars: widthOf(tokens), colour: colourOf(look, data.removed), width: data.strike * ctx.unit, at: change })])];
    }
    if (r.type === 'added') {
      const top = geo.top(first + r.to);
      return [...rowNodes({ id, tokens, top }, geo, { look, data, from: SIGN_COLUMNS, times: runsOf(tokens).map(() => opens) }), signNode(`${id}.sign`, '+', geo, top, colourOf(look, data.added), opens)];
    }
    const dy = (r.from - r.to) * geo.rowH;
    return [movingRow(id, rowNodes({ id: `${id}.row`, tokens, top: geo.top(first + r.from) }, geo, { look, data, from: SIGN_COLUMNS }), { dy, at: closes, look })];
  });
  return { nodes: [...heroNodes(shot, geo, ctx), ...nodes], landed: opens, events: [{ device: 'change', t: change }] };
}

// run: the prompt on frame 0, the command typing on (in the panel, or as the hero on a tall frame), then the output lines.
function runMode(shot, ctx, data, geo) {
  const { look } = ctx;
  const first = geo.titleRow ? 1 : 0;
  const command = ctx.prepared.command[0] ?? [];
  const output = ctx.prepared.output;
  const inHero = geo.hero?.field === 'command';
  const heroWords = inHero ? geo.hero.layout.lines.flatMap((l) => l.words).length : 0;
  const times = runTimes(inHero ? heroWords : runsOf(command).length, output.length, ctx.timing);
  const cmdRow = inHero ? [] : [signNode(`${shot.id}.prompt`, PROMPT, geo, geo.top(first), colourOf(look, data.prompt), 0),
    ...rowNodes({ id: `${shot.id}.cmd`, tokens: command, top: geo.top(first) }, geo, { look, data, from: PROMPT_COLUMNS, times: times.command })];
  const below = inHero ? 0 : 1;
  const out = output.flatMap((tokens, i) => rowNodes({ id: `${shot.id}.out${i + 1}`, tokens, top: geo.top(first + below + i) }, geo, { look, data, times: runsOf(tokens).map(() => times.output[i]) }));
  const events = output.length > 0 ? [{ device: 'output', t: times.output[0] }] : [];
  return { nodes: [...heroNodes(shot, geo, ctx, inHero ? times.command : []), ...cmdRow, ...out], landed: Math.max(0, ...times.command, ...times.output), events };
}

/** The shot laid out: { nodes, boxes, landed, events } (events: { device, t }; landed: when the last thing arrives). */
export function codeLayout(shot, ctx, data, room) {
  const geo = geometryOf(shot, ctx, data, room);
  const mode = shot.mode ?? 'type';
  const made = (mode === 'diff' ? diffMode : mode === 'run' ? runMode : typeMode)(shot, ctx, data, geo);
  const heroNode = made.nodes.filter((n) => n.id === `${shot.id}.hero`);
  const content = [...titleNodes(shot, geo, ctx, data), ...made.nodes.filter((n) => n.id !== `${shot.id}.hero`)];
  const first = geo.titleRow ? 1 : 0;
  const shown = mode === 'diff' ? ctx.prepared.after : mode === 'run' ? ctx.prepared.output : ctx.prepared.code;
  const offset = mode === 'run' && geo.hero?.field !== 'command' ? 1 : 0;
  const lineBoxes = Object.fromEntries(shown.map((tokens, i) => [`line:${i + 1}`, [geo.x, geo.top(first + offset + i), Math.max(1, widthOf(tokens)) * geo.advance, geo.rowH]]));
  return { nodes: [...heroNode, ...panelNodes(`${shot.id}.panel`, geo.panel, ctx, data, content)], boxes: { code: geo.panel, ...lineBoxes }, landed: made.landed, events: made.events, geo };
}
