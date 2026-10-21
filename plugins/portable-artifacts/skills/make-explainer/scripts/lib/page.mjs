// Page assembly: one self-contained HTML file around the rendered sections.
// Theme CSS and fonts, the hero (with a leading tldr as its card), a contents
// list (4+ titled sections), the sections, and the inlined runtime. No network,
// no LLM. Every string from the spec goes through the markdown-lite renderer or
// escapeHtml.
import fs from 'node:fs';
import path from 'node:path';
import { themeCss, loadTheme } from '../../shared/theme.mjs';
import { EXPLAINER_THEME } from './default-theme.mjs';
import { pathJoin } from '../../shared/errors.mjs';
import { META_KEYS } from './schema.mjs';
import { SECTIONS } from './sections.mjs';
import { resolveOutput, pageSlug, assetsFolder } from './output.mjs';
import { slugify } from '../../shared/output.mjs';
import { loadSibling, SiblingError } from './siblings.mjs';
import { SectionErrors } from './section-errors.mjs';
import { isSlides, renderDeck } from './slides.mjs';
import { faviconLink } from '../../shared/icons.mjs';
import { generatorMeta, provenanceHtml, buildDate } from '../../shared/provenance.mjs';
import { toggleIcons, TOGGLE_CSS, TOGGLE_JS } from '../../shared/theme-toggle.mjs';
import { esc, inline, headingInline, plain, rawText, toneClass } from './render/ui.mjs';
import { flavorFor, flavorVars, scrimVar, CLASSIC } from './flavor.mjs';
import { artSvg } from '../../shared/art.mjs';
import { dataUri } from './image.mjs';

const TEMPLATES = { page: new URL('../../template/page.html', import.meta.url), slides: new URL('../../template/slides.html', import.meta.url) };
const BASE_CSS = new URL('../../template/base.css', import.meta.url);
const FLAVOR_CSS = new URL('../../template/flavors.css', import.meta.url);
const DECK_FLAVOR_CSS = new URL('../../template/deck-flavors.css', import.meta.url);
const ART = { width: 1280, height: 720 };
const SLIDE_ART = { width: 1920, height: 1080 };
const SLIDES_JS = new URL('../../template/slides.js', import.meta.url);
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

// Explicit ids are kept; the rest come from the title (or "section-N"), get the
// "s-" prefix when they would start with a digit, and are made unique with a
// numeric suffix applied to that final id. A generated id also avoids every
// "<id>-title" heading id already taken.
export function sectionIds(sections) {
  const taken = new Set();
  for (const s of sections) {
    if (s.id !== undefined) {
      taken.add(s.id);
      taken.add(`${s.id}-title`);
    }
  }
  return sections.map((s, i) => {
    if (s.id !== undefined) return s.id;
    const slug = (s.title !== undefined && slugOf(s.title)) || `section-${i + 1}`;
    const base = /^[a-z]/.test(slug) ? slug : `s-${slug}`;
    let id = base;
    for (let n = 2; taken.has(id) || taken.has(`${id}-title`); n++) id = `${base}-${n}`;
    taken.add(id);
    taken.add(`${id}-title`);
    return id;
  });
}

// Heading ids: "<id>-title", numbered when an explicit section id already
// claims that name, so no two elements on the page share an id.
export function headingIds(ids) {
  const taken = new Set(ids);
  return ids.map((id) => {
    let h = `${id}-title`;
    for (let n = 2; taken.has(h); n++) h = `${id}-title-${n}`;
    taken.add(h);
    return h;
  });
}

function renderBody(section, i, def, ctx) {
  try {
    return def.render(section, ctx);
  } catch (e) {
    throw new BuildError([{ path: pathJoin('sections', i), message: e.message }]);
  }
}

// Async work a section type needs before its synchronous render.
// A SiblingError (a missing skill) passes through unchanged; section-relative errors get the section's path.
async function prepareSection(section, i, def, ctx) {
  try {
    await def.prepare(section, ctx, i);
  } catch (e) {
    if (e instanceof SiblingError) throw e;
    const at = pathJoin('sections', i);
    if (e instanceof SectionErrors) throw new BuildError(e.errors.map((x) => ({ path: pathJoin(at, x.path), message: x.message })));
    throw new BuildError([{ path: at, message: e.message }]);
  }
}

