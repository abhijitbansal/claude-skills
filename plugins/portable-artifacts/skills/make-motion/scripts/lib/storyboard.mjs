// The storyboard step (SKILL.md Workflow step 0): for a clip over 20 s, a make-explainer `plan` page the user answers
// before the spec is written. Pure functions: nothing here reads a file but the sibling check.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { didYouMean } from '../../shared/errors.mjs';
import { listThemes } from '../../shared/theme.mjs';

export const STORYBOARD_MIN_SECONDS = 20;

const MAX_TITLE = 78; // the page title is "Storyboard: <title>", and a make-explainer title holds 90 characters
const MAX_BEAT = 90; // a make-explainer step title holds 90 characters
const MAX_SCENE_ID = 40;
const MAX_SCENES = 50; // the motion spec's own scene limit
const MIN_SCENE_SECONDS = 0.2;
const MAX_SCENE_SECONDS = 60;
const MAX_CLIP_SECONDS = 120;
const SUM_TOLERANCE = 0.01;
const MAX_KEY = 80;
const FALLBACK_KEY = 'storyboard';
const BRIEF_FIELDS = ['title', 'seconds', 'scenes', 'theme'];
const SCENE_FIELDS = ['id', 'beat', 'seconds'];

// The three themes SKILL.md "Choosing a theme" offers, with the one-line feel it gives each.
const OFFERED = [
  { name: 'dusk', feel: 'Soft, warm and playful' },
  { name: 'press', feel: 'Print editorial, calm and long-form' },
  { name: 'poster', feel: 'Loud, condensed and high-energy' },
];
const DEFAULT_THEME = 'dusk';
const PRESS_WORDS = /\b(docs?|documentation|changelog|release notes?|recap|long[- ]?read)\b/i;
const POSTER_WORDS = /\b(launch|pitch|demo|deck|teaser|promo|announcement|energetic)\b/i;

