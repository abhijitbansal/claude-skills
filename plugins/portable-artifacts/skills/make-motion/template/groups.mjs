// Browser-safe (no Node imports): the `group` element. A group holds `children`, positioned relative to the group's
// own centre, and moves, fades, scales and rotates them as one unit. Shared by spec validation, the timeline, the
// renderer, check.mjs and the server, so every one of them walks a scene's elements the same way.
export const MAX_GROUP_DEPTH = 3; // groups nest at most this deep
export const MAX_GROUP_CHILDREN = 40;

export const isGroup = (el) => el?.type === 'group';

// A group's children as a list; a malformed spec (no array) has none, so a walker never throws on a half-edited file.
export const childrenOf = (el) => (isGroup(el) && Array.isArray(el.children) ? el.children : []);

/**
 * Every element of `elements`, groups included, depth first in document order (a group comes before its children):
 * [{ el, path, depth }]. `depth` is 0 for a top-level element. `path` is where the element sits in the spec, such as
 * `elements[2].children[1]`; pass the scene as `basePath` (`scenes[0]`) for `scenes[0].elements[2].children[1]`.
 * Pure; it does not copy the elements.
 */
export function flattenElements(elements, basePath = '') {
  const out = [];
  const walk = (list, prefix, depth) => list.forEach((el, i) => {
    const path = `${prefix}[${i}]`;
    out.push({ el, path, depth });
    walk(childrenOf(el), `${path}.children`, depth + 1);
  });
  walk(Array.isArray(elements) ? elements : [], basePath ? `${basePath}.elements` : 'elements', 0);
  return out;
}
