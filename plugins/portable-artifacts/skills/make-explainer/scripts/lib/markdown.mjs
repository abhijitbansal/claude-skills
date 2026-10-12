// Markdown-lite -> safe HTML. The only markup is: paragraphs, **bold**,
// *italic*, `code`, [text](http(s)://url) and "- " lists. Everything else,
// including raw HTML, is escaped text. Output tags: p ul li strong em code a.
// Links carry exactly href and rel="noopener noreferrer"; any other URL form
// renders as plain text.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const MAX_DEPTH = 8;
// http(s) only, no whitespace/control characters (URL parsers strip them, so
// "java\tscript:" must not slip through) and none of the characters that could
// end an attribute or a tag.
const SAFE_URL = /^[a-z]+:\/\/[^\s\u0000-\u001f\u007f<>"'`\\]+$/i;

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

function safeUrl(url) {
  if (!SAFE_URL.test(url)) return false;
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

// Closing single '*' for an emphasis opened at `from`; '**' pairs are skipped.
function closeItalic(s, from) {
  for (let j = from; j < s.length; j++) {
    if (s[j] === '*') {
      if (s[j + 1] === '*') j++;
      else return j;
    }
  }
  return -1;
}

// One pass over `s`; each construct either matches completely or its opening
// character is emitted as literal text. Nesting is structural (recursion on the
// inner text), so the output is always well-formed.
function inline(s, { links, depth }) {
  if (depth > MAX_DEPTH) return escapeHtml(s);
  const next = { links, depth: depth + 1 };
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '`') {
      const end = s.indexOf('`', i + 1);
      if (end > i + 1) {
        out += `<code>${escapeHtml(s.slice(i + 1, end))}</code>`;
        i = end + 1;
        continue;
      }
    } else if (c === '[' && links) {
      const close = s.indexOf(']', i + 1);
      if (close > i + 1 && s[close + 1] === '(') {
        const end = s.indexOf(')', close + 2);
        const url = end > 0 ? s.slice(close + 2, end) : '';
        if (end > 0 && safeUrl(url)) {
          const label = inline(s.slice(i + 1, close), { links: false, depth: depth + 1 });
          out += `<a href="${escapeHtml(url)}" rel="noopener noreferrer">${label}</a>`;
          i = end + 1;
          continue;
        }
      }
    } else if (c === '*' && s[i + 1] === '*') {
      const end = s.indexOf('**', i + 2);
      if (end > i + 2) {
        out += `<strong>${inline(s.slice(i + 2, end), next)}</strong>`;
        i = end + 2;
        continue;
      }
    } else if (c === '*') {
      const end = closeItalic(s, i + 1);
      if (end > i + 1) {
        out += `<em>${inline(s.slice(i + 1, end), next)}</em>`;
        i = end + 1;
        continue;
      }
    }
    out += escapeHtml(c);
    i += 1;
  }
  return out;
}

export function renderInline(text) {
  if (typeof text !== 'string') throw new TypeError('markdown text must be a string');
  return inline(text, { links: true, depth: 0 });
}

const isItem = (line) => line.startsWith('- ') && line.slice(2).trim() !== '';

export function renderMarkdown(text) {
  if (typeof text !== 'string') throw new TypeError('markdown text must be a string');
  const blocks = [];
  let para = [];
  let list = [];
  const flush = () => {
    if (para.length) blocks.push(`<p>${renderInline(para.join('\n'))}</p>`);
    if (list.length) blocks.push(`<ul>\n${list.map((li) => `<li>${renderInline(li)}</li>`).join('\n')}\n</ul>`);
    para = [];
    list = [];
  };
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (line === '') flush();
    else if (isItem(line)) {
      if (para.length) flush();
      list.push(line.slice(2).trim());
    } else {
      if (list.length) flush();
      para.push(line);
    }
  }
  flush();
  return blocks.join('\n');
}
