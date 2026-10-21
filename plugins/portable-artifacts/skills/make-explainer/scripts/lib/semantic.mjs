// Checks the schema cannot express: lengths and counts (with the value and the
// limit in the message), ids, theme, and the rules that tie fields together.
// Runs only after the schema passes, so shapes can be trusted.
import { didYouMean, pathJoin } from '../../shared/errors.mjs';
import { listThemes } from '../../shared/theme.mjs';
import { ID_PATTERN, KEY_PATTERN, LIMITS, META_KEYS, NON_SPACE } from './schema.mjs';
import { codeLines } from './slides.mjs';
import { suggestedPlanKey } from './plan-hash.mjs';

const q = (v) => JSON.stringify(v);
const MAX_LISTED = 12;
// A KPI value longer than this draws a warning (not an error): the tile is narrow and the value stays on one line.
// (The renderer gives a value above 10 characters a wide tile, render/kpis.mjs; the two thresholds are deliberate:
// layout at >10, advice at >12.)
const KPI_VALUE_ADVISED = 12;

function suggestion(value, candidates) {
  const hint = didYouMean(value, candidates);
  if (hint) return `did you mean ${q(hint)}?`;
  const shown = candidates.slice(0, MAX_LISTED).join(', ');
  return `available: ${shown}${candidates.length > MAX_LISTED ? `, … (${candidates.length - MAX_LISTED} more)` : ''}`;
}

function length(errors, obj, field, base, limit) {
  const value = obj[field];
  if (typeof value !== 'string') return;
  const n = [...value].length;
  if (n > limit) errors.push({ path: pathJoin(base, field), message: `${field} is ${n} characters; the limit is ${limit} — shorten it` });
}

// `range` is [min, max]; `fix` finishes the "too many" message.
function count(errors, arr, base, field, [min, max], fix = 'cut some or split the section') {
  const n = arr.length;
  const at = pathJoin(base, field);
  if (n > max) errors.push({ path: at, message: `${field} has ${n} entries; the limit is ${max} — ${fix}` });
  else if (n < min) errors.push({ path: at, message: `${field} has ${n} entries; at least ${min} required — add more` });
}

// ---- top level --------------------------------------------------------

// A page with questions to answer saves and exports its answers under the plan's key, so such a spec needs one.
const ANSWERABLE_TYPES = new Set(['decision', 'approval', 'question']);

export function checkTop(spec, errors) {
  length(errors, spec, 'title', '', LIMITS.title);
  length(errors, spec, 'subtitle', '', LIMITS.subtitle);
  for (const key of META_KEYS) if (spec.meta) length(errors, spec.meta, key, 'meta', LIMITS.meta);
  count(errors, spec.sections, '', 'sections', LIMITS.sections, 'cut some or split the explainer');
  if (spec.preset === 'slides' && spec.mode === 'page') {
    errors.push({ path: 'mode', message: 'preset "slides" renders as slides; remove mode or set it to "slides"' });
  }
  if (spec.theme !== undefined) {
    const themes = listThemes();
    if (!themes.includes(spec.theme)) errors.push({ path: 'theme', message: `unknown theme ${q(spec.theme)}; ${suggestion(spec.theme, themes)}` });
  }
  if (spec.key !== undefined) checkKey(errors, spec.key, 'key');
  else if (spec.preset === 'plan' || spec.sections.some((s) => ANSWERABLE_TYPES.has(s.type))) {
    errors.push({ path: 'key', message: `a plan needs a key (answers are saved and checked under it); add "key": ${q(suggestedPlanKey(spec))}` });
  }
}

// A storage namespace (a checklist's ticks, a plan's answers): KEY_PATTERN and the checklist key limit.
function checkKey(errors, key, at) {
  if (!KEY_PATTERN.test(key)) {
    errors.push({ path: at, message: `key ${q(key)} is invalid; use lowercase letters, digits, . - and _, starting with a letter or digit` });
  } else if ([...key].length > LIMITS.checklistKey) {
    errors.push({ path: at, message: `key is ${[...key].length} characters; the limit is ${LIMITS.checklistKey} — shorten it` });
  }
}

// ---- ids --------------------------------------------------------------