// Stylesheets and scripts a section type ships once per page, only when the page has one. Types that ship the
// same stylesheet or script (the answerable plan types) share one copy.
function sectionPageParts(spec, ctx) {
  const css = new Set();
  const js = new Set();
  for (const type of new Set(spec.sections.map((s) => s.type))) {
    const part = SECTIONS[type].page?.(ctx);
    if (!part) continue;
    css.add(part.css);
    for (const code of part.js) js.add(code);
  }
  return {
    SECTIONCSS: css.size > 0 ? `<style>\n${[...css].join('\n')}\n</style>` : '',
    SECTIONJS: [...js].map((code) => `<script>\n${inlineCode(code)}\n</script>`).join('\n'),
  };
}

// The small label above a heading; only a section that shows its own title gets one.
const eyebrow = (section) => (section.label === undefined ? '' : `<p class="sec-eyebrow pa-label">${plain(section.label)}</p>\n`);

// `alt`: the section sits on the alternating surface band (every second visual section).
function renderSection(section, i, id, titleId, def, ctx, alt = false) {
  const body = renderBody(section, i, def, ctx);
  const hasHeading = section.title !== undefined && !def.ownHeading;
  const heading = hasHeading
    ? `${eyebrow(section)}<h2 class="sec-title" id="${esc(titleId)}">${headingInline(section.title)}<a class="anchor" href="#${esc(id)}" aria-label="Link to this section: ${plain(section.title)}">#</a></h2>\n`
    : '';
  const labelled = hasHeading ? ` aria-labelledby="${esc(titleId)}"` : '';
  return `<section class="sec sec-${section.type}${alt ? ' sec-alt' : ''}" id="${esc(id)}"${labelled}>\n${heading}${body}\n</section>`;
}

// A leading tldr is the hero's card: same body, the section id kept for deep links, the tone on the card.
// The label is the card's visible heading; with a label the title stays for screen readers only (it names
// the region), because the lead sentence already states the verdict. Without a label the title shows.
function renderHeroTldr(section, id, titleId, ctx) {
  const body = renderBody(section, 0, SECTIONS.tldr, ctx);
  const hidden = section.label === undefined ? '' : ' sr-only';
  const title = section.title === undefined ? '' : `<h2 class="hero-tldr-title${hidden}" id="${esc(titleId)}">${headingInline(section.title)}</h2>\n`;
  const name = section.label === undefined ? 'Summary' : plain(section.label);
  const labelled = section.title === undefined ? ` aria-label="${name}"` : ` aria-labelledby="${esc(titleId)}"`;
  const tone = section.tone === undefined ? '' : ` ${toneClass(section.tone)}`;
  return `<div class="hero-tldr${tone}" id="${esc(id)}" role="region"${labelled}>\n${eyebrow(section)}${title}${body}\n</div>`;
}

// Plan mode: the sections a reader answers. A page that has one carries the plan's key (the answers' storage
// namespace) and its hash on <html>; the hash is a placeholder until the answers validator fills it.
const PLAN_ITEM_TYPES = new Set(['decision', 'approval', 'question', 'verdict']);
const planAttrs = (spec, slides) => (slides || !spec.sections.some((s) => PLAN_ITEM_TYPES.has(s.type))
  ? ''
  : ` data-plan-key="${esc(spec.key ?? '')}" data-plan-hash=""`);

// Review links name the section they point at: explicit id -> link text as escaped HTML. The title or label when
// there is one, else the start of its question, item or text as plain text, cut at a word near LINK_CHARS.
const LINK_CHARS = 60;
function clip(text) {
  const flat = rawText(text).replace(/\s+/g, ' ').trim();
  if ([...flat].length <= LINK_CHARS) return esc(flat);
  const cut = [...flat].slice(0, LINK_CHARS).join('');
  const space = cut.lastIndexOf(' ');
  return `${esc((space > LINK_CHARS / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, ''))}…`;
}
function linkText(s) {
  const name = s.title ?? s.label;
  if (name !== undefined) return headingInline(name);
  const words = [s.question, s.item, s.text].find((x) => typeof x === 'string');
  return words === undefined ? undefined : clip(words);
}
const linkTargets = (sections) => new Map(sections
  .filter((s) => s.id !== undefined && linkText(s) !== undefined)
  .map((s) => [s.id, linkText(s)]));

