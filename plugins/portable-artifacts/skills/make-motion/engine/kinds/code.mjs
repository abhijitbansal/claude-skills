// The `code` kind (plan 2026-11-16-pa2-shot-kinds-b, Task 8): code typed on (`type`), a change shown as a line diff
// (`diff`), or a command and what it printed (`run`), set at one size in the look's mono. The text is tokenised in Node by
// the prepare step (scripts/v2/prepare/code.mjs, shiki) and arrives as ctx.prepared; it is drawn, never run. desk: a
// printout on a paper card; pop: a dark panel with a thick outline and the accent shadow (code-layout.mjs, code-draw.mjs).
// The size is the largest step at which every line fits (code-fit.mjs); where a line or a block does not fit the format,
// or a tall frame is left mostly empty, the review says what to cut. Events: `change` (diff), `output` (run), and the
// `land` event when the last thing arrives. `on` targets: `code`, `line:<n>` (1-based). Pure and DOM-free.
import { registries } from '../registry.mjs';
import { kindData, kindSupportProblems, supportsKind } from '../looks/index.mjs';
import { didYouMean } from '../../shared/errors.mjs';
import { fieldNode, onDevices, placeDevices, deviceCamera, NOT_BLANK, assertNoBlanks, isWide } from './shared.mjs';
import { defaultCamera } from './camera.mjs';
import { roomOf } from './arrivals.mjs';
import { LANG_NAMES, CODE_LANGS, resolveLang } from './code-langs.mjs';
import { reviewRoom, innerOf, fitCode, panelHeight } from './code-fit.mjs';
import { codeLayout, measureOf, heroOf } from './code-layout.mjs';
import { compositionRect, setCase, unmarked } from './shared.mjs';
import { MIN_HERO_RATIO } from '../review/frame.mjs';
import { diffLines } from './code-diff.mjs';
import { changeTime, opensAt, runTimes, narrationEnd, typedBy } from './code-time.mjs';

const KIND = 'code';
const MAX_LINES = 12;
const MAX_CHARS = 80;
const MAX_OUTPUT = 10;
const COMMAND_MAX = 60;
const TITLE_MAX = 40;
const HIGHLIGHT_MAX = 3;
const TALL_SPAN = 0.7; // the bar's own share (helpers/bar.mjs pattern 2): a tall frame's block spans this much of it
const PERCENT = 100;
const REFERENCE_WIDTH = 1080;
const MODE_FIELDS = Object.freeze({ type: ['code'], diff: ['before', 'after'], run: ['command', 'output'] });
const REQUIRED = Object.freeze({ type: ['code'], diff: ['before', 'after'], run: ['command'] });
const modeOfField = (field) => Object.keys(MODE_FIELDS).find((m) => MODE_FIELDS[m].includes(field));

const linesOf = (text) => String(text).replace(/\r\n?/g, '\n').replace(/\t/g, '  ').split('\n');
/** The field whose lines a shot shows last, and so the one `highlight` and `line:<n>` count in. */
const shownField = (mode) => ({ type: 'code', diff: 'after', run: 'output' })[mode];

// Lines over the schema's limits: at most `max` lines, each at most MAX_CHARS characters.
function lineProblems(shot, field, max) {
  if (typeof shot[field] !== 'string') return [];
  const lines = linesOf(shot[field]);
  const long = lines.findIndex((l) => l.length > MAX_CHARS);
  return [
    ...(lines.length > max ? [{ path: field, message: `${lines.length} lines; a ${KIND} shot shows at most ${max}: cut the lines that do not matter` }] : []),
    ...(long >= 0 ? [{ path: field, message: `line ${long + 1} is ${lines[long].length} characters; a line holds at most ${MAX_CHARS}` }] : []),
  ];
}

