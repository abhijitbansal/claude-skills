// code-diff: the change from `before` to `after` as one highlighted diff, under an optional title: unchanged lines plain,
// removed lines marked - on a bad tint, added lines marked + on a good tint, each removal before the addition that
// replaces it.
import { squeeze, slot, enter, blockGroup, codePart, abovePlace } from './layout.mjs';
import { codePanelLayout, panelParts } from './code-panel.mjs';
import { CODE_LANGS, codeLines } from '../code-theme.mjs';

const params = {
  type: 'object',
  additionalProperties: false,
  required: ['before', 'after', 'lang'],
  properties: {
    before: { type: 'string', maxLength: 2000 },
    after: { type: 'string', maxLength: 2000 },
    lang: { enum: [...CODE_LANGS] },
    title: { type: 'string', minLength: 1, maxLength: 60 },
  },
};

// An empty side has no lines (a new file is all additions), not one empty line.
const linesOf = (code) => (code === '' ? [] : codeLines(code));

/**
 * The line diff of `before` and `after` as diff lines (' ' kept, '-' removed, '+' added), in order: the longest common
 * subsequence of lines is kept, and where both sides change the removals come first. Pure.
 */
export function lineDiff(before, after) {
  const a = linesOf(before);
  const b = linesOf(after);
  const width = b.length + 1;
  // keep[i * width + j]: the length of the longest common subsequence of a[i..] and b[j..] (at most 2001 lines a side)
  const keep = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      keep[i * width + j] = a[i] === b[j] ? keep[(i + 1) * width + j + 1] + 1 : Math.max(keep[(i + 1) * width + j], keep[i * width + j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push(` ${a[i]}`); i++; j++; } else if (keep[(i + 1) * width + j] >= keep[i * width + j + 1]) out.push(`-${a[i++]}`);
    else out.push(`+${b[j++]}`);
  }
  while (i < a.length) out.push(`-${a[i++]}`);
  while (j < b.length) out.push(`+${b[j++]}`);
  return out;
}

function expand(el, ctx) {
  const p = el.params;
  const id = (part) => `${el.id}/${part}`;
  const lines = lineDiff(p.before, p.after);
  const layout = codePanelLayout(el, ctx, { lines: lines.length ? lines : [''], title: p.title, cap: 1600 }); // the page draws one row for no lines
  const [panel, title] = panelParts(id, layout, p.title);
  const steps = title ? 3 : 2;
  const at = squeeze(ctx.sceneDuration, slot(steps - 1)[1]);
  const parts = [enter(panel, slot(0).map(at))];
  if (title) parts.push(enter(title, slot(1).map(at), { dy: 24 * layout.u }));
  const code = codePart(id('code'), lines.join('\n'), p.lang, 0, layout.panel.y, { width: layout.codeWidth, fontSize: layout.fontSize, diff: true });
  parts.push(enter(code, slot(steps - 1).map(at)));
  return blockGroup(el, parts);
}

export default Object.freeze({
  summary: 'a code change shown as a highlighted diff, removed lines in red and added lines in green',
  params,
  describe: {
    before: 'the code before the change, up to 2000 characters; \\n starts a new line',
    after: 'the code after the change, up to 2000 characters',
    lang: `its language: ${CODE_LANGS.join(', ')}`,
    title: 'a heading above the panel, up to 60 characters',
  },
  example: {
    title: 'Retry the request once',
    lang: 'javascript',
    before: 'async function load(url) {\n  const res = await fetch(url);\n  return res.json();\n}',
    after: 'async function load(url) {\n  let res = await fetch(url);\n  if (!res.ok) res = await fetch(url);\n  return res.json();\n}',
  },
  place: (size, format, _side, insets) => abovePlace(size, format, insets),
  paramOf: (part) => (part === 'code' ? 'after' : (part === 'title' ? part : null)),
  expand,
});
