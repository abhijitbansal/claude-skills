// Browser checks for the nowrap rule, run against a Playwright page. This module
// imports no browser library: callers pass the page, and the token pattern is
// serialised into page.evaluate so the browser uses the exact regex nowrap.mjs exports.
import { TOKEN_PATTERN } from './nowrap.mjs';

/**
 * Tokens in text nodes under `root` (default body) that render on more than one line.
 * Returns [{ text, lines }]; a token held by white-space:nowrap is not reported, and one already bound with
 * U+00A0 is not matched at all (the pattern wants a plain space).
 * Limit: the pattern runs on each text node alone, so a token split across inline elements
 * (`<b>1,204</b> ms`, `<span>87</span>%`) is never found.
 */
export async function nowrapProblems(page, { root = 'body' } = {}) {
  return page.evaluate(({ pattern, rootSelector }) => {
    const top = document.querySelector(rootSelector);
    if (!top) return [];
    const re = new RegExp(pattern.source, pattern.flags);
    const found = [];
    const walker = document.createTreeWalker(top, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement?.closest('script, style')) continue;
      for (const m of node.data.matchAll(re)) {
        const range = document.createRange();
        range.setStart(node, m.index);
        range.setEnd(node, m.index + m[0].length);
        const lines = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
        if (lines.size > 1) found.push({ text: m[0], lines: lines.size });
      }
    }
    return found;
  }, { pattern: { source: TOKEN_PATTERN.source, flags: TOKEN_PATTERN.flags }, rootSelector: root });
}

/** Elements matching `selector` whose content is wider than their box: [{ text, scrollWidth, clientWidth }]. */
export async function overflowProblems(page, selector) {
  return page.evaluate((sel) => [...document.querySelectorAll(sel)]
    .filter((el) => el.scrollWidth > el.clientWidth + 1)
    .map((el) => ({ text: el.textContent.trim().slice(0, 60), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth })), selector);
}
