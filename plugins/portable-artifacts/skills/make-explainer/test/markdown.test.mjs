import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, renderInline, escapeHtml } from '../scripts/lib/markdown.mjs';

const ALLOWED_TAGS = new Set(['p', 'ul', 'li', 'strong', 'em', 'code', 'a']);
const A_TAG = /^<a href="https?:\/\/[^"<>\s]+" rel="noopener noreferrer">$/;

// Structural safety: only the allowed tags, anchors carry only href + rel, and
// no `<` or `>` outside a tag.
function assertInert(html) {
  const tags = html.match(/<[^>]*>/g) ?? [];
  for (const tag of tags) {
    const name = /^<\/?([a-z0-9]+)/.exec(tag)?.[1];
    assert.ok(ALLOWED_TAGS.has(name), `unexpected tag ${tag} in ${html}`);
    if (name === 'a' && !tag.startsWith('</')) assert.match(tag, A_TAG, html);
    if (name !== 'a') assert.match(tag, /^<\/?[a-z]+>$/, `attributes on ${tag}`);
  }
  assert.equal(html.replace(/<[^>]*>/g, '').match(/[<>]/g), null, `stray angle bracket in ${html}`);
}

test('paragraphs, emphasis, code and lists render', () => {
  assert.equal(renderMarkdown('One **two** *three* `four`.'), '<p>One <strong>two</strong> <em>three</em> <code>four</code>.</p>');
  assert.equal(renderMarkdown('A\n\nB'), '<p>A</p>\n<p>B</p>');
  assert.equal(renderMarkdown('- a\n- **b**\n\nafter'), '<ul>\n<li>a</li>\n<li><strong>b</strong></li>\n</ul>\n<p>after</p>');
  assert.equal(renderMarkdown('intro\n- a'), '<p>intro</p>\n<ul>\n<li>a</li>\n</ul>');
  assert.equal(renderMarkdown('line one\nline two'), '<p>line one\nline two</p>');
  assert.equal(renderMarkdown(''), '');
});

test('https and http links render with rel="noopener noreferrer"', () => {
  assert.equal(
    renderMarkdown('[docs](https://example.com/a?b=1&c=2)'),
    '<p><a href="https://example.com/a?b=1&amp;c=2" rel="noopener noreferrer">docs</a></p>',
  );
  assert.equal(
    renderMarkdown('[x](HTTP://Example.com)'),
    '<p><a href="HTTP://Example.com" rel="noopener noreferrer">x</a></p>',
  );
  assert.equal(
    renderMarkdown('[**b**](https://x.example)'),
    '<p><a href="https://x.example" rel="noopener noreferrer"><strong>b</strong></a></p>',
  );
  assert.equal(
    renderMarkdown('**[a](https://x.example)**'),
    '<p><strong><a href="https://x.example" rel="noopener noreferrer">a</a></strong></p>',
  );
});

test('parentheses inside a url are balanced, not cut at the first )', () => {
  assert.equal(
    renderMarkdown('[x](https://a.com/a_(b))'),
    '<p><a href="https://a.com/a_(b)" rel="noopener noreferrer">x</a></p>',
  );
  assert.equal(
    renderMarkdown('see [wiki](https://en.wikipedia.org/wiki/Foo_(bar)_(baz)) now'),
    '<p>see <a href="https://en.wikipedia.org/wiki/Foo_(bar)_(baz)" rel="noopener noreferrer">wiki</a> now</p>',
  );
  assert.equal(renderMarkdown('[x](https://a.com/a_(b)'), '<p>[x](https://a.com/a_(b)</p>');
  assert.equal(
    renderMarkdown('([x](https://a.com/p)) end'),
    '<p>(<a href="https://a.com/p" rel="noopener noreferrer">x</a>) end</p>',
  );
});

test('urls with userinfo are plain text, not links', () => {
  for (const url of ['https://user:pw@evil.example', 'https://evil.example@good.example/', 'http://@x.example', 'https://good.example@', 'https://a:b@c.example/path?x=y@z']) {
    const html = renderMarkdown(`[x](${url})`);
    assertInert(html);
    assert.ok(!html.includes('<a'), `${url} rendered as a link: ${html}`);
  }
  assert.equal(renderMarkdown('[x](https://user:pw@evil.example)'), '<p>[x](https://user:pw@evil.example)</p>');
  assert.equal(
    renderMarkdown('[x](https://good.example/path?mail=a@b.example#c@d)'),
    '<p><a href="https://good.example/path?mail=a@b.example#c@d" rel="noopener noreferrer">x</a></p>',
  );
});

// ---- Review Focus 1: injection vectors --------------------------------

test('javascript: links are plain escaped text', () => {
  assert.equal(renderMarkdown('[x](javascript:alert(1))'), '<p>[x](javascript:alert(1))</p>');
  assert.equal(renderMarkdown('[x](JaVaScRiPt:alert(1))'), '<p>[x](JaVaScRiPt:alert(1))</p>');
  assert.equal(renderMarkdown('[x]( javascript:alert(1))'), '<p>[x]( javascript:alert(1))</p>');
  assert.equal(renderMarkdown('[x](java\tscript:alert(1))'), '<p>[x](java\tscript:alert(1))</p>');
});

test('other schemes and non-absolute urls are plain escaped text', () => {
  for (const url of ['data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)', 'mailto:a@b.example', '/relative', '//evil.example', 'file:///etc/passwd', 'ftp://x.example', 'https://', 'https:/x.example', '']) {
    const html = renderMarkdown(`[x](${url})`);
    assertInert(html);
    assert.ok(!html.includes('<a'), `${url} rendered as a link: ${html}`);
  }
  assert.equal(renderMarkdown('[x](mailto:a@b.example)'), '<p>[x](mailto:a@b.example)</p>');
  assert.equal(renderMarkdown('[x](/relative)'), '<p>[x](/relative)</p>');
});

