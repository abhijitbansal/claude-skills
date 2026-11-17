// The `code` kind's preparer (plan 2026-11-16-pa2-shot-kinds-b, Task 8), Node only: shiki 4.5.0's fine-grained core with
// its JavaScript regex engine (no wasm), loading only the grammars of the kind's language list, tokenises each code
// string of a shot against code-theme.json, a theme whose colours are role markers. The result is plain JSON, lines of
// { text, role } with roles plain, keyword, string, number, comment, name, punct; the look maps roles to its palette, so
// no shiki colour reaches the frame. Tabs become two spaces. Nothing is executed: a run shot's command is tokenised as
// shell and its output kept as written. Deterministic: same shot, same JSON.
import { createHighlighterCoreSync } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import javascript from 'shiki/langs/javascript.mjs';
import typescript from 'shiki/langs/typescript.mjs';
import json from 'shiki/langs/json.mjs';
import bash from 'shiki/langs/bash.mjs';
import python from 'shiki/langs/python.mjs';
import diff from 'shiki/langs/diff.mjs';
import go from 'shiki/langs/go.mjs';
import rust from 'shiki/langs/rust.mjs';
import swift from 'shiki/langs/swift.mjs';
import yaml from 'shiki/langs/yaml.mjs';
import html from 'shiki/langs/html.mjs';
import css from 'shiki/langs/css.mjs';
import markdown from 'shiki/langs/markdown.mjs';
import theme from './code-theme.json' with { type: 'json' };
import { resolveLang } from '../../../engine/kinds/code-langs.mjs';

export const ROLES = Object.freeze(['plain', 'keyword', 'string', 'number', 'comment', 'name', 'punct']);
// code-theme.json's marker colour for each role: #000001 plain, #000002 keyword, and so on
const ROLE_OF = Object.freeze(Object.fromEntries(ROLES.map((role, i) => [`#00000${i + 1}`, role])));
const GRAMMARS = Object.freeze([javascript, typescript, json, bash, python, diff, go, rust, swift, yaml, html, css, markdown]);
const TAB = '  ';
const SHELL = 'bash';

let highlighter = null; // built once per process, on the first code shot
const highlighterOf = () => (highlighter ??= createHighlighterCoreSync({ themes: [theme], langs: GRAMMARS.flat(), engine: createJavaScriptRegexEngine() }));

const linesOf = (text) => String(text).replace(/\r\n?/g, '\n').replace(/\t/g, TAB).split('\n');

// Adjacent tokens of one role merged, empty ones dropped.
function merged(tokens) {
  return tokens.reduce((out, t) => {
    if (t.text === '') return out;
    const last = out.at(-1);
    if (last && last.role === t.role) return [...out.slice(0, -1), { text: last.text + t.text, role: t.role }];
    return [...out, t];
  }, []);
}

/** `text` as lines of { text, role } tokens in language `lang` (a resolved name; `text` gives one plain token a line). */
export function tokenise(text, lang) {
  const lines = linesOf(text);
  if (lang === 'text' || lang === null) return lines.map((line) => (line === '' ? [] : [{ text: line, role: 'plain' }]));
  const out = highlighterOf().codeToTokensBase(lines.join('\n'), { lang, theme: theme.name });
  return lines.map((line, k) => merged((out[k] ?? []).map((t) => ({ text: t.content, role: ROLE_OF[t.color?.toLowerCase()] ?? 'plain' }))));
}

/**
 * The prepared data of one code shot: { data: { code } | { before, after } | { command, output }, problems: [] }, each
 * value lines of tokens. A shot's fields have been validated; an unknown lang is drawn as text.
 */
export function prepareCode(shot) {
  const lang = resolveLang(shot.lang ?? 'text');
  const mode = shot.mode ?? 'type';
  if (mode === 'diff') return { data: { before: tokenise(shot.before ?? '', lang), after: tokenise(shot.after ?? '', lang) }, problems: [] };
  if (mode === 'run') return { data: { command: tokenise(shot.command ?? '', SHELL), output: shot.output === undefined ? [] : tokenise(shot.output, 'text') }, problems: [] };
  return { data: { code: tokenise(shot.code ?? '', lang) }, problems: [] };
}
