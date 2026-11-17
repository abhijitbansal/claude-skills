// What this skill needs, per doctor target. Side-effect free: imports only built-ins and ../../shared/ (the icon
// catalog is loaded lazily, inside a check, so importing this file runs and reads nothing).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL, nodeVersion, nodeModules, devDeps, browser, builderAgent, quoteArg } from '../../shared/doctor.mjs';

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMPORT_STEP = `node ${quoteArg(path.join(SCRIPTS, 'icons.mjs'))} import <aws|gcp> <folder>`;
const manualAll = (cmd) => ({ darwin: cmd, linux: cmd, win32: cmd });

// check.mjs (and --fix, ALL) needs playwright, a devDependency, and a browser; plain diagnosis needs neither.
// builderAgent is optional in every target: the cheap-model agent file the SKILL.md may hand the build to.
export const targets = ['check'];

// The `cloud:` icon refs a spec names, nodes and participants alike.
function cloudRefs(specFile) {
  let spec;
  try {
    spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
  } catch (e) {
    throw new Error(`cannot read spec ${specFile}: ${String(e.message).split('\n')[0]}`);
  }
  const items = [...(Array.isArray(spec?.nodes) ? spec.nodes : []), ...(Array.isArray(spec?.participants) ? spec.participants : [])];
  return [...new Set(items.map((i) => i?.icon).filter((icon) => typeof icon === 'string' && icon.startsWith('cloud:')))];
}

// A cloud icon is bundled, or imported by the user from a vendor pack on this machine. A spec that names one the
// machine lacks fails validation here but not on the machine that imported it. Never an auto fix: the importer
// reads a pack the user downloaded and accepted the terms of.
function cloudIcons(refs) {
  const missing = async () => {
    try {
      const { hasIcon } = await import('./icons.mjs');
      return refs.filter((ref) => !hasIcon(ref));
    } catch {
      return []; // the catalog cannot be read here (a bare copy): say nothing rather than guess
    }
  };
  let last = [];
  return {
    id: 'cloud_icons',
    why: () => `the spec uses cloud icons this machine does not have (${last.join(', ')}); they come from a vendor icon pack that is imported once`,
    required: true,
    size: 'a folder you unpack, no download',
    check: async () => { last = await missing(); return last.length === 0; },
    fix: () => ({
      auto: null,
      manual: manualAll(`download the vendor's icon pack (AWS Architecture Icons, or Google Cloud's icons), accept its terms, unpack it, then run: ${IMPORT_STEP}`),
      notes: 'the importer reads the unpacked folder only: no network, no prompt',
    }),
    needsSudo: () => false,
  };
}

const specNeeds = (specFile) => {
  const refs = cloudRefs(specFile);
  return refs.length > 0 ? [cloudIcons(refs)] : [];
};

export const requirementsFor = (target) => {
  if (target === 'check' || target === ALL) {
    return [nodeVersion(20), nodeModules({ restore: ['dev_deps'] }), devDeps({ size: '≈118 MB', required: true }), browser({ required: true }), builderAgent()];
  }
  const specific = typeof target === 'string' && target.endsWith('.json') ? specNeeds(target) : [];
  return [nodeVersion(20), nodeModules({ restore: ['dev_deps'] }), ...specific, builderAgent()];
};