function renderMeta(meta) {
  const entries = META_KEYS.filter((k) => meta?.[k] !== undefined);
  if (entries.length === 0) return '';
  const items = entries.map((k) => `<div class="m-${k}"><dt>${k[0].toUpperCase()}${k.slice(1)}</dt><dd>${esc(meta[k])}</dd></div>`);
  return `<dl class="meta">\n${items.join('\n')}\n</dl>`;
}

function renderToc(entries) {
  if (entries.length < TOC_MIN) return '';
  const items = entries.map(({ id, title, label }) => `<li><a href="#${esc(id)}">${plain(label ?? title)}</a></li>`);
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
  spec.sections.forEach((s, i) => {
    if (!Object.hasOwn(SECTIONS, s.type)) {
      errors.push({ path: pathJoin(pathJoin('sections', i), 'type'), message: `no renderer for section type ${JSON.stringify(s.type)}; remove the section or use another type` });
    }
  });
  return errors;
}

// Visual sections (a registry `band` flag) alternate onto a surface band, starting with the first: 1st, 3rd, ...
function altFlags(sections) {
  let visual = 0;
  return sections.map((s) => SECTIONS[s.type].band && visual++ % 2 === 0);
}

// Procedural art for one slot: one drawing per colour mode, the stylesheet shows the one that matches.
function artPair(theme, seed, size) {
  const drawing = (mode) => artSvg({ theme: theme.name, seed, ...size, mode }).replace(/^<svg /, `<svg class="art-${mode}" `);
  return `${drawing('light')}${drawing('dark')}`;
}

// The hero's art, seeded from the title. Decorative, so hidden from assistive tech.
// With a returned image (build.mjs --image-api) it replaces the procedural pair.
function heroArt(spec, theme, image) {
  const inner = image ? `<img src="${dataUri(image)}" alt="" role="presentation">` : artPair(theme, spec.title, ART);
  return `<div class="hero-art" aria-hidden="true">${inner}</div>`;
}

// The page layout: hero pieces, the contents list and the sections.
function pageParts(spec, ctx, ids) {
  const titleIds = headingIds(ids);
  // A tldr that is the only section stays in <main>: the skip link then still lands on content.
  const heroTldr = spec.sections[0].type === 'tldr' && spec.sections.length > 1;
  const alt = altFlags(spec.sections);
  const rendered = spec.sections.map((section, i) => (heroTldr && i === 0
    ? ''
    : renderSection(section, i, ids[i], titleIds[i], SECTIONS[section.type], ctx, alt[i])));
  const tocEntries = spec.sections
    .map((s, i) => ({ id: ids[i], title: s.title, label: s.label, own: SECTIONS[s.type].ownHeading }))
    .filter((e) => e.title !== undefined && !e.own);
  const toc = renderToc(tocEntries);
  return {
    BODYCLASS: toc ? 'has-toc' : '',
    H1: inline(spec.title),
    SUBTITLE: spec.subtitle === undefined ? '' : `<p class="subtitle">${inline(spec.subtitle)}</p>`,
    META: renderMeta(spec.meta),
    HEROTLDR: heroTldr ? renderHeroTldr(spec.sections[0], ids[0], titleIds[0], ctx) : '',
    TOC: toc,
    SECTIONS: rendered.filter(Boolean).join('\n'),
  };
}

// The slide layout: the whole deck is one marker. A flavored deck's first and last slides get full-bleed art,
// seeded from the title and the slide number so the two drawings (and their svg ids) differ.
function deckParts(spec, ctx, flavored) {
  const rendered = spec.sections.map((section, i) => {
    const def = SECTIONS[section.type];
    return { section, ownHeading: def.ownHeading, body: renderBody(section, i, def, ctx) };
  });
  const artFor = flavored ? (n) => artPair(ctx.theme, `${spec.title}${n}`, SLIDE_ART) : undefined;
  return { DECK: renderDeck({ spec, rendered, metaHtml: renderMeta(spec.meta), slug: ctx.slug, footerHtml: ctx.footer, artFor }) };
}

const readCss = (url) => fs.readFileSync(url, 'utf8').replace(/\n$/, '');

// Stylesheets after the template's own: the page gets the flavor sheet; a deck gets it too (its section
// treatments are shared) plus the deck sheet and the scrim. Classic gets nothing.
function flavorSheets(flavor, slides) {
  if (flavor === CLASSIC) return '';
  if (!slides) return `<style>\n${readCss(FLAVOR_CSS)}\n</style>`;
  return `<style>\n${readCss(FLAVOR_CSS)}\n${scrimVar(flavor)}\n${readCss(DECK_FLAVOR_CSS)}\n</style>`;
}

