// explainer.json: loading and the layered validation (schema, then limits and
// ids, then the text lint, the slide budget and the per-type checks).
import fs from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import { formatAjvErrors, pathJoin } from '../../shared/errors.mjs';
import { UsageError, exitUsage } from '../../shared/cli.mjs';
import { jsonSyntaxError, JsonSyntaxError } from './json-error.mjs';
import { ROOT_SCHEMA, SECTION_SCHEMAS, TYPE_SCHEMA, NON_SPACE } from './schema.mjs';
import { checkTop, checkIds, checkSections, warnSections } from './semantic.mjs';
import { collectStrings } from './walk.mjs';
import { lintText, lintPlaceholders } from './lint.mjs';
import { warnBudget } from './budget.mjs';
import { slideBudget } from './slides.mjs';
import { checksFor } from './checks.mjs';

export { UsageError, JsonSyntaxError };

const ajv = new Ajv({ allErrors: true, strict: true, verbose: true, allowUnionTypes: true });
const validateRoot = ajv.compile(ROOT_SCHEMA);
const validateType = ajv.compile(TYPE_SCHEMA);
const validateBySection = Object.fromEntries(Object.entries(SECTION_SCHEMAS).map(([t, s]) => [t, ajv.compile(s)]));

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
    throw jsonSyntaxError(file, text, e);
  }
}

/**
 * Report a UsageError the way exitUsage does (exit 2; JSON on stdout when asked, text on stderr), except that a
 * JSON syntax error also shows its offending line and caret: the shared helper prints only a message's first line.
 */
export function exitSpecUsage(error, { json = false } = {}) {
  if (!(error instanceof JsonSyntaxError)) return exitUsage(error, { json });
  const message = `${error.message}\n${error.snippet}`;
  if (json) process.stdout.write(`${JSON.stringify({ ok: false, errors: [{ path: '', message }] })}\n`);
  else process.stderr.write(`${message}\n`);
  process.exitCode = 2;
  return undefined;
}

// Ajv's pattern message would print the raw regex; ours says what to fix.
function wordSchemaError(e) {
  if (e.keyword === 'pattern' && e.params.pattern === NON_SPACE) {
    return { ...e, message: 'must contain at least one non-space character' };
  }
  return e;
}

const under = (prefix, errors) => (errors ?? []).map((e) => ({ ...e, instancePath: `${prefix}${e.instancePath}` }));

// Root first, then every section against the schema of its own type.
function schemaErrors(spec) {
  const raw = [];
  validateRoot(spec);
  raw.push(...(validateRoot.errors ?? []));
  if (Array.isArray(spec?.sections)) {
    spec.sections.forEach((s, i) => {
      if (s === null || typeof s !== 'object' || Array.isArray(s)) return;
      const prefix = `/sections/${i}`;
      validateType(s);
      raw.push(...under(prefix, validateType.errors));
      const validate = validateBySection[s.type];
      if (!Object.hasOwn(validateBySection, s.type)) return;
      validate(s);
      raw.push(...under(prefix, validate.errors));
    });
  }
  return formatAjvErrors(raw.map(wordSchemaError));
}

// A table section's cells (sections[i].rows...): the one place the banned-phrase rule does not apply.
const TABLE_CELL = /^sections\[(\d+)\]\.rows(?:\[|$)/;
const isTableCell = (spec, at) => {
  const m = TABLE_CELL.exec(at);
  return m !== null && spec.sections?.[Number(m[1])]?.type === 'table';
};

// Every string: placeholders everywhere, the style lint on prose only.
export function lintSpec(spec) {
  const errors = [];
  for (const { path: at, text, prose, heading } of collectStrings(spec)) {
    if (!prose) {
      errors.push(...lintPlaceholders(text, at));
      continue;
    }
    const sectionTitle = /^sections\[\d+\]\.title$/.test(at);
    // Table cells are data (commands, identifiers, quoted values), not sentences: no banned-phrase rule there.
    const r = lintText(text, at, { heading, sectionTitle, banned: !isTableCell(spec, at) });
    errors.push(...r.errors);
  }
  return { errors };
}

// Every check registered for a section's type. A check returns { path, message } errors;
// an item marked `warning: true` is a warning instead.
async function registryResults(spec, dir) {
  const errors = [];
  const warnings = [];
  for (const [i, section] of spec.sections.entries()) {
    for (const check of checksFor(section.type)) {
      for (const { warning, ...item } of await check({ section, path: pathJoin('sections', i), dir, spec })) {
        (warning === true ? warnings : errors).push(item);
      }
    }
  }
  return { errors, warnings };
}

/**
 * Validate a parsed spec. `dir` is the spec's folder (file references resolve
 * against it; default: the current directory).
 * -> { ok, errors, warnings }, each [{ path, message }]. Warnings never fail.
 */
export async function validateSpec(spec, { dir = process.cwd() } = {}) {
  const structural = schemaErrors(spec);
  if (structural.length > 0) return { ok: false, errors: structural, warnings: [] };
  const errors = [];
  checkTop(spec, errors);
  checkIds(spec, errors);
  checkSections(spec, errors);
  const lint = lintSpec(spec);
  errors.push(...lint.errors);
  if (spec.mode === 'slides' || spec.preset === 'slides') errors.push(...slideBudget(spec));
  const registry = await registryResults(spec, dir);
  errors.push(...registry.errors);
  return { ok: errors.length === 0, errors, warnings: [...warnBudget(spec), ...warnSections(spec), ...registry.warnings] };
}