// Ids the page itself emits, so a section id must not equal one: <main id="content"> (page.html and
// slides.mjs), the deck's "outline-title" and "slide-N" / "slide-N-title", and the chart SVGs' "chN-..." ids.
// Diagram ids ("dg_N-...") hold an underscore, which ID_PATTERN already refuses. "plan-verdict" is the verdict's
// radio group name.
const RESERVED_IDS = [/^content$/, /^outline-title$/, /^slide-\d+(?:-title)?$/, /^ch\d+-/, /^plan-verdict$/];
// An answerable item's radios are named "plan-<id>", so its id must not be "verdict" (the verdict's group). Only these
// three types: a tldr may keep the id "verdict" (the examples use it).
const PLAN_ITEM_TYPES = new Set(['decision', 'approval', 'question']);
const RESERVED_ITEM_IDS = new Set(['verdict']);

export function checkIds(spec, errors) {
  const seen = new Map();
  spec.sections.forEach((s, i) => {
    if (s.id === undefined) return;
    const at = pathJoin(pathJoin('sections', i), 'id');
    if (!ID_PATTERN.test(s.id)) {
      errors.push({ path: at, message: `id ${q(s.id)} is invalid; use lowercase letters, digits and -, starting with a letter` });
    }
    if (RESERVED_IDS.some((re) => re.test(s.id))) {
      errors.push({ path: at, message: `id ${q(s.id)} is reserved by the page; pick another id, such as "overview"` });
    }
    if (PLAN_ITEM_TYPES.has(s.type) && RESERVED_ITEM_IDS.has(s.id)) {
      errors.push({ path: at, message: `id ${q(s.id)} is reserved for the plan's verdict; pick another id, such as "${s.id}-call"` });
    }
    if (PLAN_ITEM_TYPES.has(s.type)) length(errors, s, 'id', pathJoin('sections', i), LIMITS.planId);
    if (seen.has(s.id)) errors.push({ path: at, message: `duplicate id ${q(s.id)}; first used at ${seen.get(s.id)}; rename one` });
    else seen.set(s.id, at);
  });
}

// ---- per type ---------------------------------------------------------

const wordSchemaMessage = 'must contain at least one non-space character';

function checkTable(s, at, errors) {
  count(errors, s.columns, at, 'columns', LIMITS.tableColumns, 'drop columns or split the table');
  count(errors, s.rows, at, 'rows', LIMITS.tableRows, 'split the table');
  const n = s.columns.length;
  s.rows.forEach((row, r) => {
    if (row.length !== n) {
      errors.push({ path: pathJoin(pathJoin(at, 'rows'), r), message: `row has ${row.length} cells but there ${n === 1 ? 'is 1 column' : `are ${n} columns`}; give every row ${n} ${n === 1 ? 'cell' : 'cells'}` });
    }
  });
  if (s.align && s.align.length !== n) {
    errors.push({ path: pathJoin(at, 'align'), message: `align has ${s.align.length} entries but there ${n === 1 ? 'is 1 column' : `are ${n} columns`}; give one alignment per column` });
  }
}

// Inline-chart fields; a dashboard chart takes its definition from the dashboard.
const INLINE_CHART_FIELDS = ['kind', 'x', 'y', 'color', 'size', 'value', 'format', 'data'];

function checkChart(s, at, errors) {
  const dashboardMode = s.dashboard !== undefined || s.chart !== undefined;
  if (!dashboardMode && s.data === undefined) {
    errors.push({ path: at, message: 'a chart needs either inline data (data + kind) or dashboard + chart; add one' });
    return;
  }
  if (dashboardMode) {
    for (const field of ['dashboard', 'chart']) {
      if (s[field] === undefined) errors.push({ path: pathJoin(at, field), message: `required when ${field === 'chart' ? 'dashboard' : 'chart'} is set` });
    }
    for (const field of INLINE_CHART_FIELDS) {
      if (s[field] !== undefined) {
        errors.push({ path: pathJoin(at, field), message: `${q(field)} applies to inline data charts; remove it or drop dashboard` });
      }
    }
    return;
  }
  if (s.interactive === true) {
    errors.push({ path: pathJoin(at, 'interactive'), message: 'interactive needs dashboard + chart (the dashboard is what opens); set dashboard and chart, or remove interactive' });
  }
  count(errors, s.data, at, 'data', [1, LIMITS.chartRows], 'chart a summary or use a dashboard instead');
  if (s.kind === undefined) {
    errors.push({ path: pathJoin(at, 'kind'), message: 'required for inline data charts; set kind to a chart kind such as "bar"' });
  }
}