function highlightProblems(shot, mode) {
  if (!Array.isArray(shot.highlight)) return [];
  const field = shownField(mode);
  const n = typeof shot[field] === 'string' ? linesOf(shot[field]).length : 0;
  return shot.highlight.flatMap((h, i) => {
    const [from, to] = Array.isArray(h) ? h : [h, h];
    if (from <= to && to <= n) return [];
    return [{ path: `highlight[${i}]`, message: `${JSON.stringify(h)} is not a line or a range of lines of ${field} (1 to ${n})` }];
  });
}

function codeProblems(shot, { look } = {}) {
  const mode = shot.mode ?? 'type';
  const foreign = Object.values(MODE_FIELDS).flat().filter((f) => shot[f] !== undefined && !MODE_FIELDS[mode].includes(f))
    .map((f) => ({ path: f, message: `belongs to mode "${modeOfField(f)}"; this shot's mode is "${mode}"` }));
  const missing = REQUIRED[mode].filter((f) => shot[f] === undefined).map((f) => ({ path: f, message: `mode "${mode}" needs ${f}` }));
  const lang = shot.lang !== undefined && resolveLang(shot.lang) === null
    ? [{ path: 'lang', message: `no language "${shot.lang}"${didYouMean(shot.lang, LANG_NAMES) ? `; did you mean "${didYouMean(shot.lang, LANG_NAMES)}"?` : ''} (languages: ${CODE_LANGS.join(', ')})` }] : [];
  const output = shot.output === undefined || mode !== 'run' ? [] : lineProblems(shot, 'output', MAX_OUTPUT);
  const command = typeof shot.command === 'string' && /[\r\n]/.test(shot.command) ? [{ path: 'command', message: 'a command is one line; put what it prints in output' }] : [];
  const code = ['code', 'before', 'after'].filter((f) => MODE_FIELDS[mode].includes(f)).flatMap((f) => lineProblems(shot, f, MAX_LINES));
  return [...kindSupportProblems(KIND, look), ...foreign, ...missing, ...lang, ...code, ...command, ...output, ...highlightProblems(shot, mode)];
}

// What the shot shows as plain tokens, for the review (which has no prepared data): the prepared shape, one token a line.
function plainPrepared(shot) {
  const plain = (text) => (text === undefined ? [] : linesOf(text).map((l) => [{ text: l, role: 'plain' }]));
  return { code: plain(shot.code), before: plain(shot.before), after: plain(shot.after), command: plain(shot.command), output: plain(shot.output) };
}

// The safe height the bar judges a tall frame against: the platform zone where the look composes in it, else the margins.
function safeHeight(look, canvas, viralInsets, filmMode) {
  if (viralInsets && compositionRect({ canvas, look, viralInsets, mode: filmMode }).safe) return canvas.h - viralInsets.top - viralInsets.bottom;
  return canvas.h - 2 * look.grid.margin * (Math.min(canvas.w, canvas.h) / REFERENCE_WIDTH);
}

// The block as the review can estimate it without a page (the hero's width from look data `heroAdvance`, em a
// character): { inner (the panel's), need, size, heroH }, the same arithmetic as code-layout.mjs geometryOf.
function estimate(shot, look, canvas, viralInsets, filmMode) {
  const data = kindData(look, KIND);
  const unit = Math.min(canvas.w, canvas.h) / REFERENCE_WIDTH;
  const room = reviewRoom(look, canvas, viralInsets, filmMode);
  const hero = heroOf(shot, canvas, data);
  const maxHero = hero ? Math.floor(Math.min(Math.max(...look.scale) * unit, (data.heroMax ?? Infinity) * unit, room.w / (setCase(look, 'display', hero.text).length * data.heroAdvance))) : 0;
  const heroH = hero ? maxHero * look.lineHeight.display + data.pad * unit : 0;
  const inner = innerOf({ ...room, h: room.h - heroH }, data, unit);
  const need = measureOf(shot, plainPrepared(shot), hero);
  const fit = fitCode(need, { look, data, unit, inner });
  const least = Math.min(...data.steps.map((s) => look.scale[s - 1])) * unit;
  return { data, unit, inner, need, fit, heroH, size: hero ? Math.max(Math.min(fit.size, Math.floor(maxHero / MIN_HERO_RATIO)), least) : fit.size };
}

