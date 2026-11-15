// A shot's parsed narration as the list of synthesis calls and silences the speech model is given.
// Pure: no phonemiser, no clock. The model can take at most MAX_IDS ids per call, and the ids depend on phonemes (which
// need the optional package), so the caller injects `countIds(tokenIndexes) -> number` and this module only asks it.
//
// A call ends at a sentence end, at a pause mark (the pause is a `silence`), and at the edge of an aside. With
// emphasisPause 0 an emphasised word never ends a call (stress promotion happens later, at synthesis: the calls only
// keep the token indexes). Above 0 the call ends before an emphasised word and a silence of that length follows.
// `trailingPause` of parseSay is not a token and is not planned here: it belongs to the shot's tail.
import { VOICE_SPEED_MAX } from '../../../engine/modes/index.mjs';
import { VoiceTextError } from './tokens.mjs';

export const ASIDE_SPEED_FACTOR = 1 / 0.85;
export const MAX_IDS = 512;

// A clause ends after a token whose text ends in , ; : or a dash (closing quotes and brackets may follow), or after a
// token that is only a hyphen (a spaced dash).
const CLAUSE_END_RE = /(?:[,;:\u2013\u2014]["')\]}\u201d\u2019]*|^-+)$/;

const silence = (seconds) => ({ kind: 'silence', seconds });
const levelOf = (token) => (token.aside ? 'aside' : 'normal');

function checkOptions({ speed, emphasisPause, countIds }) {
  if (!Number.isFinite(speed) || speed <= 0) throw new TypeError(`planCalls: speed must be a positive number, got ${speed}`);
  if (!Number.isFinite(emphasisPause) || emphasisPause < 0) {
    throw new TypeError(`planCalls: emphasisPause must be a number of seconds, 0 or more, got ${emphasisPause}`);
  }
  if (typeof countIds !== 'function') {
    throw new TypeError('planCalls: countIds(tokenIndexes) is required: it says how many ids a call would have, so the 512 limit can be kept');
  }
}

// Speech calls (`{ kind, tokens, level }`, no speed yet) and silences, cut at sentence ends, pause marks, aside edges
// and, with emphasisPause above 0, before an emphasised word.
function segment(tokens, emphasisPause) {
  const items = [];
  let call = null;
  const close = () => {
    if (call) items.push(call);
    call = null;
  };
  tokens.forEach((token, index) => {
    if (token.pauseBefore > 0) {
      close();
      items.push(silence(token.pauseBefore));
    } else if (call && call.level !== levelOf(token)) {
      close();
    }
    const startsEmphasis = token.emphasis && !tokens[index - 1]?.emphasis;
    if (emphasisPause > 0 && startsEmphasis && call) {
      close();
      items.push(silence(emphasisPause));
    }
    call ??= { kind: 'speech', tokens: [], level: levelOf(token) };
    call.tokens.push(index);
    if (token.sentenceEnd) close();
  });
  close();
  return items;
}

// Splits `indexes` into pieces of at most MAX_IDS ids, each cut after a clause end, taking the longest piece that fits.
function fitIds(indexes, tokens, countIds, shotId) {
  const ids = countIds(indexes);
  if (ids <= MAX_IDS) return [indexes];
  const fits = (end) => countIds(indexes.slice(0, end)) <= MAX_IDS;
  let cut = 0;
  for (let end = 1; end < indexes.length; end++) {
    if (CLAUSE_END_RE.test(tokens[indexes[end - 1]].text) && fits(end)) cut = end;
  }
  if (cut === 0) {
    const where = shotId === undefined ? 'a shot' : `shot "${shotId}"`;
    throw new VoiceTextError(
      `${where}: a stretch of narration is ${ids} model ids, over the limit of ${MAX_IDS}, and has no comma, semicolon, colon or dash to split it at; add punctuation or split the sentence`,
    );
  }
  return [indexes.slice(0, cut), ...fitIds(indexes.slice(cut), tokens, countIds, shotId)];
}

/**
 * `sayTokens` (parseSay(say).tokens) as an array of
 * `{ kind: 'speech', tokens: number[], speed, level: 'normal' | 'aside' }` and `{ kind: 'silence', seconds }`.
 * `tokens` are indexes into `sayTokens`. Aside calls run at speed * ASIDE_SPEED_FACTOR, at most VOICE_SPEED_MAX.
 * `countIds(tokenIndexes)` is the model's id count for a call over those tokens (pads included); a call over MAX_IDS is
 * split at a clause end, and a VoiceTextError naming `shotId` is thrown when it has none.
 */
export function planCalls(sayTokens, { speed, emphasisPause, countIds, shotId } = {}) {
  checkOptions({ speed, emphasisPause, countIds });
  const asideSpeed = Math.min(speed * ASIDE_SPEED_FACTOR, VOICE_SPEED_MAX);
  return segment(sayTokens, emphasisPause).flatMap((item) => {
    if (item.kind === 'silence') return [item];
    const callSpeed = item.level === 'aside' ? asideSpeed : speed;
    return fitIds(item.tokens, sayTokens, countIds, shotId).map((tokens) => ({ kind: 'speech', tokens, speed: callSpeed, level: item.level }));
  });
}