function checkChecklist(s, at, errors, keys) {
  const keyAt = pathJoin(at, 'key');
  checkKey(errors, s.key, keyAt);
  if (keys.has(s.key)) errors.push({ path: keyAt, message: `duplicate checklist key ${q(s.key)}; first used at ${keys.get(s.key)}; rename one so their ticks stay apart` });
  else keys.set(s.key, keyAt);
  count(errors, s.groups, at, 'groups', [1, Infinity]);
  s.groups.forEach((g, gi) => count(errors, g.items, pathJoin(pathJoin(at, 'groups'), gi), 'items', [1, Infinity]));
}

function checkSection(s, i, errors, state) {
  const at = pathJoin('sections', i);
  length(errors, s, 'title', at, LIMITS.title);
  switch (s.type) {
    case 'tldr':
      length(errors, s, 'text', at, LIMITS.tldrText);
      count(errors, s.points ?? [], at, 'points', [0, LIMITS.tldrPoints], 'keep the strongest points or split the section');
      (s.points ?? []).forEach((p, pi) => {
        const n = [...p].length;
        if (n > LIMITS.point) errors.push({ path: pathJoin(pathJoin(at, 'points'), pi), message: `point is ${n} characters; the limit is ${LIMITS.point} — shorten it` });
      });
      break;
    case 'text': case 'details':
      length(errors, s, 'text', at, LIMITS.text);
      break;
    case 'kpis': count(errors, s.items, at, 'items', LIMITS.kpis, 'keep the key numbers or split the section'); break;
    case 'cards': count(errors, s.items, at, 'items', LIMITS.cards, 'split the section'); break;
    case 'table': checkTable(s, at, errors); break;
    case 'files': count(errors, s.items, at, 'items', LIMITS.files, 'group by folder instead of listing every file'); break;
    case 'risks': case 'steps': case 'timeline': count(errors, s.items, at, 'items', [1, Infinity]); break;
    case 'compare':
      count(errors, s.columns, at, 'columns', LIMITS.compareColumns, 'compare at most three options');
      s.columns.forEach((c, ci) => count(errors, c.points, pathJoin(pathJoin(at, 'columns'), ci), 'points', [1, Infinity]));
      break;
    case 'code':
      if (codeLines(s.code) > LIMITS.codeLines) {
        errors.push({ path: pathJoin(at, 'code'), message: `code is ${codeLines(s.code)} lines; the limit is ${LIMITS.codeLines} — shorten it or split it` });
      }
      break;
    case 'checklist': checkChecklist(s, at, errors, state.checklistKeys); break;
    case 'diagram':
      if (typeof s.diagram === 'string' && !new RegExp(NON_SPACE).test(s.diagram)) {
        errors.push({ path: pathJoin(at, 'diagram'), message: wordSchemaMessage });
      }
      break;
    case 'scene':
      if (typeof s.scene === 'string' && !new RegExp(NON_SPACE).test(s.scene)) {
        errors.push({ path: pathJoin(at, 'scene'), message: wordSchemaMessage });
      }
      break;
    case 'chart': checkChart(s, at, errors); break;
    case 'motion':
      if (s.video === undefined && s.spec === undefined) {
        errors.push({ path: at, message: 'a motion section needs video (an .mp4 path) or spec (a motion.json path); add one' });
      }
      break;
    case 'decision': checkDecision(s, at, errors); break;
    case 'approval': length(errors, s, 'item', at, LIMITS.planQuestion); break;
    case 'question': length(errors, s, 'text', at, LIMITS.planQuestion); break;
    case 'review': checkReview(s, at, errors, state.ids); break;
    case 'verdict': checkVerdict(i, at, errors, state); break;
    default:
  }
}

// ---- plan mode --------------------------------------------------------

// A field that names an option must name one exactly: answers carry the label.
function checkOptionRef(s, field, at, errors, labels) {
  const value = s[field];
  if (value === undefined || labels.includes(value)) return;
  const hint = didYouMean(value, labels);
  const fix = hint ? `did you mean ${q(hint)}?` : `use one option label exactly: ${labels.map(q).join(', ')}`;
  errors.push({ path: pathJoin(at, field), message: `${field} ${q(value)} is not an option label; ${fix}` });
}

