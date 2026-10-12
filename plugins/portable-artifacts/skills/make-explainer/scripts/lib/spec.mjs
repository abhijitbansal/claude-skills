// explainer.json: loading and the layered validation (schema, then limits and
// ids, then the text lint, the slide budget and the per-type checks).
import fs from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import { formatAjvErrors, pathJoin } from '../../shared/errors.mjs';
import { UsageError } from '../../shared/cli.mjs';
import { ROOT_SCHEMA, SECTION_SCHEMAS, TYPE_SCHEMA, NON_SPACE } from './schema.mjs';
import { checkTop, checkIds, checkSections } from './semantic.mjs';
import { collectStrings } from './walk.mjs';
import { lintText, lintPlaceholders } from './lint.mjs';
import { slideBudget } from './slides.mjs';
import { checksFor } from './checks.mjs';

export { UsageError };

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
    throw new UsageError(`${file} is not valid JSON: ${e.message}`);
  }
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

// Every string: placeholders everywhere, the style lint on prose only.
function lintSpec(spec) {
  const errors = [];
  const warnings = [];
  for (const { path: at, text, prose, heading } of collectStrings(spec)) {
    if (!prose) {
      errors.push(...lintPlaceholders(text, at));
      continue;
    }
    const sectionTitle = /^sections\[\d+\]\.title$/.test(at);
    const r = lintText(text, at, { heading, sectionTitle });
    errors.push(...r.errors);
    warnings.push(...r.warnings);
  }
  return { errors, warnings };
}

async function registryErrors(spec, dir) {
  const errors = [];
  for (const [i, section] of spec.sections.entries()) {
    for (const check of checksFor(section.type)) {
      errors.push(...await check({ section, path: pathJoin('sections', i), dir, spec }));
    }
  }
  return errors;
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
  errors.push(...await registryErrors(spec, dir));
  return { ok: errors.length === 0, errors, warnings: lint.warnings };
}
