// The storyboard step for a version 2 film: a make-explainer `plan` page the user answers before a long film is built.
// One timeline event per shot (its id, kind, seconds on the estimated timeline and its narration as plain text), a
// decision for the look, an approval and one open question, then the verdict. The film's words are data in the plan's
// text fields: make-explainer escapes them when it builds the page, and nothing in an answer is executed (the agent reads
// answers only through make-explainer's scripts/answers.mjs). Pure, apart from the default list of looks.
import { parseSay } from '../../engine/script/say.mjs';
import { listEntries } from './list.mjs';

/** A film longer than this many seconds gets a storyboard. */
export const STORYBOARD_MIN_SECONDS = 20;

const MAX_KEY = 80; // make-explainer's key: ^[a-z0-9][a-z0-9._-]*$, at most 80 characters
const MAX_TITLE_NAME = 70; // the page title is "Storyboard: <name>"
const MAX_OPTIONS = 5; // a decision holds 2 to 5 options
const KEY_PREFIX = 'storyboard';
const EN_DASH = '–';

// What gets built once the page is answered: make-explainer asks a plan to explain before it asks.
const NEXT_STEPS = Object.freeze([
  { title: 'The film is changed to match your answers', text: 'The look you pick, and any change you ask for in the shots or the words.' },
  { title: 'The narration is made and timed', text: 'Each shot then lasts as long as its words take, so the times above are estimates.' },
  { title: 'Review sheets, then the MP4', text: 'One command checks every shot and renders the video.' },
]);

const secondsText = (n) => `${n.toFixed(1)}`;
const plainNarration = (shot) => (typeof shot.say === 'string' ? parseSay(shot.say).plain : '');

// The key the answers are saved under: storyboard-<name as lowercase letters, digits and single dashes>.
function keyOf(name) {
  const slug = String(name).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return (slug === '' ? KEY_PREFIX : `${KEY_PREFIX}-${slug}`).slice(0, MAX_KEY).replace(/-+$/, '');
}

// One event per shot, in order.
function shotEvents(film, timeline) {
  return film.shots.map((shot, i) => {
    const { start, end } = timeline.shots[i];
    const said = plainNarration(shot);
    return {
      date: `${secondsText(start)}${EN_DASH}${secondsText(end)} s · ${shot.show}`,
      title: shot.id,
      text: said === '' ? `No narration; on screen for ${secondsText(end - start)} s.` : said,
    };
  });
}

// The look decision: the listed looks with their one-line feel, the film's own recommended and the default. A look the
// film names that is not listed (an experimental one) is offered too.
function lookDecision(film, looks) {
  const listed = looks.map((l) => ({ label: l.name, pros: [l.summary] }));
  const own = film.look;
  const options = listed.some((o) => o.label === own) ? listed : [...listed, { label: own, pros: ['the look the film names (experimental: not in the list)'] }];
  return {
    type: 'decision',
    id: 'look',
    title: `The film is drawn in ${own}`,
    label: 'Look',
    question: 'Which look should the film use?',
    options: options.slice(0, MAX_OPTIONS),
    recommended: own,
    why: `The draft film names ${own}. A look changes the type, the colours and the motion of every shot, not the words or the timing. If nobody answers, ${own} is used.`,
    default: own,
  };
}

/**
 * The make-explainer `plan` page for `film` (defaults filled, as pipeline.mjs loadFilm returns it) on `timeline` (its
 * estimated timeline). `name` titles the page and keys its answers (the film file's name); `looks` are the entries
 * `--list looks` prints (default: list.mjs listEntries('looks')).
 */
export function storyboardPlan(film, timeline, { name, looks = listEntries('looks') }) {
  const count = film.shots.length;
  const total = secondsText(timeline.duration);
  return {
    title: `Storyboard: ${String(name).slice(0, MAX_TITLE_NAME)}`,
    subtitle: `${count} shots, about ${total} s (estimated from the narration and the holds). Answer below and the film is built from your answers.`,
    preset: 'plan',
    key: keyOf(name),
    sections: [
      { type: 'tldr', title: `${count} shots tell it in about ${total} s`, label: 'Summary', text: `${count} shots over about ${total} s, in the ${film.look} look.` },
      { type: 'timeline', title: 'Each shot in order, with what it says', label: 'Shots', items: shotEvents(film, timeline) },
      { type: 'steps', title: 'Your answers go into one build', label: 'What happens next', items: NEXT_STEPS },
      lookDecision(film, looks),
      {
        type: 'approval',
        id: 'approval-1',
        title: 'Build the film from this storyboard',
        label: 'Storyboard',
        item: `Build the film from the ${count} shots above, about ${total} s in all.`,
        why: 'Approving fixes the shots, their order and their words. A change after the build costs a render; the timing is measured when the narration is made.',
      },
      {
        type: 'question',
        id: 'question-1',
        title: 'Say what to change before the build',
        label: 'Changes',
        text: 'Is there anything to change in the shots, the wording or the order?',
        default: 'Nothing: build it as written',
      },
      { type: 'verdict', id: 'verdict', title: 'Approve, change or stop this storyboard', label: 'Your verdict', text: 'Build the film from this storyboard?' },
    ],
  };
}
