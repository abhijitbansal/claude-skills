import { chip, esc, inline, glyph, CHANGE, lookup } from './ui.mjs';

const OPEN_ALL_UP_TO = 40;
const CHANGE_ORDER = ['added', 'modified', 'renamed', 'deleted'];

function emptyDir() {
  return { dirs: new Map(), files: [] };
}

function build(items) {
  const root = emptyDir();
  for (const item of items) {
    const parts = item.path.split('/').filter((p) => p !== '');
    if (parts.length === 0) parts.push(item.path);
    const name = parts.pop();
    let dir = root;
    for (const part of parts) {
      if (!dir.dirs.has(part)) dir.dirs.set(part, emptyDir());
      dir = dir.dirs.get(part);
    }
    dir.files.push({ ...item, name });
  }
  return root;
}

const countFiles = (dir) => dir.files.length + [...dir.dirs.values()].reduce((n, d) => n + countFiles(d), 0);

function stats(f) {
  const parts = [];
  if (f.add !== undefined) parts.push(`<span class="add">+${f.add}</span>`);
  if (f.del !== undefined) parts.push(`<span class="del">−${f.del}</span>`);
  return parts.length ? `<span class="stat">${parts.join(' ')}</span>` : '';
}

const fileRow = (f) => `<li class="file">
<span class="file-main">${chip(lookup(CHANGE, f.change, 'modified'))}<code class="path" title="${esc(f.path)}">${esc(f.name)}</code>${stats(f)}</span>${f.note === undefined ? '' : `\n<span class="file-note">${inline(f.note)}</span>`}
</li>`;

// A folder holding only one sub-folder and no files folds into "a/b".
function folded(name, dir) {
  let label = name;
  let node = dir;
  while (node.files.length === 0 && node.dirs.size === 1) {
    const [[childName, child]] = node.dirs;
    label = `${label}/${childName}`;
    node = child;
  }
  return { label, node };
}

function list(dir, depth, openAll) {
  const folders = [...dir.dirs.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, child]) => {
    const { label, node } = folded(name, child);
    const n = countFiles(node);
    return `<li class="folder"><details${openAll || depth === 0 ? ' open' : ''}>
<summary>${glyph('folder')}<span class="dir">${esc(label)}/</span><span class="count">${n} ${n === 1 ? 'file' : 'files'}</span></summary>
${list(node, depth + 1, openAll)}
</details></li>`;
  });
  const files = [...dir.files].sort((a, b) => a.name.localeCompare(b.name)).map(fileRow);
  return `<ul class="tree">\n${[...files, ...folders].join('\n')}\n</ul>`;
}

function summary(items) {
  const counts = CHANGE_ORDER.map((c) => [c, items.filter((f) => f.change === c).length]).filter(([, n]) => n > 0);
  const add = items.reduce((n, f) => n + (f.add ?? 0), 0);
  const del = items.reduce((n, f) => n + (f.del ?? 0), 0);
  const withLines = items.some((f) => f.add !== undefined || f.del !== undefined);
  const bits = [`${items.length} ${items.length === 1 ? 'file' : 'files'}`, counts.map(([c, n]) => `${n} ${c}`).join(', ')];
  if (withLines) bits.push(`+${add} −${del} lines`);
  return `<p class="files-sum">${bits.map(esc).join(' · ')}</p>`;
}

export function render(section) {
  const tree = build(section.items);
  return `<div class="files">\n${summary(section.items)}\n${list(tree, 0, section.items.length <= OPEN_ALL_UP_TO)}\n</div>`;
}
