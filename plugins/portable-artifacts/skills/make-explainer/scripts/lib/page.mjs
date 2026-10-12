// Page assembly: one self-contained HTML file around the rendered sections.
// Theme CSS and fonts, the masthead, a contents list (4+ titled sections),
// the sections, and the inlined runtime. No network, no LLM. Every string from
// the spec goes through the markdown-lite renderer or escapeHtml.
import fs from 'node:fs';
import path from 'node:path';
import { themeCss, loadTheme, DEFAULT_THEME } from '../../shared/theme.mjs';
import { pathJoin } from '../../shared/errors.mjs';
import { META_KEYS } from './schema.mjs';
import { SECTIONS } from './sections.mjs';
import { resolveOutput } from './output.mjs';
import { slugify } from '../../shared/output.mjs';
import { loadSibling, SiblingError } from './siblings.mjs';
import { esc, inline, plain, rawText } from './render/ui.mjs';

const TEMPLATE = new URL('../../template/page.html', import.meta.url);
const PA_LIB = new URL('../../template/pa-lib.js', import.meta.url);
const RUNTIME = new URL('../../template/runtime.js', import.meta.url);
const TOC_MIN = 4;
const MAX_ID = 40;

export class BuildError extends Error {
  constructor(errors) {
    super(errors.map((e) => `${e.path || '(root)'}: ${e.message}`).join('\n'));
    this.name = 'BuildError';
    this.errors = errors;
  }
}

/** The page's Content-Security-Policy: no network; media from disk only when a motion section needs it. */
export function contentSecurityPolicy(spec) {
  const base = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:";
  return spec.sections.some((s) => s.type === 'motion') ? `${base}; media-src 'self' file: blob:` : base;
}

// Inline script text must not close its tag or open an HTML comment.
const inlineCode = (code) => code.replace(/<\/(script)/gi, '<\\/$1').replaceAll('<!--', '<\\!--');

const slugOf = (title) => slugify(rawText(title), '').slice(0, MAX_ID).replace(/-+$/, '');

// Explicit ids are kept; the rest come from the title (or "section-N") and are
// made unique with a numeric suffix.
export function sectionIds(sections) {
  const taken = new Set(sections.map((s) => s.id).filter((id) => id !== undefined));
  return sections.map((s, i) => {
    if (s.id !== undefined) return s.id;
    const base = (s.title !== undefined && slugOf(s.title)) || `section-${i + 1}`;
    let id = /^[a-z]/.test(base) ? base : `s-${base}`;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    taken.add(id);
    return id;
  });
}

function renderSection(section, i, id, def, ctx) {
  let body;
  try {
    body = def.render(section, ctx);
  } catch (e) {
    throw new BuildError([{ path: pathJoin('sections', i), message: e.message }]);
  }
  const hasHeading = section.title !== undefined && !def.ownHeading;
  const heading = hasHeading
    ? `<h2 class="sec-title" id="${esc(id)}-title">${inline(section.title)}<a class="anchor" href="#${esc(id)}" aria-label="Link to this section: ${plain(section.title)}">#</a></h2>\n`
    : '';
  const labelled = hasHeading ? ` aria-labelledby="${esc(id)}-title"` : '';
  return `<section class="sec sec-${section.type}" id="${esc(id)}"${labelled}>\n${heading}${body}\n</section>`;
}

function renderMeta(meta) {
  const entries = META_KEYS.filter((k) => meta?.[k] !== undefined);
  if (entries.length === 0) return '';
  const items = entries.map((k) => `<div class="m-${k}"><dt>${k[0].toUpperCase()}${k.slice(1)}</dt><dd>${esc(meta[k])}</dd></div>`);
  return `<dl class="meta">\n${items.join('\n')}\n</dl>`;
}

