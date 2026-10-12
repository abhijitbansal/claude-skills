// Checks the schema cannot express: lengths and counts (with the value and the
// limit in the message), ids, theme, and the rules that tie fields together.
// Runs only after the schema passes, so shapes can be trusted.
import { didYouMean, pathJoin } from '../../shared/errors.mjs';
import { listThemes } from '../../shared/theme.mjs';
import { ID_PATTERN, KEY_PATTERN, LIMITS, META_KEYS, NON_SPACE } from './schema.mjs';
import { codeLines } from './slides.mjs';

const q = (v) => JSON.stringify(v);
const MAX_LISTED = 12;

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

export function checkTop(spec, errors) {
  length(errors, spec, 'title', '', LIMITS.title);
  length(errors, spec, 'subtitle', '', LIMITS.subtitle);
  for (const key of META_KEYS) if (spec.meta) length(errors, spec.meta, key, 'meta', LIMITS.meta);
  count(errors, spec.sections, '', 'sections', LIMITS.sections, 'cut some or split the explainer');
  if (spec.theme !== undefined) {
    const themes = listThemes();
    if (!themes.includes(spec.theme)) errors.push({ path: 'theme', message: `unknown theme ${q(spec.theme)}; ${suggestion(spec.theme, themes)}` });
  }
}

// ---- ids --------------------------------------------------------------

export function checkIds(spec, errors) {
  const seen = new Map();
  spec.sections.forEach((s, i) => {
    if (s.id === undefined) return;
    const at = pathJoin(pathJoin('sections', i), 'id');
    if (!ID_PATTERN.test(s.id)) {
      errors.push({ path: at, message: `id ${q(s.id)} is invalid; use lowercase letters, digits and -, starting with a letter` });
    }
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

function checkChart(s, at, errors) {
  const hasData = s.data !== undefined;
  const hasDashboard = s.dashboard !== undefined;
  const hasId = s.chart !== undefined;
  if (hasData) {
    count(errors, s.data, at, 'data', [0, LIMITS.chartRows], 'chart a summary or use a dashboard instead');
    if (hasDashboard || hasId) {
      errors.push({ path: pathJoin(at, 'data'), message: 'data cannot be combined with dashboard/chart; use inline data or a dashboard chart, not both' });
    }
  } else if (hasDashboard !== hasId) {
    errors.push({ path: pathJoin(at, hasDashboard ? 'chart' : 'dashboard'), message: `required when ${hasDashboard ? 'dashboard' : 'chart'} is set` });
  } else if (!hasDashboard) {
    errors.push({ path: at, message: 'a chart needs either dashboard + chart (a dashboard.json path and a chart id) or inline data + kind; add one' });
  }
}

function checkChecklist(s, at, errors, keys) {
  const keyAt = pathJoin(at, 'key');
  if (!KEY_PATTERN.test(s.key)) {
    errors.push({ path: keyAt, message: `key ${q(s.key)} is invalid; use lowercase letters, digits, . - and _, starting with a letter or digit` });
  } else if ([...s.key].length > LIMITS.checklistKey) {
    errors.push({ path: keyAt, message: `key is ${[...s.key].length} characters; the limit is ${LIMITS.checklistKey} — shorten it` });
  }
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
    case 'chart': checkChart(s, at, errors); break;
    case 'motion':
      if (s.video === undefined && s.spec === undefined) {
        errors.push({ path: at, message: 'a motion section needs video (an .mp4 path) or spec (a motion.json path); add one' });
      }
      break;
    default:
  }
}

export function checkSections(spec, errors) {
  const state = { checklistKeys: new Map() };
  spec.sections.forEach((s, i) => checkSection(s, i, errors, state));
}
