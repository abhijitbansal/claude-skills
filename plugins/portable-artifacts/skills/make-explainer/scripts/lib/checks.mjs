// Per-section-type checks that need more than the schema (files on disk, other
// skills). A check is (ctx) => array of { path, message } | Promise<same>, where
// ctx = { section, path, dir, spec } and path is the section's JSON path
// ("sections[3]"). validateSpec runs every check registered for the section's
// type. Later tasks add theirs with registerCheck(type, fn).
import { resolveRef } from './paths.mjs';
import { pathJoin } from '../../shared/errors.mjs';
import { readImage } from './image.mjs';
import { loadSibling, SiblingError, MISSING_HINT } from './siblings.mjs';
import { DEFAULT_THEME } from '../../shared/theme.mjs';
import { itemKey } from './render/checklist.mjs';
import { readDiagramSpec, reportDiagramErrors, inPageTheme } from './diagram-source.mjs';

const CHECKS = new Map();

export function registerCheck(type, fn) {
  if (typeof fn !== 'function') throw new TypeError('a check must be a function');
  CHECKS.set(type, [...(CHECKS.get(type) ?? []), fn]);
}

// Removes one registered check (the same function object); unknown ones are ignored.
export function unregisterCheck(type, fn) {
  const rest = (CHECKS.get(type) ?? []).filter((f) => f !== fn);
  if (rest.length > 0) CHECKS.set(type, rest);
  else CHECKS.delete(type);
}

export function checksFor(type) {
  return CHECKS.get(type) ?? [];
}

export const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.svg'];

// image.src: a local file inside the spec folder, within the size cap, whose
// content matches its extension; an SVG must carry no script or external refs.
registerCheck('image', ({ section, path: at, dir }) => {
  const r = resolveRef(dir, section.src, { exts: IMAGE_EXTS });
  if (r.error) return [{ path: pathJoin(at, 'src'), message: r.error }];
  const img = readImage(r.abs);
  return img.error ? [{ path: pathJoin(at, 'src'), message: img.error }] : [];
});

// cards[].icon: a make-diagram catalog ref ("lucide:<name>" or "brand:<slug>").
// The sibling is loaded only when a card actually has an icon.
registerCheck('cards', async ({ section, path: at }) => {
  const withIcon = section.items.map((item, i) => [item, i]).filter(([item]) => item.icon !== undefined);
  if (withIcon.length === 0) return [];
  let icons;
  try {
    icons = await loadSibling('make-diagram', 'scripts/lib/icons.mjs');
  } catch (e) {
    if (!(e instanceof SiblingError)) throw e;
    return [{ path: pathJoin(at, 'items'), message: `icons need the make-diagram skill: ${e.message}` }];
  }
  const errors = [];
  for (const [item, i] of withIcon) {
    if (icons.hasIcon(item.icon)) continue;
    let message;
    try {
      icons.iconSvg(item.icon);
    } catch (e) {
      message = e.message;
    }
    errors.push({ path: pathJoin(pathJoin(pathJoin(at, 'items'), i), 'icon'), message: message ?? `unknown icon ${JSON.stringify(item.icon)}` });
  }
  return errors;
});

// checklist: an item is identified by its group title and text, so two equal
// ones (in one group, or in groups sharing a title) would share a tick.
registerCheck('checklist', ({ section, path: at }) => {
  const errors = [];
  const seen = new Map();
  section.groups.forEach((group, gi) => {
    group.items.forEach((item, ii) => {
      const where = pathJoin(pathJoin(pathJoin(pathJoin(pathJoin(at, 'groups'), gi), 'items'), ii), 'text');
      const key = itemKey(group.title, item.text);
      if (seen.has(key)) {
        errors.push({ path: where, message: `duplicate item ${JSON.stringify(item.text)} in group ${JSON.stringify(group.title)}; first at ${seen.get(key)}; reword one so their ticks stay apart` });
      } else {
        seen.set(key, where);
      }
    });
  });
  return errors;
});

// diagram: the embedded spec (inline, or a file in the spec folder) must pass
// make-diagram's own validation, geometry lint included, under the page's
// theme; its errors are re-pathed under the section's `diagram` field. The
// diagram's own `theme` is ignored (a warning says so). A blank string is
// already reported by the section's own check.
registerCheck('diagram', async ({ section, path: at, dir, spec }) => {
  const where = pathJoin(at, 'diagram');
  if (typeof section.diagram === 'string' && section.diagram.trim() === '') return [];
  const source = readDiagramSpec(section.diagram, dir);
  if (source.error) return [{ path: where, message: source.error }];
  let api;
  try {
    api = await loadSibling('make-diagram', 'scripts/lib/api.mjs');
  } catch (e) {
    if (!(e instanceof SiblingError)) throw e;
    return [{ path: where, message: e.message }];
  }
  if (typeof api.validateSpec !== 'function') {
    return [{ path: where, message: `make-diagram is too old (no validateSpec in api.mjs); ${MISSING_HINT(['make-diagram'])}` }];
  }
  const pageTheme = spec.theme ?? DEFAULT_THEME;
  const warnings = source.spec.theme === undefined ? [] : [{
    path: pathJoin(where, 'theme'),
    message: `ignored — the page theme (${JSON.stringify(pageTheme)}) is used; remove it or change the explainer's theme${source.file ? ` (in ${source.file})` : ''}`,
    warning: true,
  }];
  const result = await api.validateSpec(inPageTheme(source.spec, spec.theme));
  return [...reportDiagramErrors(result.errors, where, source.file), ...warnings];
});
