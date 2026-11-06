// Browser only: the one DOM helper the hand and the drawn elements share.
import { SVG_NS } from './style.mjs';

/** An SVG node with `attrs`, inside `parent` when one is given. */
export function svgEl(name, attrs = {}, parent) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  parent?.append(node);
  return node;
}
