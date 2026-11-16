// The `pro` mode: professional explainers. Behaviour only; the look decides appearance.
// wpm: speaking pace; tail: seconds of room after the last word; maxStillSeconds: longest a frame may sit still.
const WPM = 150;
const MAX_STILL_SECONDS = 6;

export const pro = {
  name: 'pro',
  summary: `Professional explainers: 16:9, a calm pace of ${WPM} words a minute, a picture may sit still for ${MAX_STILL_SECONDS} s.`,
  defaultLook: 'desk',
  defaultFormat: '16:9',
  wpm: WPM,
  tail: 0.6,
  maxStillSeconds: MAX_STILL_SECONDS,
  hookFromFrameZero: false, // the first shot may open on its field and bring its words in as they are spoken
  maxLineWords: 12, // the review: a line of more words is a creative finding (absent: no limit)
  captions: false,
  voiceSpeed: 1.0, // Kokoro speed of the narration (0.8 to 1.25, checked by validateMode)
  emphasisPause: 0, // seconds of silence before an emphasised word; 0: emphasis neither splits a call nor pauses
  loudness: Object.freeze({ lufs: -16, truePeakDb: -1.5, lra: 11 }), // the voice master's targets (scripts/v2/voice/master.mjs)
  cues: false, // sound cues are opt-in: a film plays them only when it says "sound": "on" (scripts/v2/sound/cues.mjs)
};
