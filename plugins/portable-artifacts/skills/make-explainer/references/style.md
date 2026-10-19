# Style: banned phrases

Plain prose beats marketing prose. `validate.mjs` rejects these phrases (case-insensitive, whole word; a hyphen also matches a space) and reports the replacement. One rule per line, written as `phrase`, an arrow, then the replacement. A replacement in parentheses is an instruction, not a literal word.

delve → dig into
delves → digs into
delved → dug into
delving → digging into
elevate → improve
seamless → smooth
seamlessly → smoothly
unleash → enable
game-changer → big change
revolutionize → change
cutting-edge → new
in today's fast-paced → (cut it)
robust and scalable → (say what it handles)
leverage → use
leverages → uses
leveraged → used
leveraging → using
utilize → use
utilizes → uses
utilized → used
utilizing → using
a testament to → shows
embark → start
tapestry → mix
synergy → (say what combines)
paradigm shift → change
unlock the power of → use

The banned-phrase rule reads prose only: text inside `backticks`, a link's URL, a bare `https://` URL and table cells (`rows`) are not checked, since they hold identifiers, commands and quoted values that must stay as written. Link labels, captions and table column headers are prose and are checked.

Other lint rules, enforced in code rather than by this list: emoji are allowed but sparse: a soft warning (never an error) fires when a prose string has 3 or more emoji at more than 1 per 40 characters or a title holds more than 3 (code spans and URLs are not counted), no heading ending in `!`, no section title numbered like `01` or `07` (a leading zero digit; "3 files changed" is fine), and no `TODO:` or lorem ipsum text. Text length is capped by warnings only, never errors (`scripts/lib/budget.mjs`): title 8 words, label 4, paragraph 3 sentences or 60 words, text section 120 words, card text 30, list item 20, page prose 900, tldr 3 points. People do not read walls of text; cut, split, or turn prose into cards, steps or kpis. What counts: `text`, `lead`, `body`, `note`, tldr/compare points, list items, risk `risk` and `mitigation`, compare `verdict` and details `summary` in tldr, text, kpis, cards, risks, steps, compare, callout and details sections count toward the 900-word page total (list items, `risk` and `mitigation` use the 20-word item cap; a `- ` bullet in a text field is a list item). Card, step, item and column `title` fields get the 8-word title cap at any depth. A text, details or callout section is capped at 120 words. Long-form text elsewhere (checklist `intro`, `onFail`, items and notes, timeline text, file notes, every `caption`, image `alt`) only gets a lenient warning per paragraph over 120 words and is not counted toward the page total. Table cells and headers, code, ids, paths and hrefs never count. The page (top-level) `title` is not validated; aim for 8 words anyway. A section `title` states the finding ("Search now ignores case"), not a label ("Overview").

Also avoided, though not enforced: filler openers ("In conclusion"), stacked adjectives, and exclamation marks.