/**
 * The finished page for a validated spec.
 * `dir` is the spec's folder (file references resolve against it), `theme`
 * overrides spec.theme, `out` is the destination (file.html or directory; the
 * default output rules apply when omitted), `heroImage` ({ mime, bytes }, or an async function of `{ assets }` returning one, called last) replaces the page hero's
 * procedural art.
 * -> { html, assets: [{ from, to } or { content, to }] } with absolute paths; nothing is written.
 * Throws BuildError (path + message list) when a section cannot be rendered.
 */
export async function buildPage(spec, { dir = process.cwd(), theme, out, env = process.env, heroImage } = {}) {
  const problems = unsupported(spec);
  if (problems.length > 0) throw new BuildError(problems);
  const themeData = loadTheme(theme ?? spec.theme ?? EXPLAINER_THEME);
  const target = resolveOutput({ out, title: spec.title, env });
  const slug = pageSlug(target);
  const slides = isSlides(spec);
  const ids = sectionIds(spec.sections);
  const flavor = flavorFor(themeData.name);
  const footer = `<footer class="pa-footer">${provenanceHtml('make-explainer', spec.generatedBy, buildDate(env))}<p class="pa-theme">Theme: ${esc(themeData.name)}</p></footer>`;
  const ctx = {
    theme: themeData,
    dir,
    outDir: path.dirname(target),
    assetsDir: assetsFolder(target),
    slug,
    mode: slides ? 'slides' : 'page',
    idFor: slides ? (_section, i) => `slide-${i + 2}` : (_section, i) => ids[i],
    icons: await loadIcons(spec),
    env,
    footer,
    targets: linkTargets(spec.sections),
  };

  const assets = [];
  for (const [i, section] of spec.sections.entries()) {
    const def = SECTIONS[section.type];
    if (def.prepare) await prepareSection(section, i, def, ctx);
    if (def.assets) assets.push(...(await def.assets(section, ctx)).map((a) => ({ ...a, at: `sections[${i}]` })));
  }
  const flavored = flavor !== CLASSIC;
  const layout = slides ? deckParts(spec, ctx, flavored) : pageParts(spec, ctx, ids);

  const parts = {
    CSP: esc(contentSecurityPolicy(spec)),
    TITLE: plain(spec.title),
    FAVICON: faviconLink('make-explainer', themeData),
    GENERATOR: generatorMeta('make-explainer', spec.generatedBy),
    TOGGLE_ICONS: toggleIcons(),
    TOGGLE_CSS,
    TOGGLE_JS: inlineCode(TOGGLE_JS),
    FOOTER: footer,
    THEME: flavored ? `${themeCss(themeData)}\n${flavorVars(flavor)}` : themeCss(themeData),
    BASECSS: fs.readFileSync(BASE_CSS, 'utf8').replace(/\n$/, ''),
    FLAVOR: flavor,
    THEMENAME: esc(themeData.name),
    PLANATTRS: planAttrs(spec, slides),
    FLAVORCSS: flavorSheets(flavor, slides),
    HEROART: flavored && !slides ? heroArt(spec, themeData, typeof heroImage === 'function' ? undefined : heroImage) : '',
    ...layout,
    ...sectionPageParts(spec, ctx),
    PALIB: inlineCode(fs.readFileSync(PA_LIB, 'utf8')),
    SLIDESJS: slides ? inlineCode(fs.readFileSync(SLIDES_JS, 'utf8')) : '',
    RUNTIME: inlineCode(fs.readFileSync(RUNTIME, 'utf8')),
  };
  // One pass: a value that contains "<!--@X-->" is never substituted again.
  const template = fs.readFileSync(TEMPLATES[ctx.mode], 'utf8');
  const fill = (values) => template.replace(/<!--@(\w+)-->/g, (_, key) => values[key] ?? '');
  const html = fill(parts);
  // Everything that can throw has run. Only now may a provider be asked for the image (it may call the network);
  // the hero art is then swapped in by a pure string operation.
  const image = typeof heroImage === 'function' && parts.HEROART !== '' ? await heroImage({ assets }) : undefined;
  return { html: image ? fill({ ...parts, HEROART: heroArt(spec, themeData, image) }) : html, assets };
}