const q = (value) => JSON.stringify(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const seconds = (n) => `${n}s`;

/**
 * Whether to write the storyboard. `explainerDir` is the make-explainer folder beside this skill; `nonInteractive` is
 * declared by the agent (a script cannot tell `claude -p` from an interactive session).
 * -> { action: 'write' } | { action: 'skip', reason }
 */
export function storyboardDecision({ seconds: clipSeconds, explainerDir, nonInteractive }) {
  if (!(clipSeconds > STORYBOARD_MIN_SECONDS)) {
    return { action: 'skip', reason: `not needed (${seconds(clipSeconds)} is ${seconds(STORYBOARD_MIN_SECONDS)} or less)` };
  }
  const marker = path.join(explainerDir, 'SKILL.md');
  if (!existsSync(marker)) return { action: 'skip', reason: `make-explainer is not installed beside make-motion (looked in ${marker})` };
  if (nonInteractive) return { action: 'skip', reason: 'no one to ask (non-interactive run)' };
  return { action: 'write' };
}

function checkScene(scene, i, seen, errors) {
  const at = `brief.scenes[${i}]`;
  if (!isObject(scene)) return errors.push(`${at}: must be an object { "id", "beat", "seconds" }`);
  for (const key of Object.keys(scene)) {
    if (!SCENE_FIELDS.includes(key)) errors.push(`${at}.${key}: unknown field; accepted: ${SCENE_FIELDS.join(', ')}`);
  }
  if (!isText(scene.id) || scene.id.length > MAX_SCENE_ID) errors.push(`${at}.id: must be a scene name of 1 to ${MAX_SCENE_ID} characters, such as "intro"`);
  else if (seen.has(scene.id)) errors.push(`${at}.id: duplicate scene id ${q(scene.id)}; it is also scenes[${seen.get(scene.id)}]`);
  else seen.set(scene.id, i);
  if (!isText(scene.beat) || scene.beat.length > MAX_BEAT) errors.push(`${at}.beat: must be one line of 1 to ${MAX_BEAT} characters saying what the scene shows`);
  const s = scene.seconds;
  if (typeof s !== 'number' || !Number.isFinite(s) || s < MIN_SCENE_SECONDS || s > MAX_SCENE_SECONDS) {
    errors.push(`${at}.seconds: must be a number from ${MIN_SCENE_SECONDS} to ${MAX_SCENE_SECONDS} (got ${q(s)})`);
  }
}

function checkTheme(theme, errors) {
  if (theme === undefined) return;
  const names = listThemes();
  if (typeof theme === 'string' && names.includes(theme)) return;
  const near = typeof theme === 'string' ? didYouMean(theme, names) : null;
  errors.push(`brief.theme: unknown theme ${q(theme)}; ${near ? `did you mean ${q(near)}?` : `available: ${names.join(', ')}`}`);
}

/** The problems with a brief, each `brief.<path>: <message>` that names the fix. [] when it is good. */
export function checkBrief(brief) {
  if (!isObject(brief)) return ['brief: must be a JSON object { "title", "seconds", "scenes": [{ "id", "beat", "seconds" }], "theme"? }'];
  const errors = [];
  for (const key of Object.keys(brief)) {
    if (!BRIEF_FIELDS.includes(key)) errors.push(`brief.${key}: unknown field; accepted: ${BRIEF_FIELDS.join(', ')}`);
  }
  if (!isText(brief.title) || brief.title.length > MAX_TITLE) errors.push(`brief.title: must be 1 to ${MAX_TITLE} characters saying what the clip is about`);
  const total = brief.seconds;
  const totalOk = typeof total === 'number' && Number.isFinite(total) && total > 0 && total <= MAX_CLIP_SECONDS;
  if (!totalOk) errors.push(`brief.seconds: must be a number above 0 and up to ${MAX_CLIP_SECONDS}, the clip's length (got ${q(total)})`);
  if (!Array.isArray(brief.scenes) || brief.scenes.length < 1 || brief.scenes.length > MAX_SCENES) {
    errors.push(`brief.scenes: must be a list of 1 to ${MAX_SCENES} scenes`);
  } else {
    const seen = new Map();
    brief.scenes.forEach((scene, i) => checkScene(scene, i, seen, errors));
    const sum = brief.scenes.reduce((acc, s) => acc + (typeof s?.seconds === 'number' ? s.seconds : 0), 0);
    if (totalOk && errors.length === 0 && Math.abs(sum - total) > SUM_TOLERANCE) {
      errors.push(`brief.seconds: ${total} does not match the scenes, which add up to ${Math.round(sum * 1000) / 1000}; make the two agree`);
    }
  }
  checkTheme(brief.theme, errors);
  return errors;
}

// The key the answers are saved under: the title as lowercase letters, digits and single dashes.
function slug(title) {
  const text = title.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return text.slice(0, MAX_KEY).replace(/-+$/, '') || FALLBACK_KEY;
}

// SKILL.md "Choosing a theme": a theme the brief names wins; otherwise infer from the title; unclear or split is dusk.
function recommendTheme(brief) {
  if (brief.theme !== undefined) return { name: brief.theme, because: `The brief names ${brief.theme}.` };
  const press = PRESS_WORDS.test(brief.title);
  const poster = POSTER_WORDS.test(brief.title);
  if (press && !poster) return { name: 'press', because: 'The title reads as a long read or a changelog, which suits press.' };
  if (poster && !press) return { name: 'poster', because: 'The title reads as a launch, pitch or demo, which suits poster.' };
  return { name: DEFAULT_THEME, because: `Nothing in the title points to press or poster, so ${DEFAULT_THEME} fits.` };
}

function themeDecision(brief) {
  const { name: recommended, because } = recommendTheme(brief);
  const offered = OFFERED.some((t) => t.name === recommended) ? OFFERED : [...OFFERED, { name: recommended, feel: 'Named in the brief' }];
  const fallback = brief.theme ?? DEFAULT_THEME;
  return {
    type: 'decision',
    id: 'decision-1',
    title: 'Pick a theme for the clip',
    label: 'Theme',
    question: 'Which theme should the clip use?',
    options: offered.map((t) => ({ label: t.name, pros: [t.feel] })),
    recommended,
    why: `The Scenes and Beats sections show what the clip says. ${because} If nobody answers, ${fallback} is used.`,
    default: fallback,
  };
}

/** A make-explainer `plan` page for a brief { title, seconds, scenes: [{ id, beat, seconds }], theme? }. */
export function storyboardPlan(brief) {
  const count = brief.scenes.length;
  return {
    title: `Storyboard: ${brief.title}`,
    subtitle: `${count} scenes, ${seconds(brief.seconds)} in all. Answer below and the clip is built from your answers.`,
    preset: 'plan',
    key: slug(brief.title),
    sections: [
      {
        type: 'tldr',
        title: `${count} scenes tell it in ${seconds(brief.seconds)}`,
        label: 'Summary',
        text: `${brief.title}, in ${count} scenes over ${seconds(brief.seconds)}.`,
      },
      {
        type: 'timeline',
        title: 'Each scene has one beat and a length',
        label: 'Scenes',
        items: brief.scenes.map((s, i) => ({ date: `${seconds(s.seconds)} · ${s.id}`, title: `Scene ${i + 1}`, text: s.beat })),
      },
      {
        type: 'steps',
        title: 'One beat per scene, in order',
        label: 'Beats',
        items: brief.scenes.map((s) => ({ title: s.beat, text: `Scene ${s.id}, ${seconds(s.seconds)} on screen.` })),
      },
      themeDecision(brief),
      {
        type: 'approval',
        id: 'approval-1',
        title: 'Build the clip from this storyboard',
        label: 'Storyboard',
        item: `Build the clip from the ${count} scenes above, ${seconds(brief.seconds)} in all.`,
        why: 'Approving fixes the scenes, their order and their lengths. A change after the build costs a re-render.',
      },
      {
        type: 'question',
        id: 'question-1',
        title: 'Say what to change before the build',
        label: 'Changes',
        text: 'Is there anything to change in the scenes, the wording or the order?',
        default: 'Nothing: build it as written',
      },
      {
        type: 'verdict',
        id: 'verdict',
        title: 'Approve, change or stop this storyboard',
        label: 'Your verdict',
        text: 'Build the clip from this storyboard?',
      },
    ],
  };
}
