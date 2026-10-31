// code-typing: an editor panel that types its code, highlighted, from the first frame at the default pace (0.035 s a
// character), under an optional title. The scene must last until the last character is typed and a frame more.
import { squeeze, slot, enter, blockGroup, codePart, abovePlace } from './layout.mjs';
import { codePanelLayout, panelParts } from './code-panel.mjs';
import { CODE_LANGS, codeLines } from '../code-theme.mjs';
import { DEFAULT_FPS, TYPING_SECONDS_PER_CHAR, typingLength, typingNeeds } from '../defaults.mjs';
import { gridOf, frameCutoff, loneSceneShowing } from '../frames.mjs';

// The most code a scene can type: a scene lasts 60 s at most, and typing 1700 characters at 0.035 s takes 59.5 s, a
// frame less than that at 24 fps. (Written out: this module may not read a defaults.mjs constant while it loads.)
const MAX_TYPED_CHARACTERS = 1700;
const MIN_SCENE_SECONDS = 0.2; // spec.mjs: no scene is shorter, so a few characters never ask for less

const params = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'lang'],
  properties: {
    code: { type: 'string', minLength: 1, maxLength: MAX_TYPED_CHARACTERS },
    lang: { enum: [...CODE_LANGS] },
    title: { type: 'string', minLength: 1, maxLength: 60 },
  },
};

const takesOf = (p) => typingLength(p.code) * TYPING_SECONDS_PER_CHAR;

// The shortest scene this block alone in its video passes in (the rule validate applies, as one number).
const minDuration = (p, fps = DEFAULT_FPS) => Math.max(MIN_SCENE_SECONDS, typingNeeds(typingLength(p.code), fps), loneSceneShowing(takesOf(p), fps));

// The cut-off error (the element rule, spec.mjs checkTyping, said of the param) when the typing does not end a frame
// before the scene does and by the scene's last rendered frame (frames.mjs).
function validate(p, ctx) {
  const fps = ctx.fps ?? DEFAULT_FPS;
  const chars = typingLength(p.code);
  const fix = frameCutoff(gridOf({ ...ctx, fps }), { end: takesOf(p), minimum: typingNeeds(chars, fps) });
  if (fix === null) return [];
  return [{ path: 'code', message: `typing ${chars} characters takes ${takesOf(p).toFixed(2)}s but the scene lasts ${ctx.sceneDuration}s (it must finish a frame before the scene ends at ${fps} fps); shorten the code or lengthen the scene to at least ${fix}s` }];
}

function expand(el, ctx) {
  const p = el.params;
  const id = (part) => `${el.id}/${part}`;
  const layout = codePanelLayout(el, ctx, { lines: codeLines(p.code), title: p.title, cap: 1600 });
  const [panel, title] = panelParts(id, layout, p.title);
  const at = squeeze(ctx.sceneDuration, slot(1)[1]);
  const parts = [enter(panel, slot(0).map(at))];
  if (title) parts.push(enter(title, slot(1).map(at), { dy: 24 * layout.u }));
  // No entrance: the code is empty until it types, from the scene start (the timeline's default typing track).
  parts.push(codePart(id('code'), p.code, p.lang, 0, layout.panel.y, { width: layout.codeWidth, fontSize: layout.fontSize, typing: true }));
  return blockGroup(el, parts);
}

export default Object.freeze({
  summary: 'an editor panel that types highlighted code, such as a function or a config file being written',
  params,
  describe: {
    code: 'the code, up to 1700 characters; \\n starts a new line; it types from the first frame at 0.035 s a character',
    lang: `its language: ${CODE_LANGS.join(', ')}`,
    title: 'a heading above the panel, up to 60 characters',
  },
  example: { title: 'Add two numbers', lang: 'javascript', code: 'export function add(a, b) {\n  // both are numbers\n  return a + b;\n}\n\nconst total = add(40, 2);' },
  place: (size, format, _side, insets) => abovePlace(size, format, insets),
  minDuration,
  validate,
  expand,
});
