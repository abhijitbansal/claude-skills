// A line diff for the `code` kind's `diff` mode: the longest common subsequence of the lines before and after, as rows
// in reading order, each { type: 'same' | 'removed' | 'added', text, from, to } (`from` the line's index before, `to`
// after, null where it has none). A moved line is a removal and an addition. Where both orders are possible a removal
// comes before the addition that replaces it. Pure and DOM-free.

// lcs[i][j]: the length of the longest common subsequence of a[i..] and b[j..].
function lcsTable(a, b) {
  const table = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table;
}

/** The rows of the diff from `before` to `after` (arrays of line strings). */
export function diffLines(before, after) {
  const table = lcsTable(before, after);
  const rows = [];
  let i = 0, j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      rows.push({ type: 'same', text: before[i], from: i, to: j }); i += 1; j += 1;
    } else if (j >= after.length || (i < before.length && table[i + 1][j] >= table[i][j + 1])) {
      rows.push({ type: 'removed', text: before[i], from: i, to: null }); i += 1;
    } else {
      rows.push({ type: 'added', text: after[j], from: null, to: j }); j += 1;
    }
  }
  return rows;
}