// Each shown line longer than the format holds at the smallest step, as a finding at its field.
function longLineFindings(shot, mode, look, canvas, holds) {
  const format = isWide(canvas) ? '16:9' : '9:16';
  const extra = mode === 'diff' ? 2 : 0;
  return MODE_FIELDS[mode].filter((f) => typeof shot[f] === 'string').flatMap((f) => linesOf(shot[f]).flatMap((line, i) => {
    const length = line.length + extra + (f === 'command' ? 2 : 0);
    return length > holds ? [{ path: f, at: 0, message: `line ${i + 1} is ${length} characters; at ${format} in the ${look.name} look a line holds ${holds}: break it or cut it` }] : [];
  }));
}

// `mode` in the ctx is the film's mode (scripts/v2/review.mjs kindFindings); `shot.mode` is the code shot's own mode
function codeReview(shot, { look, canvas, viralInsets, mode: filmMode } = {}) {
  if (!look || !canvas || !supportsKind(look, KIND)) return [];
  const mode = shot.mode ?? 'type';
  if (codeProblems(shot, { look }).length > kindSupportProblems(KIND, look).length) return [];
  const { data, unit, inner, need, fit, heroH, size } = estimate(shot, look, canvas, viralInsets, filmMode);
  const long = longLineFindings(shot, mode, look, canvas, fitCode({ chars: Infinity, rows: 0 }, { look, data, unit, inner }).holds.chars);
  const format = isWide(canvas) ? '16:9' : '9:16';
  const rows = fit.holds.rows < need.rows ? [{ path: shownField(mode), at: 0, message: `${need.rows} rows do not fit at ${format} in the ${look.name} look (it holds ${fit.holds.rows}): cut lines` }] : [];
  const span = (heroH + panelHeight(need.rows, data, size, unit)) / safeHeight(look, canvas, viralInsets, filmMode);
  const tall = !isWide(canvas) && long.length === 0 && rows.length === 0 && span < TALL_SPAN
    ? [{ path: shownField(mode), at: 0, message: `at 9:16 in the ${look.name} look the code spans ${Math.round(span * PERCENT)}% of the frame's height: shorten the lines so the type can grow, or add the lines that matter` }] : [];
  return [...long, ...rows, ...tall];
}

function expandCode(shot, ctx) {
  assertNoBlanks(shot, KIND);
  const { look, timing, unit } = ctx;
  const data = kindData(look, KIND);
  const laid = codeLayout(shot, ctx, data, roomOf(ctx));
  const devices = onDevices(shot, ctx, { boxes: laid.boxes, defaultTarget: 'code' });
  return {
    nodes: placeDevices([fieldNode(shot, ctx), ...laid.nodes], devices),
    camera: [...defaultCamera(look, timing, unit), ...deviceCamera(devices)],
    boxes: laid.boxes, hero: `${shot.id}.panel`, background: look.palette.paper,
  };
}

// The field a node shows: a run of a row of a field, the title, or null for what the kind computes.
function codeField(shot, id) {
  const rest = id.startsWith(`${shot.id}.`) ? id.slice(shot.id.length + 1) : null;
  if (rest === null) return undefined;
  if (/^title\.c\d+$/.test(rest)) return 'title';
  if (rest === 'hero') return shot.title !== undefined ? 'title' : 'command'; // the tall frame's hero (code-layout.mjs heroOf)
  if (/^l\d+\.c\d+$/.test(rest)) return 'code';
  if (/^cmd\.c\d+$/.test(rest)) return 'command';
  if (/^out\d+\.c\d+$/.test(rest)) return 'output';
  const diff = /^d(\d+)(\.row)?\.c\d+$/.exec(rest);
  if (diff) return diffField(shot, Number(diff[1]));
  return /^(panel|title|l\d+|d\d+|prompt|cmd|out\d+)(\.|$)/.test(rest) ? null : undefined;
}

