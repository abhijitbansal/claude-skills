// terminal-run: a terminal panel that shows its prompt, types the command at the default pace (0.035 s a character),
// then prints the output lines one at a time, 0.15 s apart. The scene must last until the last line is out and a frame
// more, and its last rendered frame must come after that line (frames.mjs).
import { fitSchedule, squeeze, slot, enter, blockGroup, codePart, abovePlace } from './layout.mjs';
import { codePanelLayout, panelParts } from './code-panel.mjs';
import { DEFAULT_FPS, TYPING_SECONDS_PER_CHAR, typingLength } from '../defaults.mjs';
import { gridOf, frameCutoff, loneSceneShowing } from '../frames.mjs';

const params = {
  type: 'object',
  additionalProperties: false,
  required: ['command', 'output'],
  properties: {
    command: { type: 'string', minLength: 1, maxLength: 120 },
    output: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'string', maxLength: 80 } },
    prompt: { type: 'string', minLength: 1, maxLength: 8, default: '$' },
  },
};

// Each is one terminal line: a line break (\n or \r) inside one would slip past the 12-line cap and the 0.15 s stagger.
const LINE_BREAK = /[\n\r]/;
const ONE_LINE = 'must be one line (no line breaks)';
function lineBreakErrors(p) {
  const fields = [['command', p.command, ONE_LINE], ...p.output.map((line, i) => [`output[${i}]`, line, `${ONE_LINE}; put each output line in its own item`]), ['prompt', p.prompt, ONE_LINE]];
  return fields.filter(([, value]) => typeof value === 'string' && LINE_BREAK.test(value)).map(([path, , message]) => ({ path, message }));
}

const LINE_SECONDS = 0.15; // between one output line and the next (the first comes this long after the command)
const JUMP_SECONDS = 0.001; // a line (or the prompt) appears at once: its characters arrive over this
const START = () => slot(1)[1]; // the command types once the panel and the terminal have come in

const promptOf = (p) => p.prompt ?? params.properties.prompt.default;
const textOf = (p) => [`${promptOf(p)} ${p.command}`, ...p.output].join('\n');

// The value keyframes (characters shown) at full speed: the prompt and its space at once, the command typed, then each
// output line (with the newline before it) at once, LINE_SECONDS apart.
function typingTrack(p) {
  const start = START();
  const promptChars = typingLength(promptOf(p)) + 1;
  const commandChars = typingLength(p.command);
  const typed = start + JUMP_SECONDS + commandChars * TYPING_SECONDS_PER_CHAR;
  const track = [{ t: start, value: 0 }, { t: start + JUMP_SECONDS, value: promptChars }, { t: typed, value: promptChars + commandChars }];
  let shown = promptChars + commandChars;
  p.output.forEach((line, i) => {
    const t = typed + (i + 1) * LINE_SECONDS;
    track.push({ t, value: shown });
    shown += 1 + typingLength(line);
    track.push({ t: t + JUMP_SECONDS, value: shown });
  });
  return track;
}

const scheduleEnd = (p) => typingTrack(p).at(-1).t;
const CENTISECONDS = 100;
const seconds = (n) => (Math.ceil(n * CENTISECONDS) / CENTISECONDS).toFixed(2);

// The last line must be out a frame before the scene ends and by the scene's last rendered frame (frames.mjs). -> null
// when it is, else the scene length to ask for. `ctx`: validate's or expand's context (its scene's place in the video).
const cutoff = (p, ctx) => {
  const fps = ctx.fps ?? DEFAULT_FPS;
  return frameCutoff(gridOf({ ...ctx, fps }), { end: scheduleEnd(p), minimum: scheduleEnd(p) + 1 / fps });
};
// The shortest scene this block alone in its video passes in (the rule cutoff applies, as one number).
const minDuration = (p, fps = DEFAULT_FPS) => Math.max(scheduleEnd(p) + 1 / fps, loneSceneShowing(scheduleEnd(p), fps));

function validate(p, ctx) {
  const broken = lineBreakErrors(p);
  if (broken.length) return broken;
  const fix = cutoff(p, ctx);
  if (fix === null) return [];
  const lines = p.output.length;
  return [{ path: 'command', message: `typing the command (${typingLength(p.command)} characters) and showing ${lines} output line${lines === 1 ? '' : 's'} takes ${seconds(scheduleEnd(p))}s; the scene must last at least ${fix.toFixed(2)}s` }];
}

function expand(el, ctx) {
  const p = el.params;
  const id = (part) => `${el.id}/${part}`;
  const text = textOf(p);
  const layout = codePanelLayout(el, ctx, { lines: text.split('\n'), cap: 1400 });
  const [panel] = panelParts(id, layout);
  // A scene that passes keeps every time as written; a shorter one (an error) is squeezed into it.
  const at = cutoff(p, ctx) === null ? fitSchedule(ctx.sceneDuration, scheduleEnd(p), 0) : squeeze(ctx.sceneDuration, scheduleEnd(p));
  const terminal = enter(codePart(id('terminal'), text, 'bash', 0, layout.panel.y, { width: layout.codeWidth, fontSize: layout.fontSize, typing: true }), slot(1).map(at));
  terminal.keyframes.push(...typingTrack(p).map(({ t, value }) => ({ t: at(t), value })));
  return blockGroup(el, [enter(panel, slot(0).map(at)), terminal]);
}

export default Object.freeze({
  summary: 'a terminal that types a command and prints its output line by line, such as a test run or an install',
  params,
  describe: {
    command: 'the command, up to 120 characters; it types at 0.035 s a character',
    output: '1 to 12 output lines, each up to 80 characters, printed 0.15 s apart once the command is typed',
    prompt: 'the prompt before the command (default "$"), up to 8 characters',
  },
  example: { command: 'npm test', output: ['> node --test', 'ok 1 - adds two numbers', 'ok 2 - parses the config', 'pass 2, fail 0'] },
  place: (size, format, _side, insets) => abovePlace(size, format, insets),
  paramOf: (part) => (part === 'terminal' ? 'command' : null),
  minDuration,
  validate,
  expand,
});
