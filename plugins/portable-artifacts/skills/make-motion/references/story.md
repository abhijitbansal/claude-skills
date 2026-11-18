# Writing a film

How to write the script before you write the JSON. The craft here is advice. The numbers it quotes (pace, the longest a picture may sit still) come from `node scripts/make.mjs --list modes`.

## Write for the picture

Every line of narration names what is on screen while it is said. If a line has nothing to show, cut it or rewrite it until it does.

- A `number` shot says the number and what it counts. A `chart` shot says the claim the highlighted mark proves. A `clipping` shot says what to look at in the picture, and an `on` event circles it on the word that names it.
- One idea per shot. If a shot needs "and also", it is two shots.
- Settle the script before the design. Write every shot with only `id`, `show` and `say`, then run `node scripts/make.mjs film.json --outline`. It prints each shot with its start, end and narration, timed from the word count, with no voice and no browser. Read it aloud. Fix the script, then add the other fields.

## Two arcs

**A professional film** (`"mode": "pro"`): problem, the idea, proof, ask. The pace is 150 words a minute, so a shot of 3 to 6 seconds holds about 8 to 15 words. A picture may sit still for 6 seconds. Open with the problem in the viewer's words, not the product's. End with one ask.

**A short for Reels, TikTok and Shorts** (`"mode": "viral"`): the first shot reads from frame 0, so open on the hook, not a title. Keep it to a few words. Promise the payoff early, change what is on screen at least every 3 seconds (the mode flags a picture that sits still longer), and pay off one open question before the end. Put a soft ask last. The pace is 175 words a minute.

## Storylines first

For a film over 15 seconds, when a person is there to answer, offer three storylines before you write shots: a few lines each, each a different angle on the same facts. The user picks one. When nobody can answer (`claude -p`, `codex exec`, an eval), pick the first and say so in the report.

## Narration

- Write for the ear. Short sentences, one idea each. Write a number as it is spoken in `say` ("four hundred fifty nine"), as digits in `value`. The examples in `--list kinds` do this.
- A list, a timeline or a feed shows one item per sentence, in order. Give the shot one sentence for each item.
- Star the words that carry the point (`*sources*`), a few per film. A film where every line is starred has no emphasis left.
- Mark a pause with `(0.4)` where the picture needs a beat, such as before a number lands.
- Use `--phonemes` on a word with more than one reading (resume, lead, read, live, record) and respell it in `say` until the reading is the one you want.

## Tells to avoid

These make a film look generated.

- A bullet list read aloud word for word. Use `list` with one sentence for each item, or cut to the point.
- A chart with no highlighted mark, so nothing says what to see.
- Every shot a `statement`. Mix the kinds: a figure, a picture, a comparison.
- The same cut on every shot. Let a cut mean something: `match` carries a shared node across, `slide` moves on, a plain `cut` is a change of subject.
- A closing shot that repeats the opening. End on the ask.
- Starred words in every line.
- A look that does not suit the content. `ledger` suits data, `keynote` a product launch, `marker` a whiteboard talk, `cosmos` a science explainer, `poster` a loud claim, `desk` an editorial walk-through, `pop` a fast short.

## What the review tells you

`make.mjs` reads every shot back after it draws it. A `mechanical` finding is a fault with a path: change that field and run again. A `creative` finding is a call for you. Open the sheets, look at every one, and write what a stranger would see. Measurements outrank the eye. You cannot listen to the audio, so write only what the report printed about it.