// A diff row's field: `before` for a removed or kept row, `after` for an added one.
const diffField = (shot, k) => (diffLines(linesOf(shot.before ?? ''), linesOf(shot.after ?? ''))[k]?.type === 'added' ? 'after' : 'before');

// Does a type shot type anything after frame 0 (a second line, or a second run on its only line)?
function typesOn(shot) {
  const lines = linesOf(shot.code ?? '');
  return lines.slice(1).some((l) => l.trim() !== '') || (lines[0] ?? '').trim().split(/\s+/).length > 1;
}

// When the last thing arrives (the land event), from the timing alone: the same times code-layout.mjs draws.
function landingOf(shot, timing) {
  const mode = shot.mode ?? 'type';
  if (mode === 'diff') return opensAt(timing);
  if (mode === 'run') return narrationEnd(timing);
  return typesOn(shot) ? typedBy(timing) : 0;
}

// The kind's own cues: `change` when a diff's removed lines are struck, `output` with a run's first output line.
function eventsOf(shot, timing) {
  const mode = shot.mode ?? 'type';
  if (mode === 'diff') return [{ kind: 'device', device: 'change', t: changeTime(timing) }];
  if (mode === 'run' && shot.output !== undefined) return [{ kind: 'device', device: 'output', t: runTimes(1, linesOf(shot.output).length, timing).output[0] }];
  return [];
}

const CODE_TEXT = { type: 'string', minLength: 1, pattern: NOT_BLANK };
const LINE_NUMBER = { type: 'integer', minimum: 1 };

registries.kinds.add(KIND, {
  summary: 'Code on a printout (desk) or a dark panel (pop), set at one size in the look\'s mono with its tokens coloured by role: typed on over the narration (type), a change shown as a line diff (diff), or a command and what it printed (run). The text is drawn, never run.',
  example: {
    // at most 20 characters a line and 10 lines: it holds at the reading floor in every look and format (pop 9:16 holds 20)
    id: 'total', show: KIND, lang: 'js', title: 'total.js', highlight: [6],
    say: 'Total walks the rows and adds up what was paid. That one line does the work.',
    code: '// add up the paid\nfunction total(rs) {\n  let sum = 0\n  for (let r of rs)\n    if (r.paid)\n      sum += r.price\n  return sum\n}\n\nlog(total(load()))',
  },
  schema: {
    properties: {
      mode: { enum: ['type', 'diff', 'run'] },
      lang: { type: 'string', minLength: 1, pattern: NOT_BLANK },
      code: CODE_TEXT, before: CODE_TEXT, after: CODE_TEXT,
      command: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: COMMAND_MAX },
      output: CODE_TEXT,
      title: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: TITLE_MAX },
      highlight: { type: 'array', minItems: 1, maxItems: HIGHLIGHT_MAX, items: { anyOf: [LINE_NUMBER, { type: 'array', minItems: 2, maxItems: 2, items: LINE_NUMBER }] } },
    },
  },
  srcFields: [],
  steeringFields: ['mode', 'lang', 'highlight'],
  heroTarget: 'code',
  targets: (shot) => ['code', ...(typeof shot[shownField(shot.mode ?? 'type')] === 'string' ? linesOf(shot[shownField(shot.mode ?? 'type')]).map((_, i) => `line:${i + 1}`) : [])],
  ids: (shot) => [`${shot.id}.panel`],
  nodeField: codeField,
  validate: codeProblems,
  review: codeReview,
  // only the title loses emphasis markers: a star in the code is code
  expand: (shot, ctx) => expandCode(shot.title === undefined ? shot : { ...shot, title: unmarked(shot.title) }, ctx),
  prepared: true,
  eventDevices: Object.freeze(['change', 'output']),
  events: eventsOf,
  landing: landingOf,
  lookData: true,
  numbered: false,
  showsWords: false,
});