function renderToc(entries) {
  if (entries.length < TOC_MIN) return '';
  const items = entries.map(({ id, title }) => `<li><a href="#${esc(id)}">${plain(title)}</a></li>`);
  return `<nav class="toc" aria-label="Contents">\n<details open>\n<summary>Contents</summary>\n<ol>\n${items.join('\n')}\n</ol>\n</details>\n</nav>`;
}

async function loadIcons(spec) {
  const used = spec.sections.some((s) => s.type === 'cards' && s.items.some((c) => c.icon !== undefined));
  if (!used) return null;
  try {
    return await loadSibling('make-diagram', 'scripts/lib/icons.mjs');
  } catch (e) {
    if (e instanceof SiblingError) throw new BuildError([{ path: 'sections', message: `icons need the make-diagram skill: ${e.message}` }]);
    throw e;
  }
}

function unsupported(spec) {
  const errors = [];
  if (spec.mode === 'slides' || spec.preset === 'slides') {
    errors.push({ path: 'mode', message: 'slides mode has no renderer yet; set mode to "page" (and preset to something else) to build a page' });
  }
  spec.sections.forEach((s, i) => {
    if (!Object.hasOwn(SECTIONS, s.type)) {
      errors.push({ path: pathJoin(pathJoin('sections', i), 'type'), message: `${JSON.stringify(s.type)} sections have no renderer yet; remove the section or use another type` });
    }
  });
  return errors;
}

/**
 * The finished page for a validated spec.
 * `dir` is the spec's folder (file references resolve against it), `theme`
 * overrides spec.theme, `out` is the destination (file.html or directory; the
 * default output rules apply when omitted).
 * -> { html, assets: [{ from, to }] } with absolute paths; nothing is written.
 * Throws BuildError (path + message list) when a section cannot be rendered.
 */
export async function buildPage(spec, { dir = process.cwd(), theme, out, env = process.env } = {}) {
  const problems = unsupported(spec);
  if (problems.length > 0) throw new BuildError(problems);
  const themeData = loadTheme(theme ?? spec.theme ?? DEFAULT_THEME);
  const target = resolveOutput({ out, title: spec.title, env });
  const slug = path.basename(target, '.html');
  const ids = sectionIds(spec.sections);
  const ctx = {
    theme: themeData,
    dir,
    outDir: path.dirname(target),
    assetsDir: path.join(path.dirname(target), `${slug}.assets`),
    slug,
    mode: 'page',
    idFor: (_section, i) => ids[i],
    icons: await loadIcons(spec),
  };

  const assets = [];
  for (const section of spec.sections) {
    const def = SECTIONS[section.type];
    if (def.assets) assets.push(...await def.assets(section, ctx));
  }
  const rendered = spec.sections.map((section, i) => renderSection(section, i, ids[i], SECTIONS[section.type], ctx));
  const tocEntries = spec.sections
    .map((s, i) => ({ id: ids[i], title: s.title, own: SECTIONS[s.type].ownHeading }))
    .filter((e) => e.title !== undefined && !e.own);
  const toc = renderToc(tocEntries);

  const parts = {
    CSP: esc(contentSecurityPolicy(spec)),
    TITLE: plain(spec.title),
    THEME: themeCss(themeData),
    BODYCLASS: toc ? 'has-toc' : '',
    H1: inline(spec.title),
    SUBTITLE: spec.subtitle === undefined ? '' : `<p class="subtitle">${inline(spec.subtitle)}</p>`,
    META: renderMeta(spec.meta),
    TOC: toc,
    SECTIONS: rendered.join('\n'),
    PALIB: inlineCode(fs.readFileSync(PA_LIB, 'utf8')),
    RUNTIME: inlineCode(fs.readFileSync(RUNTIME, 'utf8')),
  };
  // One pass: a value that contains "<!--@X-->" is never substituted again.
  const html = fs.readFileSync(TEMPLATE, 'utf8').replace(/<!--@(\w+)-->/g, (_, key) => parts[key] ?? '');
  return { html, assets };
}
