// The `quote` kind's words as its compositions read them (quote.mjs, quote-desk.mjs, quote-pop.mjs): the quotation
// without the marks an author typed, the kind's own marks, the attribution line and the shared timing. Pure, DOM-free.
import { parseSay, SayError } from '../script/say.mjs';
import { endTimes } from './end.mjs';

export const OPEN_MARK = '“';
export const CLOSE_MARK = '”';
export const BY_SEPARATOR = ' · ';
// Quote marks an author may have typed around the quotation: straight, curly, low and guillemets.
const MARKS_RE = /^["'‘’‚‛“”„‟«»‹›]+|["'‘’‚‛“”„‟«»‹›]+$/gu;

// A say that does not parse has its own validation error; it then gives no words.
function plainSay(say) {
  if (typeof say !== 'string') return '';
  try {
    return parseSay(say).plain;
  } catch (err) {
    if (err instanceof SayError) return '';
    throw err;
  }
}

/** The quotation without the marks an author typed around it. */
export const quoteBody = (text) => text.trim().replace(MARKS_RE, '').trim();

/** The quotation the shot quotes: its `text`, else its say, without typed marks. */
export const quotationOf = (shot) => quoteBody(shot.text ?? plainSay(shot.say));

/** The attribution as one line: who, and their role after a separator. */
export const attributionOf = (shot) => (shot.role === undefined ? shot.by : `${shot.by}${BY_SEPARATOR}${shot.role}`);

/** When the quotation's words land and when the attribution does (end.mjs endTimes: on its own spoken words, else just
 *  after the quotation's last word): { words: [{ at, spoken }], by }. */
export function quoteTimes(shot, timing) {
  const times = endTimes({ say: shot.say, title: quotationOf(shot), ask: attributionOf(shot) }, timing);
  return { words: times.title, by: times.ask };
}
