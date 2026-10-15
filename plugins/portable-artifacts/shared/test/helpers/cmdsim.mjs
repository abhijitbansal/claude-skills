// A model, not real cmd.exe: cmd /d /s /c "<line>" phase 1 (%name% expands only
// when defined), phase 2 (quotes, ^ escapes, unquoted & | < > noted), the .cmd
// shim's %* re-parse, then the UCRT argv split. Used to round-trip cmdLine().
import { cmdLine } from '../../doctor.mjs';

const ENV = { PATH: 'C:\\Windows', USERNAME: 'john' };

function phase1(line) {
  let out = '';
  for (let i = 0; i < line.length;) {
    if (line[i] !== '%') { out += line[i++]; continue; }
    const j = line.indexOf('%', i + 1);
    if (j < 0) { out += line.slice(i); break; }
    const name = line.slice(i + 1, j);
    const key = Object.keys(ENV).find((k) => k.toLowerCase() === name.toLowerCase());
    if (key) { out += ENV[key]; i = j + 1; } else { out += '%'; i += 1; }
  }
  return out;
}

function phase2(line) {
  let out = '';
  let q = false;
  const unquotedMeta = [];
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { q = !q; out += c; continue; }
    if (!q && c === '^') { out += line[++i] ?? ''; continue; }
    if (!q && '&|<>'.includes(c)) unquotedMeta.push(c);
    out += c;
  }
  return { out, unquotedMeta };
}

function crt(s) {
  const args = [];
  let cur = '';
  let inArg = false;
  let q = false;
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (c === '\\') {
      let n = 0;
      while (s[i] === '\\') { n++; i++; }
      if (s[i] === '"') {
        cur += '\\'.repeat(Math.floor(n / 2));
        inArg = true;
        if (n % 2) { cur += '"'; i++; }
      } else { cur += '\\'.repeat(n); inArg = true; }
      continue;
    }
    if (c === '"') {
      inArg = true;
      if (q && s[i + 1] === '"') { cur += '"'; i += 2; continue; }
      q = !q; i++; continue;
    }
    if (!q && (c === ' ' || c === '\t')) { if (inArg) { args.push(cur); cur = ''; inArg = false; } i++; continue; }
    cur += c; inArg = true; i++;
  }
  if (inArg) args.push(cur);
  return args;
}

export function roundTrip(argv) {
  const p2 = phase2(phase1(cmdLine(argv)));
  const shim = phase2(p2.out);
  return { argv: crt(shim.out), unquotedMeta: [...p2.unquotedMeta, ...shim.unquotedMeta].join('') };
}