test('a url that could break out of the attribute is plain text', () => {
  const html = renderMarkdown('[x](https://a.example/"onmouseover="alert(1))');
  assertInert(html);
  assert.ok(!html.includes('<a'));
  assert.ok(!html.includes('"onmouse'));
  assert.ok(!renderMarkdown("[x](https://a.example/'onmouseover='alert(1))").includes('<a'));
  assert.ok(!renderMarkdown('[x](https://a.example/<script>)').includes('<a'));
});

test('raw html is escaped, never passed through', () => {
  assert.equal(renderMarkdown('<img src=x onerror=alert(1)>'), '<p>&lt;img src=x onerror=alert(1)&gt;</p>');
  assert.equal(renderMarkdown('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  assert.equal(renderMarkdown('- <script>alert(1)</script>'), '<ul>\n<li>&lt;script&gt;alert(1)&lt;/script&gt;</li>\n</ul>');
  assert.equal(renderMarkdown('&lt;b&gt; &amp; "q" \'s\''), '<p>&amp;lt;b&amp;gt; &amp;amp; &quot;q&quot; &#39;s&#39;</p>');
  assertInert(renderMarkdown('<a href="javascript:alert(1)">x</a>'));
  assertInert(renderMarkdown('<svg/onload=alert(1)>'));
});

test('markdown markers around html stay inert', () => {
  assert.equal(renderMarkdown('**<b>**'), '<p><strong>&lt;b&gt;</strong></p>');
  assert.equal(renderMarkdown('*<i>*'), '<p><em>&lt;i&gt;</em></p>');
  assert.equal(renderMarkdown('`<script>`'), '<p><code>&lt;script&gt;</code></p>');
  assert.equal(renderMarkdown('`**not bold** [a](https://x.example)`'), '<p><code>**not bold** [a](https://x.example)</code></p>');
  assert.equal(
    renderMarkdown('[<b>x</b>](https://ok.example)'),
    '<p><a href="https://ok.example" rel="noopener noreferrer">&lt;b&gt;x&lt;/b&gt;</a></p>',
  );
});

test('link text containing ]( cannot smuggle a second link', () => {
  assert.equal(
    renderMarkdown('[a](https://ok.example)](https://evil.example)'),
    '<p><a href="https://ok.example" rel="noopener noreferrer">a</a>](https://evil.example)</p>',
  );
  assert.equal(
    renderMarkdown('[[x](https://evil.example)](https://good.example)'),
    '<p><a href="https://evil.example" rel="noopener noreferrer">[x</a>](https://good.example)</p>',
  );
  assert.equal(renderMarkdown('[x](y](https://evil.example)'), '<p>[x](y](https://evil.example)</p>');
  const nested = renderMarkdown('[[a](https://one.example)](https://two.example) [b](https://three.example)');
  assertInert(nested);
  assert.equal((nested.match(/<a /g) ?? []).length, 2);
});

test('nested and unclosed markers never produce unbalanced or hostile markup', () => {
  assert.equal(renderMarkdown('**bold'), '<p>**bold</p>');
  assert.equal(renderMarkdown('*it'), '<p>*it</p>');
  assert.equal(renderMarkdown('`code'), '<p>`code</p>');
  assert.equal(renderMarkdown('[text](https://x.example'), '<p>[text](https://x.example</p>');
  assert.equal(renderMarkdown('[text'), '<p>[text</p>');
  assert.equal(renderMarkdown('**a *b** c*'), '<p><strong>a *b</strong> c*</p>');
  assert.equal(renderMarkdown('*a **b* c**'), '<p><em>a **b</em> c**</p>');
  assert.equal(renderMarkdown('**a *b* c**'), '<p><strong>a <em>b</em> c</strong></p>');
  assert.equal(renderMarkdown('****'), '<p>****</p>');
  assert.equal(renderMarkdown('``'), '<p>``</p>');
  assert.equal(renderMarkdown('[](https://x.example)'), '<p>[](https://x.example)</p>');
  for (const s of ['***x***', '**`*`**', '*[a](https://x.example)*', '[*a*](https://x.example)', '_a_ __b__ ~~c~~']) assertInert(renderMarkdown(s));
});

test('unsupported markup stays literal text', () => {
  assert.equal(renderMarkdown('# Heading'), '<p># Heading</p>');
  assert.equal(renderMarkdown('1. one'), '<p>1. one</p>');
  assert.equal(renderMarkdown('> quote'), '<p>&gt; quote</p>');
  assert.equal(renderMarkdown('![alt](https://x.example/i.png)'), '<p>!<a href="https://x.example/i.png" rel="noopener noreferrer">alt</a></p>');
  assert.equal(renderMarkdown('-no space'), '<p>-no space</p>');
  assert.equal(renderMarkdown('- '), '<p>-</p>');
});

test('hostile input at the length limit renders fast and inert', () => {
  for (const s of ['*'.repeat(4000), '**'.repeat(2000), '['.repeat(4000), '[a](https://x.example)'.repeat(180), '`'.repeat(4000), '*a'.repeat(2000)]) {
    const start = performance.now();
    assertInert(renderMarkdown(s));
    assert.ok(performance.now() - start < 1500, 'too slow');
  }
});

test('renderInline has no block markup; non-strings throw', () => {
  assert.equal(renderInline('a **b**'), 'a <strong>b</strong>');
  assert.throws(() => renderMarkdown(42), /must be a string/);
  assert.throws(() => renderInline(null), /must be a string/);
  assert.equal(escapeHtml('<&>"\''), '&lt;&amp;&gt;&quot;&#39;');
});
