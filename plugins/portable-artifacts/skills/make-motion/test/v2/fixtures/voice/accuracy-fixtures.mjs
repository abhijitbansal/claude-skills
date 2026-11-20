// Narration lines for scripts/v2/voice/accuracy.mjs, in make-motion say markup.
//
// FIXTURES are the voice spike's 16 lines, copied verbatim from its tools/fixtures.mjs (2026-11-15) and kept in the same
// order: the lead constants in scripts/v2/voice/words.mjs were fitted on the even-indexed lines (0-based) and the odd
// ones are held out, so the order is part of the measurement. Many clause breaks give silence-adjacent word starts;
// words after breaks mostly start with vowels, sonorants or fricatives (a stop's silent closure reads late on an energy
// onset), with stops kept in a few places.
export const FIXTURES = Object.freeze([
  { id: 'short', say: 'Hello there.' },
  { id: 'commas', say: 'Welcome back, everyone, and thanks for watching.' },
  { id: 'numbers', say: 'In 2024, we shipped three releases, and fixed 12,500 issues.' },
  { id: 'acronym', say: 'The NASA API, as you know, returns JSON, not XML.' },
  { id: 'emphasis', say: 'This is *really* important, and it *is* urgent.' },
  { id: 'pause', say: 'First, we measure. (0.5) Then, we decide.' },
  { id: 'long', say: 'Over the last several months, our small team rebuilt the rendering engine from scratch, rewrote every shader, moved the whole pipeline onto the graphics card, and still found time to fix the oldest bugs in the tracker.' },
  { id: 'ellipsis', say: 'Wait... what happened here?' },
  { id: 'percent', say: 'Sales rose 40 percent, while costs fell by half, so margins doubled.' },
  { id: 'aside', say: 'Our *new* model, _quietly_, outperforms the old one.' },
  { id: 'staccato', say: 'Yes. No. Maybe. Always.' },
  { id: 'clock', say: 'At 3:30, the meeting starts; at 4:15, everyone leaves.' },
  { id: 'question', say: 'So, how does it work? Simply put, it listens, it learns, and it adapts.' },
  { id: 'ipa', say: 'Kokoro, pronounced [Kokoro](/kˈoʊkəɹoʊ/), is a small model.' },
  { id: 'triple', say: 'Every frame matters, every second counts, and every viewer notices.' },
  { id: 'money', say: 'It costs $4.50 a month, or $45 a year, whichever you prefer.' },
].map(Object.freeze));

// Mid-phrase lines: words that start with s or sh right after a vowel or sonorant, with no pause, so silence
// detection cannot see them and the high-band check measures them. `plain-*` are the spike's 8 lines (its
// tools/midphrase.mjs). `stress-*` put the s or sh word under emphasis, which no longer splits the call, so the
// emphasised word is mid-phrase too. Which words are measured is decided from the phoneme string at run time, not here.
export const MIDPHRASE = Object.freeze([
  { id: 'plain-see', say: 'I really see something special here.' },
  { id: 'plain-so', say: 'We owe so much to you.' },
  { id: 'plain-show', say: 'A new show starts every Monday.' },
  { id: 'plain-sea', say: 'The blue sea shines all summer.' },
  { id: 'plain-she', say: 'You know she said so.' },
  { id: 'plain-server', say: 'Our main server sends seven signals.' },
  { id: 'plain-share', say: 'They now share six simple rules.' },
  { id: 'plain-sings', say: 'Every day she sings softly.' },
  { id: 'stress-saw', say: 'Nobody *saw* it coming.' },
  { id: 'stress-she', say: 'They tell me *she* knows the answer.' },
  { id: 'stress-system', say: 'Our new *system* runs all night.' },
  { id: 'stress-spins', say: 'The fan *spins* faster now.' },
  { id: 'stress-sure', say: 'We are *sure* of it.' },
  { id: 'stress-see', say: 'You only *see* the surface.' },
  { id: 'stress-show', say: 'I will *show* you why.' },
  { id: 'stress-signal', say: 'A new *signal* arrives every hour.' },
].map(Object.freeze));

// Lines the reviews asked for, where the token-to-word mapping is easiest to get wrong: a word after an opening quote,
// money read in another word order, and a spaced dash (a token with no phonemes).
export const REVIEW = Object.freeze([
  { id: 'quote', say: 'He said, "so much has changed," and smiled.' },
  { id: 'money-million', say: 'It cost $5 million.' },
  { id: 'dash', say: 'We waited - and then, at last, it rained.' },
].map(Object.freeze));