// Labels are what a reader picks and what the export carries: no edge spaces, and no two that differ only in case.
function checkOptionLabels(s, at, errors) {
  const seen = new Map();
  s.options.forEach((o, oi) => {
    const labelAt = pathJoin(pathJoin(pathJoin(at, 'options'), oi), 'label');
    if (o.label !== o.label.trim()) errors.push({ path: labelAt, message: `label ${q(o.label)} starts or ends with a space; trim it` });
    const folded = o.label.trim().toLowerCase();
    const first = seen.get(folded);
    if (first) errors.push({ path: labelAt, message: `duplicate option label ${q(o.label)}: it matches ${q(first.label)} at ${first.at} (labels are compared ignoring case); give each option its own label` });
    else seen.set(folded, { label: o.label, at: labelAt });
  });
}

function checkDecision(s, at, errors) {
  length(errors, s, 'question', at, LIMITS.planQuestion);
  count(errors, s.options, at, 'options', LIMITS.planOptions, 'keep the strongest options');
  s.options.forEach((o, oi) => length(errors, o, 'label', pathJoin(pathJoin(at, 'options'), oi), LIMITS.planLabel));
  checkOptionLabels(s, at, errors);
  const labels = s.options.map((o) => o.label);
  checkOptionRef(s, 'recommended', at, errors, labels);
  checkOptionRef(s, 'default', at, errors, labels);
}

// A review item points at a section by its explicit id (generated ids are not known until the build).
function checkReview(s, at, errors, ids) {
  count(errors, s.items, at, 'items', LIMITS.reviewItems, 'keep the places that need the hardest look');
  s.items.forEach((item, j) => {
    if (item.target !== undefined && item.target === s.id) {
      errors.push({ path: pathJoin(pathJoin(pathJoin(at, 'items'), j), 'target'), message: `target ${q(item.target)} is this review section itself; point it at the section to review` });
      return;
    }
    if (item.target === undefined || ids.includes(item.target)) return;
    const hint = didYouMean(item.target, ids);
    const fix = hint ? `did you mean ${q(hint)}?` : `set an explicit id on the section it points to; ids: ${ids.length > 0 ? ids.join(', ') : '(none)'}`;
    errors.push({ path: pathJoin(pathJoin(pathJoin(at, 'items'), j), 'target'), message: `target ${q(item.target)} matches no section id; ${fix}` });
  });
}

function checkVerdict(i, at, errors, state) {
  if (i !== state.last) errors.push({ path: at, message: 'the verdict must be the last section; move it to the end' });
  if (state.verdictAt !== undefined) errors.push({ path: at, message: `only one verdict per page; the first is at ${state.verdictAt}; remove this one` });
  else state.verdictAt = at;
}

export function checkSections(spec, errors) {
  const ids = spec.sections.map((s) => s.id).filter((id) => id !== undefined);
  const state = { checklistKeys: new Map(), ids, last: spec.sections.length - 1, verdictAt: undefined };
  spec.sections.forEach((s, i) => checkSection(s, i, errors, state));
  const answerable = spec.sections.some((s) => PLAN_ITEM_TYPES.has(s.type));
  if (spec.preset === 'plan' && !answerable) {
    errors.push({ path: 'sections', message: 'a plan needs at least one decision, approval or question' });
  }
  // The verdict holds the Export buttons: without it the answers cannot leave the page.
  if (answerable && state.verdictAt === undefined) {
    errors.push({ path: 'sections', message: 'a plan with decisions, approvals or questions needs a verdict section (it holds the Export buttons); add one as the last section' });
  }
}

/** Advice that never blocks a build: -> [{ path, message }]. */
export function warnSections(spec) {
  const warnings = [];
  spec.sections.forEach((s, i) => {
    const at = pathJoin('sections', i);
    if (s.type === 'checklist' && s.intro === undefined && spec.preset === 'checklist') {
      warnings.push({ path: pathJoin(at, 'intro'), message: 'add a "What\'s in this branch" summary (features and review-cycle fixes) — testers need the context' });
    }
    if (s.type === 'kpis') warnLongKpiValues(s, at, warnings);
  });
  return warnings;
}

// A KPI tile is narrow and holds its value on one line, so words belong in `note`. A number is never long.
function warnLongKpiValues(section, at, warnings) {
  section.items.forEach((item, j) => {
    if (typeof item.value !== 'string') return;
    const n = [...item.value].length;
    if (n > KPI_VALUE_ADVISED) {
      warnings.push({ path: pathJoin(pathJoin(pathJoin(at, 'items'), j), 'value'), message: `KPI value is ${n} characters; keep it to ${KPI_VALUE_ADVISED} or move words to note` });
    }
  });
}
