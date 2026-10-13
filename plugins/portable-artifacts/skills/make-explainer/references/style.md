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

Other lint rules, enforced in code rather than by this list: no emoji or pictographs anywhere, no heading ending in `!`, no section title starting with a number such as `01`, and no `TODO:` or lorem ipsum text. A paragraph over 120 words is a warning. A section `title` states the finding ("Search now ignores case"), not a label ("Overview").

Also avoided, though not enforced: filler openers ("In conclusion"), stacked adjectives, and exclamation marks.
