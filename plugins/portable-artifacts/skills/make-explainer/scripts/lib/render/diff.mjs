// diff section: a unified diff as one marked row per line. Add, delete, context, hunk header, file header and the
// "No newline" note each get a class; the sign stays in the text, so the Copy button copies the diff as written and
// the marking never depends on colour alone. Offline: there is no syntax highlighter and nothing is fetched.
import { esc, inline } from './ui.mjs';

// Lines before the first hunk of a file (and after a `diff ` line) are headers, whatever their first character.
const FILE_HEADER = /^(?:diff |index |--- |\+\+\+ |new file|deleted file|old mode|new mode|similarity |rename |copy |Binary files )/;

/** The class of each line, in order: 'meta' | 'hunk' | 'add' | 'del' | 'ctx' | 'note'. */
export function classify(lines) {
  let inHunk = false;
  return lines.map((line) => {
    if (line.startsWith('diff ')) {
      inHunk = false;
      return 'meta';
    }
    if (line.startsWith('@@')) {
      inHunk = true;
      return 'hunk';
    }
    if (!inHunk && FILE_HEADER.test(line)) return 'meta';
    if (line.startsWith('\\')) return 'note';
    if (inHunk && line.startsWith('+')) return 'add';
    if (inHunk && line.startsWith('-')) return 'del';
    return 'ctx';
  });
}

export function render(section) {
  const lines = section.diff.replace(/\n+$/, '').split('\n');
  const kinds = classify(lines);
  // The newline stays inside each row (a block in a <pre> shows it as one line break), so textContent is the diff.
  const rows = lines.map((line, i) => `<span class="dl dl-${kinds[i]}">${esc(line)}\n</span>`).join('');
  const file = section.file === undefined ? '' : `<span class="code-lang">${esc(section.file)}</span>`;
  const caption = section.caption === undefined ? '' : `\n<figcaption>${inline(section.caption)}</figcaption>`;
  return `<figure class="code diff">
<div class="code-bar">${file}<button type="button" class="btn copy" data-copy aria-label="Copy diff">Copy</button></div>
<pre tabindex="0"><code>${rows}</code></pre>${caption}
</figure>`;
}
