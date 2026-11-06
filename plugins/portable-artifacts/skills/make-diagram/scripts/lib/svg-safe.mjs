// The one allow-list every cloud icon passes, bundled (build-icons.mjs) or imported
// (icon-import.mjs). sanitizeSvg(text) parses an SVG file with a small tokenizer,
// checks every element, attribute and value against the tables below, and returns
// markup it serialises itself: nothing of the input text is echoed. Fail closed:
// whatever the tokenizer or a table does not recognise is a refusal with a reason,
// and the icon is skipped. No dependency, no network, no DOM.
//
//   sanitizeSvg(text) -> { markup, viewBox } | { skipped: reason }   (never throws)
//   roundTrip(entry) -> entry | null   an icon as stored: kept only if sanitizing it again changes nothing
//   scopeIds(markup, prefix) -> markup with every id (and each reference to one) prefixed
//
// `markup` is the content of the <svg> (no root element); `viewBox` is "minX minY w h".

export const MAX_SVG_BYTES = 256 * 1024;
const MAX_DEPTH = 16;
const MAX_ELEMENTS = 4000;
const MAX_DRAWN = 20000; // elements drawn once <use> and the other references are expanded
const MAX_REFERENCE_DEPTH = 100; // a chain of <use>, mask, clip-path and href references
const MAX_ID_LENGTH = 64;
const MAX_VIEWBOX = 100000;
const MIN_VIEWBOX_SIZE = 0.01;
const MAX_SCALAR = 64; // characters in one number, colour or length
const MAX_REASON = 120;

// A stored icon is the sanitized content of an <svg>, so wrapping it back adds one root attribute and may add one <g>
// (root paint): the second pass gets that much room, and no more.
const STRICT = { bytes: MAX_SVG_BYTES, depth: MAX_DEPTH, elements: MAX_ELEMENTS };
const STORED = { bytes: MAX_SVG_BYTES + 1024, depth: MAX_DEPTH + 2, elements: MAX_ELEMENTS + 2 };

class Refusal extends Error {}
// A reason may quote hostile input: only printable ASCII, and never long.
const printable = (text) => String(text).replace(/[^\x20-\x7e]/g, '?');
const refuse = (reason) => {
  const text = printable(reason);
  throw new Refusal(text.length > MAX_REASON ? `${text.slice(0, MAX_REASON)}...` : text);
};

// ---- tables -------------------------------------------------------------------------------

