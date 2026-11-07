// The one warning a shipped example may carry: a film that opens on a hand-drawn scene starts with a blank board on purpose
// (the thumbnail comes from `--poster`). One pin, shared by check.test.mjs and sketch-examples.test.mjs, anchored on the whole message.
const MESSAGE = String.raw`scene "[^"]+" shows nothing at 0\.00s: the first frame, the video's thumbnail, is blank; a hand-drawn scene starts as an empty board and is drawn on\. Take the thumbnail from a drawn moment with render\.mjs --poster <seconds>, or accept a blank thumbnail`;

/** The message of the blank-board warning as `check.mjs --json` lists it (path `scenes[0]`). */
export const BLANK_BOARD_MESSAGE = new RegExp(`^${MESSAGE}$`);

/** The warning as `check.mjs` prints it on stderr, and nothing else. */
export const BLANK_BOARD_STDERR = new RegExp(`^warning: scenes\\[0\\]: ${MESSAGE}\\n$`);
