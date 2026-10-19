// Semantic rules for rows and links, after the schema has passed: limits,
// non-negative values, parent references and cycles, link ends, and the
// eligibility of an explicit world.
import { pathJoin } from '../../shared/errors.mjs';
import { eligibility, WORLDS } from './eligibility.mjs';
import { LIMITS } from './schema.mjs';
import { q, suggestion, checkLength, checkNegative } from './checks.mjs';

const notAGroup = (name, groups) => `${q(name)} is not a group; ${suggestion(name, groups)}`;

function checkParents(errors, rows, base, groups) {
  const parents = new Map(); // group -> its one valid parent
  const rowOf = new Map(); // group -> index of the row that named the parent
  rows.forEach((r, i) => {
    if (r.parent === undefined) return;
    const at = pathJoin(pathJoin(base, i), 'parent');
    if (!groups.includes(r.parent)) {
      errors.push({ path: at, message: notAGroup(r.parent, groups) });
    } else if (parents.has(r.group) && parents.get(r.group) !== r.parent) {
      errors.push({ path: at, message: `group ${q(r.group)} has parents ${q(parents.get(r.group))} and ${q(r.parent)}; give each group one parent` });
    } else if (!parents.has(r.group)) {
      parents.set(r.group, r.parent);
      rowOf.set(r.group, i);
    }
  });
  const reported = new Set();
  for (const start of parents.keys()) {
    const chain = [];
    for (let cur = start; cur !== undefined; cur = parents.get(cur)) {
      const at = chain.indexOf(cur);
      if (at < 0) { chain.push(cur); continue; }
      const cycle = chain.slice(at);
      if (!cycle.some((g) => reported.has(g))) {
        cycle.forEach((g) => reported.add(g));
        errors.push({
          path: pathJoin(pathJoin(base, rowOf.get(cycle[0])), 'parent'),
          message: `group parents form a cycle: ${[...cycle, cycle[0]].join(' -> ')}; remove parent from one of them`,
        });
      }
      break;
    }
  }
}

export function checkRows(errors, rows, base) {
  if (rows.length === 0) errors.push({ path: base, message: 'at least one row is required' });
  if (rows.length > LIMITS.rows) errors.push({ path: base, message: `${rows.length} rows; the limit is ${LIMITS.rows}; aggregate or drop rows` });
  rows.forEach((r, i) => {
    const p = pathJoin(base, i);
    checkLength(errors, r, 'group', p, LIMITS.group);
    checkNegative(errors, r.value, pathJoin(p, 'value'));
  });
  const groups = [...new Set(rows.map((r) => r.group))];
  if (groups.length > LIMITS.groups) {
    errors.push({ path: 'data', message: `${groups.length} groups; the limit is ${LIMITS.groups}; merge small groups or drop some` });
  }
  checkParents(errors, rows, base, groups);
  return groups;
}

export function checkLinks(errors, links, base, groups) {
  links.forEach((l, i) => {
    const p = pathJoin(base, i);
    for (const end of ['from', 'to']) {
      if (!groups.includes(l[end])) errors.push({ path: pathJoin(p, end), message: notAGroup(l[end], groups) });
    }
    checkNegative(errors, l.value, pathJoin(p, 'value'));
  });
}

// An explicit world must be one the data can feed; name the ones it can.
export function checkWorld(errors, world, data) {
  if (world === undefined) return;
  const table = eligibility(data);
  if (table[world].ok) return;
  const eligible = WORLDS.filter((w) => table[w].ok);
  errors.push({
    path: 'world',
    message: `world ${q(world)} cannot show this data: ${table[world].needs}; eligible worlds: ${eligible.join(', ')}`,
  });
}