const PAINT = ['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin',
  'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'clip-rule', 'clip-path', 'mask'];
const SHAPE = ['id', 'transform', ...PAINT];
// What a style="" attribute may set: the paint properties and the gradient stop ones, nothing about geometry or structure.
const STYLE_PROPERTIES = new Set([...PAINT, 'stop-color', 'stop-opacity']);
const GRADIENT = ['id', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'href', 'xlink:href'];

// element -> the attributes it may carry (`style` is converted to attributes first, so it is not listed).
const ELEMENTS = {
  g: SHAPE,
  defs: ['id'],
  path: [...SHAPE, 'd'],
  rect: [...SHAPE, 'x', 'y', 'width', 'height', 'rx', 'ry'],
  circle: [...SHAPE, 'cx', 'cy', 'r'],
  ellipse: [...SHAPE, 'cx', 'cy', 'rx', 'ry'],
  line: [...SHAPE, 'x1', 'y1', 'x2', 'y2'],
  polygon: [...SHAPE, 'points'],
  polyline: [...SHAPE, 'points'],
  use: [...SHAPE, 'x', 'y', 'width', 'height', 'href', 'xlink:href'],
  linearGradient: [...GRADIENT, 'x1', 'y1', 'x2', 'y2'],
  radialGradient: [...GRADIENT, 'cx', 'cy', 'r', 'fx', 'fy'],
  stop: ['id', 'offset', 'stop-color', 'stop-opacity'],
  // A mask or clip path may set the paint its contents inherit (Iconify packs write fill="#fff" on <mask>).
  mask: ['id', 'x', 'y', 'width', 'height', 'maskUnits', 'maskContentUnits', ...PAINT],
  clipPath: ['id', 'transform', 'clipPathUnits', ...PAINT],
};
const DRAWN = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline', 'use']);
// Elements that draw nothing and are dropped with everything inside them.
const DROPPED_ELEMENTS = new Set(['title', 'desc', 'metadata', 'sodipodi:namedview']);
// Elements refused by name (keys lower-case: the lookup ignores case), so the reason says what was found.
const NAMED_REFUSALS = {
  script: 'script element',
  style: 'style element',
  foreignobject: 'foreignObject element',
  image: 'image element (external pictures are not allowed)',
  a: 'link element',
  animate: 'animation element',
  set: 'animation element',
  animatetransform: 'animation element',
  animatemotion: 'animation element',
  iframe: 'iframe element',
  filter: 'filter element',
  pattern: 'pattern element',
  symbol: 'symbol element',
  text: 'text element',
  svg: 'nested svg element',
};
// Attributes that carry no drawing and are dropped, never copied.
const DROPPED_ATTRIBUTES = /^(?:class|xml:space|version|baseProfile|enable-background|role|focusable|preserveAspectRatio|overflow|xmlns(?::[\w.-]+)?|data-[\w.-]+|aria-[\w.-]+|(?:inkscape|sodipodi):[\w.-]+)$/;
// Root-only attributes read (viewBox, width, height) or ignored (x, y).
const ROOT_ATTRIBUTES = new Set(['viewBox', 'width', 'height', 'x', 'y']);

const NAMED_COLOURS = new Set(('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood '
  + 'cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey '
  + 'darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey '
  + 'darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite '
  + 'gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon '
  + 'lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue '
  + 'lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid '
  + 'mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin '
  + 'navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff '
  + 'peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver '
  + 'skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow '
  + 'yellowgreen transparent').split(' '));

// ---- value grammar ------------------------------------------------------------------------

// No digit run can be split two ways, so a long failing input cannot make these patterns backtrack badly.
const NUMBER = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
const re = (source) => new RegExp(`^${source}$`);
const IS_NUMBER = re(NUMBER);
const IS_LENGTH = re(`${NUMBER}(?:px|%)?`);
const IS_PERCENT_OR_NUMBER = re(`${NUMBER}%?`);
const IS_HEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const IS_COLOUR_FUNCTION = re(`(?:rgb|rgba|hsl|hsla)\\(\\s*${NUMBER}(?:deg)?%?(?:\\s*[,/\\s]\\s*${NUMBER}%?){2,3}\\s*\\)`);
const IS_PATH_DATA = /^[MmZzLlHhVvCcSsQqTtAa0-9eE.,\s+-]+$/;
const IS_ID = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;
const isId = (v) => v.length <= MAX_ID_LENGTH && IS_ID.test(v);
const URL_REFERENCE = /^url\(\s*(['"]?)#([^'")\s]+)\1\s*\)$/i;
const ANY_URL = /url\s*\(/i;
const TRANSFORM_STEP = new RegExp(`\\s*(matrix|translate|scale|rotate|skewX|skewY)\\s*\\(\\s*(${NUMBER}(?:[\\s,]+${NUMBER})*)\\s*\\)\\s*,?`, 'y');
const TRANSFORM_ARITY = { matrix: [6], translate: [1, 2], scale: [1, 2], rotate: [1, 3], skewX: [1], skewY: [1] };

const ENUMS = {
  'fill-rule': ['nonzero', 'evenodd'],
  'clip-rule': ['nonzero', 'evenodd'],
  'stroke-linecap': ['butt', 'round', 'square'],
  'stroke-linejoin': ['miter', 'round', 'bevel'],
  gradientUnits: ['userSpaceOnUse', 'objectBoundingBox'],
  maskUnits: ['userSpaceOnUse', 'objectBoundingBox'],
  maskContentUnits: ['userSpaceOnUse', 'objectBoundingBox'],
  clipPathUnits: ['userSpaceOnUse', 'objectBoundingBox'],
  spreadMethod: ['pad', 'reflect', 'repeat'],
};

const trimmed = (value) => value.replace(/\s+/g, ' ').trim();

// A number, colour or other single value is short. Anything longer is refused before a pattern sees it, so no
// pattern can be made to run long on hostile text.
const scalar = (value, name) => {
  const v = trimmed(value);
  return v.length <= MAX_SCALAR ? v : refuse(`${name} is over ${MAX_SCALAR} characters`);
};

function number(value, name) {
  const v = scalar(value, name);
  return IS_NUMBER.test(v) ? v : refuse(`${name} is not a number: ${JSON.stringify(v.slice(0, 40))}`);
}

function matched(value, pattern, name) {
  const v = scalar(value, name);
  return pattern.test(v) ? v : refuse(`${name} has an unsupported value: ${JSON.stringify(v.slice(0, 40))}`);
}

function colour(value, name) {
  const v = scalar(value, name);
  if (/^currentcolor$/i.test(v)) return 'currentColor';
  if (IS_HEX.test(v) || IS_COLOUR_FUNCTION.test(v) || NAMED_COLOURS.has(v.toLowerCase())) return v;
  return refuse(`${name} is not a plain colour: ${JSON.stringify(v.slice(0, 40))}`);
}

// A reference to an id inside the icon: url(#id). Anything else with url( is external.
function reference(value, name, ctx) {
  const v = trimmed(value);
  const m = URL_REFERENCE.exec(v);
  if (!m) return ANY_URL.test(v) ? refuse(`external url() in ${name}`) : null;
  if (!isId(m[2])) refuse(`${name} references an invalid id`);
  ctx.refs.push(m[2]);
  return `url(#${m[2]})`;
}

function paint(value, name, ctx) {
  const v = trimmed(value);
  const ref = reference(v, name, ctx);
  if (ref !== null) return ref;
  return v === 'none' ? 'none' : colour(v, name);
}

function urlOrNone(value, name, ctx) {
  const v = trimmed(value);
  return v === 'none' ? v : reference(v, name, ctx) ?? refuse(`${name} must be none or url(#id)`);
}

function transform(value, name) {
  const v = trimmed(value);
  const parts = [];
  TRANSFORM_STEP.lastIndex = 0;
  while (TRANSFORM_STEP.lastIndex < v.length) {
    const m = TRANSFORM_STEP.exec(v);
    if (!m) return refuse(`${name} is not a plain transform list`);
    const args = m[2].split(/[\s,]+/);
    if (!TRANSFORM_ARITY[m[1]].includes(args.length)) refuse(`${name} has the wrong number of arguments for ${m[1]}`);
    parts.push(`${m[1]}(${args.join(' ')})`);
  }
  return parts.length > 0 ? parts.join(' ') : refuse(`${name} is empty`);
}

function numberList(value, name, { min = 1, max = 4000 } = {}) {
  const items = trimmed(value).split(/[\s,]+/).filter(Boolean);
  if (items.length < min || items.length > max || !items.every((item) => item.length <= MAX_SCALAR && IS_NUMBER.test(item))) refuse(`${name} is not a list of numbers`);
  return items.join(' ');
}

function localHref(value, name, ctx) {
  const v = trimmed(value);
  const m = /^#([^\s'"()]+)$/.exec(v);
  if (!m) return refuse(`external ${name}: only #id references inside the icon are allowed`);
  if (!isId(m[1])) refuse(`${name} references an invalid id`);
  ctx.refs.push(m[1]);
  return `#${m[1]}`;
}

function viewBoxValue(value) {
  const parts = value.length <= 4 * MAX_SCALAR ? trimmed(value).split(/[\s,]+/) : [];
  if (parts.length !== 4 || !parts.every((p) => p.length <= MAX_SCALAR && IS_NUMBER.test(p))) refuse('viewBox is not four numbers');
  const [x, y, w, h] = parts.map(Number);
  const sane = (n) => n >= MIN_VIEWBOX_SIZE && n <= MAX_VIEWBOX;
  if (!sane(w) || !sane(h) || Math.abs(x) > MAX_VIEWBOX || Math.abs(y) > MAX_VIEWBOX) {
    refuse(`viewBox width and height must be between ${MIN_VIEWBOX_SIZE} and ${MAX_VIEWBOX}, and its origin within ${MAX_VIEWBOX}`);
  }
  return [x, y, w, h].join(' ');
}

// attribute name -> value checker. Names not in a table get the checker of their kind below.
function checkValue(name, value, ctx) {
  if (name === 'id') {
    const v = value.trim();
    if (!isId(v)) refuse(`id ${JSON.stringify(v.slice(0, 40))} is not a plain id`);
    return v;
  }
  if (name === 'd') return IS_PATH_DATA.test(value) && value.trim() !== '' ? trimmed(value) : refuse('path data holds characters other than path commands and numbers');
  if (name === 'points') return numberList(value, name);
  if (name === 'transform' || name === 'gradientTransform') return transform(value, name);
  if (name === 'href' || name === 'xlink:href') return localHref(value, 'href', ctx);
  if (name === 'fill' || name === 'stroke') return paint(value, name, ctx);
  if (name === 'stop-color') return colour(value, name);
  if (name === 'mask' || name === 'clip-path') return urlOrNone(value, name, ctx);
  if (name === 'stroke-dasharray') return trimmed(value) === 'none' ? 'none' : numberList(value, name, { max: 32 });
  if (name === 'offset') return matched(value, IS_PERCENT_OR_NUMBER, name);
  if (Object.hasOwn(ENUMS, name)) return ENUMS[name].includes(value.trim()) ? value.trim() : refuse(`${name} has an unsupported value: ${JSON.stringify(value.trim().slice(0, 40))}`);
  if (/opacity$|^stroke-miterlimit$/.test(name)) return number(value, name);
  return matched(value, IS_LENGTH, name); // coordinates and sizes: x, y, width, height, cx, r, x1, fx ...
}

// ---- tokenizer ----------------------------------------------------------------------------

const ENTITY = /&(?:(amp|lt|gt|quot|apos)|#(\d+)|#x([0-9a-fA-F]+));/g;
const NAMED_ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(raw) {
  if (!raw.includes('&')) return raw;
  const out = raw.replace(ENTITY, (_, named, dec, hex) => {
    if (named) return NAMED_ENTITY[named];
    const code = dec !== undefined ? Number(dec) : parseInt(hex, 16);
    const bad = code > 0x10ffff || (code < 0x20 && ![9, 10, 13].includes(code)) || (code >= 0xd800 && code <= 0xdfff);
    return bad ? refuse('invalid character reference') : String.fromCodePoint(code);
  });
  return out.includes('&') ? refuse('entity other than &amp; &lt; &gt; &quot; &apos; or a numeric reference') : out;
}

const NAME = /[A-Za-z_][\w.:-]*/y;
const SPACE = /\s*/y;

function readName(src, at) {
  NAME.lastIndex = at;
  const m = NAME.exec(src);
  return m ? m[0] : refuse('malformed tag or attribute name');
}

function skipSpace(src, at) {
  SPACE.lastIndex = at;
  SPACE.exec(src);
  return SPACE.lastIndex;
}

// Attributes of one start tag from `at` to its '>' or '/>': { attrs: Map, end, selfClosing }.
function readTag(src, start) {
  let at = skipSpace(src, start);
  const attrs = new Map();
  for (;;) {
    if (at >= src.length) refuse('unterminated tag');
    if (src[at] === '>') return { attrs, end: at + 1, selfClosing: false };
    if (src.startsWith('/>', at)) return { attrs, end: at + 2, selfClosing: true };
    const name = readName(src, at);
    at = skipSpace(src, at + name.length);
    if (src[at] !== '=') refuse(`attribute ${name} has no value`);
    at = skipSpace(src, at + 1);
    const quote = src[at];
    if (quote !== '"' && quote !== "'") refuse(`attribute ${name} is not quoted`);
    const close = src.indexOf(quote, at + 1);
    if (close < 0) refuse('unterminated attribute value');
    const raw = src.slice(at + 1, close);
    if (raw.includes('<')) refuse(`attribute ${name} contains "<"`);
    if (attrs.has(name)) refuse(`attribute ${name} is repeated`);
    attrs.set(name, decodeEntities(raw));
    at = skipSpace(src, close + 1);
    if (at === close + 1 && src[at] !== '>' && !src.startsWith('/>', at)) refuse('attributes must be separated by a space');
  }
}

// Text -> element tree { name, attrs: Map, children, text: boolean }. Comments and the XML declaration are skipped.
function parse(src, limits) {
  const root = { name: '#document', attrs: new Map(), children: [] };
  const stack = [root];
  let at = 0;
  let elements = 0;
  let seenRoot = false;
  while (at < src.length) {
    const lt = src.indexOf('<', at);
    const textEnd = lt < 0 ? src.length : lt;
    if (src.slice(at, textEnd).trim() !== '') {
      if (stack.length === 1) refuse('text outside the root element');
      stack[stack.length - 1].text = true; // clean() refuses it unless the element is dropped, after naming a script or style element first
    }
    if (lt < 0) break;
    at = lt;
    if (src.startsWith('<!--', at)) {
      const end = src.indexOf('-->', at + 4);
      if (end < 0) refuse('unterminated comment');
      at = end + 3;
    } else if (src.startsWith('<?xml', at) && /\s|\?/.test(src[at + 5] ?? '') && !seenRoot && stack.length === 1) {
      const end = src.indexOf('?>', at);
      if (end < 0) refuse('unterminated XML declaration');
      at = end + 2;
    } else if (src.startsWith('<?', at)) {
      refuse('processing instruction');
    } else if (src.startsWith('<![CDATA[', at)) {
      // Text like any other: only a dropped element (title, desc) may hold it; a style or script says so by name.
      const end = src.indexOf(']]>', at + 9);
      if (end < 0) refuse('unterminated CDATA section');
      if (stack.length === 1) refuse('text outside the root element');
      stack[stack.length - 1].text = true;
      at = end + 3;
    } else if (src.startsWith('<!', at)) {
      refuse('DOCTYPE or ENTITY declaration');
    } else if (src.startsWith('</', at)) {
      const name = readName(src, at + 2);
      const end = skipSpace(src, at + 2 + name.length);
      if (src[end] !== '>') refuse('malformed closing tag');
      if (stack.length < 2 || stack[stack.length - 1].name !== name) refuse(`closing tag </${name}> does not match`);
      stack.pop();
      at = end + 1;
    } else {
      const name = readName(src, at + 1);
      const { attrs, end, selfClosing } = readTag(src, at + 1 + name.length);
      const parent = stack[stack.length - 1];
      if (stack.length === 1 && seenRoot) refuse('more than one root element');
      if (++elements > limits.elements) refuse('too many elements');
      if (stack.length > limits.depth) refuse('nested too deeply');
      const node = { name, attrs, children: [], dropped: parent.dropped || DROPPED_ELEMENTS.has(name) };
      parent.children.push(node);
      seenRoot = true;
      if (!selfClosing) stack.push(node);
      at = end;
    }
  }
  if (stack.length !== 1) refuse('unclosed element');
  if (root.children.length !== 1) refuse('no root element');
  return root.children[0];
}

// ---- cleaning -----------------------------------------------------------------------------

// `style="fill:red;stroke:none"` -> [[name, value]]. Only the paint properties the element may carry as attributes.
function styleDeclarations(value) {
  const out = [];
  for (const part of value.split(';')) {
    if (part.trim() === '') continue;
    if (/[/*\\{}@!]/.test(part)) refuse('style attribute holds comments, escapes, !important or rules');
    const colon = part.indexOf(':');
    if (colon < 1) refuse('style attribute is not a list of property: value pairs');
    out.push([part.slice(0, colon).trim(), part.slice(colon + 1).trim()]);
  }
  return out;
}

function checkAttribute(element, name, value, ctx) {
  if (/^on/i.test(name)) refuse(`event handler attribute ${name}`);
  if (!ELEMENTS[element].includes(name)) refuse(`attribute ${name} is not allowed on <${element}>`);
  return checkValue(name, value, ctx);
}

function cleanAttributes(node, ctx) {
  const out = new Map();
  let style = [];
  for (const [name, value] of node.attrs) {
    if (name === 'style') style = styleDeclarations(value);
    else if (/^on/i.test(name)) refuse(`event handler attribute ${name}`);
    else if (!DROPPED_ATTRIBUTES.test(name)) out.set(name, checkAttribute(node.name, name, value, ctx));
  }
  for (const [name, value] of style) {
    if (name === 'enable-background') continue;
    if (!STYLE_PROPERTIES.has(name)) refuse(`style property ${name} is not a paint property`);
    // A style declaration beats the presentation attribute of the same name, as in CSS.
    out.set(name, checkAttribute(node.name, name, value, ctx));
  }
  if (out.has('href') && out.has('xlink:href')) refuse('href and xlink:href are both set');
  if (out.has('xlink:href')) { out.set('href', out.get('xlink:href')); out.delete('xlink:href'); }
  return out;
}

function clean(node, ctx) {
  if (DROPPED_ELEMENTS.has(node.name)) return null;
  const named = node.name.toLowerCase();
  if (Object.hasOwn(NAMED_REFUSALS, named)) refuse(NAMED_REFUSALS[named]);
  if (!Object.hasOwn(ELEMENTS, node.name)) refuse(`element <${node.name}> is not allowed`);
  if (node.text) refuse(`text inside <${node.name}>`);
  const attrs = cleanAttributes(node, ctx);
  if (attrs.has('id')) {
    const id = attrs.get('id');
    if (ctx.ids.has(id)) refuse(`id ${JSON.stringify(id)} is used twice`);
  }
  const out = { name: node.name, attrs, children: [] };
  if (attrs.has('id')) ctx.ids.set(attrs.get('id'), out);
  if (DRAWN.has(node.name) && !ctx.insideDefs) ctx.drawn += 1;
  const nested = { ...ctx, insideDefs: ctx.insideDefs || node.name === 'defs' };
  for (const child of node.children) {
    const cleaned = clean(child, nested);
    if (cleaned) out.children.push(cleaned);
  }
  ctx.drawn = nested.drawn;
  return out;
}

// The elements a node draws through: its children, then whatever it points at (a <use> or gradient href, a url(#id)
// in fill, stroke, mask or clip-path). Every reference resolved already, so each id is in ctx.ids.
function dependencies(node, ctx) {
  const found = [...node.children];
  for (const [name, value] of node.attrs) {
    // Only href (a #id) and url(#id) are references: a colour such as fill="#abc" is not one.
    const ids = name === 'href' ? [value.slice(1)] : [...value.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]);
    for (const id of ids) if (ctx.ids.has(id)) found.push(ctx.ids.get(id));
  }
  return found;
}

// A reference may lead back to its own element, or fan out (a mask used twice by a mask used twice ...) so that
// drawing it takes without bound. Count every element as many times as it is drawn; refuse a loop, a chain deeper
// than MAX_REFERENCE_DEPTH and a total over MAX_DRAWN. Iterative: hostile nesting cannot overflow the stack.
function checkExpansion(ctx, root) {
  const weights = new Map();
  const open = new Set([root]);
  const stack = [{ node: root, kids: dependencies(root, ctx), next: 0, weight: 1 }];
  const add = (frame, amount) => {
    frame.weight += amount;
    if (frame.weight > MAX_DRAWN) refuse('too many drawn elements once references are expanded');
  };
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame.next < frame.kids.length) {
      const kid = frame.kids[frame.next++];
      if (open.has(kid)) refuse('a reference leads back to its own element');
      if (weights.has(kid)) { add(frame, weights.get(kid)); continue; }
      if (stack.length > MAX_REFERENCE_DEPTH) refuse('references nested too deeply');
      open.add(kid);
      stack.push({ node: kid, kids: dependencies(kid, ctx), next: 0, weight: 1 });
      continue;
    }
    stack.pop();
    open.delete(frame.node);
    weights.set(frame.node, frame.weight);
    if (stack.length > 0) add(stack[stack.length - 1], frame.weight);
  }
}

// ---- output -------------------------------------------------------------------------------

const ATTRIBUTE_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escapeAttribute = (v) => v.replace(/[&<>"]/g, (c) => ATTRIBUTE_ESCAPES[c]);

function serialize(node) {
  const attrs = [...node.attrs].map(([k, v]) => ` ${k}="${escapeAttribute(v)}"`).join('');
  if (node.children.length === 0) return `<${node.name}${attrs}/>`;
  return `<${node.name}${attrs}>${node.children.map(serialize).join('')}</${node.name}>`;
}

function rootViewBox(attrs) {
  if (attrs.has('viewBox')) return viewBoxValue(attrs.get('viewBox'));
  const size = (name) => {
    const v = trimmed(attrs.get(name) ?? '');
    const m = v.length <= MAX_SCALAR ? /^\+?(\d+(?:\.\d*)?|\.\d+)(?:px)?$/.exec(v) : null;
    return m ? Number(m[1]) : null;
  };
  const [w, h] = [size('width'), size('height')];
  return w && h ? viewBoxValue(`0 0 ${w} ${h}`) : refuse('no viewBox, and no plain width and height to build one from');
}

// The root's own presentation attributes (fill="none" on an outline icon) apply to everything inside: keep them on a <g>.
function rootGroup(node, ctx) {
  const own = new Map([...node.attrs].filter(([name]) => !ROOT_ATTRIBUTES.has(name)));
  const probe = { name: 'g', attrs: own };
  const attrs = cleanAttributes(probe, ctx);
  attrs.delete('id');
  return attrs;
}

function sanitize(text, limits) {
  if (typeof text !== 'string') refuse('not text');
  if (Buffer.byteLength(text) > limits.bytes) refuse('file is over 256 KiB');
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(src)) refuse('control characters');
  const root = parse(src, limits);
  if (root.name !== 'svg') refuse('not an SVG file (root element is not <svg>)');
  if (root.text) refuse('text inside <svg>');
  const ctx = { ids: new Map(), refs: [], drawn: 0, insideDefs: false };
  const viewBox = rootViewBox(root.attrs);
  const wrapper = rootGroup(root, ctx);
  const children = root.children.map((child) => clean(child, ctx)).filter(Boolean);
  if (ctx.drawn === 0) refuse('nothing to draw');
  for (const id of ctx.refs) if (!ctx.ids.has(id)) refuse(`reference to #${id}, which is not inside the icon`);
  const top = { name: 'g', attrs: wrapper, children }; // the root's paint attributes count: they may hold a mask or a gradient
  checkExpansion(ctx, top);
  return { markup: wrapper.size > 0 ? serialize(top) : children.map(serialize).join(''), viewBox };
}

// Whatever goes wrong (a refusal, or a limit of the engine) is a skip with a reason: this is the guard at the door.
function guarded(text, limits) {
  try {
    return sanitize(text, limits);
  } catch (e) {
    if (e instanceof Refusal) return { skipped: e.message };
    return { skipped: `could not be checked safely (${e instanceof RangeError ? 'too complex' : 'unexpected input'})` };
  }
}

/**
 * Parse and re-serialise one SVG file. Returns { markup, viewBox } or { skipped: reason }.
 * Never throws, whatever the input.
 */
export const sanitizeSvg = (text) => guarded(text, STRICT);

/**
 * An icon as stored ({ viewBox, markup } and nothing else): returned as a fresh object when
 * sanitizing it again gives back exactly the same markup and viewBox, else null. The importer
 * runs it before it says "added", and icons.mjs runs it on every load of a stored catalog.
 */
export function roundTrip(entry) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const keys = Object.keys(entry);
  if (keys.length !== 2 || !keys.includes('markup') || !keys.includes('viewBox')) return null;
  const { markup, viewBox } = entry;
  if (typeof markup !== 'string' || typeof viewBox !== 'string' || /["<>&]/.test(viewBox)) return null;
  const again = guarded(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${markup}</svg>`, STORED);
  return again.skipped === undefined && again.markup === markup && again.viewBox === viewBox ? { viewBox, markup } : null;
}

// ---- id scoping ---------------------------------------------------------------------------

/**
 * Prefix every id in sanitized `markup`, and each reference to one, so two drawn
 * copies of an icon on a page never share an id. Safe on sanitizeSvg output only:
 * it serialises ids and references in exactly the forms matched here.
 */
export function scopeIds(markup, prefix) {
  return markup
    .replace(/ id="([^"]*)"/g, (_, id) => ` id="${prefix}-${id}"`)
    .replace(/ href="#([^"]*)"/g, (_, id) => ` href="#${prefix}-${id}"`)
    .replace(/url\(#([^)]*)\)/g, (_, id) => `url(#${prefix}-${id})`);
}
