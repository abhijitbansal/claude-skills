// Import a folder of vendor cloud icons the user downloaded and unpacked themselves
// (having accepted the vendor's terms) into the folder icons.mjs reads imported icons
// from. No network, no prompt. Every file passes svg-safe.mjs; a symlink is never
// followed; one unreadable or unsafe file is skipped and reported, never fatal.
//
//   importIcons(provider, folder, dir) -> { added: string[], skipped: [{ file, reason }] }
//
// `dir` is where the catalog goes (icons.mjs iconDir()). Writes go to a temp file that is
// moved into place, so a crash never leaves half a catalog.
import fs from 'node:fs';
import path from 'node:path';
import { sanitizeSvg, MAX_SVG_BYTES } from './svg-safe.mjs';
import { forgetImported } from './icons.mjs';

const MAX_FILES = 20000;
const MAX_DEPTH = 8;
const NAME_MAX = 64;

export class ImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ImportError';
  }
}

const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// AWS: Architecture-Service-Icons_<date>/Arch_<Category>/<size>/Arch_AWS-Lambda_64.svg -> aws-lambda,
// Arch_Amazon-Simple-Storage-Service_64.svg -> aws-simple-storage-service. Resource and category icons are not imported.
function awsName(base) {
  const m = /^Arch_(.+?)_(\d+)(?:_(.+))?\.svg$/i.exec(base);
  if (!m) {
    const why = /^(Res_|Arch-Category_)/i.test(base) ? 'not a service icon (only Arch_<Service>_<size>.svg files are imported)' : 'file name is not Arch_<Service>_<size>.svg';
    return { reason: why };
  }
  const service = slug(m[1]).replace(/^(?:amazon|aws)-/, '');
  return service === '' ? { reason: 'service name is empty' } : { name: `aws-${service}`, size: Number(m[2]), variant: m[3] ? 1 : 0 };
}

// Google Cloud: Cloud_Run.svg or cloud_run/cloud_run.svg -> google-cloud-run, BigQuery.svg -> google-bigquery.
function gcpName(base) {
  const product = slug(base.replace(/\.svg$/i, '')).replace(/(?:-icon|-\d+px|-\d+x\d+)+$/, '');
  if (product === '') return { reason: 'product name is empty' };
  return { name: product.startsWith('google-') ? product : `google-${product}`, size: 0, variant: 0 };
}

export const PROVIDERS = {
  aws: {
    label: 'AWS',
    nameOf: awsName,
    layout: 'expected the unpacked AWS Architecture Icons download: Architecture-Service-Icons_<date>/Arch_<Category>/<size>/Arch_<Service>_<size>.svg',
  },
  gcp: {
    label: 'Google Cloud',
    nameOf: gcpName,
    layout: 'expected .svg files named for the product, like Cloud_Run.svg or cloud_run/cloud_run.svg or BigQuery.svg',
  },
};

export const providerNames = () => Object.keys(PROVIDERS);

// Every .svg under `folder`, sorted, without following a symlink to a file or a folder.
function collect(folder) {
  const files = [];
  const skipped = [];
  const visit = (dir, depth) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(folder, full);
      if (entry.isSymbolicLink()) skipped.push({ file: rel, reason: 'symlink not followed' });
      else if (entry.isDirectory()) {
        if (depth >= MAX_DEPTH) skipped.push({ file: rel, reason: `folder nested more than ${MAX_DEPTH} levels deep` });
        else visit(full, depth + 1);
      } else if (entry.isFile() && /\.svg$/i.test(entry.name)) {
        if (files.length >= MAX_FILES) throw new ImportError(`more than ${MAX_FILES} .svg files under ${folder}; point at the icon folder itself`);
        files.push({ full, rel });
      }
    }
  };
  visit(folder, 0);
  return { files, skipped };
}

function readSafe({ full, rel }) {
  const size = fs.lstatSync(full).size;
  if (size > MAX_SVG_BYTES) return { skipped: { file: rel, reason: 'file is over 256 KiB' } };
  const result = sanitizeSvg(fs.readFileSync(full, 'utf8'));
  return result.skipped === undefined ? { entry: result } : { skipped: { file: rel, reason: result.skipped } };
}

// Highest size first, a plain file before a variant of it, then the path order.
const byRank = (a, b) => b.size - a.size || a.variant - b.variant || (a.rel < b.rel ? -1 : 1);

function pick(candidates, skipped) {
  const entries = {};
  const byName = new Map();
  for (const c of candidates) byName.set(c.name, [...(byName.get(c.name) ?? []), c]);
  for (const [name, group] of byName) {
    const ranked = [...group].sort(byRank);
    const winner = ranked.find((c) => {
      const read = readSafe(c);
      if (read.skipped) skipped.push(read.skipped);
      else entries[name] = read.entry;
      return read.entry !== undefined;
    });
    if (!winner) continue;
    for (const c of ranked) {
      if (c !== winner && c.size === winner.size && c.variant === winner.variant) skipped.push({ file: c.rel, reason: `same icon as ${winner.rel}` });
    }
  }
  return entries;
}

function writeAtomically(file, text) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(tmp, text, { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw new ImportError(`cannot write ${file}: ${e.message}`);
  }
}

function readStored(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')).icons ?? {};
  } catch {
    return {}; // none yet, or a damaged one that this import replaces
  }
}

function store(provider, dir, entries) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `imported-${provider}.json`);
  const merged = { ...readStored(file), ...Object.fromEntries(Object.entries(entries).map(([n, e]) => [n, { viewBox: e.viewBox, markup: e.markup }])) };
  const body = Object.keys(merged).sort().map((k) => `${JSON.stringify(k)}:${JSON.stringify(merged[k])}`);
  writeAtomically(file, `{"provider":${JSON.stringify(provider)},"icons":{\n${body.join(',\n')}\n}}\n`);
  forgetImported(dir);
}

export function importIcons(provider, folder, dir) {
  if (!Object.hasOwn(PROVIDERS, provider)) {
    throw new ImportError(`unknown provider ${JSON.stringify(provider)}; accepted: ${providerNames().join(', ')}`);
  }
  const spec = PROVIDERS[provider];
  let isFolder = false;
  try {
    isFolder = fs.statSync(folder).isDirectory();
  } catch {
    isFolder = false;
  }
  if (!isFolder) throw new ImportError(`${JSON.stringify(folder)} is not a folder; unpack the ${spec.label} icon download and pass that folder`);
  const { files, skipped } = collect(folder);
  const candidates = [];
  for (const file of files) {
    const mapped = spec.nameOf(path.basename(file.full));
    if (mapped.reason) skipped.push({ file: file.rel, reason: mapped.reason });
    else if (mapped.name.length > NAME_MAX) skipped.push({ file: file.rel, reason: `name is over ${NAME_MAX} characters` });
    else candidates.push({ ...file, ...mapped });
  }
  if (candidates.length === 0) {
    throw new ImportError(`no ${spec.label} icons found in ${folder} (${files.length} .svg file${files.length === 1 ? '' : 's'} seen); ${spec.layout}`);
  }
  const entries = pick(candidates, skipped);
  if (Object.keys(entries).length > 0) store(provider, dir, entries);
  return { added: Object.keys(entries).sort(), skipped };
}
